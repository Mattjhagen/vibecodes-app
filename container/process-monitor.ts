/**
 * Enhanced Process Monitor with Inlined Patterns and Robust Framework Support
 * Comprehensive monitoring for Vite+React/Next.js development servers
 * Handles both structured and unstructured console output gracefully
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { StorageManager } from './storage.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { 
  ProcessInfo, 
  ProcessState, 
  MonitoringOptions, 
  MonitoringEvent, 
  LogLine,
  ParsedError,
  ErrorPattern,
  ErrorCategory,
  ErrorSeverity,
  LogLevel,
  Result,
  StoredError,
  DEFAULT_MONITORING_OPTIONS,
  getDataDirectory 
} from './types.js';

/**
 * Simple file-based log manager for raw process output
 * Maintains a rolling log file with automatic size management
 * Optimized for minimal I/O overhead with batched size checks
 */
class SimpleLogManager {
  private logFilePath: string;
  private maxLines: number;
  private maxFileSize: number; // in bytes
  private appendCount = 0;
  private static readonly CHECK_INTERVAL = 100; // Check file size every 100 appends

  constructor(instanceId: string, maxLines: number = 1000, maxFileSize: number = 1024 * 1024) { // 1MB default
    this.logFilePath = join(getDataDirectory(), `${instanceId}-process.log`);
    this.maxLines = maxLines;
    this.maxFileSize = maxFileSize;
  }

  /**
   * Append a line to the log file with batched size checking for performance
   */
  async appendLog(content: string, stream: 'stdout' | 'stderr'): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      const logLine = `[${timestamp}] [${stream}] ${content}\n`;
      
      await fs.appendFile(this.logFilePath, logLine, 'utf8');
      
      // Only check file size periodically to reduce I/O overhead
      if (++this.appendCount % SimpleLogManager.CHECK_INTERVAL === 0) {
        await this.trimLogIfNeeded();
      }
    } catch (error) {
      console.warn('Failed to append to log file:', error);
    }
  }

  /**
   * Get all logs since last call and reset the file atomically
   * Uses file renaming for atomic operation to avoid loss of logs
   */
  async getAllLogsAndReset(): Promise<string> {
    try {
      const tempPath = `${this.logFilePath}.tmp.${Date.now()}`;
      
      // Atomic operation: rename current file to temp, create new empty file
      try {
        await fs.rename(this.logFilePath, tempPath);
      } catch (error) {
        // File doesn't exist yet, return empty
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          return '';
        }
        throw error;
      }
      
      // Create new empty log file immediately
      await fs.writeFile(this.logFilePath, '', 'utf8').catch(() => {});
      
      // Read from temp file and clean up
      try {
        const logs = await fs.readFile(tempPath, 'utf8');
        await fs.unlink(tempPath).catch(() => {}); // Clean up temp file
        return logs;
      } catch (error) {
        // If we can't read temp file, at least clean it up
        await fs.unlink(tempPath).catch(() => {});
        return '';
      }
    } catch (error) {
      console.warn('Failed to atomically read/reset log file:', error);
      return '';
    }
  }

  /**
   * Trim log file if it exceeds size or line limits
   */
  private async trimLogIfNeeded(): Promise<void> {
    try {
      const stats = await fs.stat(this.logFilePath).catch(() => null);
      if (!stats) return;

      // Check file size
      if (stats.size > this.maxFileSize) {
        await this.trimLogFile();
        return;
      }

      // Check line count (only if file is reasonably sized)
      if (stats.size > 50000) { // Only check lines if file is > 50KB
        const content = await fs.readFile(this.logFilePath, 'utf8');
        const lines = content.split('\n');
        
        if (lines.length > this.maxLines) {
          await this.trimLogFile();
        }
      }
    } catch (error) {
      console.warn('Failed to trim log file:', error);
    }
  }

  /**
   * Trim log file to keep only recent entries
   */
  private async trimLogFile(): Promise<void> {
    try {
      const content = await fs.readFile(this.logFilePath, 'utf8');
      const lines = content.split('\n');
      
      // Keep last 70% of max lines to avoid frequent trimming
      const keepLines = Math.floor(this.maxLines * 0.7);
      const trimmedContent = lines.slice(-keepLines).join('\n');
      
      await fs.writeFile(this.logFilePath, trimmedContent, 'utf8');
    } catch (error) {
      console.warn('Failed to trim log file:', error);
    }
  }

  /**
   * Cleanup - remove log file
   */
  async cleanup(): Promise<void> {
    try {
      await fs.unlink(this.logFilePath).catch(() => {});
    } catch (error) {
      console.warn('Failed to cleanup log file:', error);
    }
  }
}

/**
 * General error patterns for robust error detection across any codebase
 * Focuses on fundamental error structures rather than framework-specific patterns
 */
const GENERAL_ERROR_PATTERNS: readonly ErrorPattern[] = [
  // ==========================================
  // STACK TRACE ERRORS (High Priority)
  // ==========================================
  {
    id: 'stack_trace_error',
    category: 'runtime',
    severity: 'error',
    priority: 95,
    regex: /^(.+?Error): (.+?)(?:\n.*?)*?(?:\n\s*at\s+[^(]*\(([^:)]+):(\d+):(\d+)\))/s,
    description: 'Any error with stack trace',
    extractors: { message: 2, file: 3, line: 4, column: 5 },
    multiline: true
  },

  // ==========================================
  // ERROR PREFIX PATTERNS (High Priority)
  // ==========================================
  {
    id: 'fatal_error',
    category: 'runtime',
    severity: 'fatal',
    priority: 100,
    regex: /^(?:FATAL|Fatal)(?:\s+ERROR)?:\s*(.+?)(?:\n|$)/s,
    description: 'Fatal error messages',
    extractors: { message: 1 },
    multiline: true
  },
  {
    id: 'error_prefix',
    category: 'runtime',
    severity: 'error',
    priority: 90,
    regex: /^(?:ERROR|Error):\s*(.+?)(?:\n|$)/s,
    description: 'Error prefix messages',
    extractors: { message: 1 },
    multiline: true
  },
  {
    id: 'exception_prefix',
    category: 'runtime',
    severity: 'error',
    priority: 85,
    regex: /^(?:Exception|EXCEPTION):\s*(.+?)(?:\n|$)/s,
    description: 'Exception prefix messages',
    extractors: { message: 1 },
    multiline: true
  },

  // ==========================================
  // PROCESS HEALTH ERRORS (High Priority)
  // ==========================================
  {
    id: 'process_health',
    category: 'runtime',
    severity: 'error',
    priority: 80,
    regex: /(process unresponsive|process crashed|process failed|timeout|unresponsive|crashed)/i,
    description: 'Process health and monitoring errors',
    extractors: { message: 1 }
  },

  // ==========================================
  // BUILD/TRANSFORM ERRORS (High Priority)
  // ==========================================
  {
    id: 'build_transform_error',
    category: 'compilation',
    severity: 'error',
    priority: 85,
    regex: /(?:Transform|Build|Compilation)\s+failed\s+with\s+\d+\s+errors?[:\n]\s*(.+?)(?:\n(?!\s)|$)/s,
    description: 'Build and transform failures',
    extractors: { message: 1 },
    multiline: true
  },

  // ==========================================
  // JSON ERROR OBJECTS (Medium Priority)
  // ==========================================
  {
    id: 'json_error_object',
    category: 'runtime',
    severity: 'error',
    priority: 75,
    regex: /\{[^{}]*?(?:"error"|"message"|"code")[^{}]*?\}/s,
    description: 'JSON error objects',
    extractors: { message: 0 },
    multiline: true
  },
  // ==========================================
  // FILE LOCATION PATTERNS (Medium Priority)
  // ==========================================
  {
    id: 'file_location_error',
    category: 'compilation',
    severity: 'error',
    priority: 70,
    regex: /(.+?):(\d+):(\d+):\s*(?:ERROR|Error|error):\s*(.+)/,
    description: 'Errors with file location',
    extractors: { file: 1, line: 2, column: 3, message: 4 }
  },

  // ==========================================
  // GENERIC STDERR FALLBACK (Low Priority)
  // ==========================================
  {
    id: 'stderr_fallback',
    category: 'runtime',
    severity: 'error',
    priority: 30,
    regex: /.+/s,
    description: 'Generic stderr content fallback',
    extractors: { message: 0 },
    multiline: true
  }
] as const;

