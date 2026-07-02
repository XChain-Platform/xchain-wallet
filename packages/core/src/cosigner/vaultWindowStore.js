// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Vault-backed co-signer spending-window store (§22, P4 passive co-signer).
//
// The SDK's `sdk.coSigner.CoSigner` enforces a spending policy and, when
// `policy.maxPerWindow` is set, consults a window store for the running
// per-window usage. The SDK ships a Node `fs`-backed store; the browser
// wallet needs an equivalent backed by the wallet Vault. This is that
// equivalent, matching the SDK store's contract exactly:
//
//   snapshot() -> { count, perTick: { TICK: decimalString } }   (sync)
//   record({ action, tick, amount, txid })                       (sync)
//
// `CoSigner.process()` is synchronous and calls snapshot()/record()
// synchronously, but the Vault is async (IndexedDB). The store therefore
// loads its state into memory once (`await load()`) BEFORE process() runs,
// serves snapshot()/record() from that in-memory copy, and persists back
// to the Vault on `await flush()` (which the passiveCoSign flow calls after
// process()). The budget is consumed in memory the instant record() runs,
// so a second authorization in the same loaded session already sees it.
//
// FAIL-CLOSED, mirroring the SDK store and AgentSession: an unreadable or
// structurally-corrupt persisted state THROWS on load rather than silently
// resetting the window (a silent reset would re-open the whole budget).

// Exact decimal-string addition (no float, no dependency). The amounts are
// bounded token quantities (<= 8 decimal places), so a scaled-BigInt add is
// exact. The result is a numerically-correct decimal string; the SDK policy
// evaluator re-parses it via mathjs, so canonical formatting (not byte
// identity with mathjs) is all that is required.
function toScaled(s) {
    let str = String(s).trim();
    let sign = 1n;
    if (str[0] === '-') { sign = -1n; str = str.slice(1); }
    else if (str[0] === '+') { str = str.slice(1); }
    if (str === '' || str === '.' || !/^\d*(\.\d*)?$/.test(str)) {
        throw new Error(`addDecimalStrings: invalid decimal "${s}"`);
    }
    const [intPart, fracPart = ''] = str.split('.');
    const digits = (intPart + fracPart).replace(/^0+(?=\d)/, '') || '0';
    return { value: sign * BigInt(digits), scale: fracPart.length };
}

function fromScaled(value, scale) {
    const neg = value < 0n;
    let str = (neg ? -value : value).toString();
    if (scale === 0) return (neg ? '-' : '') + str;
    if (str.length <= scale) str = '0'.repeat(scale - str.length + 1) + str;
    const intP = str.slice(0, str.length - scale);
    const fracP = str.slice(str.length - scale).replace(/0+$/, '');
    return (neg ? '-' : '') + intP + (fracP ? '.' + fracP : '');
}

/**
 * Exact sum of two decimal strings (or numbers), returned as a canonical
 * decimal string.
 * @param {string|number} a
 * @param {string|number} b
 * @returns {string}
 */
export function addDecimalStrings(a, b) {
    const A = toScaled(a);
    const B = toScaled(b);
    const scale = Math.max(A.scale, B.scale);
    const av = A.value * 10n ** BigInt(scale - A.scale);
    const bv = B.value * 10n ** BigInt(scale - B.scale);
    return fromScaled(av + bv, scale);
}

export class WindowStateCorruptError extends Error {
    constructor(message) {
        super(`co-signer window state is unreadable (${message}); inspect/remove it deliberately to reset the spending window`);
        this.name = 'WindowStateCorruptError';
        this.code = 'WINDOW_STATE_CORRUPT';
    }
}

export const WINDOW_STATE_VERSION = 1;

/**
 * @typedef {Object} WindowEntry
 * @property {number} t        epoch-ms the action was authorized
 * @property {string} [action]
 * @property {string} [tick]
 * @property {string} [amount] decimal string
 * @property {string|null} [txid]
 */

/**
 * @typedef {Object} WindowState
 * @property {number} version
 * @property {WindowEntry[]} entries
 */

/**
 * Async persistence port the store reads/writes through. A Vault-backed
 * implementation lands with the agent-account schema slice; tests and dev
 * use {@link createInMemoryWindowPersistence}.
 *
 * @typedef {Object} WindowPersistence
 * @property {() => Promise<WindowState | null>} read   resolves null when absent
 * @property {(state: WindowState) => Promise<void>} write
 */

