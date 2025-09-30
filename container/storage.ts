import { Database } from 'bun:sqlite';
import { createHash } from 'crypto';
import { 
  StoredError, 
  StoredLog,
  ParsedError,
  LogLevel,
  ErrorSummary,
  ErrorStoreOptions,
  LogStoreOptions,
  LogFilter,
  LogCursor,
  LogRetrievalResponse,
  Result,
  getErrorDbPath,
  getLogDbPath,
  ERROR_HASH_ALGORITHM,
  DEFAULT_STORAGE_OPTIONS,
  DEFAULT_LOG_STORE_OPTIONS
} from './types.js';

export interface ProcessLog {
  readonly instanceId: string;
  readonly processId: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly stream: 'stdout' | 'stderr';
  readonly source?: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Unified storage manager with shared database connections and optimized operations
 */
export class StorageManager {
  private errorDb: Database;
  private logDb: Database;
  private errorStorage: ErrorStorage;
  private logStorage: LogStorage;
  private options: {
    error: Required<ErrorStoreOptions>;
    log: Required<LogStoreOptions>;
  };

  constructor(
    errorDbPath: string = getErrorDbPath(),
    logDbPath: string = getLogDbPath(),
    options: { error?: ErrorStoreOptions; log?: LogStoreOptions } = {}
  ) {
    this.options = {
      error: { ...DEFAULT_STORAGE_OPTIONS, ...options.error } as Required<ErrorStoreOptions>,
      log: { ...DEFAULT_LOG_STORE_OPTIONS, ...options.log } as Required<LogStoreOptions>
    };

    // Ensure data directories exist
    this.ensureDataDirectory(errorDbPath);
    if (errorDbPath !== logDbPath) {
      this.ensureDataDirectory(logDbPath);
    }

    // Initialize databases with optimal settings
    this.errorDb = this.initializeDatabase(errorDbPath);
    this.logDb = errorDbPath === logDbPath ? this.errorDb : this.initializeDatabase(logDbPath);

    // Initialize storage components
    this.errorStorage = new ErrorStorage(this.errorDb, this.options.error);
    this.logStorage = new LogStorage(this.logDb, this.options.log);

    // Setup periodic maintenance
    this.setupMaintenanceTasks();
  }

