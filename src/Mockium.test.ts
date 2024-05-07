import { assert, expect } from 'chai'
import { ExecutionError, MemoryLimitError, ModuleNotFoundError, TimeoutError } from './errors'
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
        const mockium = new Mockium({timeout: 500})
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
        const mockium = new Mockium({maxMemory: 8})
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
