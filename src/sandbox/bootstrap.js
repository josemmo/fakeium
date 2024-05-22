//#region Constants

/** Pattern to extract filename, line and column from stack trace line */
const TRACE_PATTERN = /  at.* \(?(.+):([0-9]+):([0-9]+)\)?$/

/** Pattern that identifies object properties that do not need to be escaped */
const SIMPLE_PROPERTY_PATTERN = /^[a-z_#$][a-z0-9_#$]*$/i

/** Symbol to mark objects that are mocks, used to prevent mocking the same object twice */
const MockSymbol = Symbol(`Mock-${Math.random()}`)

/** Symbol to mark fully autogenerated templates, used to prevent mocking missing properties in "real" objects */
const FullMockSymbol = Symbol(`FullMock-${Math.random()}`)

/** Symbol used as a property key to store the value ID of an object */
const IdSymbol = Symbol(`Id-${Math.random()}`)

/** Symbol used to taint previously visited callbacks */
const VisitedSymbol = Symbol(`Visited-${Math.random()}`)

/** Reference to original properties from globalThis object */
const { Error, JSON, Proxy, Promise, Reflect, isNaN, parseInt } = globalThis


//#region Proxies

/**
 * @typedef {import('../Report').Location} Location
 * @typedef {import('../Report').Value} Value
 * @typedef {import('../Report').ReportEvent} ReportEvent
 */

/** @type {import('isolated-vm').Reference} */
const EVENT_PROXY = $1 // eslint-disable-line no-undef

/** @type {import('isolated-vm').Reference} */
const DEBUG_PROXY = $2 // eslint-disable-line no-undef

/**
 * Next value ID
 */
let nextValueId = parseInt(`${$0.copySync()}`) // eslint-disable-line no-undef

/**
 * Emit event
 * @param {ReportEvent} event Event
 */
function emitEvent(event) {
    EVENT_PROXY.applyIgnored(undefined, [event, nextValueId], { arguments: { copy: true } })
}

/**
 * Emit debug message
 * @param {...unknown} args Arguments to log
 */
function emitDebug(...args) {
    DEBUG_PROXY.applyIgnored(undefined, args.map(item => `${item}`), { arguments: { copy: true } })
}


//#region Utils

/**
 * Resolve path
 * @param  {string} parentPath Parent path
 * @param  {string} property   Property to append
 * @return {string}            New path
 */
function resolvePath(parentPath, property) {
    if (property === '()') {
        return parentPath.endsWith('()') ? parentPath : `${parentPath}()`
    }

    // Parse property
    if (!isNaN(property)) {
        property = `[${property}]`
    } else if (!SIMPLE_PROPERTY_PATTERN.test(property)) {
        property = `[${JSON.stringify(property)}]`
    }

    // Build new property
    if (parentPath === 'globalThis') {
        return property
    }
    return `${parentPath}${property.startsWith('[') ? '' : '.'}${property}`
}

/**
 * Get current location
 * @return {Location} Location
 */
function getCurrentLocation() {
    // Get stack
    const e = {
        stack: '',
    }
    Error.captureStackTrace(e)

    // Get closest location from stack
    for (const line of e.stack.split('\n').slice(1)) {
        if (line.includes(' (<isolated-vm>:')) {
            // Part of bootstrap code, skip
            continue
        }
        const match = line.match(TRACE_PATTERN)
        if (match === null) {
            // Failed to match, skip
            continue
        }
        return {
            filename: match[1],
            line: parseInt(match[2]),
            column: parseInt(match[3]),
        }
    }

    // Failed to extract location
    return {
        filename: '<unknown>',
        line: 1,
        column: 1,
    }
}

/**
 * Is literal
 * @param  {any}     input Input variable
 * @return {boolean}       Whether input is a literal
 */
function isLiteral(input) {
    if (input === null || input === undefined) {
        return true
    }
    const type = typeof input
    return (type === 'string' || type === 'number' || type === 'boolean')
}

/**
 * To event value
 * @param  {any}   value Value to wrap
 * @return {Value}       Event value
 */
function toEventValue(value) {
    // Literal values
    if (isLiteral(value)) {
        return { literal: value }
    }

    // Get ID or taint object if needed
    let valueId = value[IdSymbol]
    if (valueId === undefined) {
        valueId = nextValueId++
        value[IdSymbol] = valueId
    }
    return { ref: valueId }
}

/**
 * On get or set event
 * @param {'GetEvent'|'SetEvent'} type  Event type
 * @param {string}                path  Path to variable
 * @param {any}                   value Value being read/written
 */
function onGetOrSetEvent(type, path, value) {
    emitDebug(`${type === 'GetEvent' ? 'Got' : 'Set'} ${path}`)
    emitEvent({
        type,
        path,
        value: toEventValue(value),
        location: getCurrentLocation(),
    })
}

/**
 * On call event
 * @param {string}  path          Path to variable being called
 * @param {any[]}   argArray      Call arguments
 * @param {any}     returns       Return value
 * @param {boolean} isConstructor Is call from constructor
 */
function onCallEvent(path, argArray, returns, isConstructor) {
    const normalizedPath = path.endsWith('()') ? path.slice(0, -2) : path
    const wrappedArguments = []
    for (const value of argArray) {
        wrappedArguments.push(toEventValue(value))
    }
    emitDebug(`Called ${normalizedPath}(${argArray.map(() => '#').join(', ')})`)
    emitEvent({
        type: 'CallEvent',
        path: normalizedPath,
        arguments: wrappedArguments,
        returns: toEventValue(returns),
        isConstructor,
        location: getCurrentLocation(),
    })
}


//#region Mocks

/**
 * Is mock
 * @param  {any}     object Object to check
 * @return {boolean}        Whether object is mock
 */
function isMock(object) {
    return (object[MockSymbol] === MockSymbol)
}

/**
 * Create mock object (if possible)
 * @param  {string} path       Path to new object
 * @param  {any}    [template] Template to mock
 * @param  {any}    [thisArg]  For functions, custom `this` argument used during invocation
 * @return {object}            Mock object
 */
function createMock(path, template, thisArg) {
    // Is template a primitive type?
    const type = typeof template
    if (template === null || type === 'string' || type === 'number' || type === 'boolean' || type === 'symbol') {
        return template
    }

    // Create fully mock template if needed
    if (template === undefined) {
        template = function() {
            const subpath = resolvePath(path, '()')
            emitDebug(`Mocked "${subpath}" object`)
            return createMock(subpath)
        }
        template[FullMockSymbol] = FullMockSymbol
    }

    // Wrap template in proxy
    const proxy = new Proxy(template, {
        has(target, property) {
            return (target[FullMockSymbol] === FullMockSymbol) ? true : (property in target)
        },
        get(target, property) {
            // Handle symbol properties
            if (typeof property === 'symbol') {
                return (property === MockSymbol) ? MockSymbol : target[property]
            }

            // Handle ignored properties
            if (property === 'prototype' || property === 'apply' || property === 'bind' || property === 'call') {
                return target[property]
            }

            // Handle thenable functions
            if (property === 'then') {
                if (!(property in target)) {
                    let resolve, reject
                    target[property] = new Promise((res, rej) => {
                        resolve = res
                        reject = rej
                    })
                    visitCallback([resolve, reject], proxy)
                }
                return target[property]
            }

            // Create or get child mock
            const subpath = resolvePath(path, property)
            if (!(property in target)) {
                emitDebug(`Mocked "${subpath}" object`)
                target[property] = createMock(subpath)
            } else if (!isMock(target[property])) {
                emitDebug(`Patched existing "${subpath}" object`)
                target[property] = createMock(subpath, target[property], target)
            }

            // Return value
            onGetOrSetEvent('GetEvent', subpath, target[property])
            return target[property]
        },
        set(target, property, newValue, receiver) {
            if (typeof property !== 'symbol') {
                const subpath = resolvePath(path, property)
                onGetOrSetEvent('SetEvent', subpath, newValue)
            }
            return Reflect.set(target, property, newValue, receiver)
        },
        construct(target, argArray, newTarget) {
            const newInstance = Reflect.construct(target, argArray, newTarget)
            const subpath = resolvePath(path, '()')

            // Wrap new instance in mock if needed
            let newMock
            if (isMock(newInstance)) {
                emitDebug(`"${subpath}" is already a mock, not mocking again`)
                newMock = newInstance
            } else {
                newMock = createMock(subpath, newInstance)
            }

            // Return value
            onCallEvent(path, argArray, newMock, true)
            return newMock
        },
        apply(target, realThisArg, argArray) {
            const returns = target.apply(thisArg ?? realThisArg, argArray)
            onCallEvent(path, argArray, returns, false)
            return returns
        },
    })

    return proxy
}

/**
 * Visit callback if not already visited
 * @param {any[]} candidates         Candidates to pick first valid callback from
 * @param {any}   [valueToPropagate] Optional value to propagate as the first call argument
 */
function visitCallback(candidates, valueToPropagate) {
    try {
        for (const callback of candidates) {
            if (typeof callback === 'function' && callback[VisitedSymbol] !== VisitedSymbol) {
                callback[VisitedSymbol] = VisitedSymbol
                if (valueToPropagate === undefined) {
                    callback()
                } else {
                    callback(valueToPropagate)
                }
                break
            }
        }
    } catch (_) {
        // Ignore error and keep running
    }
}


//#region Initialize

// Hijack globalThis object
const originalGlobalThis = globalThis
const newGlobalThis = {}
newGlobalThis[Symbol.toPrimitive] = () => '[object Window]'
newGlobalThis[FullMockSymbol] = FullMockSymbol
for (const property of [
    'console',
    'eval',
    'decodeURI', 'decodeURIComponent',
    'encodeURI', 'encodeURIComponent',
    'escape', 'unescape',
    'isFinite', 'isNaN',
    'parseFloat', 'parseInt',
    'Date',
    'Error', 'AggregateError', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError', 'TypeError', 'URIError',
    'RegExp',
    'JSON',
    'Math',
    'Intl',
    'ArrayBuffer', 'SharedArrayBuffer', 'Uint8Array', 'Uint16Array', 'Int16Array', 'Uint32Array', 'Int32Array',
    'Float32Array', 'Float64Array', 'Uint8ClampedArray', 'BigUint64Array', 'BigInt64Array', 'DataView',
    'BigInt',
    'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef',
    'Proxy', 'Reflect',
    'FinalizationRegistry',
    'Atomics',
    'WebAssembly',
]) {
    newGlobalThis[property] = createMock(property, originalGlobalThis[property])
    delete originalGlobalThis[property] // eslint-disable-line @typescript-eslint/no-dynamic-delete
}
Object.setPrototypeOf(globalThis, createMock('globalThis', newGlobalThis))
