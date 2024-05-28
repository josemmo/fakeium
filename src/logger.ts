export interface LoggerInterface {
    debug(...args: unknown[]): unknown
    info(...args: unknown[]): unknown
    warn(...args: unknown[]): unknown
    error(...args: unknown[]): unknown
}

export class DefaultLogger implements LoggerInterface {
    public debug(...args: unknown[]) {
        console.debug(...args)
    }

    public info(...args: unknown[]) {
        console.log(...args)
    }

    public warn(...args: unknown[]) {
        console.warn(...args)
    }

    public error(...args: unknown[]) {
        console.error(...args)
    }
}