  private ensureDataDirectory(dbPath: string): void {
    const fs = require('fs');
    const path = require('path');
    const dir = path.dirname(dbPath);
    
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private initializeDatabase(dbPath: string): Database {
    const fs = require('fs');
    
    // Check if database already exists to avoid race conditions during initialization
    const dbExists = fs.existsSync(dbPath);
    
    const db = new Database(dbPath);
    
    // Only set pragmas if this is a new database to avoid conflicts
    if (!dbExists) {
      try {
        // Optimal performance settings for container environment
        db.exec('PRAGMA journal_mode = WAL');
        db.exec('PRAGMA synchronous = NORMAL');
        db.exec('PRAGMA cache_size = 10000');
        db.exec('PRAGMA temp_store = memory');
      } catch (error) {
        // If pragma setup fails (due to concurrent access), continue anyway
        console.warn('Database pragma setup failed (this is okay if database already initialized):', error);
      }
    }
    
    return db;
  }

  private setupMaintenanceTasks(): void {
    // Cleanup old records every hour
    setInterval(() => {
      this.errorStorage.cleanupOldErrors();
      this.logStorage.cleanupOldLogs();
    }, 60 * 60 * 1000);
  }

  // Error storage methods
  public storeError(instanceId: string, processId: string, error: ParsedError): Result<boolean> {
    try {
      return this.retryOperation(() => this.errorStorage.storeError(instanceId, processId, error));
    } catch (retryError) {
      return { success: false, error: retryError instanceof Error ? retryError : new Error(String(retryError)) };
    }
  }

  public getErrors(instanceId: string): Result<StoredError[]> {
    try {
      return this.retryOperation(() => this.errorStorage.getErrors(instanceId));
    } catch (retryError) {
      return { success: false, error: retryError instanceof Error ? retryError : new Error(String(retryError)) };
    }
  }

  public getErrorSummary(instanceId: string): Result<ErrorSummary> {
    try {
      return this.retryOperation(() => this.errorStorage.getErrorSummary(instanceId));
    } catch (retryError) {
      return { success: false, error: retryError instanceof Error ? retryError : new Error(String(retryError)) };
    }
  }

  public clearErrors(instanceId: string): Result<{ clearedCount: number }> {
    try {
      return this.retryOperation(() => this.errorStorage.clearErrors(instanceId));
    } catch (retryError) {
      return { success: false, error: retryError instanceof Error ? retryError : new Error(String(retryError)) };
    }
  }

  // Log storage methods
  public storeLog(log: ProcessLog): Result<number> {
    return this.logStorage.storeLog(log);
  }

  public storeLogs(logs: ProcessLog[]): Result<number[]> {
    return this.logStorage.storeLogs(logs);
  }

  public getLogs(filter: LogFilter = {}): Result<LogRetrievalResponse> {
    return this.logStorage.getLogs(filter);
  }


  public clearLogs(instanceId: string): Result<{ clearedCount: number }> {
    return this.logStorage.clearLogs(instanceId);
  }

  public getLogStats(instanceId: string): Result<{
    totalLogs: number;
    logsByLevel: Record<LogLevel, number>;
    logsByStream: Record<'stdout' | 'stderr', number>;
    oldestLog?: Date;
    newestLog?: Date;
  }> {
    return this.logStorage.getLogStats(instanceId);
  }

  /**
   * Retry operation with exponential backoff for SQLITE_BUSY errors
   * Uses synchronous retry for immediate operations to maintain performance
   */
  private retryOperation<T>(operation: () => T, maxAttempts: number = 3): T {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Check if it's a SQLite busy error
        if (lastError.message.includes('SQLITE_BUSY') || lastError.message.includes('database is locked')) {
          if (attempt < maxAttempts) {
            // Use minimal delay for SQLite contention - most resolve quickly
            const delay = Math.min(10 * Math.pow(2, attempt - 1), 100); // Cap at 100ms
            const start = Date.now();
            while (Date.now() - start < delay) {
              // Minimal busy wait for SQLite - usually resolves in microseconds
            }
            continue;
          }
        }
        
        // If not a busy error, or max attempts reached, throw immediately
        throw lastError;
      }
    }
    
    throw lastError!;
  }

  /**
   * Unified transaction support for batch operations
   */
  public transaction<T>(operation: () => T): T {
    // Use error database for transaction coordination
    const transaction = this.errorDb.transaction(operation);
    return transaction();
  }

  /**
   * Close all database connections and cleanup
   */
  public close(): void {
    try {
      this.errorStorage.close();
      this.logStorage.close();
      
      if (this.errorDb !== this.logDb) {
        this.logDb.close();
      }
      this.errorDb.close();
    } catch (error) {
      console.error('Error closing storage manager:', error);
    }
  }
}

/**
 * Error storage component with optimized SQLite operations
 */
class ErrorStorage {
  private db: Database;
  private options: Required<ErrorStoreOptions>;
  
  // Prepared statements for maximum performance  
  private insertErrorStmt: ReturnType<Database['query']>;
  private selectErrorsStmt: ReturnType<Database['query']>;
  private countErrorsStmt: ReturnType<Database['query']>;
  private deleteAllErrorsStmt: ReturnType<Database['query']>;
  private deleteOldErrorsStmt: ReturnType<Database['query']>;