/**
 * Intelligent log classifier for modern development frameworks
 * Handles both structured logs and raw console output
 */
class LogClassifier {
  // Only patterns that indicate real problems breaking functionality
  private static readonly ERROR_INDICATORS = [
    // Real error patterns - exclude development server noise
    /\bFATAL/i, /\bcrash\b/i, /\bexception\b/i,
    /\buncaught\b/i, /\bunhandled\b/i, /\bfailed to compile/i,
    /\bsyntaxerror\b/i, /\btypeerror\b/i, /\breferenceerror\b/i,
    /\bmodule not found/i, /\beconnrefused\b/i, /\beaddrinuse\b/i,
    /\btransform failed/i, /\bbuild failed/i, /\bcompilation failed/i,
    
    // More specific ERROR patterns that exclude development server echoes
    /(?:^|\s)ERROR:\s*(?!.*(?:\$\s+vite|Default inspector port))/i,  // ERROR: but not command echoes
    /(?:^|\s)error:\s*(?!.*(?:\$\s+vite|Default inspector port))/i   // error: but not command echoes
  ];

  private static readonly WARNING_INDICATORS = [
    /\bwarning\b/i, /\bwarn\b/i, /\bdeprecated\b/i, /\boutdated\b/i, 
    /\bsuggest\b/i, /\brecommend\b/i, /\bshould\b/i, /\bconsider\b/i,
    /\bmight\b/i, /\bpotential\b/i, /\bpartial\b/i, /\bfallback\b/i
  ];

  private static readonly INFO_INDICATORS = [
    /\binfo\b/i, /\bready\b/i, /\bstarted\b/i, /\bloaded\b/i, /\bcompiled\b/i,
    /\bbuilt\b/i, /\bwatching\b/i, /\blistening\b/i, /\bserver\b/i,
    /\blocal:\s*http/i, /\bnetwork:\s*http/i, /\bvite\s+v\d/i,
    
    // Development server specific info patterns
    /^\$\s+vite\s+--host/i,                     // Command echo from bun
    /^VITE\s+v[\d.]+\s+ready/i,                // Vite startup success
    /^Local:\s+https?:\/\//i,                  // Local server URL  
    /^Network:\s+https?:\/\//i,                // Network server URL
    /^\s*➜\s+(?:Local|Network):/i,             // Formatted server URLs
    /^ready\s+in\s+\d+\s*ms/i,                 // Ready timing
    /^Press\s+[a-z]\s+\+\s+enter\s+to/i,      // Interactive prompts
    /Default inspector port.*using.*instead/i, // Port change notifications
    /Process started:/i                        // Process monitoring messages
  ];

  private static readonly DEBUG_INDICATORS = [
    /\bdebug\b/i, /\btrace\b/i, /\bverbose\b/i, /\bdetail\b/i,
    /^\s*console\.(?:log|debug)\(/i, /^\s*\[DEBUG\]/i
  ];

  public static classifyLogLevel(content: string): LogLevel {
    const trimmedContent = content.trim();
    
    // Skip empty content
    if (!trimmedContent) return 'output';
    
    // Check for error patterns first (highest priority)
    if (this.ERROR_INDICATORS.some(pattern => pattern.test(trimmedContent))) {
      return 'error';
    }
    
    // Check for warning patterns
    if (this.WARNING_INDICATORS.some(pattern => pattern.test(trimmedContent))) {
      return 'warn';
    }
    
    // Check for debug patterns
    if (this.DEBUG_INDICATORS.some(pattern => pattern.test(trimmedContent))) {
      return 'debug';
    }
    
    // Check for info patterns
    if (this.INFO_INDICATORS.some(pattern => pattern.test(trimmedContent))) {
      return 'info';
    }
    
    // Default to output for raw process output
    return 'output';
  }

  public static shouldStoreAsLog(content: string): boolean {
    const trimmed = content.trim();
    if (!trimmed) return false;
    
    // Aggressive filtering for development noise - only store meaningful logs
    const skipPatterns = [
      /^[\s\d\[\]:\.]*$/,                    // Just timestamps/formatting
      /^webpack.*compiled/i,                 // Webpack spam
      /^hot[:\s]/i,                         // Hot reload spam  
      /^hmr[:\s]/i,                         // HMR spam
      /^\s*\[vite\]\s*hmr\s*update/i,       // All Vite HMR updates
      /^\s*\[vite\]\s*page reload/i,        // Vite page reload notices
      /^\s*\[vite\]\s*connecting/i,         // Vite connection messages
      /^\s*\d+\s*\|\s*$/,                   // Line number only
      /^\s*\|\s*$/,                         // Pipe only
      /^\s*\^+\s*$/,                        // Caret indicators only
      /^\s*~+\s*$/,                         // Tilde indicators only
      /rebuilding/i,                        // Rebuild notifications
      /file changed/i,                      // File change notifications
      /restarting due to changes/i,         // Restart notifications
      /compiled successfully/i,             // Success notifications (noise)
      /no issues found/i,                   // TypeScript checker success
      /found 0 errors/i,                    // Linter success
      /^\s*\[.*?\]\s*\d+:\d+:\d+/,         // Timestamped logs with no content
      /healthcheck/i,                       // Health monitoring messages
      /monitoring/i,                        // General monitoring messages
      /^\s*(?:-->|<--)\s+\w+\s+\/.*?\s+\d+/i, // HTTP request/response logs
    ];
    
    return !skipPatterns.some(pattern => pattern.test(trimmed));
  }

  /**
   * Conservative method to detect if content looks like a real error (breaking functionality)
   */
  public static looksLikeError(content: string): boolean {
    const trimmed = content.toLowerCase().trim();
    
    // Only very strong indicators of real problems
    const strongIndicators = [
      'error:', 'fatal:', 'exception:', 'crash:', 'abort:',
      'uncaught exception', 'unhandled promise', 'syntax error',
      'reference error', 'type error', 'module not found',
      'failed to compile', 'build failed', 'compilation failed',
      'econnrefused', 'eaddrinuse', 'transform failed'
    ];
    
    return strongIndicators.some(indicator => trimmed.includes(indicator));
  }
}

/**
 * Optimized error pattern matcher with smart pattern grouping and fallback detection
 * Uses keyword-based pre-filtering to reduce CPU overhead from O(n) to O(1) average case
 */
class ErrorDetector {
  private patterns: readonly ErrorPattern[];
  private fastPatterns = new Map<string, ErrorPattern[]>(); // Keyword -> patterns mapping
  private severityPatterns = new Map<string, ErrorPattern[]>(); // Severity-based grouping
  private fallbackPatterns: ErrorPattern[] = []; // Catch-all patterns

