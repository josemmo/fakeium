interface Location {
    filename: string
    line: number
    column: number
}

type LogEntry = {
    id: number
    type: 'get'
    value: string
    location: Location
} | {
    id: number
    type: 'call'
    value: string
    /** Log entry IDs for known arguments */
    args: number[]
    location: Location
} | {
    id: number
    type: 'string'
    value: string
    location: Location
}

/**
 * Helper class for storing and traversing log entries reported by Mockium.
 */
export default class Report {
    private flushedSize = 0
    /** Map of log entries indexed by log entry ID */
    private readonly logEntries = new Map<number, LogEntry>()

    /**
     * Get size
     * @return Current number of log entries
     */
    public size(): number {
        return this.logEntries.size
    }

    /**
     * Get all log entries
     * @return Iterable of log entries
     */
    public getAll(): Iterable<LogEntry> {
        return this.logEntries.values()
    }

    /**
     * Add log entry
     * @package
     * @param logEntry Log entry
     */
    public add(logEntry: LogEntry): void {
        this.logEntries.set(logEntry.id, logEntry)
    }

    /**
     * Flush log entries to free memory
     */
    public flush(): void {
        this.flushedSize += this.logEntries.size
        this.logEntries.clear()
    }

    /**
     * Reset instance
     */
    public reset(): void {
        this.flush()
        this.flushedSize = 0
    }
}