  constructor(db: Database, options: Required<ErrorStoreOptions>) {
    this.db = db;
    this.options = options;
    this.initializeSchema();
    this.prepareStatements();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runtime_errors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id TEXT NOT NULL,
        process_id TEXT NOT NULL,
        error_hash TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL,
        severity TEXT NOT NULL,
        message TEXT NOT NULL,
        stack_trace TEXT,
        source_file TEXT,
        line_number INTEGER,
        column_number INTEGER,
        raw_output TEXT NOT NULL,
        first_occurrence TEXT NOT NULL,
        last_occurrence TEXT NOT NULL,
        occurrence_count INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_instance_errors ON runtime_errors(instance_id);
      CREATE INDEX IF NOT EXISTS idx_error_hash ON runtime_errors(error_hash);
      CREATE INDEX IF NOT EXISTS idx_last_occurrence ON runtime_errors(last_occurrence DESC);
      CREATE INDEX IF NOT EXISTS idx_severity ON runtime_errors(severity);
    `);
  }

  private prepareStatements(): void {
    this.insertErrorStmt = this.db.query(`
      INSERT INTO runtime_errors (
        instance_id, process_id, error_hash, category, severity, message,
        stack_trace, source_file, line_number, column_number, raw_output,
        first_occurrence, last_occurrence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(error_hash) DO UPDATE SET
        last_occurrence = excluded.last_occurrence,
        occurrence_count = occurrence_count + 1
    `);

    this.selectErrorsStmt = this.db.query(`
      SELECT * FROM runtime_errors 
      WHERE instance_id = ?
      ORDER BY last_occurrence DESC
    `);

    this.countErrorsStmt = this.db.query(`
      SELECT COUNT(*) as count FROM runtime_errors WHERE instance_id = ?
    `);

    this.deleteAllErrorsStmt = this.db.query(`
      DELETE FROM runtime_errors WHERE instance_id = ?
    `);

    this.deleteOldErrorsStmt = this.db.query(`
      DELETE FROM runtime_errors 
      WHERE datetime(created_at) < datetime('now', '-' || ? || ' days')
    `);
  }

  public storeError(instanceId: string, processId: string, error: ParsedError): Result<boolean> {
    try {
      const errorHash = this.generateErrorHash(error);
      const now = new Date().toISOString();

      this.insertErrorStmt.run(
        instanceId, processId, errorHash, error.category, error.severity,
        error.message, error.stackTrace || null, error.sourceFile || null,
        error.lineNumber || null, error.columnNumber || null, error.rawOutput,
        now, now
      );
      
      return { success: true, data: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error : new Error('Unknown error storing error') 
      };
    }
  }

  public getErrors(instanceId: string): Result<StoredError[]> {
    try {
      const errors = this.selectErrorsStmt.all(instanceId) as StoredError[];
      return { success: true, data: errors };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error : new Error('Unknown error retrieving errors') 
      };
    }
  }

  public getErrorSummary(instanceId: string): Result<ErrorSummary> {
    try {
      const errors = this.selectErrorsStmt.all(instanceId) as StoredError[];
      
      if (errors.length === 0) {
        return {
          success: true,
          data: {
            totalErrors: 0,
            errorsByCategory: {} as Record<string, number>,
            errorsBySeverity: {} as Record<string, number>,
            uniqueErrors: 0,
            repeatedErrors: 0,
            latestError: undefined,
            oldestError: undefined
          }
        };
      }

      const categoryCount: Record<string, number> = {};
      const severityCount: Record<string, number> = {};
      let totalOccurrences = 0;

      for (const error of errors) {
        categoryCount[error.category] = (categoryCount[error.category] || 0) + 1;
        severityCount[error.severity] = (severityCount[error.severity] || 0) + 1;
        totalOccurrences += error.occurrenceCount;
      }

      const summary: ErrorSummary = {
        totalErrors: totalOccurrences,
        uniqueErrors: errors.length,
        repeatedErrors: totalOccurrences - errors.length,
        errorsByCategory: categoryCount,
        errorsBySeverity: severityCount,
        latestError: new Date(errors[0].lastOccurrence),
        oldestError: new Date(errors[errors.length - 1].firstOccurrence)
      };

      return { success: true, data: summary };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error : new Error('Unknown error getting summary') 
      };
    }
  }

  public clearErrors(instanceId: string): Result<{ clearedCount: number }> {
    try {
      const countResult = this.countErrorsStmt.get(instanceId) as { count: number };
      const clearedCount = countResult?.count || 0;
      
      this.deleteAllErrorsStmt.run(instanceId);
      
      return { success: true, data: { clearedCount } };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error : new Error('Unknown error clearing errors') 
      };
    }
  }

  public cleanupOldErrors(): Result<number> {
    try {
      const result = this.deleteOldErrorsStmt.run(this.options.retentionDays);
      return { success: true, data: result.changes };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error : new Error('Unknown error cleaning up errors') 
      };
    }
  }

  private generateErrorHash(error: ParsedError): string {
    const hashInput = [
      error.message.trim(),
      error.sourceFile || ''
    ].join('|');

    return createHash(ERROR_HASH_ALGORITHM)
      .update(hashInput)
      .digest('hex');
  }

  public close(): void {
    // Database connection is managed by StorageManager
  }
}

/**
 * Log storage component with cursor-based pagination and in-memory buffering
 */
class LogStorage {
  private db: Database;
  private options: Required<LogStoreOptions>;
  
  // Prepared statements
  private insertLogStmt: ReturnType<Database['query']>;
  private selectLogsStmt: ReturnType<Database['query']>;
  private selectLogsSinceStmt: ReturnType<Database['query']>;
  private countLogsStmt: ReturnType<Database['query']>;
  private deleteOldLogsStmt: ReturnType<Database['query']>;
  private getLastSequenceStmt: ReturnType<Database['query']>;
  private deleteAllLogsStmt: ReturnType<Database['query']>;

  private sequenceCounter = 0;

  constructor(db: Database, options: Required<LogStoreOptions>) {
    this.db = db;
    this.options = options;
    this.initializeSchema();
    this.prepareStatements();
    this.initializeSequenceCounter();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS process_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id TEXT NOT NULL,
        process_id TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        stream TEXT NOT NULL,
        source TEXT,
        metadata TEXT,
        sequence INTEGER UNIQUE NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_instance_logs ON process_logs(instance_id);
      CREATE INDEX IF NOT EXISTS idx_sequence ON process_logs(sequence);
      CREATE INDEX IF NOT EXISTS idx_timestamp ON process_logs(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_level ON process_logs(level);
      CREATE INDEX IF NOT EXISTS idx_instance_sequence ON process_logs(instance_id, sequence);
    `);
  }

