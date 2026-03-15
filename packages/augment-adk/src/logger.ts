/**
 * Framework-agnostic logger interface.
 * Consumers provide their own implementation (e.g. Winston, Pino, Backstage LoggerService).
 */
export interface ILogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Default console-based logger implementation.
 * Used when no custom logger is provided.
 */
export const consoleLogger: ILogger = {
  info(message: string, meta?: Record<string, unknown>) {
    console.log(`[INFO] ${message}`, meta ? meta : '');
  },
  warn(message: string, meta?: Record<string, unknown>) {
    console.warn(`[WARN] ${message}`, meta ? meta : '');
  },
  error(message: string, meta?: Record<string, unknown>) {
    console.error(`[ERROR] ${message}`, meta ? meta : '');
  },
  debug(message: string, meta?: Record<string, unknown>) {
    console.debug(`[DEBUG] ${message}`, meta ? meta : '');
  },
};

/**
 * No-op logger that silences all output.
 */
export const noopLogger: ILogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};