  constructor() {
    // Sort patterns by priority (highest first) for optimal matching
    this.patterns = [...GENERAL_ERROR_PATTERNS].sort((a, b) => b.priority - a.priority);
    this.initializeOptimizedPatterns();
  }

  /**
   * Pre-process patterns for O(1) keyword-based lookup
   * Reduces average pattern matching from 76 regex tests to ~3-5
   */
  private initializeOptimizedPatterns(): void {
    for (const pattern of this.patterns) {
      const keywords = this.extractPatternKeywords(pattern);
      
      if (keywords.length === 0) {
        // Generic patterns without specific keywords
        this.fallbackPatterns.push(pattern);
      } else {
        // Index by first significant keyword for fast lookup
        for (const keyword of keywords) {
          if (!this.fastPatterns.has(keyword)) {
            this.fastPatterns.set(keyword, []);
          }
          this.fastPatterns.get(keyword)!.push(pattern);
        }
      }
      
      // Also group by severity for quick filtering
      if (!this.severityPatterns.has(pattern.severity)) {
        this.severityPatterns.set(pattern.severity, []);
      }
      this.severityPatterns.get(pattern.severity)!.push(pattern);
    }
  }

  /**
   * Extract meaningful keywords from regex patterns for indexing
   */
  private extractPatternKeywords(pattern: ErrorPattern): string[] {
    const keywords: string[] = [];
    const regexStr = pattern.regex.source.toLowerCase();
    
    // Extract literal strings from regex patterns
    const literalMatches = regexStr.match(/[a-z]{3,}(?![\|\*\+\?\[\]])/g) || [];
    
    // Add pattern-specific keywords based on ID
    const idKeywords = {
      'vite_error': ['vite'],
      'react_error': ['react'],
      'nextjs_': ['next'],
      'typescript_': ['typescript', 'ts'],
      'syntax_error': ['syntax'],
      'openai_error': ['openai'],
      'module_not_found': ['module'],
      'port_in_use': ['port'],
      'network_error': ['econnrefused', 'enotfound'],
      'css_': ['css'],
      'eslint_': ['eslint']
    };
    
    for (const [prefix, words] of Object.entries(idKeywords)) {
      if (pattern.id.startsWith(prefix)) {
        keywords.push(...words);
      }
    }
    
    // Add significant literal matches
    keywords.push(...literalMatches.filter(match => match.length >= 4));
    
    return [...new Set(keywords)]; // Remove duplicates
  }