/**
 * @param {{ persistence: WindowPersistence, hours: number, now?: () => number }} opts
 */
export class VaultWindowStore {
    constructor({ persistence, hours, now } = {}) {
        if (!persistence || typeof persistence.read !== 'function' || typeof persistence.write !== 'function') {
            throw new Error('VaultWindowStore: persistence with read()/write() is required');
        }
        if (!Number.isFinite(hours) || hours <= 0) {
            throw new Error('VaultWindowStore: hours must be a positive number');
        }
        this._persistence = persistence;
        this._hours = hours;
        this._now = typeof now === 'function' ? now : Date.now;
        /** @type {WindowState | null} */
        this._state = null;
        this._dirty = false;
    }

    /**
     * Load persisted state into memory. Idempotent. Throws
     * {@link WindowStateCorruptError} on unreadable / malformed state so the
     * caller fails closed (never silently resets the budget).
     * @returns {Promise<void>}
     */
    async load() {
        if (this._state) return;
        let raw;
        try {
            raw = await this._persistence.read();
        } catch (e) {
            throw new WindowStateCorruptError(e?.message ?? String(e));
        }
        if (raw === null || raw === undefined) {
            this._state = { version: WINDOW_STATE_VERSION, entries: [] };
            return;
        }
        if (typeof raw !== 'object' || !Array.isArray(raw.entries)) {
            throw new WindowStateCorruptError('entries missing or not an array');
        }
        for (const e of raw.entries) {
            if (!e || typeof e.t !== 'number' || !Number.isFinite(e.t)) {
                throw new WindowStateCorruptError('an entry has no valid timestamp');
            }
        }
        this._state = { version: WINDOW_STATE_VERSION, entries: raw.entries.slice() };
    }

    _ensureLoaded() {
        if (!this._state) {
            throw new Error('VaultWindowStore: call await load() before snapshot()/record()');
        }
    }

    // Drop entries older than the window; mutates the in-memory state.
    _prune() {
        const cutoff = this._now() - this._hours * 3600 * 1000;
        this._state.entries = this._state.entries.filter((e) => e.t >= cutoff);
    }

    /**
     * Current window usage in the shape the SDK policy evaluator expects.
     * @returns {{ count: number, perTick: Record<string, string> }}
     */
    snapshot() {
        this._ensureLoaded();
        this._prune();
        /** @type {Record<string, string>} */
        const perTick = {};
        for (const e of this._state.entries) {
            if (e.tick !== undefined && e.tick !== null && e.amount !== undefined && e.amount !== null) {
                perTick[e.tick] = addDecimalStrings(perTick[e.tick] ?? '0', e.amount);
            }
        }
        return { count: this._state.entries.length, perTick };
    }

    /**
     * Append a consumed action. Call AFTER deciding to authorize: the budget
     * is consumed on authorization, conservatively, even if the aggregate
     * spend never completes (so the cap can't be double-spent). Marks the
     * store dirty; persistence happens on {@link flush}.
     * @param {{ action?: string, tick?: string, amount?: string, txid?: string|null }} entry
     */
    record({ action, tick, amount, txid } = {}) {
        this._ensureLoaded();
        this._prune();
        this._state.entries.push({ t: this._now(), action, tick, amount, txid: txid ?? null });
        this._dirty = true;
    }

    /** @returns {boolean} whether there are unpersisted writes */
    get dirty() {
        return this._dirty;
    }

    /**
     * Persist the in-memory state through the port when dirty. The
     * passiveCoSign flow awaits this after process() so an authorized
     * budget entry is durable before the partial signature is returned.
     * @returns {Promise<void>}
     */
    async flush() {
        if (!this._dirty || !this._state) return;
        await this._persistence.write({ version: WINDOW_STATE_VERSION, entries: this._state.entries });
        this._dirty = false;
    }
}

/**
 * In-memory persistence port (deep-copying so callers can't mutate stored
 * state by reference). For tests and dev; production uses a Vault-backed port.
 * @param {WindowState | null} [initial]
 * @returns {WindowPersistence & { dump: () => WindowState | null }}
 */
export function createInMemoryWindowPersistence(initial = null) {
    let store = initial ? JSON.parse(JSON.stringify(initial)) : null;
    return {
        async read() {
            return store ? JSON.parse(JSON.stringify(store)) : null;
        },
        async write(state) {
            store = JSON.parse(JSON.stringify(state));
        },
        dump() {
            return store ? JSON.parse(JSON.stringify(store)) : null;
        },
    };
}
