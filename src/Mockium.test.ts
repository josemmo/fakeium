import { assert, expect } from 'chai'
import { ExecutionError, InvalidPathError, InvalidValueError, MemoryLimitError, ModuleNotFoundError, ParsingError, TimeoutError } from './errors'
import Mockium from './Mockium'
import { Reference } from './hooks'

describe('Mockium', () => {
    it('initializes and disposes', async () => {
        const mockium = new Mockium()
        expect(mockium.getReport().size()).to.be.equal(0)
        mockium.dispose()
    })

    it('runs scripts without resolver', async () => {
        const mockium = new Mockium()
        await mockium.run('example.js', '1+1') // Create new module with custom source code
        await mockium.run('example.js')        // Run the same module (cached)
        await mockium.run('example.js', '2+2') // Override cached module with new source code
        mockium.dispose()
    })

    it('runs scripts with resolver', async () => {
        const mockium = new Mockium({ origin: 'https://localhost' })
        mockium.setResolver(async url => {
            if (url.href === 'https://localhost/index.js') {
                return '// This is the index\n'
            }
            return null
        })
        await mockium.run('index.js')
        await mockium.run('404.js', '// Not coming from resolver\n')
    })

    it('throws an error for unresolved modules', async () => {
        const mockium = new Mockium()
        try {
            await mockium.run('example.js')
        } catch (e) {
            expect(e).to.be.an.instanceOf(ModuleNotFoundError)
            return
        } finally {
            mockium.dispose()
        }
        assert.fail('Mockium#run() did not throw any error')
    })

    it('throws an error for invalid source code', async () => {
        const mockium = new Mockium()
        try {
            await mockium.run('example.js', 'This is not JavaScript code')
        } catch (e) {
            expect(e).to.be.an.instanceOf(ParsingError)
            return
        } finally {
            mockium.dispose()
        }
        assert.fail('Mockium#run() did not throw any error')
    })

    it('resolves module specifiers', async () => {
        const mockium = new Mockium()
        mockium.setResolver(async url => {
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
        await mockium.run('./index.js')
        await mockium.run('something/with spaces.js')
        await mockium.run('hash.js#this-is-a-fragment')

        // Run unsuccessful code
        try {
            await mockium.run('./crash.js')
            throw new Error('Did not crash when importing missing module')
        } catch (e) {
            expect(e).to.be.an.instanceOf(ModuleNotFoundError)
            expect(e).to.have.a.property('message').that.matches(/^Cannot find package "fake\/path\/to\/module.js"/)
        }

        mockium.dispose()
    })

    it('propagates unhandled sandbox errors', async () => {
        const mockium = new Mockium()
        try {
            await mockium.run('crash.js', 'throw new Error("oh no!");')
        } catch (e) {
            expect(e).to.be.an.instanceOf(ExecutionError)
            return
        } finally {
            mockium.dispose()
        }
        assert.fail('Mockium#run() did not throw any error')
    })

    it('throws an error on timeout', async () => {
        const mockium = new Mockium({ timeout: 500 })
        try {
            await mockium.run('endless.js', 'while (true) {;;}')
        } catch (e) {
            expect(e).to.be.an.instanceOf(TimeoutError)
            return
        } finally {
            mockium.dispose()
        }
        assert.fail('Mockium#run() did not throw any error')
    }).timeout(1000)

    it('throw an error on memory exhaustion', async () => {
        const mockium = new Mockium({ maxMemory: 8 })
        const code = 'const garbage = [];\n' +
                     'while (true) {\n' +
                     '    garbage.push("abcdefghijklmnopqrstuvwxyz".repeat(1024));\n' +
                     '}\n'
        try {
            await mockium.run('crash.js', code)
        } catch (e) {
            expect(e).to.be.an.instanceOf(MemoryLimitError)
            return
        } finally {
            mockium.dispose()
        }
        assert.fail('Mockium#run() did not throw any error')
    })
})

describe('Mockium sandbox', () => {
    it('assigns incremental value IDs', async () => {
        const mockium = new Mockium()
        mockium.setResolver(async () => {
            return '(async () => {\n' +
                   '    const a = JSON.stringify({ tag: "a" });\n' +
                   '    const b = JSON.stringify({ tag: "b" });\n' +
                   '    callMe(a);\n' +
                   '    callMe(b);\n' +
                   '})();\n'
        })
        await mockium.run('index.js')
        expect(mockium.getReport().getAll()).to.deep.equal([
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
        mockium.dispose()
    })

    it('assigns incremental value IDs after clearing and dispose', async () => {
        const mockium = new Mockium()

        await mockium.run('first.js', 'first()')
        expect(mockium.getReport().has({ type: 'CallEvent', path: 'first', returns: { ref: 2 } })).to.be.true
        mockium.getReport().clear()

        await mockium.run('second.js', 'second()')
        expect(mockium.getReport().has({ path: 'first' })).to.be.false
        expect(mockium.getReport().has({ type: 'CallEvent', path: 'second', returns: { ref: 4 } })).to.be.true
        mockium.dispose()

        await mockium.run('third.js', 'third()')
        expect(mockium.getReport().has({ path: 'first' })).to.be.false
        expect(mockium.getReport().has({ path: 'second' })).to.be.false
        expect(mockium.getReport().has({ type: 'CallEvent', path: 'third', returns: { ref: 2 } })).to.be.true
    })

    it('resolves paths in both dot and bracket notation', async () => {
        const mockium = new Mockium()
        await mockium.run('index.js',
            'a.b.c[123];\n' +
            'a.b.c.d[\'with space\'].e;\n' +
            'a.b.$1;\n'
        )
        expect(mockium.getReport().has({ type: 'GetEvent', path: 'a.b.c[123]' })).to.be.true
        expect(mockium.getReport().has({ type: 'GetEvent', path: 'a.b.c.d["with space"].e' })).to.be.true
        expect(mockium.getReport().has({ type: 'GetEvent', path: 'a.b.$1' })).to.be.true
        mockium.dispose()
    })

    it('logs simple function calls', async() => {
        const mockium = new Mockium()
        await mockium.run('index.js', 'console.log(something, 123)')
        expect(mockium.getReport().has({
            type: 'CallEvent',
            path: 'console.log',
            arguments: [ { ref: 3 }, { literal: 123 } ],
        })).to.be.true
        mockium.dispose()
        expect(mockium.getReport().size()).to.equal(0)
    })

    it('logs thenable function calls', async () => {
        const mockium = new Mockium()
        await mockium.run('index.js',
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
        expect(mockium.getReport().has({ type: 'CallEvent', path: 'aPromise', returns: { ref: 2 } })).to.be.true
        expect(mockium.getReport().has({
            type: 'CallEvent',
            path: 'console.log',
            arguments: [ { ref: 2 } ],
            returns: { literal: undefined },
        })).to.be.true
        expect(mockium.getReport().has({
            type: 'CallEvent',
            path: 'reachedEnd',
            arguments: [ { ref: 2 } ],
            returns: { ref: 6 },
        })).to.be.true
        mockium.dispose()
    })

    it('runs code with module imports', async () => {
        const mockium = new Mockium()
        mockium.setResolver(async url => {
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
        await mockium.run('./index.js')
        expect(mockium.getReport().getAll()).to.deep.equal([
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
        mockium.dispose()
    })

    it('runs eval code', async () => {
        const mockium = new Mockium()
        await mockium.run('index.js', 'alert(eval("1+1"))')
        expect(mockium.getReport().has({
            type: 'CallEvent',
            path: 'eval',
            arguments: [ { literal: '1+1' } ],
            returns: { literal: 2 },
        })).to.be.true
        mockium.dispose()
    })

    it('handles constructors', async () => {
        const mockium = new Mockium()
        await mockium.run('index.js',
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

        expect(mockium.getReport().has({
            type: 'CallEvent',
            path: 'Date',
            arguments: [ { literal: '2021-01-02' } ],
            returns: { ref: 2 },
            isConstructor: true,
        })).to.be.true
        expect(mockium.getReport().has({
            type: 'CallEvent',
            path: 'Date().toJSON',
            arguments: [],
            returns: { literal: '2021-01-02T00:00:00.000Z' },
            isConstructor: false,
        })).to.be.true

        expect(mockium.getReport().has({
            type: 'CallEvent',
            path: 'Uint32Array',
            arguments: [ { literal: 16 } ],
            returns: { ref: 7 },
            isConstructor: true,
        })).to.be.true
        expect(mockium.getReport().has({
            type: 'CallEvent',
            path: 'crypto.getRandomValues',
            arguments: [ { ref: 7 } ],
            returns: { ref: 8 },
            isConstructor: false,
        })).to.be.true

        expect(mockium.getReport().has({
            type: 'CallEvent',
            path: 'getThing',
            arguments: [ { literal: '2021-01-02T00:00:00.000Z' } ],
            returns: { ref: 11 },
            isConstructor: true,
        })).to.be.true
        expect(mockium.getReport().has({
            type: 'CallEvent',
            path: 'getAsyncThing',
            arguments: [ { ref: 11 } ],
            isConstructor: true,
        })).to.be.true

        expect(mockium.getReport().has({
            type: 'CallEvent',
            path: 'XMLHttpRequest',
            arguments: [],
            isConstructor: true,
        })).to.be.true
        expect(mockium.getReport().has({
            type: 'CallEvent',
            path: 'XMLHttpRequest().open',
            arguments: [ { literal: 'GET' }, { literal: 'https://www.example.com/' } ],
            isConstructor: false,
        })).to.be.true

        mockium.dispose()
    })

    it('handles calling of functions in several ways', async () => {
        const mockium = new Mockium()
        await mockium.run('index.js',
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
        expect(mockium.getReport().has({
            type: 'CallEvent',
            path: 'something',
            arguments: [ { literal: 1 }, { literal: 2 }, { literal: 3 } ],
            isConstructor: false,
        })).to.be.true
        expect(mockium.getReport().has({
            type: 'CallEvent',
            path: 'another.thing',
            arguments: [ { literal: 'hey' } ],
            isConstructor: false,
        })).to.be.true
        expect(mockium.getReport().has({
            type: 'CallEvent',
            path: 'another.something',
            arguments: [],
            isConstructor: false,
        })).to.be.true
        expect(mockium.getReport().has({
            type: 'CallEvent',
            path: 'done',
            arguments: [],
            isConstructor: false,
        })).to.be.true
        mockium.dispose()
    })

    it('handles callbacks and event listeners', async () => {
        const mockium = new Mockium()
        await mockium.run('index.js',
            'window.addEventListener("load", function() {\n' +
            '    navigator.gotCalled();\n' +
            '    throw new Error("Crash!");\n' +
            '    // This line is unreachable, but the program must not crash\n' +
            '});\n' +
            '$("#button").click(() => {\n' +
            '    also.gotCalled();\n' +
            '});\n'
        )
        expect(mockium.getReport().has({ type: 'CallEvent', path: 'navigator.gotCalled' })).to.be.true
        expect(mockium.getReport().has({ type: 'CallEvent', path: 'also.gotCalled' })).to.be.true
        mockium.dispose()
    })

    it('creates mocks that can be converted to primitive values', async () => {
        const mockium = new Mockium()
        await mockium.run('index.js',
            'const diff = 123_456 - document.createEvent("Event").timeStamp;\n' +
            'console.log(diff);\n'
        )
        expect(mockium.getReport().has({ type: 'CallEvent', path: 'console.log', arguments: [ {literal: 123456 }] }))
        mockium.dispose()
    })

    it('handles iterators', async () => {
        const mockium = new Mockium()
        await mockium.run('index.js',
            'for (const test of getItems()) {\n' +
            '    console.log(test.hey());\n' +
            '}\n'
        )
        expect(mockium.getReport().has({ type: 'CallEvent', path: 'getItems()[3].hey', arguments: [] })).to.be.true
        mockium.dispose()
    })
})

describe('Mockium hooks', () => {
    it('throws an error for invalid paths', async () => {
        const mockium = new Mockium()
        expect(() => mockium.hook('This is clearly not a valid path', '')).to.throw(InvalidPathError)
        expect(() => mockium.hook('a.b.0.c', '')).to.throw(InvalidPathError)
        expect(() => mockium.hook('hey[0.unclosed_bracket', '')).to.throw(InvalidPathError)
        expect(() => mockium.hook('valid.path', new Reference('invalid path'))).to.throw(InvalidPathError)
        mockium.dispose()
    })

    it('throws an error for non-transferable values', () => {
        const mockium = new Mockium()
        expect(() => mockium.hook('something', Symbol('test'))).to.throw(InvalidValueError)
        mockium.dispose()
    })

    it('aliases window and other objects to globalThis by default', async () => {
        const mockium = new Mockium()
        await mockium.run('index.js',
            'for (const item of [frames, global, parent, self, window]) {\n' +
            '    if (typeof item !== "object" || item !== globalThis) {\n' +
            '        throw new Error("Sandbox did not pass environment verification");\n' +
            '    }\n' +
            '}\n'
        )
        mockium.dispose()
    })

    it('fakes browser extensions environment by default', async () => {
        const mockium = new Mockium()

        // Ensure predefined mocks are correct
        await mockium.run('index.js',
            '// "globalThis.chrome" must be an object, not a function\n' +
            'if (typeof chrome !== "object" || !chrome || !chrome.runtime || !chrome.runtime.id || chrome !== browser) {\n' +
            '    throw new Error("Sandbox did not pass environment verification");\n' +
            '}\n'
        )
        mockium.dispose()

        // Validate auto-wiring of "chrome" to "browser" object
        await mockium.run('index.js',
            '(async () => {\n' +
            '    const [ tab ] = await chrome.tabs.query({ active: true });\n' +
            '    const response = await browser.tabs.sendMessage(tab.id, { greeting: "hello" });\n' +
            '})();\n'
        )
        expect(mockium.getReport().has({ type: 'CallEvent', path: 'browser.tabs.query' })).to.be.true
        expect(mockium.getReport().has({ type: 'CallEvent', path: 'browser.tabs.sendMessage' })).to.be.true
        expect(mockium.getReport().has({ path: 'chrome.tabs.query' })).to.be.false
        expect(mockium.getReport().has({ path: 'chrome.tabs.sendMessage' })).to.be.false
        expect(mockium.getReport().has({ path: 'chrome' })).to.be.false
        mockium.dispose()
    })

    it('supports hooking certain objects inside the sandbox', async () => {
        let somethingGotCalled = false
        const mockium = new Mockium()
        mockium.hook('sample.value', 'hello!')
        mockium.hook('hookMe', () => 33)
        mockium.hook('something', async () => {
            somethingGotCalled = true
            return 123
        })
        mockium.hook('test.something', new Reference('another.reference[0].to.somewhere'))
        await mockium.run('index.js',
            'console.log(sample.value);\n' +
            'something();\n' +
            'window.something();\n' +
            'const res = hookMe();\n' +
            'anotherThing(res);\n' +
            'test.something.else();\n'
        )
        expect(mockium.getReport().has({ path: 'sample.value', value: { literal: 'hello!' } })).to.be.true
        expect(mockium.getReport().has({ path: 'hookMe', returns: { literal: 33 } })).to.be.true
        expect(mockium.getReport().has({ path: 'something', returns: { literal: 123 } })).to.be.true
        expect(somethingGotCalled).to.be.true
        expect(mockium.getReport().has({ type: 'CallEvent', path: 'another.reference[0].to.somewhere.else' })).to.be.true
        mockium.dispose()
    })

    it('handles writable and non-writable hooks', async () => {
        const mockium = new Mockium()
        mockium.hook('writable', 'a', true)
        mockium.hook('readOnly', 'a', false)
        mockium.hook('writableFn', () => 'Y', true)
        mockium.hook('readOnlyFn', () => 'Y', false)
        await mockium.run('index.js',
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
        expect(mockium.getReport().has({ path: 'writable', value: { literal: 'a' } })).to.be.true
        expect(mockium.getReport().has({ path: 'writable', value: { literal: 'ab' } })).to.be.true
        expect(mockium.getReport().has({ path: 'readOnly', value: { literal: 'a' } })).to.be.true
        expect(mockium.getReport().has({ path: 'readOnly', value: { literal: 'ab' } })).to.be.true
        expect(mockium.getReport().has({ type: 'SetEvent', path: 'writableFn' })).to.be.true
        expect(mockium.getReport().has({ type: 'SetEvent', path: 'readOnlyFn' })).to.be.true

        // But changes should not persisted to read-only paths
        expect(mockium.getReport().has({ arguments: [ { literal: 'writable is "ab"' } ] })).to.be.true
        expect(mockium.getReport().has({ arguments: [ { literal: 'readOnly is "a"' } ] })).to.be.true
        expect(mockium.getReport().has({
            path: 'writableFn',
            returns: { literal: 'Y' },
            location: { line: 5 },
        })).to.be.true
        expect(mockium.getReport().has({
            path: 'writableFn',
            returns: { literal: 'Z' },
            location: { line: 7 },
        })).to.be.true
        expect(mockium.getReport().has({
            path: 'readOnlyFn',
            returns: { literal: 'Y' },
            location: { line: 8 },
        })).to.be.true
        expect(mockium.getReport().has({
            path: 'readOnlyFn',
            returns: { literal: 'Y' },
            location: { line: 10 },
        })).to.be.true

        mockium.dispose()
    })
})
