import { assert, expect } from 'chai'
import {
    ExecutionError,
    InvalidPathError,
    InvalidValueError,
    MemoryLimitError,
    ParsingError,
    SourceNotFoundError,
    TimeoutError,
} from '../src/errors'
import { Fakeium, FakeiumStats } from '../src/Fakeium'
import { Reference } from '../src/hooks'
import { DefaultLogger } from '../src/logger'

const logger = (process.env.LOG_LEVEL === 'debug') ? new DefaultLogger() : null

function expectNonEmptyStats(stats: FakeiumStats): void {
    expect(Number(stats.cpuTime)).to.be.greaterThan(100_000)
    expect(Number(stats.wallTime)).to.be.greaterThan(50_000)
    expect(stats.totalHeapSize).to.be.greaterThan(500_000)
    expect(stats.usedHeapSize).to.be.greaterThan(500_000)
}

describe('Fakeium', () => {
    it('initializes and disposes', async () => {
        const fakeium = new Fakeium({ logger })
        expect(fakeium.getReport().size()).to.be.equal(0)
        fakeium.dispose()
    })

    it('runs sources without resolver', async () => {
        const fakeium = new Fakeium({ logger })
        await fakeium.run('module.js', '1+1', { sourceType: 'module' }) // Create module with custom source code
        await fakeium.run('script.js', '2+2', { sourceType: 'script' }) // Create script with custom source code
        await fakeium.run('module.js', '3+3', { sourceType: 'module' }) // Override cached module with new source code
        await fakeium.run('script.js', '4+4', { sourceType: 'script' }) // Create script with new custom source code
        fakeium.dispose()
    })

    it('runs scripts with resolver', async () => {
        const fakeium = new Fakeium({ logger, origin: 'https://localhost' })
        fakeium.setResolver(async url => {
            if (url.href === 'https://localhost/index.js') {
                return '// This is the index\n'
            }
            return null
        })
        await fakeium.run('index.js')
        await fakeium.run('404.js', '// Not coming from resolver\n')
    })

    it('throws an error for unresolved sources', async () => {
        const fakeium = new Fakeium({ logger })
        for (const sourceType of ['script', 'module'] as const) {
            try {
                await fakeium.run(`${sourceType}.js`, { sourceType })
                assert.fail('Fakeium#run() did not throw any error')
            } catch (e) {
                expect(e).to.be.an.instanceOf(SourceNotFoundError)
            }
        }
        fakeium.dispose()
    })

    it('throws an error for invalid source code', async () => {
        const fakeium = new Fakeium({ logger })
        for (const sourceType of ['script', 'module'] as const) {
            try {
                await fakeium.run(`${sourceType}.js`, 'This is not JavaScript code', { sourceType })
                assert.fail('Fakeium#run() did not throw any error')
            } catch (e) {
                expect(e).to.be.an.instanceOf(ParsingError)
            }
        }
        fakeium.dispose()
    })

    it('assumes sources are scripts by default', async () => {
        const fakeium = new Fakeium({ logger })
        try {
            await fakeium.run('index.js', 'import "something.js"')
            assert.fail('Fakeium#run() did not throw any error')
        } catch (e) {
            expect(e).to.be.an.instanceOf(ParsingError)
            expect(e).to.have.a.property('message').that.matches(/^Cannot use import statement outside a module/)
        }
        fakeium.dispose()
    })

    it('resolves module specifiers', async () => {
        const fakeium = new Fakeium({ logger, sourceType: 'module' })
        fakeium.setResolver(async url => {
            if (url.pathname === '/index.js') {
                return 'import "./subdir/b.js";\n' +
                       'import "subdir/c.js";\n' +
                       'alert("Hi from index.js");\n'
            }
            if (url.pathname === '/subdir/b.js') {
                return 'alert("Hi from b.js");\n'
            }
            if (url.pathname === '/subdir/c.js') {
                return 'import "../d.js";\n' +
                       'alert("Hi from c.js");\n'
            }
            if (url.pathname === '/d.js') {
                return 'alert("Hi from d.js");\n'
            }
            if (url.pathname === '/something/with%20spaces.js') {
                return '// Empty\n'
            }
            if (url.pathname === '/hash.js') {
                return 'alert("Hi from a module with fragment");\n'
            }
            if (url.pathname === '/crash.js') {
                return 'import "fake/path/to/module.js";\n' +
                       'alert("This line is never reached");\n'
            }
            return null
        })

        // Run successful code
        await fakeium.run('./index.js')
        await fakeium.run('something/with spaces.js')
        await fakeium.run('hash.js#this-is-a-fragment')

        // Run unsuccessful code
        try {
            await fakeium.run('./crash.js')
            assert.fail('Did not crash when importing missing module')
        } catch (e) {
            expect(e).to.be.an.instanceOf(SourceNotFoundError)
            expect(e).to.have.a.property('message').that.matches(/^Cannot find module "fake\/path\/to\/module.js"/)
        }

        fakeium.dispose()
    })

    it('propagates unhandled sandbox errors', async () => {
        const fakeium = new Fakeium({ logger })
        try {
            await fakeium.run('crash.js', 'throw new Error("oh no!");')
        } catch (e) {
            expect(e).to.be.an.instanceOf(ExecutionError)
            return
        } finally {
            fakeium.dispose()
        }
        assert.fail('Fakeium#run() did not throw any error')
    })

    it('throws an error on timeout', async () => {
        const fakeium = new Fakeium({ logger, timeout: 500 })
        for (const sourceType of ['script', 'module'] as const) {
            try {
                await fakeium.run('endless.js', 'while (true) {;;}', { sourceType })
                assert.fail('Fakeium#run() did not throw any error')
            } catch (e) {
                expect(e).to.be.an.instanceOf(TimeoutError)
            }
        }
        fakeium.dispose()
    }).timeout(3000)

    it('throws an error on memory exhaustion', async () => {
        const fakeium = new Fakeium({ logger, maxMemory: 8 })
        const code = 'const garbage = [];\n' +
                     'while (true) {\n' +
                     '    garbage.push("abcdefghijklmnopqrstuvwxyz".repeat(1024));\n' +
                     '}\n'
        const beforeStats = fakeium.getStats()
        try {
            await fakeium.run('crash.js', code)
        } catch (e) {
            expect(e).to.be.an.instanceOf(MemoryLimitError)
            return
        } finally {
            expect(beforeStats).to.deep.equal(fakeium.getStats()) // No stats are recorded after memory limit
            fakeium.dispose()
        }
        assert.fail('Fakeium#run() did not throw any error')
    })

    it('records stats', async () => {
        const fakeium = new Fakeium({ logger })
        expect(fakeium.getStats()).to.be.deep.equal({
            cpuTime: 0n,
            wallTime: 0n,
            totalHeapSize: 0,
            totalHeapSizeExecutable: 0,
            totalPhysicalSize: 0,
            usedHeapSize: 0,
            mallocedMemory: 0,
            peakMallocedMemory: 0,
            externallyAllocatedSize: 0,
        })

        // Stats are recorded after running sources
        await fakeium.run('first.js', 'for (let i=0; i<1000; i++) "abc".repeat(100)')
        const firstStats = fakeium.getStats()
        expectNonEmptyStats(firstStats)

        // Stats are cumulative
        await fakeium.run('second.js', 'let i = 0; while (i < 1_000_000) i++;')
        const secondStats = fakeium.getStats()
        expect(Number(secondStats.cpuTime)).to.be.greaterThan(Number(firstStats.cpuTime))
        expect(Number(secondStats.wallTime)).to.be.greaterThan(Number(firstStats.wallTime))
        expect(secondStats.totalHeapSize).to.be.greaterThan(firstStats.totalHeapSize)
        expect(secondStats.totalHeapSizeExecutable).to.be.greaterThan(firstStats.totalHeapSizeExecutable)
        expect(secondStats.totalPhysicalSize).to.be.greaterThan(firstStats.totalPhysicalSize)
        expect(secondStats.usedHeapSize).to.be.greaterThan(firstStats.usedHeapSize)
        expect(secondStats.mallocedMemory).to.be.greaterThanOrEqual(firstStats.mallocedMemory)
        expect(secondStats.externallyAllocatedSize).to.be.greaterThanOrEqual(firstStats.externallyAllocatedSize)

        // Stats must be reset after dispose
        fakeium.dispose()
        expect(fakeium.getStats()).to.be.deep.equal({
            cpuTime: 0n,
            wallTime: 0n,
            totalHeapSize: 0,
            totalHeapSizeExecutable: 0,
            totalPhysicalSize: 0,
            usedHeapSize: 0,
            mallocedMemory: 0,
            peakMallocedMemory: 0,
            externallyAllocatedSize: 0,
        })
    })
})

