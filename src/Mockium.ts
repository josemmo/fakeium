import { readFileSync } from 'fs'
import {
    ExecutionError,
    InvalidPathError,
    InvalidValueError,
    MemoryLimitError,
    ModuleNotFoundError,
    ParsingError,
    TimeoutError,
} from './errors'
import { Hook, Reference } from './hooks'
import { LoggerInterface } from './logger'
import Report, { ReportEvent } from './Report'
import ivm from 'isolated-vm'

interface MockiumInstanceOptions {
    /** Origin to use when resolving relative specifiers (defaults to "file:///") */
    origin?: string
    /** Maximum amount of memory in MiB that the sandbox is allowed to allocate (defaults to 64MiB) */
    maxMemory?: number
    /** Maximum execution time in milliseconds for scripts (defaults to 10000ms) */
    timeout?: number
    /** Optional logger instance */
    logger?: LoggerInterface | null
}

interface MockiumRunOptions {
    /** Maximum execution time in milliseconds just for this script */
    timeout?: number
}

type ModuleSourceCode = Buffer | string

/**
 * @param  url Absolute URL to module
 * @return     Module source code or `null` if not found
 */
type ModuleResolver = (url: URL) => Promise<ModuleSourceCode | null>

/** Pattern to match valid property path accessors */
const PATH_PATTERN = /^[a-z_$][a-z0-9_$]*(\.[a-z_$][a-z0-9_$]*|\[".+?"\]|\['.+?'\]|\[\d+\])*$/i

/** JavaScript bootstrap code to run inside the sandbox */
const BOOTSTRAP_CODE = readFileSync(new URL('sandbox/bootstrap.js', import.meta.url), 'utf-8')

/**
 * Mockium (from "mock" and "Chromium") is a simple yet *safe* instrumented environment for running
 * untrusted JavaScript code that was intended to be run in a web browser.
 *
 * Rather than replacing dynamic analysis, its main goal is to complement static analysis by detecting
 * API calls that would otherwise be missed using traditional AST parsing.
 */
export default class Mockium {
    private readonly options: Required<MockiumInstanceOptions>
    private resolver: ModuleResolver = async () => null
    private hooks = new Map<string, Hook>()
    private isolate: ivm.Isolate | null = null
    private readonly pathToModule = new Map<string, ivm.Module>()
    private readonly moduleToPath = new Map<ivm.Module, string>()
    private readonly report = new Report()
    private nextValueId = 1

    /**
     * @param options Instance-wide options
     */
    public constructor(options: MockiumInstanceOptions = {}) {
        this.options = {
            origin: 'file:///',
            maxMemory: 64,
            timeout: 10000,
            logger: null,
            ...options,
        }

        // Auto-wire aliases of the "globalThis" object
        for (const path of ['frames', 'global', 'parent', 'self', 'window']) {
            this.hook(path, new Reference('globalThis'))
        }

        // Setup environment for browser extensions
        this.hook('browser', {})
        this.hook('chrome', new Reference('browser'))
    }

    /**
     * Set module resolver
     * @param resolver Resolver callback
     */
    public setResolver(resolver: ModuleResolver): void {
        this.resolver = resolver
    }

    /**
     * Hook value inside sandbox
     *
     * Will overwrite any existing hook for the same path.
     *
     * Allowed values are:
     * - Serializable values that can be copied to the sandbox using the
     *   [structured clone algorithm](https://developer.mozilla.org/docs/Web/API/Web_Workers_API/Structured_clone_algorithm).
     * - Functions that receive and/or return serializable values. Note that, while the aforementioned values will be
     *   copied from/to the sandbox, functions are executed outside the sandbox.
     * - Instances of {@link Reference} that point to a different value path inside the sandbox.
     *
     * @param path       Path of value to hook
     * @param value      Value to return
     * @param isWritable Whether hook can have its value overwritten inside the sandbox, `true` by default
     * @throws {InvalidPathError} if the provided path is not valid
     * @throws {InvalidValueError} if the provided value is not valid
     */
    public hook(path: string, value: unknown, isWritable = true): void {
        this.validatePath(path)
        if (value instanceof Reference) {
            this.validatePath(value.path)
            this.hooks.set(path, {
                path,
                isWritable,
                newPath: value.path,
            })
        } else if (typeof value === 'function') {
            this.hooks.set(path, {
                path,
                isWritable,
                function: new ivm.Reference(value),
            })
        } else {
            try {
                this.hooks.set(path, {
                    path,
                    isWritable,
                    value: new ivm.ExternalCopy(value),
                })
            } catch (e) {
                throw new InvalidValueError((e as TypeError).message)
            }
        }
    }

    /**
     * Unhook value inside sandbox
     * @param path Path of value to unhook
     */
    public unhook(path: string): void {
        this.hooks.delete(path)
    }

    /**
     * Run code in sandbox
     * @param specifier Specifier
     * @param options   Additional execution options
     * @throws {ExecutionError} if an uncaught error was thrown inside the sandbox
     * @throws {MemoryLimitError} if exceeded max allowed memory for the instance
     * @throws {ModuleNotFoundError} if failed to resolve specifier or imports
     * @throws {TimeoutError} if exceeded max execution time
     */
    public async run(specifier: string, options?: MockiumRunOptions): Promise<void>

