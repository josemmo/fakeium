export abstract class MockiumError extends Error {
    // Intentionally left blank
}

/**
 * Error thrown when a path is malformed or not valid.
 */
export class InvalidPathError extends MockiumError {
    // Intentionally left blank
}

/**
 * Error thrown when a value cannot be serialized inside the sandbox.
 */
export class InvalidValueError extends MockiumError {
    // Intentionally left blank
}

/**
 * Error thrown when a script or module cannot be resolved.
 */
export class SourceNotFoundError extends MockiumError {
    // Intentionally left blank
}

/**
 * Error thrown when the source code of a module could not be parsed.
 */
export class ParsingError extends MockiumError {
    // Intentionally left blank
}

/**
 * Error that encapsulates an uncaught error thrown inside the execution sandbox.
 */
export class ExecutionError extends MockiumError {
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
export class TimeoutError extends MockiumError {
    // Intentionally left blank
}

/**
 * Error thrown when an instance exceeds its maximum allowed memory.
 */
export class MemoryLimitError extends MockiumError {
    // Intentionally left blank
}