describe('Fakeium sandbox', () => {
    it('assigns incremental value IDs', async () => {
        const fakeium = new Fakeium({ logger })
        fakeium.setResolver(async () => {
            return '(async () => {\n' +
                   '    const a = JSON.stringify({ tag: "a" });\n' +
                   '    const b = JSON.stringify({ tag: "b" });\n' +
                   '    callMe(a);\n' +
                   '    callMe(b);\n' +
                   '})();\n'
        })
        await fakeium.run('index.js')
        expect(fakeium.getReport().getAll()).to.deep.equal([
            {
                type: 'GetEvent',
                path: 'JSON',
                value: { ref: 1 },
                location: { filename: 'file:///index.js', line: 2, column: 15 },
            },
            {
                type: 'GetEvent',
                path: 'JSON.stringify',
                value: { ref: 2 },
                location: { filename: 'file:///index.js', line: 2, column: 20 },
            },
            {
                type: 'CallEvent',
                path: 'JSON.stringify',
                arguments: [ { ref: 3 } ],
                returns: { literal: '{"tag":"a"}' },
                isConstructor: false,
                location: { filename: 'file:///index.js', line: 2, column: 20 },
            },
            {
                type: 'GetEvent',
                path: 'JSON',
                value: { ref: 1 },
                location: { filename: 'file:///index.js', line: 3, column: 15 },
            },
            {
                type: 'GetEvent',
                path: 'JSON.stringify',
                value: { ref: 2 },
                location: { filename: 'file:///index.js', line: 3, column: 20 },
            },
            {
                type: 'CallEvent',
                path: 'JSON.stringify',
                arguments: [ { ref: 4 } ],
                returns: { literal: '{"tag":"b"}' },
                isConstructor: false,
                location: { filename: 'file:///index.js', line: 3, column: 20 },
            },
            {
                type: 'GetEvent',
                path: 'callMe',
                value: { ref: 5 },
                location: { filename: 'file:///index.js', line: 4, column: 5 },
            },
            {
                type: 'CallEvent',
                path: 'callMe',
                arguments: [ { literal: '{"tag":"a"}' } ],
                returns: { ref: 6 },
                isConstructor: false,
                location: { filename: 'file:///index.js', line: 4, column: 5 },
            },
            {
                type: 'GetEvent',
                path: 'callMe',
                value: { ref: 5 },
                location: { filename: 'file:///index.js', line: 5, column: 5 },
            },
            {
                type: 'CallEvent',
                path: 'callMe',
                arguments: [ { literal: '{"tag":"b"}' } ],
                returns: { ref: 7 },
                isConstructor: false,
                location: { filename: 'file:///index.js', line: 5, column: 5 },
            }
        ])
        fakeium.dispose()
    })

    it('assigns incremental value IDs after clearing and dispose', async () => {
        const fakeium = new Fakeium({ logger })

        await fakeium.run('first.js', 'first()')
        expect(fakeium.getReport().has({ type: 'CallEvent', path: 'first', returns: { ref: 2 } })).to.be.true
        fakeium.getReport().clear()

        await fakeium.run('second.js', 'second()')
        expect(fakeium.getReport().has({ path: 'first' })).to.be.false
        expect(fakeium.getReport().has({ type: 'CallEvent', path: 'second', returns: { ref: 4 } })).to.be.true
        fakeium.dispose()

        await fakeium.run('third.js', 'third()')
        expect(fakeium.getReport().has({ path: 'first' })).to.be.false
        expect(fakeium.getReport().has({ path: 'second' })).to.be.false
        expect(fakeium.getReport().has({ type: 'CallEvent', path: 'third', returns: { ref: 2 } })).to.be.true
    })

    it('resolves paths in both dot and bracket notation', async () => {
        const fakeium = new Fakeium({ logger })
        await fakeium.run('index.js',
            'a.b.c[123];\n' +
            'a.b.c.d[\'with space\'].e;\n' +
            'a.b.$1;\n'
        )
        expect(fakeium.getReport().has({ type: 'GetEvent', path: 'a.b.c[123]' })).to.be.true
        expect(fakeium.getReport().has({ type: 'GetEvent', path: 'a.b.c.d["with space"].e' })).to.be.true
        expect(fakeium.getReport().has({ type: 'GetEvent', path: 'a.b.$1' })).to.be.true
        fakeium.dispose()
    })

    it('logs simple function calls', async() => {
        const fakeium = new Fakeium({ logger })
        await fakeium.run('index.js', 'console.log(something, 123)')
        expect(fakeium.getReport().has({
            type: 'CallEvent',
            path: 'console.log',
            arguments: [ { ref: 3 }, { literal: 123 } ],
        })).to.be.true
        fakeium.dispose()
        expect(fakeium.getReport().size()).to.equal(0)
    })

    it('does not produce extra Object.length on scripts', async() => {
        const fakeium = new Fakeium({ logger })
        await fakeium.run('index.js', 'alert("hello")')
        expect(fakeium.getReport().getAll()).to.be.deep.equal([
            {
                type: 'GetEvent',
                path: 'alert',
                value: { ref: 1 },
                location: { filename: 'file:///index.js', line: 1, column: 1 },
            },
            {
                type: 'CallEvent',
                path: 'alert',
                arguments: [ { literal: 'hello' } ],
                returns: { ref: 2 },
                isConstructor: false,
                location: { filename: 'file:///index.js', line: 1, column: 1 },
            },
        ])
        fakeium.dispose()
    })

    it('logs thenable function calls', async () => {
        const fakeium = new Fakeium({ logger })
        await fakeium.run('index.js',
            '(async () => {\n' +
            '    const res = await aPromise();\n' +
            '    console.log(res);\n' +
            '    const sameRes = await res;\n' +
            '    if (res !== sameRes) {\n' +
            '        throw new Error("Resolving the same promise must yield the same value");\n' +
            '    }\n' +
            '    reachedEnd(sameRes);\n' +
            '})();\n'
        )
        expect(fakeium.getReport().has({ type: 'CallEvent', path: 'aPromise', returns: { ref: 2 } })).to.be.true
        expect(fakeium.getReport().has({
            type: 'CallEvent',
            path: 'console.log',
            arguments: [ { ref: 2 } ],
            returns: { literal: undefined },
        })).to.be.true
        expect(fakeium.getReport().has({
            type: 'CallEvent',
            path: 'reachedEnd',
            arguments: [ { ref: 2 } ],
            returns: { ref: 6 },
        })).to.be.true
        fakeium.dispose()
    })

    it('runs code with module imports', async () => {
        const fakeium = new Fakeium({ logger, sourceType: 'module' })
        fakeium.setResolver(async url => {
            if (url.href === 'file:///index.js') {
                return 'import { callMe } from "./test.js";\n' +
                       'import "./subdir/hey.js";\n' +
                       'index();\n' +
                       'export default {\n' +
                       '  start: () => thisShouldNotBeCalled(),\n' +
                       '}\n'
            }
            if (url.href === 'file:///test.js') {
                return '/* Hi from test.js! */\n' +
                       'export const callMe = () => iGotCalled();\n'
            }
            if (url.href === 'file:///subdir/hey.js') {
                return 'import { callMe as callMeFn } from "../test.js";\n' +
                       'import "../a [weird] (name).js";\n' +
                       'callMeFn();\n';
            }
            if (url.href === 'file:///a%20[weird]%20(name).js') {
                return 'weirdName();\n';
            }
            return null
        })
        await fakeium.run('./index.js')
        expect(fakeium.getReport().getAll()).to.deep.equal([
            {
                type: 'GetEvent',
                path: 'weirdName',
                value: { ref: 1 },
                location: { filename: 'file:///a%20[weird]%20(name).js', line: 1, column: 1 },
            },
            {
                type: 'CallEvent',
                path: 'weirdName',
                arguments: [],
                returns: { ref: 2 },
                isConstructor: false,
                location: { filename: 'file:///a%20[weird]%20(name).js', line: 1, column: 1 },
            },
            {
                type: 'GetEvent',
                path: 'iGotCalled',
                value: { ref: 3 },
                location: { filename: 'file:///test.js', line: 2, column: 29 },
            },
            {
                type: 'CallEvent',
                path: 'iGotCalled',
                arguments: [],
                returns: { ref: 4 },
                isConstructor: false,
                location: { filename: 'file:///test.js', line: 2, column: 29 },
            },
            {
                type: 'GetEvent',
                path: 'index',
                value: { ref: 5 },
                location: { filename: 'file:///index.js', line: 3, column: 1 },
            },
            {
                type: 'CallEvent',
                path: 'index',
                arguments: [],
                returns: { ref: 6 },
                isConstructor: false,
                location: { filename: 'file:///index.js', line: 3, column: 1 },
            }
        ])
        fakeium.dispose()
    })

    it('runs eval code', async () => {
        const fakeium = new Fakeium({ logger })
        await fakeium.run('index.js', 'alert(eval("1+1"))')
        expect(fakeium.getReport().has({
            type: 'CallEvent',
            path: 'eval',
            arguments: [ { literal: '1+1' } ],
            returns: { literal: 2 },
        })).to.be.true
        fakeium.dispose()
    })

    it('handles constructors', async () => {
        const fakeium = new Fakeium({ logger })
        await fakeium.run('index.js',
            '(async () => {\n' +
            '    const dateAsJson = new Date("2021-01-02").toJSON();\n' +
            '    crypto.getRandomValues(new Uint32Array(16));\n' +
            '    const Thing = getThing();\n' +
            '    const thing = new Thing(dateAsJson);\n' +
            '    thing.doSomething();\n' +
            '    const AsyncThing = await getAsyncThing();\n' +
            '    new AsyncThing(thing);\n' +
            '    const req = new XMLHttpRequest();\n' +
            '    req.open("GET", "https://www.example.com/");\n' +
            '    req.send();\n' +
            '})();\n'
        )

        expect(fakeium.getReport().has({
            type: 'CallEvent',
            path: 'Date',
            arguments: [ { literal: '2021-01-02' } ],
            returns: { ref: 2 },
            isConstructor: true,
        })).to.be.true
        expect(fakeium.getReport().has({
            type: 'CallEvent',
            path: 'Date().toJSON',
            arguments: [],
            returns: { literal: '2021-01-02T00:00:00.000Z' },
            isConstructor: false,
        })).to.be.true

        expect(fakeium.getReport().has({
            type: 'CallEvent',
            path: 'Uint32Array',
            arguments: [ { literal: 16 } ],
            returns: { ref: 7 },
            isConstructor: true,
        })).to.be.true
        expect(fakeium.getReport().has({
            type: 'CallEvent',
            path: 'crypto.getRandomValues',
            arguments: [ { ref: 7 } ],
            returns: { ref: 8 },
            isConstructor: false,
        })).to.be.true

        expect(fakeium.getReport().has({
            type: 'CallEvent',
            path: 'getThing',
            arguments: [ { literal: '2021-01-02T00:00:00.000Z' } ],
            returns: { ref: 11 },
            isConstructor: true,
        })).to.be.true
        expect(fakeium.getReport().has({
            type: 'CallEvent',
            path: 'getAsyncThing',
            arguments: [ { ref: 11 } ],
            isConstructor: true,
        })).to.be.true

        expect(fakeium.getReport().has({
            type: 'CallEvent',
            path: 'XMLHttpRequest',
            arguments: [],
            isConstructor: true,
        })).to.be.true
        expect(fakeium.getReport().has({
            type: 'CallEvent',
            path: 'XMLHttpRequest().open',
            arguments: [ { literal: 'GET' }, { literal: 'https://www.example.com/' } ],
            isConstructor: false,
        })).to.be.true

        fakeium.dispose()
    })

    it('handles calling of functions in several ways', async () => {
        const fakeium = new Fakeium({ logger })
        await fakeium.run('index.js',
            'function test() {\n' +
            '    done();\n' +
            '}\n' +
            ';(async () => {\n' +
            '    something.apply(null, [1, 2, 3]);\n' +
            '    another.thing.bind({})("hey");\n' +
            '    await another.something.call(this);\n' +
            '    test.apply(null, []);\n' +
            '})();\n'
        )
        expect(fakeium.getReport().has({
            type: 'CallEvent',
            path: 'something',
            arguments: [ { literal: 1 }, { literal: 2 }, { literal: 3 } ],
            isConstructor: false,
        })).to.be.true
        expect(fakeium.getReport().has({
            type: 'CallEvent',
            path: 'another.thing',
            arguments: [ { literal: 'hey' } ],
            isConstructor: false,
        })).to.be.true
        expect(fakeium.getReport().has({
            type: 'CallEvent',
            path: 'another.something',
            arguments: [],
            isConstructor: false,
        })).to.be.true
        expect(fakeium.getReport().has({
            type: 'CallEvent',
            path: 'done',
            arguments: [],
            isConstructor: false,
        })).to.be.true
        fakeium.dispose()
    })

    it('handles callbacks and event listeners', async () => {
        const fakeium = new Fakeium({ logger })
        await fakeium.run('index.js',
            'window.addEventListener("load", function() {\n' +
            '    navigator.gotCalled();\n' +
            '    throw new Error("Crash!");\n' +
            '    // This line is unreachable, but the program must not crash\n' +
            '});\n' +
            '$("#button").click(() => {\n' +
            '    also.gotCalled();\n' +
            '});\n'
        )
        expect(fakeium.getReport().has({ type: 'CallEvent', path: 'navigator.gotCalled' })).to.be.true
        expect(fakeium.getReport().has({ type: 'CallEvent', path: 'also.gotCalled' })).to.be.true
        fakeium.dispose()
    })

    it('creates mocks that can be converted to primitive values', async () => {
        const fakeium = new Fakeium({ logger })
        await fakeium.run('index.js',
            'const diff = 123_456 - document.createEvent("Event").timeStamp;\n' +
            'console.log(diff);\n'
        )
        expect(fakeium.getReport().has({ type: 'CallEvent', path: 'console.log', arguments: [ {literal: 123456 }] }))
        fakeium.dispose()
    })

    it('handles iterators', async () => {
        const fakeium = new Fakeium({ logger })
        await fakeium.run('index.js',
            'for (const test of getItems()) {\n' +
            '    console.log(test.hey());\n' +
            '}\n'
        )
        expect(fakeium.getReport().has({ type: 'CallEvent', path: 'getItems()[3].hey', arguments: [] })).to.be.true
        fakeium.dispose()
    })

    it('uses different scopes for scripts and modules', async () => {
        const fakeium = new Fakeium({ logger })
        await fakeium.run('script.js',
            'if (this === undefined || this !== globalThis) {\n' +
            '    throw new Error("Invalid scope");\n' +
            '}\n',
            { sourceType: 'script' },
        )
        await fakeium.run('module.js',
            'if (this !== undefined || globalThis === undefined) {\n' +
            '    throw new Error("Invalid scope");\n' +
            '}\n',
            { sourceType: 'module' },
        )
        fakeium.dispose()
    })

    it('shares global scope in modules', async () => {
        const fakeium = new Fakeium({ logger, sourceType: 'module' })
        fakeium.setResolver(async url => {
            if (url.pathname === '/index.js') {
                return 'import "./other-module.js";\n' +
                       'if (globalThis.test !== 123) {\n' +
                       '    throw new Error("Global scope is not being shared");\n' +
                       '}\n'
            }
            if (url.pathname === '/other-module.js') {
                return 'globalThis.test = 123;\n'
            }
            return null
        })
        await fakeium.run('index.js')
        fakeium.dispose()
    })

    it('does not SIGSEGV', async () => {
        const fakeium = new Fakeium({ logger })
        await fakeium.run('index.js',
            'function doStuff() {\n' +
            '    console.log("Doing stuff");\n' +
            '}\n' +
            'var tid;\n' +
            'var debouncedCheck = function () {\n' +
            '    clearTimeout(tid);\n' +
            '    tid = setTimeout(doStuff, 100);\n' +
            '};\n' +
            'window.addEventListener("resize", debouncedCheck, false);\n' +
            'var winLoad = function () {\n' +
            '    window.removeEventListener("load", winLoad, false);\n' +
            '    tid = setTimeout(doStuff, 0);\n' +
            '};\n' +
            'if (document.readyState !== "complete") {\n' +
            '    window.addEventListener("load", winLoad, false);\n' +
            '} else {\n' +
            '    winLoad();\n' +
            '}\n'
        )
        expect(fakeium.getReport().has({ arguments: [ { literal: 'Doing stuff' }] })).to.be.true
        fakeium.dispose()
    })
})

