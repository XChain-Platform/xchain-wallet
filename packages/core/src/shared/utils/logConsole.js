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
//   logConsole.restore(entries)                    — Cluster Q FOLLOWUP 5.
//                                                    Splice persisted
//                                                    entries into the
//                                                    front of the buffer
//                                                    (chronologically).
//                                                    Skips listener
//                                                    notifications so a
//                                                    boot-time hydrate
//                                                    doesn't spam the
//                                                    Developer Mode panel
//                                                    with stale rows.
//   logConsole.attachMirror({save,sourceAllow?,
//                            debounceMs?})         — Cluster Q FOLLOWUP 5.
//                                                    Subscribe a debounced
//                                                    persistence sink.
//                                                    Default sourceAllow
//                                                    is the strict
//                                                    vault/signer/encoder/
//                                                    bridge prefix list —
//                                                    'console' entries are
//                                                    NEVER mirrored
//                                                    because they can
//                                                    carry arbitrary
//                                                    stringified args from
//                                                    third-party code.
//   logConsole.detachMirror()                      — remove the mirror.
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

/**
 * Cluster Q FOLLOWUP 5 — bounded snapshot for diagnostic dumps.
 * Returns a copy of the most-recent entries (oldest → newest) with
 * each `message` truncated to `messageLimit` chars so a runaway log
 * line doesn't bloat a pasted bug report. The pure-array shape is
 * JSON-serialisable so the host can route it through any
 * `messaging.*` shim without bespoke marshalling.
 *
 * @param {{ limit?: number, messageLimit?: number }} [opts]
 * @returns {Array<LogEntry>}
 */
