/**
 * Class representing a reference to an object inside the sandbox.
 * Does not actually hold the value for the object.
 */
export class Reference {
    protected readonly __tag = 'MockiumReference'
    public readonly path: string

    /**
     *
     * @param path Path of value to which redirect events
     */
    public constructor(path: string) {
        this.path = path
    }
}

type Literal = string | number | boolean | null | undefined

export type HookableValue = Reference | Literal | (() => Reference | Literal | void | Promise<Reference | Literal | void>)
