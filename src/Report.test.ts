import { expect } from 'chai'
import Report, { Location, ReportEvent } from './Report'

const TEST_LOCATION: Location = {
    filename: 'file:///test.js',
    line: 1,
    column: 1,
}

describe('Report', () => {
    it('calculates size accordingly', async () => {
        const report = new Report()
        expect(report.size()).to.equal(0)
        expect(report.totalSize()).to.equal(0)

        // Add events
        for (let id=1; id<=8; id++) {
            report.add({
                id,
                type: 'GetEvent',
                path: 'before',
                value: { unknown: true },
                location: TEST_LOCATION,
            })
        }
        expect(report.size()).to.equal(8)
        expect(report.totalSize()).to.equal(8)

        // Flush report
        report.flush()
        expect(report.size()).to.equal(0)
        expect(report.totalSize()).to.equal(8)

        // Add more events
        for (let id=9; id<=11; id++) {
            report.add({
                id,
                type: 'GetEvent',
                path: 'after',
                value: { unknown: true },
                location: TEST_LOCATION,
            })
        }
        expect(report.size()).to.equal(3)
        expect(report.totalSize()).to.equal(11)

        // Reset report
        report.reset()
        expect(report.size()).to.equal(0)
        expect(report.totalSize()).to.equal(0)
    })

    it('adds and returns all events', async () => {
        const events: ReportEvent[] = [
            {
                id: 1,
                type: 'GetEvent',
                path: 'test',
                value: { unknown: true },
                location: TEST_LOCATION,
            },
            {
                id: 2,
                type: 'GetEvent',
                path: 'another',
                value: { unknown: true },
                location: TEST_LOCATION,
            },
            {
                id: 3,
                type: 'SetEvent',
                path: 'something',
                value: { unknown: true },
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
        report.add(events[1]) // Mind the same event again
        report.add(events[2])
        expect(Array.from(report.getAll())).to.deep.equal(events)
    })

    it('finds events from queries', async () => {
        const events: ReportEvent[] = [
            {
                id: 1,
                type: 'GetEvent',
                path: 'first',
                value: { unknown: true },
                location: TEST_LOCATION,
            },
            {
                id: 2,
                type: 'GetEvent',
                path: 'second',
                value: { literal: 2 },
                location: { ...TEST_LOCATION, line: 222 },
            },
            {
                id: 3,
                type: 'SetEvent',
                path: 'third',
                value: { literal: 3 },
                location: { ...TEST_LOCATION, column: 333 },
            },
            {
                id: 4,
                type: 'CallEvent',
                path: 'callMe',
                arguments: [
                    { unknown: true },
                    { literal: 'input' },
                    { ref: 2 },
                ],
                isConstructor: false,
                location: TEST_LOCATION,
            },
        ]
        const report = new Report()
        report.add(events[0])
        report.add(events[1])
        report.add(events[2])
        report.add(events[3])

        // Test "findAll" method
        expect(Array.from(report.findAll({}))).to.deep.equal(Array.from(report.getAll()))
        expect(Array.from(report.findAll({ id: 1 }))).to.deep.equal([events[0]])
        expect(Array.from(report.findAll({ path: 'does.not.exist' }))).to.deep.equal([])
        expect(Array.from(report.findAll({
            location: {
                filename: TEST_LOCATION.filename,
            },
        }))).to.deep.equal(Array.from(report.getAll()))
        expect(Array.from(report.findAll({ path: 'second' }))).to.deep.equal([events[1]])
        expect(Array.from(report.findAll({ location: { column: 333 } }))).to.deep.equal([events[2]])
        expect(Array.from(report.findAll({ value: { literal: 2 } }))).to.deep.equal([events[1]])
        expect(Array.from(report.findAll({ arguments: [{ unknown: true }] }))).to.deep.equal([events[3]])
        expect(Array.from(report.findAll({ isConstructor: false }))).to.deep.equal([events[3]])

        // Test "find" method
        expect(report.find({ id: 2 })).to.deep.equal(events[1])
        expect(report.find({ id: 99 })).to.equal(null)
        expect(report.find({ location: { filename: TEST_LOCATION.filename } })).to.deep.equal(events[0])
        expect(report.find({ isConstructor: true })).to.equal(null)

        // Test "has" method
        expect(report.has({ id: 3 })).to.be.true
        expect(report.has({ id: 99 })).to.be.false
        expect(report.has({ path: 'callMe' })).to.be.true
        expect(report.has({ path: 'doNotCallMe' })).to.be.false
    })
})