function snapshot(opts = {}) {
    const limit = Number.isInteger(opts.limit) && opts.limit > 0
        ? opts.limit
        : buffer.length;
    const messageLimit = Number.isInteger(opts.messageLimit) && opts.messageLimit > 0
        ? opts.messageLimit
        : 500;
    const slice = buffer.length > limit
        ? buffer.slice(buffer.length - limit)
        : buffer.slice();
    return slice.map((e) => ({
        id: e.id,
        timestamp: e.timestamp,
        level: e.level,
        source: e.source,
        message: typeof e.message === 'string' && e.message.length > messageLimit
            ? e.message.slice(0, messageLimit)
            : e.message,
    }));
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

// ─── Cluster Q FOLLOWUP 5 — persistent mirror ──────────────────────────
//
// Default source allow-list. The "vault / signer / encoder / bridge —
// never console" rule from the FOLLOWUP guards the mirror against
// leaking arbitrary console.* args (third-party code calling console.log
// from a content-script context can include partial keys, addresses,
// JSON-RPC payloads, etc.). Synthetic record() emissions opt-in by
// using one of the prefixed sources.
const DEFAULT_MIRROR_SOURCE_ALLOW = (source) => {
    if (typeof source !== 'string') return false;
    if (source === 'vault' || source === 'encoder') return true;
    if (source.startsWith('signer:')) return true;
    if (source.startsWith('bridge:')) return true;
    return false;
};

const MIRROR_DEFAULT_LIMIT = 200;
const MIRROR_DEFAULT_MESSAGE_LIMIT = 500;
const MIRROR_DEFAULT_DEBOUNCE_MS = 1000;

/** @type {{ unsubscribe: () => void, cancelTimer: () => void, flush: () => Promise<void>, save: (entries: LogEntry[]) => any, sourceAllow: (source: string) => boolean, limit: number, messageLimit: number } | null} */
let mirror = null;

/**
 * Splice persisted entries into the front of the live buffer in
 * chronological order without firing listeners. Idempotent — a duplicate
 * id from a previous restore (or an in-memory entry pushed while the
 * load was in flight) is dropped. Caller is expected to pass entries
 * sorted oldest → newest, but the merge tolerates an unsorted input.
 *
 * @param {LogEntry[]} persisted
 */
function restore(persisted) {
    if (!Array.isArray(persisted) || persisted.length === 0) return;
    const seenIds = new Set();
    for (const e of buffer) {
        if (Number.isFinite(e?.id)) seenIds.add(e.id);
    }
    /** @type {LogEntry[]} */
    const additions = [];
    for (const raw of persisted) {
        if (!raw || typeof raw !== 'object') continue;
        const id = Number.isFinite(raw.id) ? raw.id : nextId++;
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        const entry = {
            id,
            timestamp: Number.isFinite(raw.timestamp) ? raw.timestamp : Date.now(),
            level: ['log', 'info', 'warn', 'error'].includes(raw.level) ? raw.level : 'log',
            source: typeof raw.source === 'string' ? raw.source : 'restore',
            message: typeof raw.message === 'string' ? raw.message : String(raw.message ?? ''),
        };
        additions.push(entry);
        if (entry.id >= nextId) nextId = entry.id + 1;
    }
    if (additions.length === 0) return;
    additions.sort((a, b) => a.timestamp - b.timestamp);
    buffer = [...additions, ...buffer];
    if (buffer.length > capacity) {
        buffer.splice(0, buffer.length - capacity);
    }
}

/**
 * Install a debounced persistence sink. Idempotent — a second call
 * detaches the previous mirror first. The sink only sees entries whose
 * source matches `sourceAllow`; the default whitelist excludes plain
 * console.* output for safety.
 *
 * @param {{
 *   save: (entries: LogEntry[]) => any,
 *   sourceAllow?: (source: string) => boolean,
 *   limit?: number,
 *   messageLimit?: number,
 *   debounceMs?: number,
 * }} opts
 */
function attachMirror(opts) {
    if (!opts || typeof opts.save !== 'function') return;
    detachMirror();
    const sourceAllow = typeof opts.sourceAllow === 'function'
        ? opts.sourceAllow
        : DEFAULT_MIRROR_SOURCE_ALLOW;
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : MIRROR_DEFAULT_LIMIT;
    const messageLimit = Number.isInteger(opts.messageLimit) && opts.messageLimit > 0
        ? opts.messageLimit
        : MIRROR_DEFAULT_MESSAGE_LIMIT;
    const debounceMs = Number.isInteger(opts.debounceMs) && opts.debounceMs >= 0
        ? opts.debounceMs
        : MIRROR_DEFAULT_DEBOUNCE_MS;

    let pending = false;
    let flushTimer = null;

    const buildSnapshot = () => {
        const filtered = buffer.filter((e) => sourceAllow(e.source));
        const sliced = filtered.length > limit
            ? filtered.slice(filtered.length - limit)
            : filtered;
        return sliced.map((e) => ({
            id: e.id,
            timestamp: e.timestamp,
            level: e.level,
            source: e.source,
            message: typeof e.message === 'string' && e.message.length > messageLimit
                ? e.message.slice(0, messageLimit)
                : e.message,
        }));
    };

    const flush = async () => {
        pending = false;
        flushTimer = null;
        const snapshotEntries = buildSnapshot();
        try {
            await mirror?.save(snapshotEntries);
        } catch {
            // Storage failed — tolerate; the buffer stays in memory.
        }
    };

    const schedule = () => {
        if (pending) return;
        pending = true;
        flushTimer = setTimeout(() => { void flush(); }, debounceMs);
    };

    const unsubscribe = subscribe((entry) => {
        if (!sourceAllow(entry.source)) return;
        schedule();
    });

    mirror = {
        unsubscribe,
        cancelTimer: () => { if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; pending = false; } },
        flush,
        save: opts.save,
        sourceAllow,
        limit,
        messageLimit,
    };

    // Defer the kickoff write so callers that immediately push() right
    // after attachMirror still batch into one save.
    schedule();
}

function detachMirror() {
    if (!mirror) return;
    mirror.unsubscribe();
    mirror.cancelTimer();
    mirror = null;
}

export const logConsole = {
    attach,
    detach,
    record,
    entries,
    snapshot,
    subscribe,
    clear,
    setCapacity,
    restore,
    attachMirror,
    detachMirror,
    isAttached() { return attached; },
    isMirrorAttached() { return mirror !== null; },
};

// Exposed for tests; not part of the public surface.
export const __mirrorTestUtils = {
    defaultSourceAllow: DEFAULT_MIRROR_SOURCE_ALLOW,
    DEFAULTS: {
        limit: MIRROR_DEFAULT_LIMIT,
        messageLimit: MIRROR_DEFAULT_MESSAGE_LIMIT,
        debounceMs: MIRROR_DEFAULT_DEBOUNCE_MS,
    },
};
