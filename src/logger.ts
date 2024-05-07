export interface LoggerInterface {
    debug(...args: unknown[]): unknown
    info(...args: unknown[]): unknown
    warn(...args: unknown[]): unknown
    error(...args: unknown[]): unknown
}