describe('Fakeium hooks', () => {
    it('throws an error for invalid paths', async () => {
        const fakeium = new Fakeium({ logger })
        expect(() => fakeium.hook('This is clearly not a valid path', '')).to.throw(InvalidPathError)
        expect(() => fakeium.hook('a.b.0.c', '')).to.throw(InvalidPathError)
        expect(() => fakeium.hook('hey[0.unclosed_bracket', '')).to.throw(InvalidPathError)
        expect(() => fakeium.hook('valid.path', new Reference('invalid path'))).to.throw(InvalidPathError)
        fakeium.dispose()
    })

    it('throws an error for non-transferable values', () => {
        const fakeium = new Fakeium({ logger })
        expect(() => fakeium.hook('something', Symbol('test'))).to.throw(InvalidValueError)
        fakeium.dispose()
    })

    it('throws an error on timeout caused by a hook', async () => {
        const fakeium = new Fakeium({ logger, timeout: 200 })
        fakeium.hook('test', () => {
            return new Promise(resolve => setTimeout(resolve, 1000))
        })
        for (const sourceType of ['script', 'module'] as const) {
            try {
                await fakeium.run('index.js', 'test()', { sourceType })
                assert.fail('Fakeium#run() did not throw any error')
            } catch (e) {
                expect(e).to.be.an.instanceOf(TimeoutError)
            }
            expectNonEmptyStats(fakeium.getStats())
            fakeium.dispose()
        }
    }).timeout(2000)

    it('aliases window and other objects to globalThis by default', async () => {
        const fakeium = new Fakeium({ logger })
        await fakeium.run('index.js',
            'for (const item of [frames, global, parent, self, window]) {\n' +
            '    if (typeof item !== "object" || item !== globalThis) {\n' +
            '        throw new Error("Sandbox did not pass environment verification");\n' +
            '    }\n' +
            '}\n'
        )
        fakeium.dispose()
    })

    it('fakes browser extensions environment by default', async () => {
        const fakeium = new Fakeium({ logger })

        // Ensure predefined mocks are correct
        await fakeium.run('index.js',
            '// "globalThis.chrome" must be an object, not a function\n' +
            'if (typeof chrome !== "object" || !chrome || !chrome.runtime || !chrome.runtime.id || chrome !== browser) {\n' +
            '    throw new Error("Sandbox did not pass environment verification");\n' +
            '}\n'
        )
        fakeium.dispose()

        // Validate auto-wiring of "chrome" to "browser" object
        await fakeium.run('index.js',
            '(async () => {\n' +
            '    const [ tab ] = await chrome.tabs.query({ active: true });\n' +
            '    const response = await browser.tabs.sendMessage(tab.id, { greeting: "hello" });\n' +
            '})();\n'
        )
        expect(fakeium.getReport().has({ type: 'CallEvent', path: 'browser.tabs.query' })).to.be.true
        expect(fakeium.getReport().has({ type: 'CallEvent', path: 'browser.tabs.sendMessage' })).to.be.true
        expect(fakeium.getReport().has({ path: 'chrome.tabs.query' })).to.be.false
        expect(fakeium.getReport().has({ path: 'chrome.tabs.sendMessage' })).to.be.false
        expect(fakeium.getReport().has({ path: 'chrome' })).to.be.false
        fakeium.dispose()
    })

    it('prevents mocking AMD loaders by default', async () => {
        const fakeium = new Fakeium({ logger })
        await fakeium.run('index.js',
            'if (define !== undefined || exports !== undefined || require !== undefined) {\n' +
            '    throw new Error("Sandbox did not pass environment verification");\n' +
            '}\n' +
            'globalThis.define = () => alert("I can be overwritten from inside the sandbox");\n' +
            'define();\n'
        )
        expect(fakeium.getReport().has({
            type: 'CallEvent',
            path: 'alert',
            arguments: [ { literal: 'I can be overwritten from inside the sandbox' }],
        })).to.be.true
        fakeium.dispose()
    })

    it('supports hooking certain objects inside the sandbox', async () => {
        let somethingGotCalled = false
        const fakeium = new Fakeium({ logger })
        fakeium.hook('sample.value', 'hello!')
        fakeium.hook('undefinedIsAlsoValid', undefined)
        fakeium.hook('hookMe', () => 33)
        fakeium.hook('something', async () => {
            somethingGotCalled = true
            return 123
        })
        fakeium.hook('test.something', new Reference('another.reference[0].to.somewhere'))
        await fakeium.run('index.js',
            'console.log(sample.value);\n' +
            'console.log(undefinedIsAlsoValid);\n' +
            'something();\n' +
            'window.something();\n' +
            'const res = hookMe();\n' +
            'anotherThing(res);\n' +
            'test.something.else();\n'
        )
        expect(fakeium.getReport().has({ path: 'sample.value', value: { literal: 'hello!' } })).to.be.true
        expect(fakeium.getReport().has({ path: 'undefinedIsAlsoValid', value: { literal: undefined } })).to.be.true
        expect(fakeium.getReport().has({ path: 'hookMe', returns: { literal: 33 } })).to.be.true
        expect(fakeium.getReport().has({ path: 'something', returns: { literal: 123 } })).to.be.true
        expect(somethingGotCalled).to.be.true
        expect(fakeium.getReport().has({ type: 'CallEvent', path: 'another.reference[0].to.somewhere.else' })).to.be.true
        fakeium.dispose()
    })

    it('handles writable and non-writable hooks', async () => {
        const fakeium = new Fakeium({ logger })
        fakeium.hook('writable', 'a', true)
        fakeium.hook('readOnly', 'a', false)
        fakeium.hook('writableFn', () => 'Y', true)
        fakeium.hook('readOnlyFn', () => 'Y', false)
        await fakeium.run('index.js',
            'writable += "b";\n' +
            'console.log(`writable is "${writable}"`);\n' +
            'readOnly += "b";\n' +
            'console.log(`readOnly is "${readOnly}"`);\n' +
            'writableFn();\n' +
            'writableFn = () => "Z";\n' +
            'writableFn();\n' +
            'readOnlyFn();\n' +
            'readOnlyFn = () => "Z";\n' +
            'readOnlyFn();\n'
        )

        // Set events should be logged regardless of writable state
        expect(fakeium.getReport().has({ path: 'writable', value: { literal: 'a' } })).to.be.true
        expect(fakeium.getReport().has({ path: 'writable', value: { literal: 'ab' } })).to.be.true
        expect(fakeium.getReport().has({ path: 'readOnly', value: { literal: 'a' } })).to.be.true
        expect(fakeium.getReport().has({ path: 'readOnly', value: { literal: 'ab' } })).to.be.true
        expect(fakeium.getReport().has({ type: 'SetEvent', path: 'writableFn' })).to.be.true
        expect(fakeium.getReport().has({ type: 'SetEvent', path: 'readOnlyFn' })).to.be.true

        // But changes should not persisted to read-only paths
        expect(fakeium.getReport().has({ arguments: [ { literal: 'writable is "ab"' } ] })).to.be.true
        expect(fakeium.getReport().has({ arguments: [ { literal: 'readOnly is "a"' } ] })).to.be.true
        expect(fakeium.getReport().has({
            path: 'writableFn',
            returns: { literal: 'Y' },
            location: { line: 5 },
        })).to.be.true
        expect(fakeium.getReport().has({
            path: 'writableFn',
            returns: { literal: 'Z' },
            location: { line: 7 },
        })).to.be.true
        expect(fakeium.getReport().has({
            path: 'readOnlyFn',
            returns: { literal: 'Y' },
            location: { line: 8 },
        })).to.be.true
        expect(fakeium.getReport().has({
            path: 'readOnlyFn',
            returns: { literal: 'Y' },
            location: { line: 10 },
        })).to.be.true

        fakeium.dispose()
    })

    it('supports returning non-transferable objects in hooked functions', async () => {
        let somethingGotCalled = false
        let fnGotCalled = false
        const fakeium = new Fakeium({ logger })
        fakeium.hook('something', (props: { a: number, b: number }) => {
            somethingGotCalled = true
            expect(props).to.be.deep.equal({ a: 1, b: 2 })
            return {
                a: props.a * 100,
                b: props.b * 100,
                c: {
                    d: 'hello',
                },
                fn: () => {
                    fnGotCalled = true
                    return 123
                },
                nestedFn: () => {
                    return () => 'hello from nested'
                },
            }
        })
        await fakeium.run('index.js',
            '(async () => {\n' +
            '    const test = something({ a: 1, b: 2 });\n' +
            '    if (test.a !== 100) {\n' +
            '        throw new Error("Invalid literal value for test.a");\n' +
            '    }\n' +
            '    if (test.b !== 200) {\n' +
            '        throw new Error("Invalid literal value for test.b");\n' +
            '    }\n' +
            '    if (test.c.d !== "hello") {\n' +
            '        throw new Error("Invalid literal value for test.c.d");\n' +
            '    }\n' +
            '    test.fn();\n' +
            '    const nestedFn = test.nestedFn();\n' +
            '    if (nestedFn() !== "hello from nested") {\n' +
            '        throw new Error("Invalid return value for test.nestedFn()()");\n' +
            '    }\n' +
            '})();\n'
        )
        expect(fakeium.getReport().has({ path: 'something().a', value: { literal: 100 } } )).to.be.true
        expect(fakeium.getReport().has({ path: 'something().b', value: { literal: 200 } } )).to.be.true
        expect(fakeium.getReport().has({ path: 'something().c.d', value: { literal: 'hello' } } )).to.be.true
        expect(fakeium.getReport().has({ path: 'something().fn', returns: { literal: 123 } })).to.be.true
        expect(somethingGotCalled).to.be.true
        expect(fnGotCalled).to.be.true
        fakeium.dispose()
    })
})