  /**
   * Check if content should be skipped entirely (applies skip patterns from createFallbackError)
   */
  private shouldSkipContent(content: string): boolean {
    const lines = content.trim().split('\n');
    const message = lines[0].trim();
    
    const skipPatterns = [
      /^\s*$/,              // Empty lines
      /^warning:/i,         // Warning prefix (handled separately)
      /^\s*at\s+/,          // Stack trace lines without context
      /^[0-9]+\s+\|/,       // Code snippets in error reports
      /Port \d+ is in use, using available port \d+ instead/, 
      /Default inspector port \d+ not available, using port \d+ instead/,
      /Default inspector port \d+ not available, using \d+ instead/,
      /The latest compatibility date supported by the installed Cloudflare Workers Runtime is/,
      
      // Vite/Bun development server specific patterns
      /^\$\s+vite\s+--host/i,                     // Bun command echo: "$ vite --host 0.0.0.0 --port ${PORT:-3000}"
      /^ERROR:\s*\$\s+vite\s+--host/i,           // Bun stderr: "ERROR: $ vite --host 0.0.0.0 --port ${PORT:-3000}"
      /^ERROR:\s*Default inspector port/i,        // Bun stderr: "ERROR: Default inspector port 9229 not available, using 9230 instead"
      /^VITE\s+v[\d.]+\s+ready/i,                // Vite ready message: "VITE v6.3.5 ready in 722 ms"
      /^Local:\s+https?:\/\//i,                  // Vite local URL
      /^Network:\s+https?:\/\//i,                // Vite network URL
      /^\s*➜\s+Local:/i,                         // Vite formatted local URL
      /^\s*➜\s+Network:/i,                       // Vite formatted network URL
      /^Press\s+[a-z]\s+\+\s+enter\s+to/i,      // Vite interactive prompts
      /^ready\s+in\s+\d+\s*ms/i,                 // Vite ready timing
      
      // Bun runtime messages
      /^\[bun\]/i,                               // Bun runtime messages
      /^bun:\s/i,                                // Bun prefixed messages
      
      // Development server common patterns
      /watch.*(?:compil|build)/i,                // Watch compilation messages
      /compiled? successfully/i,                 // Compilation success
      /dev server running/i,                     // Dev server status
      /hmr update/i,                             // Hot module replacement updates
      
      // Skip very short or meaningless messages
      /^[\s\d\W]*$/,        // Only whitespace, digits, or punctuation
      /^\s*[{}[\](),;:.'"]*\s*$/, // Only punctuation/brackets
    ];
    
    return skipPatterns.some(pattern => pattern.test(message));
  }

  /**
   * Parse error with optimized pattern matching and intelligent extraction
   * Uses keyword-based pre-filtering for ~70% CPU reduction
   */
  public parseError(content: string, context?: Record<string, unknown>): ParsedError | null {
    // First check if this content should be skipped entirely
    const shouldSkip = this.shouldSkipContent(content);
    if (shouldSkip) {
      return null;
    }

    // Optimized pattern matching: try keyword-based lookup first
    const candidatePatterns = this.getCandidatePatterns(content);
    
    for (const pattern of candidatePatterns) {
      const match = content.match(pattern.regex);
      if (match) {
        return this.extractErrorInfo(content, pattern, match, context);
      }
    }

    // Fallback: if content looks like an error but no pattern matched
    // Enhanced stderr handling - capture ALL stderr as potential errors
    if (context?.stream === 'stderr' && content.trim()) {
      const fallbackError = this.createFallbackError(content, context);
      return fallbackError; // May be null if should skip
    }

    // Additional fallback: if any content looks like an error based on keywords
    if (LogClassifier.looksLikeError(content)) {
      const fallbackError = this.createFallbackError(content, context);
      return fallbackError;
    }

    return null;
  }

  /**
   * Get candidate patterns based on content keywords
   * Reduces pattern testing from ~76 to ~3-8 patterns average
   */
  private getCandidatePatterns(content: string): ErrorPattern[] {
    const contentLower = content.toLowerCase();
    const candidates = new Set<ErrorPattern>();
    
    // Extract significant words from content
    const words = contentLower.match(/[a-z]{3,}/g) || [];
    const significantWords = words.slice(0, 10); // Limit for performance
    
    // Find patterns matching content keywords
    let foundSpecific = false;
    for (const word of significantWords) {
      const matchingPatterns = this.fastPatterns.get(word);
      if (matchingPatterns) {
        matchingPatterns.forEach(p => candidates.add(p));
        foundSpecific = true;
      }
    }
    
    // If no specific patterns found, include high-priority fallback patterns
    if (!foundSpecific || candidates.size < 5) {
      // Add high-priority generic patterns
      this.fallbackPatterns
        .filter(p => p.priority >= 80)
        .forEach(p => candidates.add(p));
    }
    
    // Sort by priority (highest first) and return as array
    return Array.from(candidates).sort((a, b) => b.priority - a.priority);
  }

  private extractErrorInfo(
    content: string, 
    pattern: ErrorPattern, 
    match: RegExpMatchArray,
    context?: Record<string, unknown>
  ): ParsedError {
    const extractors = pattern.extractors;
    let message = match[0].trim();
    let sourceFile: string | undefined;
    let lineNumber: number | undefined;
    let columnNumber: number | undefined;
    let severity = pattern.severity;

    // Handle special patterns
    if (pattern.id === 'client_error_json') {
      return this.handleClientError(match[1], content, context);
    }

    if (pattern.id === 'eslint_error') {
      // ESLint severity is determined by capture group 4
      severity = (match[4] === 'error' ? 'error' : 'warning') as ErrorSeverity;
    }

    if (extractors) {
      if (extractors.message && match[extractors.message]) {
        message = match[extractors.message].trim();
      }
      if (extractors.file && match[extractors.file]) {
        sourceFile = this.extractRelativePath(match[extractors.file].trim());
      }
      if (extractors.line && match[extractors.line]) {
        lineNumber = parseInt(match[extractors.line], 10);
      }
      if (extractors.column && match[extractors.column]) {
        columnNumber = parseInt(match[extractors.column], 10);
      }
    }

    return {
      category: pattern.category,
      severity,
      message: this.cleanErrorMessage(message),
      sourceFile,
      lineNumber,
      columnNumber,
      stackTrace: this.extractStackTrace(content),
      patternId: pattern.id,
      rawOutput: content,
      context
    };
  }

  /**
   * Handle client error JSON parsing with robust cleanup and validation
   */
  private handleClientError(jsonStr: string, content: string, context?: Record<string, unknown>): ParsedError {
    try {
      // Clean up the JSON string to handle fragmented/malformed content
      let cleanJsonStr = this.cleanupClientErrorJson(jsonStr);
      
      const clientErrorData = JSON.parse(cleanJsonStr);
      
      // Extract file info from source or URL
      let sourceFile: string | undefined;
      let lineNumber: number | undefined;
      let columnNumber: number | undefined;
      
      if (clientErrorData.source) {
        sourceFile = this.extractRelativePath(clientErrorData.source);
        lineNumber = clientErrorData.lineno;
        columnNumber = clientErrorData.colno;
      } else if (clientErrorData.url) {
        sourceFile = this.extractRelativePath(clientErrorData.url);
      }
      
      // Clean up the error message to prevent malformed output
      let message = clientErrorData.message || 'Client error';
      if (typeof message === 'string') {
        message = message.replace(/['"]+$/, '').trim(); // Remove trailing quotes
      }
      
      return {
        category: 'runtime',
        severity: 'error',
        message: `React Client Error: ${message}`,
        stackTrace: clientErrorData.stack || undefined,
        sourceFile,
        lineNumber,
        columnNumber,
        patternId: 'client_error_json',
        rawOutput: content,
        context: { ...context, source: 'REACT CLIENT ERROR', clientData: clientErrorData }
      };
    } catch (parseError) {
      // Enhanced fallback parsing for malformed JSON
      const fallbackMessage = this.extractFallbackClientErrorMessage(jsonStr);
      return {
        category: 'runtime',
        severity: 'error',
        message: `React Client Error: ${fallbackMessage}`,
        stackTrace: jsonStr,
        patternId: 'client_error_json',
        rawOutput: content,
        context: { ...context, source: 'REACT CLIENT ERROR', parseError: true, originalJson: jsonStr }
      };
    }
  }

  /**
   * Clean up fragmented or malformed client error JSON
   */
  private cleanupClientErrorJson(jsonStr: string): string {
    let cleaned = jsonStr.trim();
    
    // Remove any trailing incomplete content
    const lastBraceIndex = cleaned.lastIndexOf('}');
    if (lastBraceIndex > -1) {
      cleaned = cleaned.substring(0, lastBraceIndex + 1);
    }
    
    // Fix common malformed patterns
    cleaned = cleaned
      .replace(/,\s*}/g, '}')           // Remove trailing commas
      .replace(/,\s*]/g, ']')          // Remove trailing commas in arrays
      .replace(/([^\\])'/g, '$1"')     // Replace single quotes with double quotes
      .replace(/\\"/g, '\\"')          // Ensure escaped quotes are properly formatted
      .replace(/\n/g, '\\n')           // Escape newlines in strings
      .replace(/\r/g, '\\r')           // Escape carriage returns
      .replace(/\t/g, '\\t');          // Escape tabs
    
    return cleaned;
  }

  /**
   * Extract error message from malformed JSON using fallback patterns
   */
  private extractFallbackClientErrorMessage(jsonStr: string): string {
    // Try to extract message field even from broken JSON
    const messageMatch = jsonStr.match(/message['":\s]*['"]([^'"]+)['"]/);
    if (messageMatch) {
      return messageMatch[1].replace(/['"]+$/, '').trim();
    }
    
    // Look for common error patterns
    const errorPatterns = [
      /ReferenceError:\s*([^,\n]+)/,
      /TypeError:\s*([^,\n]+)/,
      /SyntaxError:\s*([^,\n]+)/,
      /Error:\s*([^,\n]+)/
    ];
    
    for (const pattern of errorPatterns) {
      const match = jsonStr.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }
    
    return 'Client error (malformed data)';
  }

  /**
   * Extract relative path from file path (like reference implementation)
   */
  private extractRelativePath(filePath: string): string {
    // Remove common absolute path prefixes to get relative paths
    const cleanPath = filePath
      .replace(/^.*?\/(?:src|pages|components|lib|utils|app)\//, '')
      .replace(/^.*?\/node_modules\//, 'node_modules/')
      .replace(/^file:\/\//, '')
      .replace(/^\w+:\/\/[^/]+/, ''); // Remove URL prefixes
    
    return cleanPath || filePath;
  }

  private createFallbackError(content: string, context?: Record<string, unknown>): ParsedError | null {
    // Clean up and format the error message like reference implementation
    const lines = content.trim().split('\n');
    const message = lines[0].trim(); // Use first line as the primary error message

    // Skip check is already done in parseError() method before calling this
    
    // For stderr content, be more aggressive about capturing as errors
    const isStderr = context?.stream === 'stderr';
    const hasErrorKeywords = LogClassifier.looksLikeError(content);
    
    // If it's stderr and has any meaningful content, capture it
    if (isStderr && message.length > 3) {
      // Don't skip stderr unless it's clearly noise
      const isNoise = [
        /^\s*$/, 
        /^[\s\d\W]*$/,
        /healthcheck/i
      ].some(pattern => pattern.test(message));
      
      if (isNoise) {
        return null;
      }
    } else if (!hasErrorKeywords && !isStderr) {
      // For non-stderr, require error keywords
      return null;
    }
    
    // Enhanced file path and line extraction from stack traces
    let sourceFile: string | undefined;
    let lineNumber: number | undefined;
    let columnNumber: number | undefined;
    
    // Try to extract file path and line info from common formats (enhanced from reference)
    const fileLineMatch = message.match(/([^()[\]:]+):(\d+)(?::(\d+))?/);
    if (fileLineMatch) {
      const potentialPath = fileLineMatch[1];
      // Only include if it looks like a file path (from reference)
      if (potentialPath.includes('.') || potentialPath.includes('/')) {
        sourceFile = this.extractRelativePath(potentialPath);
        lineNumber = parseInt(fileLineMatch[2]);
        if (fileLineMatch[3]) {
          columnNumber = parseInt(fileLineMatch[3]);
        }
      }
    } else {
      // Look for stack trace patterns to extract source file
      const stackMatch = content.match(/\s+at\s+\w+\s+\((.+?):(\d+):(\d+)\)/);
      if (stackMatch) {
        const filePath = stackMatch[1];
        // Only extract if it looks like user code (not node_modules)
        if (filePath.includes('/src/') || filePath.includes('/app/')) {
          sourceFile = this.extractRelativePath(filePath);
          lineNumber = parseInt(stackMatch[2]);
          columnNumber = parseInt(stackMatch[3]);
        }
      }
    }
    
    return {
      category: this.inferCategory(content),
      severity: 'error',
      message: this.cleanErrorMessage(message),
      sourceFile,
      lineNumber,
      columnNumber,
      stackTrace: lines.length > 1 ? content.trim() : undefined,
      rawOutput: content,
      context: { ...context, fallbackDetection: true }
    };
  }

  private extractStackTrace(content: string): string | undefined {
    const stackLines = content.match(/(?:^\s+at .+$|^\s+in .+$)/gm);
    return stackLines && stackLines.length > 0 ? stackLines.join('\n') : undefined;
  }


  private inferCategory(content: string): ErrorCategory {
    const lower = content.toLowerCase();
    
    // Very specific patterns first - exact matches
    if (lower.includes('syntaxerror:') || lower.includes('unexpected token') || lower.includes('unexpected end') || 
        lower.includes('duplicate identifier') || lower.includes('assignment to constant variable')) return 'syntax';
    
    // React component export issues - very specific
    if (lower.includes('element type is invalid') || 
        (lower.includes('export') && lower.includes('component'))) return 'dependency';
    
    // Module/import resolution issues
    if (lower.includes('cannot resolve module') || lower.includes('module not found') || 
        lower.includes('cannot find module') || lower.includes('failed to resolve import') ||
        lower.includes('error: cannot resolve')) return 'dependency';
    
    // Build system errors
    if (lower.includes('[vite:build]') || lower.includes('rollup failed') || lower.includes('build failed') ||
        lower.includes('failed to compile') || lower.includes('transform failed') || 
        lower.includes('compilation failed') || lower.includes('could not resolve')) return 'compilation';
    
    // CSS parsing errors
    if (lower.includes('[vite:css]') || lower.includes('css') && (lower.includes('unexpected') || lower.includes('parse'))) return 'syntax';
    
    // Then broader but still specific patterns
    if (lower.includes('module') && (lower.includes('resolve') || lower.includes('import'))) return 'dependency';
    if (lower.includes('syntax') && !lower.includes('error:')) return 'syntax'; // Avoid "SyntaxError:" which is runtime
    if (lower.includes('compile') || lower.includes('build') || lower.includes('transform')) return 'compilation';
    if (lower.includes('memory') || lower.includes('heap')) return 'memory';
    if (lower.includes('network') || lower.includes('fetch') || lower.includes('connection')) return 'network';
    if (lower.includes('file') || lower.includes('path') || lower.includes('directory')) return 'filesystem';
    if (lower.includes('port') || lower.includes('env') || lower.includes('config')) return 'environment';
    return 'runtime';
  }


  private cleanErrorMessage(message: string): string {
    return message
      .replace(/^\[.*?\]\s*/, '')           // Remove log level prefixes
      .replace(/^\d{4}-\d{2}-\d{2}.*?\s/, '') // Remove timestamps
      .replace(/^(ERROR|WARN|INFO|DEBUG):\s*/i, '') // Remove log level indicators
      .replace(/^\s*at\s+/, '')             // Remove stack trace prefixes
      .replace(/\s+/g, ' ')                 // Normalize whitespace
      .trim();
  }

}

/**
 * Circular buffer for efficient log line storage and processing
 */
class LogBuffer {
  private buffer: LogLine[];
  private readonly maxSize: number;
  private head = 0;
  private size = 0;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
    this.buffer = new Array(maxSize);
  }

  add(logLine: LogLine): void {
    this.buffer[this.head] = logLine;
    this.head = (this.head + 1) % this.maxSize;
    if (this.size < this.maxSize) {
      this.size++;
    }
  }

  getRecentLines(count: number = this.size): LogLine[] {
    const result: LogLine[] = [];
    const actualCount = Math.min(count, this.size);
    
    for (let i = 0; i < actualCount; i++) {
      const index = (this.head - actualCount + i + this.maxSize) % this.maxSize;
      result.push(this.buffer[index]);
    }
    
    return result;
  }

  clear(): void {
    this.head = 0;
    this.size = 0;
  }

  get length(): number {
    return this.size;
  }
}

/**
 * Enhanced process monitoring with comprehensive logging and error detection
 * Optimized for modern full-stack development servers (Vite, React, Next.js)
 */
export class ProcessMonitor extends EventEmitter {
  private processInfo: ProcessInfo;
  private childProcess?: ChildProcess;
  private options: Required<MonitoringOptions>;
  private storage: StorageManager;
  private errorDetector: ErrorDetector;
  private logBuffer: LogBuffer;
  private simpleLogManager: SimpleLogManager;
  private state: ProcessState = 'stopped';
  private restartCount = 0;
  private restartTimer?: NodeJS.Timeout;
  private healthCheckTimer?: NodeJS.Timeout;
  private lastActivity = new Date();

  constructor(
    processInfo: ProcessInfo,
    storage: StorageManager,
    options: MonitoringOptions = {}
  ) {
    super();
    
    this.processInfo = { ...processInfo };
    this.options = { ...DEFAULT_MONITORING_OPTIONS, ...options } as Required<MonitoringOptions>;
    this.storage = storage;
    this.errorDetector = new ErrorDetector();
    
    // Ensure errorBufferSize has a valid default value
    const bufferSize = this.options.errorBufferSize ?? DEFAULT_MONITORING_OPTIONS.errorBufferSize ?? 100;
    this.logBuffer = new LogBuffer(bufferSize);
    this.simpleLogManager = new SimpleLogManager(this.processInfo.instanceId);

    // Start health monitoring
    this.startHealthMonitoring();
  }

  /**
   * Start monitoring the process
   */
  public async start(): Promise<Result<ProcessInfo>> {
    try {
      if (this.state === 'running') {
        return { success: false, error: new Error('Process is already running') };
      }

      this.setState('starting');
      
      // Spawn the child process
      this.childProcess = spawn(this.processInfo.command, this.processInfo.args, {
        cwd: this.processInfo.cwd,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false
      });

      if (!this.childProcess.pid) {
        throw new Error('Failed to start process - no PID assigned');
      }

      // Update process info
      this.processInfo = {
        ...this.processInfo,
        pid: this.childProcess.pid,
        startTime: new Date(),
        endTime: undefined,
        exitCode: undefined,
        state: 'running'
      };

      this.setState('running');
      this.lastActivity = new Date();

      // Set up stream monitoring
      this.setupStreamMonitoring();
      this.setupProcessEventHandlers();

      // Log process start to simple log
      await this.simpleLogManager.appendLog(`Process started: ${this.processInfo.command} ${this.processInfo.args.join(' ')}`, 'stdout').catch(() => {});

      // Emit start event
      this.emit('process_started', {
        type: 'process_started',
        processId: this.processInfo.id,
        instanceId: this.processInfo.instanceId,
        pid: this.childProcess.pid,
        command: `${this.processInfo.command} ${this.processInfo.args.join(' ')}`,
        timestamp: new Date()
      } as MonitoringEvent);

      return { success: true, data: this.processInfo };
    } catch (error) {
      this.setState('stopped');
      return { 
        success: false, 
        error: error instanceof Error ? error : new Error('Unknown error starting process') 
      };
    }
  }

  /**
   * Stop monitoring and terminate the process
   */
  public async stop(force = false): Promise<Result<boolean>> {
    try {
      if (this.state === 'stopped') {
        return { success: true, data: true };
      }

      this.setState('stopping');
      await this.simpleLogManager.appendLog('Process stopping...', 'stdout').catch(() => {});

      // Clear timers
      if (this.restartTimer) {
        clearTimeout(this.restartTimer);
        this.restartTimer = undefined;
      }
      if (this.healthCheckTimer) {
        clearInterval(this.healthCheckTimer);
        this.healthCheckTimer = undefined;
      }

      if (this.childProcess && !this.childProcess.killed) {
        // Try graceful shutdown first
        if (!force) {
          this.childProcess.kill('SIGTERM');
          
          // Wait for graceful shutdown
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
              if (this.childProcess && !this.childProcess.killed) {
                this.childProcess.kill('SIGKILL');
              }
              resolve();
            }, this.options.killTimeout ?? 10000);

            this.childProcess!.once('exit', () => {
              clearTimeout(timeout);
              resolve();
            });
          });
        } else {
          this.childProcess.kill('SIGKILL');
        }
      }

      this.setState('stopped');
      this.processInfo = {
        ...this.processInfo,
        endTime: new Date()
      };

      await this.simpleLogManager.appendLog('Process stopped', 'stdout').catch(() => {});
      return { success: true, data: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error : new Error('Unknown error stopping process') 
      };
    }
  }

  /**
   * Restart the process
   */
  public async restart(): Promise<Result<ProcessInfo>> {
    try {
      await this.stop();
      
      // Increment restart count
      this.restartCount++;
      this.processInfo = {
        ...this.processInfo,
        restartCount: this.restartCount
      };

      await this.simpleLogManager.appendLog(`Process restarting (attempt ${this.restartCount})`, 'stdout').catch(() => {});

      // Wait for restart delay
      const restartDelay = this.options.restartDelay ?? 0;
      if (restartDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, restartDelay));
      }

      return await this.start();
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error : new Error('Unknown error restarting process') 
      };
    }
  }

  /**
   * Get current process information
   */
  public getProcessInfo(): ProcessInfo {
    return { ...this.processInfo };
  }

  /**
   * Get recent log lines from buffer
   */
  public getRecentLogs(count?: number): LogLine[] {
    return this.logBuffer.getRecentLines(count);
  }

  /**
   * Setup stdout/stderr stream monitoring with enhanced processing
   */
  private setupStreamMonitoring(): void {
    if (!this.childProcess) return;

    // Monitor stdout
    this.childProcess.stdout?.on('data', (data: Buffer) => {
      this.processStreamData(data, 'stdout');
    });

    // Monitor stderr
    this.childProcess.stderr?.on('data', (data: Buffer) => {
      this.processStreamData(data, 'stderr');
    });
  }

  // Buffer for multi-line error reconstruction with memory bounds
  private errorBuffer = '';
  private bufferTimeout?: NodeJS.Timeout;
  private static readonly MAX_ERROR_BUFFER_SIZE = 64 * 1024; // 64KB limit to prevent memory leaks
  
  // Stream processing throttling for high-throughput scenarios
  private processingQueue: Array<{data: Buffer, stream: 'stdout' | 'stderr'}> = [];
  private isProcessing = false;
  private static readonly MAX_QUEUE_SIZE = 100; // Prevent memory buildup during bursts

  /**
   * Process stream data with enhanced multi-line error handling and backpressure control
   */
  private processStreamData(data: Buffer, stream: 'stdout' | 'stderr'): void {
    // Handle backpressure: drop oldest data if queue is full
    if (this.processingQueue.length >= ProcessMonitor.MAX_QUEUE_SIZE) {
      this.processingQueue.shift(); // Drop oldest to prevent memory buildup
    }
    
    // Queue data for processing
    this.processingQueue.push({ data, stream });
    
    // Start processing if not already active
    if (!this.isProcessing) {
      this.isProcessing = true;
      setImmediate(() => this.processQueuedData());
    }
  }

  /**
   * Process queued stream data asynchronously to prevent blocking
   */
  private processQueuedData(): void {
    while (this.processingQueue.length > 0) {
      const { data, stream } = this.processingQueue.shift()!;
      
      // Handle encoding properly
      const content = data.toString('utf8');
      
      // Handle empty content
      if (!content.trim()) {
        continue;
      }
      
      // Split into lines but preserve multi-line error blocks
      const lines = content.split('\n');
      
      this.lastActivity = new Date();

      // Handle multi-line error reconstruction for stderr
      if (stream === 'stderr') {
        this.bufferMultiLineErrors(content.trim(), stream);
      } else {
        // Process stdout immediately for single-line errors
        this.detectErrorsInOutputChunk(content.trim(), stream);
      }

      // Process individual lines for logging and buffering
      for (const line of lines) {
        if (!line.trim()) continue;
        
        const logLine: LogLine = {
          content: line.trim(),
          timestamp: new Date(),
          stream,
          processId: this.processInfo.id
        };

        // Add to buffer (for immediate access)
        this.logBuffer.add(logLine);

        // Store ALL output to simple log file
        this.simpleLogManager.appendLog(logLine.content, stream).catch(() => {
          // Ignore logging failures
        });
      }
    }
    
    // Mark processing as complete
    this.isProcessing = false;
    
    // If more data arrived while processing, restart
    if (this.processingQueue.length > 0) {
      this.isProcessing = true;
      setImmediate(() => this.processQueuedData());
    }
  }

  /**
   * Buffer stderr content to reconstruct multi-line errors with memory bounds
   */
  private bufferMultiLineErrors(content: string, stream: 'stdout' | 'stderr'): void {
    // Prevent unbounded memory growth
    if (this.errorBuffer.length + content.length > ProcessMonitor.MAX_ERROR_BUFFER_SIZE) {
      // Keep most recent half of buffer to preserve context
      this.errorBuffer = this.errorBuffer.slice(-ProcessMonitor.MAX_ERROR_BUFFER_SIZE / 2);
    }
    
    // Add to buffer
    this.errorBuffer += (this.errorBuffer ? '\n' : '') + content;
    
    // Clear existing timeout
    if (this.bufferTimeout) {
      clearTimeout(this.bufferTimeout);
    }
    
    // Set timeout to process buffer after brief pause
    this.bufferTimeout = setTimeout(() => {
      if (this.errorBuffer.trim()) {
        this.detectErrorsInOutputChunk(this.errorBuffer.trim(), stream);
        this.errorBuffer = '';
      }
    }, 100); // 100ms timeout to collect multi-line content
  }



  /**
   * Detect errors in complete output chunk with enhanced pattern matching
   */
  private detectErrorsInOutputChunk(output: string, source: 'stdout' | 'stderr'): void {
    if (!output.trim()) return;

    // Try intelligent error detection
    const parsedError = this.errorDetector.parseError(output, {
      instanceId: this.processInfo.instanceId,
      processId: this.processInfo.id,
      stream: source
    });

    if (parsedError) {
      this.handleDetectedError(parsedError);
    }
  }

  /**
   * Handle detected error with validation and smart truncation
   */
  private handleDetectedError(error: ParsedError): void {
    // Validate error object before processing
    if (!error.message || !error.category || !error.severity) {
      console.warn('Invalid error object detected, skipping:', error);
      return;
    }

    // Smart truncation: only truncate excessively long content to preserve parsing capability
    const truncatedError = {
      ...error,
      message: error.message.length > 2000 ? error.message.substring(0, 2000) + '...[truncated]' : error.message,
      rawOutput: this.smartTruncateRawOutput(error.rawOutput)
    };

    // Check for duplicates
    const isDuplicate = this.checkForDuplicateError(truncatedError);
    
    if (!isDuplicate) {
      // Store error in database
      const storeResult = this.storage.storeError(
        this.processInfo.instanceId,
        this.processInfo.id,
        truncatedError
      );

      if (storeResult.success) {
        // Log error to simple log file too
        this.simpleLogManager.appendLog(`ERROR: ${truncatedError.message}`, 'stderr').catch(() => {});

        // Emit error event
        this.emit('error_detected', {
          type: 'error_detected',
          processId: this.processInfo.id,
          instanceId: this.processInfo.instanceId,
          error: {
            category: truncatedError.category,
            severity: truncatedError.severity,
            message: truncatedError.message,
            hash: this.generateSimpleErrorHash(truncatedError),
            isNewError: true
          },
          timestamp: new Date()
        } as MonitoringEvent);

        // Handle fatal errors
        if (truncatedError.severity === 'fatal') {
          this.handleFatalError(truncatedError);
        }

        console.log(`Runtime error detected: ${truncatedError.message}. Already logged: false`);
      } else {
        console.error('Failed to store error:', storeResult.error);
      }
    } else {
      console.log(`Runtime error detected: ${truncatedError.message}. Already logged: true`);
    }
  }

  /**
   * Smart truncation for raw output - only truncate excessively long outputs
   * Preserves content needed for manual/3rd party parsing
   */
  private smartTruncateRawOutput(rawOutput: string): string {
    if (!rawOutput) return rawOutput;
    
    const MAX_RAW_OUTPUT = 10000; // 10KB - generous limit for parsing tools
    const TRUNCATION_THRESHOLD = 8000; // Start considering truncation at 8KB
    
    // Only truncate if genuinely excessive
    if (rawOutput.length <= TRUNCATION_THRESHOLD) {
      return rawOutput; // Keep as-is for normal sized outputs
    }
    
    if (rawOutput.length > MAX_RAW_OUTPUT) {
      // For very long outputs, keep beginning (error info) and end (stack trace)
      const keepStart = Math.floor(MAX_RAW_OUTPUT * 0.7); // 70% from start
      const keepEnd = MAX_RAW_OUTPUT - keepStart - 50; // Remaining from end, minus separator
      
      return rawOutput.substring(0, keepStart) + 
             '\n\n...[truncated for length - full output available in logs]...\n\n' +
             rawOutput.substring(rawOutput.length - keepEnd);
    }
    
    return rawOutput; // No truncation needed
  }

  /**
   * Enhanced duplicate detection with time-based and similarity-based checks
   */
  private checkForDuplicateError(newError: ParsedError): boolean {
    const recentErrorsResult = this.storage.getErrors(this.processInfo.instanceId);
    
    if (!recentErrorsResult.success) {
      return false;
    }

    const now = new Date();
    const DUPLICATE_WINDOW_MS = 5000; // 5 seconds window for near-identical errors
    
    // Enhanced duplicate detection with multiple criteria
    const errorExists = recentErrorsResult.data.some(existingError => {
      const existingFile = existingError.sourceFile || '';
      const newFile = newError.sourceFile || '';
      const existingMessage = existingError.message.trim();
      const newMessage = newError.message.trim();
      
      // Time-based duplicate check - same error within 5 seconds
      const timeDiff = now.getTime() - new Date(existingError.lastOccurrence).getTime();
      const isRecent = timeDiff < DUPLICATE_WINDOW_MS;
      
      // Exact match check
      const exactMatch = existingMessage === newMessage && existingFile === newFile;
      if (exactMatch) {
        return true;
      }
      
      // Recent similar error check (for rapid repeated errors)
      if (isRecent) {
        // Check if it's the same error type in the same location
        const sameLocation = existingFile === newFile && 
                            existingError.lineNumber === newError.lineNumber;
        
        // Check if messages are substantially similar (for client errors that may have slight variations)
        const messageSimilarity = this.calculateMessageSimilarity(existingMessage, newMessage);
        const substantiallySimilar = messageSimilarity > 0.8; // 80% similarity threshold
        
        if (sameLocation && substantiallySimilar) {
          return true;
        }
      }
      
      // Enhanced pattern matching for specific error types
      if (this.areErrorsRelated(existingError, newError)) {
        return true;
      }
      
      return false;
    });

    return errorExists;
  }

  /**
   * Calculate similarity between two error messages (0-1 scale)
   */
  private calculateMessageSimilarity(msg1: string, msg2: string): number {
    if (msg1 === msg2) return 1.0;
    
    // Simple similarity based on common words and structure
    const words1 = msg1.toLowerCase().split(/\s+/);
    const words2 = msg2.toLowerCase().split(/\s+/);
    
    const set1 = new Set(words1);
    const set2 = new Set(words2);
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size; // Jaccard similarity
  }

  /**
   * Check if two errors are related using general semantic similarity
   */
  private areErrorsRelated(existing: StoredError, newError: ParsedError): boolean {
    // Only compare errors of the same category and severity
    if (existing.category !== newError.category || existing.severity !== newError.severity) {
      return false;
    }
    
    const existingMsg = existing.message.toLowerCase();
    const newMsg = newError.message.toLowerCase();
    
    // Extract error signatures - common patterns that indicate the same underlying issue
    const existingSignature = this.extractErrorSignature(existingMsg);
    const newSignature = this.extractErrorSignature(newMsg);
    
    // If both have signatures and they match, they're related
    if (existingSignature && newSignature && existingSignature === newSignature) {
      return true;
    }
    
    // High text similarity indicates related errors
    const similarity = this.calculateMessageSimilarity(existingMsg, newMsg);
    return similarity > 0.85; // Higher threshold for semantic relatedness
  }

  /**
   * Extract a general error signature from the message
   */
  private extractErrorSignature(message: string): string | null {
    // Common error pattern signatures
    const patterns = [
      // JavaScript errors: "ReferenceError: x is not defined" -> "referenceerror_not_defined"
      /(\w+error):\s*[^,\s]+\s+(is not defined|is not a function|cannot read|cannot access)/i,
      // HTTP errors: "404 Not Found" -> "http_404"
      /(\d{3})\s+[^,\n]+/,
      // Module errors: "Cannot resolve module" -> "module_resolve_error" 
      /(cannot resolve|module not found|failed to resolve)/i,
      // Network errors: "ECONNREFUSED" -> "network_econnrefused"
      /(econnrefused|enotfound|etimedout|network error)/i,
    ];
    
    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match) {
        // Create a normalized signature
        return match[0].toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
      }
    }
    
