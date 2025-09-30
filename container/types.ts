import { z } from 'zod';

// ==========================================
// CORE ERROR TYPES
// ==========================================

export const ErrorCategorySchema = z.enum([
  'compilation',    // TypeScript, build tool errors
  'runtime',        // JavaScript runtime exceptions, unhandled promises
  'network',        // Connection failures, timeout errors
  'filesystem',     // Missing files, permission issues
  'dependency',     // Missing packages, version conflicts
  'syntax',         // Parse errors, invalid code
  'memory',         // Out of memory, heap limit exceeded
  'environment',    // Missing env vars, configuration issues
  'unknown'         // Fallback for unmatched patterns
]);
export type ErrorCategory = z.infer<typeof ErrorCategorySchema>;

export const ErrorSeveritySchema = z.enum([
  'fatal',     // Process-terminating errors
  'error',     // Standard errors that break functionality
  'warning',   // Non-breaking issues that should be addressed
  'info'       // Informational messages for debugging
]);
export type ErrorSeverity = z.infer<typeof ErrorSeveritySchema>;

export interface ErrorPattern {
  readonly id: string;
  readonly category: ErrorCategory;
  readonly severity: ErrorSeverity;
  readonly regex: RegExp;
  readonly multiline?: boolean;
  readonly priority: number;
  readonly description: string;
  readonly extractors?: {
    readonly file?: number;
    readonly line?: number;
    readonly column?: number;
    readonly message?: number;
  };
}

export interface ParsedError {
  readonly category: ErrorCategory;
  readonly severity: ErrorSeverity;
  readonly message: string;
  readonly sourceFile?: string;
  readonly lineNumber?: number;
  readonly columnNumber?: number;
  readonly stackTrace?: string;
  readonly patternId?: string;
  readonly rawOutput: string;
  readonly context?: Record<string, unknown>;
}

// ==========================================
// CORE LOG TYPES
// ==========================================

export const LogLevelSchema = z.enum([
  'debug',    // Detailed diagnostic information
  'info',     // General informational messages
  'warn',     // Warning messages (non-error issues)
  'error',    // Error messages (already handled by error system)
  'output'    // Raw process output (stdout/stderr)
]);
export type LogLevel = z.infer<typeof LogLevelSchema>;

export interface LogLine {
  readonly content: string;
  readonly timestamp: Date;
  readonly stream: 'stdout' | 'stderr';
  readonly processId: string;
}

// ==========================================
// STORAGE SCHEMAS
// ==========================================

export const StoredErrorSchema = z.object({
  id: z.number(),
  instanceId: z.string(),
  processId: z.string(),
  errorHash: z.string(),
  category: ErrorCategorySchema,
  severity: ErrorSeveritySchema,
  message: z.string(),
  stackTrace: z.string().nullable(),
  sourceFile: z.string().nullable(),
  lineNumber: z.number().nullable(),
  columnNumber: z.number().nullable(),
  rawOutput: z.string(),
  context: z.string().nullable(),
  firstOccurrence: z.string(),
  lastOccurrence: z.string(),
  occurrenceCount: z.number(),
  createdAt: z.string()
});
export type StoredError = z.infer<typeof StoredErrorSchema>;

export const StoredLogSchema = z.object({
  id: z.number(),
  instanceId: z.string(),
  processId: z.string(),
  level: LogLevelSchema,
  message: z.string(),
  timestamp: z.string(),
  stream: z.enum(['stdout', 'stderr']),
  source: z.string().optional(),
  metadata: z.string().nullable(),
  sequence: z.number(),
  createdAt: z.string()
});
export type StoredLog = z.infer<typeof StoredLogSchema>;

// ==========================================
// PROCESS MONITORING TYPES
// ==========================================

export const ProcessStateSchema = z.enum([
  'starting',
  'running',
  'stopping',
  'stopped',
  'crashed',
  'restarting'
]);
export type ProcessState = z.infer<typeof ProcessStateSchema>;

export interface ProcessInfo {
  readonly id: string;
  readonly instanceId: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly pid?: number;
  readonly state: ProcessState;
  readonly startTime: Date;
  readonly endTime?: Date;
  readonly exitCode?: number;
  readonly restartCount: number;
  readonly lastError?: string;
}

export interface MonitoringOptions {
  readonly restartOnCrash?: boolean;
  readonly maxRestarts?: number;
  readonly restartDelay?: number;
  readonly killTimeout?: number;
  readonly errorBufferSize?: number;
  readonly healthCheckInterval?: number;
}

// ==========================================
// STORAGE OPTIONS
// ==========================================

export interface ErrorStoreOptions {
  readonly maxErrors?: number;
  readonly retentionDays?: number;
  readonly vacuumInterval?: number;
}

export interface LogStoreOptions {
  readonly maxLogs?: number;
  readonly retentionHours?: number;
  readonly bufferSize?: number;
}

// ==========================================
// FILTER & CURSOR TYPES
// ==========================================

export interface ErrorFilter {
  readonly instanceId?: string;
  readonly categories?: readonly ErrorCategory[];
  readonly severities?: readonly ErrorSeverity[];
  readonly since?: Date;
  readonly until?: Date;
  readonly limit?: number;
  readonly offset?: number;
  readonly includeRaw?: boolean;
  readonly sortBy?: 'createdAt' | 'lastOccurrence' | 'occurrenceCount';
  readonly sortOrder?: 'asc' | 'desc';
}

