interface BaseEvent {
    /** Unique event ID */
    id: number
    /** Event type */
    type: ReportEvent['type']
    /** Path to variable that triggered the event (e.g., `navigator.geolocation.getCurrentPosition`) */
    path: string
    /** Closest location of the code that triggered the event */
    location: Location
}

export interface Location {
    /** Absolute URL to file, including protocol */
    filename: string
    line: number
    column: number
}

export type Value = {
    /** ID of event */
    ref: number
} | {
    /** Literal value */
    literal: string | number | boolean | null
} | {
    /** Unknown value */
    unknown: true
}

export interface GetEvent extends BaseEvent {
    type: 'GetEvent'
    value: Value
}

export interface SetEvent extends BaseEvent {
    type: 'SetEvent'
    value: Value
}

export interface CallEvent extends BaseEvent {
    type: 'CallEvent'
    arguments: Value[]
    /** Whether call comes from instantiating a new object */
    isConstructor: boolean
}

export type ReportEvent = GetEvent | SetEvent | CallEvent

/**
 * Helper class for storing and traversing events reported by Mockium.
 */
export default class Report {
    private flushedSize = 0
    /** Map of events indexed by event ID */
    private readonly events = new Map<number, ReportEvent>()

    /**
     * Get size
     * @return Current number of events
     */
    public size(): number {
        return this.events.size
    }

    /**
     * Get total size (including flushed events)
     * @return Total size
     */
    public totalSize(): number {
        return this.flushedSize + this.size()
    }

    /**
     * Get all events
     * @return Iterable of events
     */
    public getAll(): Iterable<ReportEvent> {
        return this.events.values()
    }

    /**
     * Add event
     * @package
     * @param event Event
     */
    public add(event: ReportEvent): void {
        this.events.set(event.id, event)
    }

    /**
     * Flush events to free memory
     */
    public flush(): void {
        this.flushedSize += this.events.size
        this.events.clear()
    }

    /**
     * Reset instance
     */
    public reset(): void {
        this.flush()
        this.flushedSize = 0
    }
}