    return null;
  }

  /**
   * Handle fatal errors that may require process restart
   */
  private handleFatalError(error: ParsedError): void {
    console.error(`Fatal error detected in process ${this.processInfo.id}:`, error.message);
    
    const maxRestarts = this.options.maxRestarts ?? 0;
    if (this.options.restartOnCrash && this.restartCount < maxRestarts) {
      console.log(`Scheduling restart for process ${this.processInfo.id} (attempt ${this.restartCount + 1}/${maxRestarts})`);
      
      this.restartTimer = setTimeout(() => {
        this.restart().catch(error => {
          console.error('Failed to restart process:', error);
        });
      }, this.options.restartDelay ?? 1000);
    } else {
      console.error(`Process ${this.processInfo.id} has exceeded maximum restart attempts or restart is disabled`);
    }
  }

  /**
   * Setup process event handlers
   */
  private setupProcessEventHandlers(): void {
    if (!this.childProcess) return;

    this.childProcess.on('exit', (code, signal) => {
      // Update process info immutably 
      this.processInfo = {
        ...this.processInfo,
        exitCode: code ?? undefined,
        endTime: new Date()
      };
      
      const wasUnexpected = this.state === 'running';
      this.setState('stopped');

      // Log process exit
      this.simpleLogManager.appendLog(`Process exited with code ${code}${signal ? ` (signal: ${signal})` : ''}`, 'stdout').catch(() => {});

      // Emit exit event
      this.emit('process_stopped', {
        type: 'process_stopped',
        processId: this.processInfo.id,
        instanceId: this.processInfo.instanceId,
        exitCode: code,
        reason: signal ? `Signal: ${signal}` : `Exit code: ${code}`,
        timestamp: new Date()
      } as MonitoringEvent);

      // Handle unexpected crashes
      if (wasUnexpected && code !== 0) {
        this.setState('crashed');
        
        this.emit('process_crashed', {
          type: 'process_crashed',
          processId: this.processInfo.id,
          instanceId: this.processInfo.instanceId,
          exitCode: code,
          signal: signal,
          willRestart: this.options.restartOnCrash && this.restartCount < (this.options.maxRestarts ?? 0),
          timestamp: new Date()
        } as MonitoringEvent);

        // Auto-restart if configured
        const maxRestarts = this.options.maxRestarts ?? 0;
        if (this.options.restartOnCrash && this.restartCount < maxRestarts) {
          this.restartTimer = setTimeout(() => {
            this.restart().catch(error => {
              console.error('Failed to restart crashed process:', error);
            });
          }, this.options.restartDelay ?? 1000);
        }
      }
    });

    this.childProcess.on('error', (error) => {
      console.error(`Process ${this.processInfo.id} error:`, error);
      this.processInfo = {
        ...this.processInfo,
        lastError: error.message
      };
      this.setState('crashed');

      // Log process error
      this.simpleLogManager.appendLog(`Process error: ${error.message}`, 'stderr').catch(() => {});
    });
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    const healthCheckInterval = this.options.healthCheckInterval ?? 0;
    if (healthCheckInterval > 0) {
      this.healthCheckTimer = setInterval(() => {
        this.performHealthCheck();
      }, healthCheckInterval);
    }
  }

