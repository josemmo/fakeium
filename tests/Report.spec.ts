import { expect } from 'chai'
import { Location, Report, ReportEvent } from '../src/Report'

const TEST_LOCATION: Location = {
    filename: 'file:///test.js',
    line: 1,
    column: 1,
}

describe('Report', () => {
    it('calculates size accordingly', async () => {
        const report = new Report()
        expect(report.size()).to.equal(0)

        // Add events
        for (let id=1; id<=8; id++) {
            report.add({
                type: 'GetEvent',
                path: 'before',
                value: { ref: id },
                location: TEST_LOCATION,
            })
        }
        expect(report.size()).to.equal(8)

        // Clear report
        report.clear()
        expect(report.size()).to.equal(0)
    })

    it('adds and returns all events', async () => {
        const events: ReportEvent[] = [
            {
                type: 'GetEvent',
                path: 'test',
                value: { ref: 1 },
                location: TEST_LOCATION,
            },
            {
                type: 'GetEvent',
                path: 'another',
                value: { ref: 2 },
                location: TEST_LOCATION,
            },
            {
                type: 'SetEvent',
                path: 'something',
                value: { ref: 3 },
                location: {
                    filename: 'https://localhost/another/file.js',
                    line: 101,
                    column: 202,
                },
            },
        ]
        const report = new Report()
        report.add(events[0])
        report.add(events[1])
        report.add(events[2])
        expect(report.getAll()).to.deep.equal(events)
    })

    it('finds events from queries', async () => {
        const events: ReportEvent[] = [
            {
                type: 'GetEvent',
                path: 'first',
                value: { ref: 1 },
                location: TEST_LOCATION,
            },
            {
                type: 'GetEvent',
                path: 'second',
                value: { literal: 200 },
                location: { ...TEST_LOCATION, line: 222 },
            },
            {
                type: 'SetEvent',
                path: 'third',
                value: { literal: 'hey' },
                location: { ...TEST_LOCATION, column: 333 },
            },
            {
                type: 'CallEvent',
                path: 'callMe',
                arguments: [
                    { ref: 2 },
                    { literal: 'input' },
                    { ref: 3 },
                ],
                returns: { literal: undefined },
                isConstructor: false,
                location: TEST_LOCATION,
            },
            {
                type: 'CallEvent',
                path: 'NoArguments',
                arguments: [],
                returns: { ref: 4 },
                isConstructor: true,
                location: TEST_LOCATION,
            },
        ]
        const report = new Report()
        report.add(events[0])
        report.add(events[1])
        report.add(events[2])
        report.add(events[3])
        report.add(events[4])

        // Test "findAll" method
        expect(Array.from(report.findAll({}))).to.deep.equal(report.getAll())
        expect(Array.from(report.findAll({ path: 'does.not.exist' }))).to.deep.equal([])
        expect(Array.from(report.findAll({ type: 'SetEvent' }))).to.deep.equal([events[2]])
        expect(Array.from(report.findAll({ location: { filename: TEST_LOCATION.filename } }))).to.deep.equal(report.getAll())
        expect(Array.from(report.findAll({ path: 'second' }))).to.deep.equal([events[1]])
        expect(Array.from(report.findAll({ location: { column: 333 } }))).to.deep.equal([events[2]])
        expect(Array.from(report.findAll({ value: { literal: 200 } }))).to.deep.equal([events[1]])
        expect(Array.from(report.findAll({ arguments: [{ ref: 2 }] }))).to.deep.equal([events[3]])
        expect(Array.from(report.findAll({ isConstructor: false }))).to.deep.equal([events[3]])
        expect(Array.from(report.findAll({ returns: { literal: undefined } }))).to.deep.equal([events[3]])

        // Test "find" method
        expect(report.find({ type: 'GetEvent' })).to.deep.equal(events[0])
        expect(report.find({ value: { literal: 'missing' } })).to.equal(null)
        expect(report.find({ location: { filename: TEST_LOCATION.filename } })).to.deep.equal(events[0])
        expect(report.find({ isConstructor: true })).to.equal(events[4])
        expect(report.find({ arguments: [] })).to.equal(events[4])

        // Test "has" method
        expect(report.has({ type: 'GetEvent' })).to.be.true
        expect(report.has({ value: { literal: 'missing' } })).to.be.false
        expect(report.has({ path: 'callMe' })).to.be.true
        expect(report.has({ path: 'doNotCallMe' })).to.be.false
    })
})
