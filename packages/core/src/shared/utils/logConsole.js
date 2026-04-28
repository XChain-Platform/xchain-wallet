// logConsole — §48.5 / G150. Process-wide ring buffer that captures
// console.* output (and any explicit `record(...)` calls) so a
// Developer Mode panel can surface recent logs without users having
// to open DevTools. Useful for popup / desktop sessions where DevTools
// access is friction.
//
// Surface:
//
//   logConsole.attach()                            — idempotently install
//                                                    a console patch that
//                                                    routes log/info/warn/
//                                                    error into the buffer.
//                                                    Original console
//                                                    methods still run, so
//                                                    DevTools also sees
//                                                    the entries.
//   logConsole.detach()                            — restore the original
//                                                    console methods (for
//                                                    test cleanup).
//   logConsole.record({ level, source, message }) — record a synthetic
//                                                    entry from a flow /
//                                                    bridge handler that
//                                                    didn't go through
//                                                    console.*.
//   logConsole.entries()                           — snapshot of the
//                                                    current buffer
//                                                    (oldest → newest).
//   logConsole.subscribe(listener)                 — subscribe to
//                                                    additions; returns
//                                                    an unsubscribe fn.
//   logConsole.clear()                             — empty the buffer.
//
// Capacity defaults to 500 — enough to spot most session-level issues
// without keeping a megabyte of stringified payloads in memory.

const DEFAULT_CAPACITY = 500;

let capacity = DEFAULT_CAPACITY;
/** @type {Array<LogEntry>} */
let buffer = [];
/** @type {Set<(entry: LogEntry) => void>} */
const listeners = new Set();
let nextId = 1;

let attached = false;
/** @type {Record<string, (...args: any[]) => void> | null} */
let originals = null;

/**
 * @typedef {Object} LogEntry
 * @property {number} id
 * @property {number} timestamp     ms since epoch
 * @property {'log'|'info'|'warn'|'error'} level
 * @property {string} source        free-form tag (default 'console')
 * @property {string} message       stringified args
 */

function stringifyArgs(args) {
    if (!Array.isArray(args)) return String(args);
    return args.map((arg) => {
        if (arg === null || arg === undefined) return String(arg);
        if (typeof arg === 'string') return arg;
        if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg);
        if (arg instanceof Error) return arg.stack || arg.message || String(arg);
        try {
            return JSON.stringify(arg);
        } catch {
            return '[unserializable]';
        }
    }).join(' ');
}

function push(entry) {
    buffer.push(entry);
    if (buffer.length > capacity) {
        buffer.splice(0, buffer.length - capacity);
    }
    for (const listener of listeners) {
        try { listener(entry); } catch { /* swallow — listeners can't crash producers */ }
    }
}

function attach() {
    if (attached) return;
    if (typeof console === 'undefined') return;
    originals = {
        log: console.log.bind(console),
        info: console.info.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
    };
    for (const level of /** @type {const} */ (['log', 'info', 'warn', 'error'])) {
        console[level] = (...args) => {
            try {
                push({
                    id: nextId++,
                    timestamp: Date.now(),
                    level,
                    source: 'console',
                    message: stringifyArgs(args),
                });
            } catch { /* swallow */ }
            originals[level](...args);
        };
    }
    attached = true;
}

function detach() {
    if (!attached) return;
    if (originals) {
        console.log = originals.log;
        console.info = originals.info;
        console.warn = originals.warn;
        console.error = originals.error;
    }
    originals = null;
    attached = false;
}

function record({ level = 'log', source = 'app', message = '', data } = {}) {
    const composed = data !== undefined
        ? `${message} ${stringifyArgs([data])}`.trim()
        : String(message);
    push({
        id: nextId++,
        timestamp: Date.now(),
        level: /** @type {LogEntry['level']} */ (level),
        source,
        message: composed,
    });
}

function entries() {
    return buffer.slice();
}

function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function clear() {
    buffer = [];
}

function setCapacity(n) {
    if (Number.isInteger(n) && n > 0) {
        capacity = n;
        if (buffer.length > capacity) {
            buffer.splice(0, buffer.length - capacity);
        }
    }
}

export const logConsole = {
    attach,
    detach,
    record,
    entries,
    subscribe,
    clear,
    setCapacity,
    isAttached() { return attached; },
};
