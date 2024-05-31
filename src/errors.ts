export abstract class FakeiumError extends Error {
    // Intentionally left blank
}

/**
 * Error thrown when a path is malformed or not valid.
 */
export class InvalidPathError extends FakeiumError {
    // Intentionally left blank
}

/**
 * Error thrown when a value cannot be serialized inside the sandbox.
 */
export class InvalidValueError extends FakeiumError {
    // Intentionally left blank
}

/**
 * Error thrown when a script or module cannot be resolved.
 */
export class SourceNotFoundError extends FakeiumError {
    // Intentionally left blank
}

/**
 * Error thrown when the source code of a module could not be parsed.
 */
export class ParsingError extends FakeiumError {
    // Intentionally left blank
}

/**
 * Error that encapsulates an uncaught error thrown inside the execution sandbox.
 */
export class ExecutionError extends FakeiumError {
    /** Original thrown error */
    public cause: Error

    public constructor(message: string, cause: Error) {
        super(message)
        this.cause = cause
    }
}

/**
 * Error thrown when a script exceeds its maximum execution time.
 */
export class TimeoutError extends FakeiumError {
    // Intentionally left blank
}

/**
 * Error thrown when an instance exceeds its maximum allowed memory.
 */
export class MemoryLimitError extends FakeiumError {
    // Intentionally left blank
}
