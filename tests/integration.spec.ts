import { expect } from 'chai'
import Mockium from '../src/Mockium'
import { DefaultLogger } from '../src/logger'
import { readFileSync } from 'fs'
import { dirname } from 'path'
import { fileURLToPath } from 'url'

const DATA_DIR = dirname(fileURLToPath(import.meta.url)) + '/data'
const logger = (process.env.LOG_LEVEL === 'debug') ? new DefaultLogger() : null

describe('Integration', () => {
    it('jquery.js', async () => {
        const mockium = new Mockium({ logger })
        await mockium.run('jquery.js', readFileSync(`${DATA_DIR}/jquery.txt`))
        expect(mockium.getReport().has({
            type: 'GetEvent',
            path: 'document.nodeType',
            value: { literal: 9 },
        })).to.be.true
        expect(mockium.getReport().has({
            type: 'GetEvent',
            path: 'document.readyState',
            value: { literal: 'complete' },
        })).to.be.true
        expect(mockium.getReport().has({ type: 'SetEvent', path: 'jQuery' })).to.be.true
        mockium.dispose()
    })

    it('lodash.js', async () => {
        const mockium = new Mockium({ logger })
        await mockium.run('lodash.js', readFileSync(`${DATA_DIR}/lodash.txt`))
        expect(mockium.getReport().has({ type: 'SetEvent', path: '_' })).to.be.true
        mockium.dispose()
    })

    it('webext.js', async () => {
        const mockium = new Mockium({ logger, sourceType: 'module' })
        mockium.setResolver(async () => readFileSync(`${DATA_DIR}/webext.txt`))
        await mockium.run('index.js',
            'import webext from "webext.js";\n' +
            'const tab = webext.tabs.query({ active: true });\n' +
            'console.log(`Active tab ID is ${tab.id}`);\n'
        )
        expect(mockium.getReport().has({ type: 'CallEvent', path: 'browser.tabs.query' })).to.be.true
        expect(Array.from(mockium.getReport().findAll({ type: 'CallEvent' }))).to.have.lengthOf(2)
        mockium.dispose()
    })
})
