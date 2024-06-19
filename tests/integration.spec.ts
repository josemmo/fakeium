import { expect } from 'chai'
import { Fakeium } from '../src/Fakeium'
import { DefaultLogger } from '../src/logger'
import { readFileSync } from 'fs'
import { dirname } from 'path'
import { fileURLToPath } from 'url'

const DATA_DIR = dirname(fileURLToPath(import.meta.url)) + '/data'
const logger = (process.env.LOG_LEVEL === 'debug') ? new DefaultLogger() : null

describe('Integration', () => {
    it('aight.js', async () => {
        const fakeium = new Fakeium({ logger })
        await fakeium.run('aight.js', readFileSync(`${DATA_DIR}/aight.txt`))
        expect(fakeium.getReport().has({ type: 'SetEvent', path: 'returnExports' })).to.be.true
        fakeium.dispose()
    })

    it('jquery.js', async () => {
        const fakeium = new Fakeium({ logger })
        await fakeium.run('jquery.js', readFileSync(`${DATA_DIR}/jquery.txt`))
        expect(fakeium.getReport().has({
            type: 'GetEvent',
            path: 'document.nodeType',
            value: { literal: 9 },
        })).to.be.true
        expect(fakeium.getReport().has({
            type: 'GetEvent',
            path: 'document.readyState',
            value: { literal: 'complete' },
        })).to.be.true
        expect(fakeium.getReport().has({ type: 'SetEvent', path: 'jQuery' })).to.be.true
        fakeium.dispose()
    })

    it('lodash.js', async () => {
        const fakeium = new Fakeium({ logger })
        await fakeium.run('lodash.js', readFileSync(`${DATA_DIR}/lodash.txt`))
        expect(fakeium.getReport().has({ type: 'SetEvent', path: '_' })).to.be.true
        fakeium.dispose()
    })

    it('moment.js', async () => {
        const fakeium = new Fakeium({ logger })
        await fakeium.run('moment.js',
            readFileSync(`${DATA_DIR}/moment.txt`, 'utf-8') + '\n' +
            'console.log("Date is " + moment("01022003", "DDMMYYYY").format("YYYY-MM-DD"));\n'
        )
        expect(fakeium.getReport().has({
            type: 'CallEvent',
            path: 'console.log',
            arguments: [ { literal: 'Date is 2003-02-01' }],
        }))
        fakeium.dispose()
    })

    it('react.min.js', async () => {
        const fakeium = new Fakeium({ logger })
        await fakeium.run('react.min.js', readFileSync(`${DATA_DIR}/react.min.txt`))
        expect(fakeium.getReport().has({ type: 'SetEvent', path: 'React' })).to.be.true
        fakeium.dispose()
    })

    it('webext.js', async () => {
        const fakeium = new Fakeium({ logger, sourceType: 'module' })
        fakeium.setResolver(async () => readFileSync(`${DATA_DIR}/webext.txt`))
        await fakeium.run('index.js',
            'import webext from "webext.js";\n' +
            'const tab = webext.tabs.query({ active: true });\n' +
            'console.log(`Active tab ID is ${tab.id}`);\n'
        )
        expect(fakeium.getReport().has({ type: 'CallEvent', path: 'browser.tabs.query' })).to.be.true
        expect(Array.from(fakeium.getReport().findAll({ type: 'CallEvent' }))).to.have.lengthOf(2)
        fakeium.dispose()
    })
})