  /**
   * Perform health check on the process
   */
  private performHealthCheck(): void {
    const now = new Date();
    const timeSinceActivity = now.getTime() - this.lastActivity.getTime();
    
    const healthCheckInterval = this.options.healthCheckInterval ?? 30000;
    const isResponsive = timeSinceActivity < healthCheckInterval * 2;
    
    if (!isResponsive && this.state === 'running') {
      console.warn(`Process ${this.processInfo.id} may be unresponsive (${timeSinceActivity}ms since last activity)`);
      
      // Log health warning
      this.simpleLogManager.appendLog(`Process unresponsive (${timeSinceActivity}ms since last activity)`, 'stderr').catch(() => {});
    }
  }

  /**
   * Set process state and update info
   */
  private setState(newState: ProcessState): void {
    this.state = newState;
    this.processInfo = {
      ...this.processInfo,
      state: newState
    };
  }

  /**
   * Generate simple error hash
   */
  private generateSimpleErrorHash(error: ParsedError): string {
    const crypto = require('crypto');
    const hashInput = `${error.message}|${error.sourceFile || ''}`;
    return crypto.createHash('sha256').update(hashInput).digest('hex').substring(0, 16);
  }

  /**
   * Clean up resources
   */
  public cleanup(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
    }
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
    if (this.bufferTimeout) {
      clearTimeout(this.bufferTimeout);
    }
    
    // Clear processing queue and reset state
    this.processingQueue.length = 0;
    this.isProcessing = false;
    this.errorBuffer = '';
    
    this.logBuffer.clear();
    this.simpleLogManager.cleanup().catch(() => {});
    this.removeAllListeners();
  }

  /**
   * Get all logs since last call and reset log file
   */
  public async getAllLogsAndReset(): Promise<string> {
    return await this.simpleLogManager.getAllLogsAndReset();
  }

  /**
   * Get monitoring statistics
   */
  public getStats(): {
    processInfo: ProcessInfo;
    bufferSize: number;
    restartCount: number;
    lastActivity: Date;
  } {
    return {
      processInfo: this.getProcessInfo(),
      bufferSize: this.logBuffer.length,
      restartCount: this.restartCount,
      lastActivity: this.lastActivity
    };
  }
}

// Export the old name for backward compatibility
export { ProcessMonitor as ErrorMonitor };

// Export internal classes for testing
export { SimpleLogManager, LogClassifier, ErrorDetector };