export interface LogFilter {
  readonly instanceId?: string;
  readonly levels?: readonly LogLevel[];
  readonly streams?: readonly ('stdout' | 'stderr')[];
  readonly since?: Date;
  readonly until?: Date;
  readonly limit?: number;
  readonly offset?: number;
  readonly includeMetadata?: boolean;
  readonly sortOrder?: 'asc' | 'desc';
  readonly afterSequence?: number;
}

export interface LogCursor {
  readonly instanceId: string;
  readonly lastSequence: number;
  readonly lastRetrieved: Date;
}

// ==========================================
// SUMMARY TYPES
// ==========================================

export interface ErrorSummary {
  readonly totalErrors: number;
  readonly errorsByCategory: Record<ErrorCategory, number>;
  readonly errorsBySeverity: Record<ErrorSeverity, number>;
  readonly latestError?: Date;
  readonly oldestError?: Date;
  readonly uniqueErrors: number;
  readonly repeatedErrors: number;
}

export interface LogRetrievalResponse {
  readonly success: boolean;
  readonly logs: readonly StoredLog[];
  readonly cursor: LogCursor;
  readonly hasMore: boolean;
  readonly totalCount?: number;
  readonly error?: string;
}

// ==========================================
// MONITORING EVENTS
// ==========================================

export const MonitoringEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('process_started'),
    processId: z.string(),
    instanceId: z.string(),
    pid: z.number(),
    command: z.string(),
    timestamp: z.date()
  }),
  z.object({
    type: z.literal('process_stopped'),
    processId: z.string(),
    instanceId: z.string(),
    exitCode: z.number().nullable(),
    reason: z.string(),
    timestamp: z.date()
  }),
  z.object({
    type: z.literal('error_detected'),
    processId: z.string(),
    instanceId: z.string(),
    error: z.object({
      category: ErrorCategorySchema,
      severity: ErrorSeveritySchema,
      message: z.string(),
      hash: z.string(),
      isNewError: z.boolean()
    }),
    timestamp: z.date()
  }),
  z.object({
    type: z.literal('process_crashed'),
    processId: z.string(),
    instanceId: z.string(),
    exitCode: z.number().nullable(),
    signal: z.string().nullable(),
    willRestart: z.boolean(),
    timestamp: z.date()
  })
]);
export type MonitoringEvent = z.infer<typeof MonitoringEventSchema>;

// ==========================================
// CONFIGURATION TYPES
// ==========================================

export interface ProcessRunnerConfig {
  readonly instanceId: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly monitoring: MonitoringOptions;
  readonly storage: ErrorStoreOptions;
}

// ==========================================
// UTILITY TYPES
// ==========================================

export type Result<T, E = Error> = 
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: E };

// ==========================================
// CONSTANTS
// ==========================================

export const DEFAULT_MONITORING_OPTIONS: MonitoringOptions = {
  restartOnCrash: true,
  maxRestarts: 3,
  restartDelay: 1000,
  killTimeout: 10000,
  errorBufferSize: 100,
  healthCheckInterval: 30000
} as const;

export const DEFAULT_STORAGE_OPTIONS: ErrorStoreOptions = {
  maxErrors: 1000,
  retentionDays: 7,
  vacuumInterval: 24
} as const;

export const DEFAULT_LOG_STORE_OPTIONS: LogStoreOptions = {
  maxLogs: 10000,
  retentionHours: 168, // 7 days
  bufferSize: 1000
} as const;

// Configurable paths - use environment variables or default to ./data directory
export const getDataDirectory = (): string => {
  return process.env.CLI_DATA_DIR || './data';
};

export const getErrorDbPath = (): string => {
  return process.env.CLI_ERROR_DB_PATH || `${getDataDirectory()}/errors.db`;
};

export const getLogDbPath = (): string => {
  return process.env.CLI_LOG_DB_PATH || `${getDataDirectory()}/logs.db`;
};

// CLI tools path resolution for different environments
export const getCliToolsPath = (): string => {
  // In Docker container, use absolute path
  if (process.env.CONTAINER_ENV === 'docker') {
    return '/app/container/cli-tools.ts';
  }
  
  // For local development, try to find the cli-tools.ts file
  const path = require('path');
  const fs = require('fs');
  
  // Common locations to check
  const possiblePaths = [
    './cli-tools.ts',
    './container/cli-tools.ts',
    '../container/cli-tools.ts',
    path.join(__dirname, 'cli-tools.ts'),
    path.join(process.cwd(), 'container/cli-tools.ts')
  ];
  
  for (const possiblePath of possiblePaths) {
    try {
      if (fs.existsSync(possiblePath)) {
        return path.resolve(possiblePath);
      }
    } catch (error) {
      // Continue checking other paths
    }
  }
  
  // Fallback to relative path
  return './cli-tools.ts';
};

// Legacy constants for backward compatibility
export const ERROR_DB_PATH = getErrorDbPath();
export const LOG_DB_PATH = getLogDbPath();
export const ERROR_HASH_ALGORITHM = 'sha256' as const;