import { assert, expect } from 'chai'
import { ExecutionError, MemoryLimitError, ModuleNotFoundError, ParsingError, TimeoutError } from './errors'
import Mockium from './Mockium'

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
                arguments: [{ ref: 3 }],
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
                arguments: [{ literal: '{"tag":"a"}' }],
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
                arguments: [{ literal: '{"tag":"b"}' }],
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

    it('logs simple function calls', async() => {
        const mockium = new Mockium()
        await mockium.run('index.js', 'console.log(something, 123)')
        expect(mockium.getReport().has({
            type: 'CallEvent',
            path: 'console.log',
            arguments: [{ ref: 3 }, { literal: 123 }],
        })).to.be.true
        mockium.dispose()
        expect(mockium.getReport().size()).to.equal(0)
    })
})