    /**
     * Run code in sandbox
     * @param specifier  Specifier
     * @param sourceCode JavaScript source code
     * @param options    Additional execution options
     * @throws {ExecutionError} if an uncaught error was thrown inside the sandbox
     * @throws {MemoryLimitError} if exceeded max allowed memory for the instance
     * @throws {ModuleNotFoundError} if failed to resolve imports
     * @throws {TimeoutError} if exceeded max execution time
     */
    public async run(specifier: string, sourceCode: ModuleSourceCode, options?: MockiumRunOptions): Promise<void>
    public async run(specifier: string, b?: MockiumRunOptions | ModuleSourceCode, c?: MockiumRunOptions): Promise<void> {
        let sourceCode: ModuleSourceCode | undefined = undefined
        let options: MockiumRunOptions
        if (typeof b === 'string' || b instanceof Buffer) {
            sourceCode = b
            options = c || {}
        } else {
            options = b || {}
        }
        const timeout = options.timeout ?? this.options.timeout

        // Create isolate if needed
        if (this.isolate === null) {
            this.isolate = new ivm.Isolate({
                memoryLimit: this.options.maxMemory,
            })
        }

        // Create context
        const context = await this.isolate.createContext()
        await this.setupContext(context)

        // Instantiate module
        const module = await this.getModule(specifier, undefined, sourceCode)
        await module.instantiate(context, (specifier, referrer) => this.getModule(specifier, referrer))

        // Add hard-timeout listener
        // See https://github.com/laverdet/isolated-vm/issues/185
        let didTimeout = false
        const hardTimeout = setTimeout(() => {
            this.options.logger?.warn('Script refused to stop, terminating it')
            didTimeout = true
            this.dispose(false)
        }, timeout+150)

        // Run code as module
        try {
            await module.evaluate({ timeout })
        } catch (e) {
            if (!(e instanceof Error)) {
                this.options.logger?.warn(`Expected Error from sandbox, received ${typeof e}`)
                throw e
            }
            if (e.message === 'Script execution timed out.') {
                didTimeout = true
            } else if (e.message === 'Isolate was disposed during execution') {
                // Skip throwing an error here as it's most surely caused by a forced timeout
                this.options.logger?.debug('Forcedly disposed instance to terminate script')
            } else if (e.message === 'Isolate was disposed during execution due to memory limit') {
                throw new MemoryLimitError(`Exceeded ${this.options.maxMemory}MiB memory limit`)
            } else {
                throw new ExecutionError('Uncaught error raised in sandbox', e)
            }
        } finally {
            clearTimeout(hardTimeout)
            context.release()
        }

        // Throw timeout if needed
        if (didTimeout) {
            throw new TimeoutError(`Exceeded ${timeout}ms timeout`)
        }
    }

    /**
     * Get report
     * @return Report instance
     */
    public getReport() {
        return this.report
    }

    /**
     * Dispose instance
     *
     * Frees from memory any resources used by this instance.
     * You should call this method after working with Mockium to avoid any memory leaks.
     * It *is* safe to reuse the instance after disposing.
     *
     * @param clearReport Whether to clear report as well
     */
    public dispose(clearReport = true): void {
        // Clear modules
        this.pathToModule.clear()
        this.moduleToPath.clear()

        // Dispose isolate
        if (this.isolate !== null) {
            try {
                this.isolate.dispose()
            } catch (_) {
                this.options.logger?.debug('Attempted to dispose a previously disposed isolate, ignored')
            }
            this.isolate = null
        }

        // Clear report
        if (clearReport) {
            this.report.clear()
            this.nextValueId = 1
        }
    }

    /**
     * Validate path
     * @param path Path
     * @throws {InvalidPathError} if path is not valid
     */
    private validatePath(path: string): void {
        if (!PATH_PATTERN.test(path)) {
            throw new InvalidPathError(`Path "${path}" is not valid`)
        }
    }

    /**
     * Get un-instantiated module
     * @param  specifier  Specifier
     * @param  referrer   Referrer module
     * @param  sourceCode Module source code (overrides resolver)
     * @return            Module instance
     * @throws {ModuleNotFoundError} if failed to resolve module
     * @throws {ParsingError} if failed to parse source code
     */
    private async getModule(specifier: string, referrer?: ivm.Module, sourceCode?: ModuleSourceCode): Promise<ivm.Module> {
        // Resolve absolute URL for module
        const relativeTo = referrer ? this.moduleToPath.get(referrer) : undefined
        const url = new URL(specifier, relativeTo || this.options.origin)

        // Check cache
        let cachedModule = this.pathToModule.get(url.href)
        if (cachedModule && sourceCode !== undefined) {
            this.options.logger?.warn(`Overwriting cached module ${url} with custom source code`)
            cachedModule.release()
            cachedModule = undefined
        }
        if (cachedModule) {
            return cachedModule
        }

        // Compile and cache new module
        if (sourceCode === undefined) {
            sourceCode = await this.resolver(url) ?? undefined
            if (sourceCode === undefined) {
                throw new ModuleNotFoundError(`Cannot find package "${specifier}": failed to resolve absolute URL ${url.href}`)
            }
        }
        if (this.isolate === null) {
            throw new ReferenceError('Illegal instance state: missing isolate')
        }
        let module: ivm.Module
        try {
            module = this.isolate.compileModuleSync(`${sourceCode}`, { filename: url.href })
        } catch (e) {
            if (e instanceof SyntaxError) {
                throw new ParsingError(e.message)
            }
            throw e
        }
        this.pathToModule.set(url.href, module)
        this.moduleToPath.set(module, url.href)
        this.options.logger?.debug(`Compiled module ${url.href}`)

        return module
    }

    /**
     * Setup context
     * @param context Execution context
     */
    private async setupContext(context: ivm.Context): Promise<void> {
        await context.evalClosure(
            BOOTSTRAP_CODE,
            [
                this.nextValueId,
                (event: ReportEvent, nextValueId: number) => {
                    this.report.add(event)
                    this.nextValueId = nextValueId
                },
                (...args: string[])  => this.options.logger?.debug('<SANDBOX>', ...args),
                Array.from(this.hooks.values()),
            ],
            {
                arguments: {
                    reference: true,
                },
            },
        )
    }
}
