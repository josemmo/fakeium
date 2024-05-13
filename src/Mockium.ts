import { readFileSync } from 'fs'
import { ExecutionError, MemoryLimitError, ModuleNotFoundError, TimeoutError } from './errors'
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

/**
 * JavaScript bootstrap code to run inside the sandbox
 */
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
    private isolate: ivm.Isolate | null = null
    private readonly pathToModule = new Map<string, ivm.Module>()
    private readonly moduleToPath = new Map<ivm.Module, string>()
    private readonly report = new Report()

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
    }

    /**
     * Set module resolver
     * @param resolver Resolver callback
     */
    public setResolver(resolver: ModuleResolver): void {
        this.resolver = resolver
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
            await module.evaluate({timeout})
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
     * @param resetReport Whether to reset report as well
     */
    public dispose(resetReport = true): void {
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

        // Reset report
        if (resetReport) {
            this.report.reset()
        }
    }

    /**
     * Get un-instantiated module
     * @param  specifier  Specifier
     * @param  referrer   Referrer module
     * @param  sourceCode Module source code (overrides resolver)
     * @return            Module instance
     * @throws {ModuleNotFoundError} if failed to resolve module
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
        const module = this.isolate.compileModuleSync(`${sourceCode}`, {
            filename: url.href,
        })
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
                this.report.totalSize() + 1,
                (event: ReportEvent) => this.report.add(event),
                (...args: string[])  => this.options.logger?.debug('<SANDBOX>', ...args),
            ],
            {
                arguments: {
                    reference: true,
                },
            },
        )
    }
}
