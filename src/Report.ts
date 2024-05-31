interface BaseEvent {
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
    /** Object ID */
    ref: number
    literal?: never
} | {
    ref?: never
    /** Literal value */
    literal: string | number | boolean | null | undefined
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
    returns: Value
    /** Whether call comes from instantiating a new object */
    isConstructor: boolean
}

export type ReportEvent = GetEvent | SetEvent | CallEvent

type MappedOmit<T, K extends PropertyKey> = { [P in keyof T as Exclude<P, K>]: T[P] }
type Query = Partial<MappedOmit<ReportEvent, 'location'>> & { location?: Partial<Location> }

/**
 * Helper class for storing and traversing events reported by Fakeium.
 */
export class Report {
    private readonly events: ReportEvent[] = []

    /**
     * Get size
     * @return Current number of events
     */
    public size(): number {
        return this.events.length
    }

    /**
     * Add event
     * @package
     * @param event Event
     */
    public add(event: ReportEvent): void {
        this.events.push(event)
    }

    /**
     * Clear report
     */
    public clear(): void {
        this.events.length = 0
    }

    /**
     * Get all events
     * @return Array of events
     */
    public getAll(): ReportEvent[] {
        return this.events
    }

    /**
     * Find all events that match the given query
     * @param  query Search query
     * @return       Iterable of matched events
     */
    public* findAll(query: Query): IterableIterator<ReportEvent> {
        for (const event of this.getAll()) {
            // Matches type
            if (query.type !== undefined && query.type !== event.type) {
                continue
            }

            // Matches path
            if (query.path !== undefined && query.path !== event.path) {
                continue
            }

            // Matches location
            if (query.location?.filename !== undefined && query.location.filename !== event.location.filename) {
                continue
            }
            if (query.location?.line !== undefined && query.location.line !== event.location.line) {
                continue
            }
            if (query.location?.column !== undefined && query.location.column !== event.location.column) {
                continue
            }

            // Matches value
            if (
                ('value' in query) && query.value &&
                (!('value' in event) || !this.matchesValue(query.value, event.value))
            ) {
                continue
            }

            // Matches arguments
            if ('arguments' in query && query.arguments) {
                if (
                    !('arguments' in event) ||
                    (query.arguments.length === 0 && event.arguments.length !== 0)
                ) {
                    continue
                }
                let matches = true
                for (const queryArg of query.arguments) {
                    matches = false
                    for (const eventArg of event.arguments) {
                        if (this.matchesValue(queryArg, eventArg)) {
                            matches = true
                            break
                        }
                    }
                    if (!matches) {
                        // Early stop, no need to check rest of query arguments
                        break
                    }
                }
                if (!matches) {
                    // 1+ query arguments not present in event
                    continue
                }
            }

            // Matches return value
            if (
                ('returns' in query) && query.returns &&
                (!('returns' in event) || !this.matchesValue(query.returns, event.returns))
            ) {
                continue
            }

            // Matches isConstructor
            if (
                ('isConstructor' in query) &&
                (!('isConstructor' in event) || query.isConstructor !== event.isConstructor)
            ) {
                continue
            }

            yield event
        }
    }

    /**
     * Find first event that matches the given query
     * @param  query Search query
     * @return       Matched event or `null` if not found
     */
    public find(query: Query): ReportEvent | null {
        return this.findAll(query).next().value || null
    }

    /**
     * Has event that matches the given query
     * @param  query Search query
     * @return       Whether report has at least one matching event
     */
    public has(query: Query): boolean {
        return this.find(query) !== null
    }

    /**
     * Matches value
     * @param  query  Desired value (query)
     * @param  target Target value to check against
     * @return        Whether target value matches query
     */
    private matchesValue(query: Value, target: Value): boolean {
        if (query.ref !== undefined && query.ref !== target.ref) {
            return false
        }
        if (
            ('literal' in query) &&
            (!('literal' in target) || query.literal !== target.literal)
        ) {
            return false
        }
        return true
    }
}
