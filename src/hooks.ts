import type { ExternalCopy, Reference as ivmReference } from 'isolated-vm'

/**
 * Class representing a reference to an object inside the sandbox.
 * Does not actually hold the value for the object.
 */
export class Reference {
    public readonly path: string

    /**
     *
     * @param path Path of value to which redirect events
     */
    public constructor(path: string) {
        this.path = path
    }
}

export type Hook = {
    path: string
} & (
    { newPath: string } |
    { value: ExternalCopy } |
    { function: ivmReference }
)
