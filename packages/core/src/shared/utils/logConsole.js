// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import {
    REDACTED_DIAGNOSTIC_VALUE,
    redactDiagnosticText,
} from './diagnosticText.js';

// logConsole (§48.5 / G150). Process-wide ring buffer that captures
// console.* output (and any explicit `record(...)` calls) so a
// Developer Mode panel can surface recent logs without users having
// to open DevTools. Useful for popup / desktop sessions where DevTools
// access is friction.
//
// Surface:
//
//   logConsole.attach()                            - idempotently install
//                                                    a console patch that
//                                                    routes log/info/warn/
//                                                    error into the buffer.
//                                                    Original console
//                                                    methods still run, so
//                                                    DevTools also sees
//                                                    the entries.
//   logConsole.detach()                            - restore the original
//                                                    console methods (for
//                                                    test cleanup).
//   logConsole.record({ level, source, message }) - record a synthetic
//                                                    entry from a flow /
//                                                    bridge handler that
//                                                    didn't go through
//                                                    console.*.
//   logConsole.entries()                           - snapshot of the
//                                                    current buffer
//                                                    (oldest -> newest).
//   logConsole.subscribe(listener)                 - subscribe to
//                                                    additions; returns
//                                                    an unsubscribe fn.
//   logConsole.clear()                             - empty the buffer.
//   logConsole.restore(entries)                    - Cluster Q FOLLOWUP 5.
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
//                            debounceMs?})         - Cluster Q FOLLOWUP 5.
//                                                    Subscribe a debounced
//                                                    persistence sink.
//                                                    Default sourceAllow
//                                                    is the strict
//                                                    vault/signer/encoder/
//                                                    bridge prefix list;
//                                                    'console' entries are
//                                                    NEVER mirrored
//                                                    because they can
//                                                    carry arbitrary
//                                                    stringified args from
//                                                    third-party code.
//   logConsole.detachMirror()                      - remove the mirror.
//
// Capacity defaults to 500; enough to spot most session-level issues
// without keeping a megabyte of stringified payloads in memory.

const DEFAULT_CAPACITY = 500;
const REDACTED = REDACTED_DIAGNOSTIC_VALUE;
const SECRET_FIELDS = new Set([
    'bip39passphrase',
    'decryptedvault',
    'masterkey',
    'mnemonic',
    'mnemonicphrase',
    'passphrase',
    'password',
    'passwd',
    'plaintextvault',
    'privatekey',
    'privkey',
    'psbt',
    'psbthex',
    'recoveryphrase',
    'recoverywords',
    'seed',
    'seedphrase',
    'seedwords',
    'signedpsbt',
    'unsignedpsbt',
    'vaultdata',
    'vaultpayload',
    'wif',
]);
const SECRET_FIELD_PART_RE = /(?:password|passphrase|privatekey|privkey|secretkey|signingkey|masterkey|mnemonic|seedphrase|seedwords|recoveryphrase|recoverywords|backupphrase|wif|psbt)/;
const TESTNET_WIF_RE = /\b(?:c[1-9A-HJ-NP-Za-km-z]{51}|9[1-9A-HJ-NP-Za-km-z]{50})\b/g;
const PSBT_BASE64_RE = /\bcHNidP[A-Za-z0-9+/_=-]*\b/g;
const PSBT_HEX_RE = /\b70736274ff[a-f0-9]*\b/gi;
const PEM_PRIVATE_KEY_RE = /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/g;
const DECRYPTED_VAULT_RE = /(\b(?:decrypted[ _-]?vault|plain(?:text)?[ _-]?vault|vault[ _-]?(?:data|payload))\b["']?\s*[:=]\s*)[^,;\r\n}]+/gi;

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

function isSecretField(key) {
    const normalized = String(key).replace(/[^a-z0-9]/gi, '').toLowerCase();
    return SECRET_FIELDS.has(normalized)
        || SECRET_FIELD_PART_RE.test(normalized)
        || normalized.startsWith('decryptedvault');
}

function redactString(value) {
    const patternsRedacted = String(value)
        .replace(PEM_PRIVATE_KEY_RE, REDACTED)
        .replace(PSBT_BASE64_RE, REDACTED)
        .replace(PSBT_HEX_RE, REDACTED)
        .replace(TESTNET_WIF_RE, REDACTED)
        .replace(DECRYPTED_VAULT_RE, `$1${REDACTED}`);
    return redactDiagnosticText(patternsRedacted, {
        keepAddresses: true,
        limit: Number.MAX_SAFE_INTEGER,
    });
}

function redactValue(value, seen = new WeakSet()) {
    if (typeof value === 'string') return redactString(value);
    if (value === null || value === undefined || typeof value !== 'object') return value;
    if (seen.has(value)) return '[Circular]';
    seen.add(value);

    if (value instanceof Error) {
        const safe = new Error(redactString(value.message));
        safe.name = redactString(value.name);
        if (typeof value.stack === 'string') safe.stack = redactString(value.stack);
        return safe;
    }
    if (Array.isArray(value)) return value.map((item) => redactValue(item, seen));
    if (value instanceof Date) return value;
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return '[binary data]';

    const safe = {};
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (!descriptor.enumerable) continue;
        safe[key] = isSecretField(key)
            ? REDACTED
            : ('value' in descriptor ? redactValue(descriptor.value, seen) : '[unavailable]');
    }
    return safe;
}

function redactArgs(args) {
    const values = Array.isArray(args) ? args : [args];
    return values.map((arg) => {
        try {
            return redactValue(arg);
        } catch {
            return '[unavailable]';
        }
    });
}

function stringifyArgs(args) {
    if (!Array.isArray(args)) return redactString(args);
    return args.map((arg) => {
        if (arg === null || arg === undefined) return String(arg);
        if (typeof arg === 'string') return redactString(arg);
        if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg);
        if (arg instanceof Error) return redactString(arg.stack || arg.message || String(arg));
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
        try { listener(entry); } catch { /* swallow; listeners cannot crash producers */ }
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
            const safeArgs = redactArgs(args);
            try {
                push({
                    id: nextId++,
                    timestamp: Date.now(),
                    level,
                    source: 'console',
                    message: stringifyArgs(safeArgs),
                });
            } catch { /* swallow */ }
            originals[level](...safeArgs);
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
    const safeMessage = redactString(message);
    const composed = data !== undefined
        ? `${safeMessage} ${stringifyArgs(redactArgs([data]))}`.trim()
        : safeMessage;
    push({
        id: nextId++,
        timestamp: Date.now(),
        level: /** @type {LogEntry['level']} */ (level),
        source: redactString(source),
        message: composed,
    });
}

function entries() {
    return buffer.slice();
}

/**
 * Cluster Q FOLLOWUP 5: bounded snapshot for diagnostic dumps.
 * Returns a copy of the most-recent entries (oldest to newest) with
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

// ─── Cluster Q FOLLOWUP 5: persistent mirror ──────────────────────────
//
// Default source allow-list. The "vault / signer / encoder / bridge;
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
 * chronological order without firing listeners. Idempotent; a duplicate
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
            source: typeof raw.source === 'string' ? redactString(raw.source) : 'restore',
            message: redactString(raw.message ?? ''),
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
 * Install a debounced persistence sink. Idempotent; a second call
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
            // Storage failed; tolerate; the buffer stays in memory.
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