  private prepareStatements(): void {
    this.insertLogStmt = this.db.query(`
      INSERT INTO process_logs (
        instance_id, process_id, level, message, timestamp, 
        stream, source, metadata, sequence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.selectLogsStmt = this.db.query(`
      SELECT * FROM process_logs 
      WHERE instance_id = ?
      ORDER BY sequence DESC
      LIMIT ? OFFSET ?
    `);

    this.selectLogsSinceStmt = this.db.query(`
      SELECT * FROM process_logs 
      WHERE instance_id = ? AND sequence > ?
      ORDER BY sequence ASC
      LIMIT ?
    `);

    this.countLogsStmt = this.db.query(`
      SELECT COUNT(*) as count FROM process_logs WHERE instance_id = ?
    `);

    this.deleteOldLogsStmt = this.db.query(`
      DELETE FROM process_logs 
      WHERE datetime(timestamp) < datetime('now', '-' || ? || ' hours')
    `);

    this.getLastSequenceStmt = this.db.query(`
      SELECT MAX(sequence) as maxSequence FROM process_logs
    `);

    this.deleteAllLogsStmt = this.db.query(`
      DELETE FROM process_logs WHERE instance_id = ?
    `);
  }

  private initializeSequenceCounter(): void {
    const result = this.getLastSequenceStmt.get() as { maxSequence: number | null };
    this.sequenceCounter = (result?.maxSequence || 0) + 1;
  }

  public storeLog(log: ProcessLog): Result<number> {
    try {
      const sequence = this.sequenceCounter++;
      const now = new Date().toISOString();
      
      this.insertLogStmt.run(
        log.instanceId, log.processId, log.level, log.message, now,
        log.stream, log.source || null, 
        log.metadata ? JSON.stringify(log.metadata) : null, sequence
      );


      return { success: true, data: sequence };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error : new Error('Unknown error storing log') 
      };
    }
  }

  public storeLogs(logs: ProcessLog[]): Result<number[]> {
    try {
      const sequences: number[] = [];
      const transaction = this.db.transaction(() => {
        for (const log of logs) {
          const result = this.storeLog(log);
          if (result.success) {
            sequences.push(result.data);
          } else {
            throw result.error;
          }
        }
      });

      transaction();
      return { success: true, data: sequences };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error : new Error('Unknown error storing logs') 
      };
    }
  }

  public getLogs(filter: LogFilter = {}): Result<LogRetrievalResponse> {
    try {
      const instanceId = filter.instanceId || '';
      const limit = filter.limit || 100;
      const offset = filter.offset || 0;

      const logs = this.selectLogsStmt.all(instanceId, limit, offset) as StoredLog[];
      const countResult = this.countLogsStmt.get(instanceId) as { count: number };
      const totalCount = countResult?.count || 0;

      const lastSequence = logs.length > 0 ? Math.max(...logs.map(l => l.sequence)) : 0;
      const cursor: LogCursor = {
        instanceId,
        lastSequence,
        lastRetrieved: new Date()
      };

      const hasMore = offset + logs.length < totalCount;

      return {
        success: true,
        data: {
          success: true,
          logs,
          cursor,
          hasMore,
          totalCount
        }
      };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error : new Error('Unknown error retrieving logs') 
      };
    }
  }


  public clearLogs(instanceId: string): Result<{ clearedCount: number }> {
    try {
      const countResult = this.countLogsStmt.get(instanceId) as { count: number };
      const clearedCount = countResult?.count || 0;
      
      this.deleteAllLogsStmt.run(instanceId);

      return { success: true, data: { clearedCount } };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error : new Error('Unknown error clearing logs') 
      };
    }
  }

  public getLogStats(instanceId: string): Result<{
    totalLogs: number;
    logsByLevel: Record<LogLevel, number>;
    logsByStream: Record<'stdout' | 'stderr', number>;
    oldestLog?: Date;
    newestLog?: Date;
  }> {
    try {
      const stats = this.db.query(`
        SELECT 
          COUNT(*) as total,
          level,
          stream,
          MIN(timestamp) as oldest,
          MAX(timestamp) as newest
        FROM process_logs 
        WHERE instance_id = ?
        GROUP BY level, stream
      `).all(instanceId) as Array<{
        total: number;
        level: LogLevel;
        stream: 'stdout' | 'stderr';
        oldest: string;
        newest: string;
      }>;

      const logsByLevel: Record<string, number> = {};
      const logsByStream: Record<string, number> = {};
      let totalLogs = 0;
      let oldestLog: Date | undefined;
      let newestLog: Date | undefined;

      for (const stat of stats) {
        totalLogs += stat.total;
        logsByLevel[stat.level] = (logsByLevel[stat.level] || 0) + stat.total;
        logsByStream[stat.stream] = (logsByStream[stat.stream] || 0) + stat.total;
        
        const oldest = new Date(stat.oldest);
        const newest = new Date(stat.newest);
        
        if (!oldestLog || oldest < oldestLog) oldestLog = oldest;
        if (!newestLog || newest > newestLog) newestLog = newest;
      }

      return {
        success: true,
        data: {
          totalLogs,
          logsByLevel: logsByLevel as Record<LogLevel, number>,
          logsByStream: logsByStream as Record<'stdout' | 'stderr', number>,
          oldestLog,
          newestLog
        }
      };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error : new Error('Unknown error getting log stats') 
      };
    }
  }

  public cleanupOldLogs(): Result<number> {
    try {
      const result = this.deleteOldLogsStmt.run(this.options.retentionHours);
      return { success: true, data: result.changes };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error : new Error('Unknown error cleaning up logs') 
      };
    }
  }

  public close(): void {
    // Database connection is managed by StorageManager
  }
}