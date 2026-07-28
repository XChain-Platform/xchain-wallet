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
 * Reserved bucket for entries whose tick never resolved (G8). MUST stay
 * byte-equal to the SDK's `policyEvaluator.UNRESOLVED_TICK_BUCKET`: this store's
 * snapshot is consumed by the SDK evaluator, which looks the total up under
 * exactly this key, so a divergence silently degrades every wildcard window cap
 * back into a per-transaction cap. '|' is the action-string field separator, so
 * no real tick can ever collide with it.
 */
export const UNRESOLVED_TICK_BUCKET = '|unresolved|';

// How far ahead of our own clock a persisted timestamp may sit before it counts
// as a clock fault rather than jitter (G19).
const CLOCK_SKEW_TOLERANCE_MS = 60 * 1000;

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
        /** @type {WindowEntry[]} entries snapshot() could not accumulate */
        this._quarantined = [];
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
        const entries = raw.entries.map((e) => ({ ...e }));
        // G19: the rolling window trusts wall-clock time, so a clock the daemon
        // does not control is part of the trust boundary. Refuse a future-dated
        // timestamp by clamping it to now (dropping it would LOOSEN the budget,
        // the wrong direction to fail in) and record that the clock moved back.
        const now = this._now();
        this._clockWarnings = [];
        if (Number.isFinite(raw.lastSeen) && raw.lastSeen > now + CLOCK_SKEW_TOLERANCE_MS) {
            this._clockWarnings.push('window state was last written in the future: the clock moved backward');
        }
        let clamped = 0;
        for (const e of entries) {
            if (e.t > now + CLOCK_SKEW_TOLERANCE_MS) { e.t = now; clamped++; }
        }
        if (clamped) this._clockWarnings.push(`${clamped} entry timestamp(s) were in the future and were clamped`);
        this._state = { version: WINDOW_STATE_VERSION, entries, lastSeen: raw.lastSeen };
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
    /**
     * Current window usage in the shape the SDK policy evaluator expects.
     *
     * `perTick` is NULL-PROTOTYPE, and the accumulate is guarded. Ticks come
     * from the agent's own OP_RETURN, so they are attacker-chosen strings used
     * directly as keys here: on a plain `{}` a tick of `constructor` /
     * `toString` / `valueOf` reads back an inherited function, and adding a
     * function to a decimal throws. Since the entry is already persisted by
     * then, that throw repeats on every later request - a remote freeze of the
     * account, which on a plain 2-of-2 means funds stuck for good (G1).
     *
     * An entry that still cannot be accumulated (a row written before this fix)
     * is quarantined and reported rather than allowed to throw. It keeps
     * counting toward `count`, so quarantining can only tighten the budget.
     * @returns {{ count: number, perTick: Record<string, string> }}
     */
    snapshot() {
        this._ensureLoaded();
        this._prune();
        /** @type {Record<string, string>} */
        const perTick = Object.create(null);
        for (const e of this._state.entries) {
            if (e.amount === undefined || e.amount === null) continue;
            // G8: an unresolved tick still accumulates, under the reserved bucket
            // the SDK evaluator reads for exactly that case. Skipping these made
            // every wildcard window cap see a used total of '0' for them forever,
            // so the cap bound each transaction independently rather than the window.
            const key = (e.tick === undefined || e.tick === null)
                ? UNRESOLVED_TICK_BUCKET : String(e.tick);
            try {
                perTick[key] = addDecimalStrings(perTick[key] ?? '0', e.amount);
            } catch (err) {
                this._quarantined.push(e);
            }
        }
        return { count: this._state.entries.length, perTick };
    }

    /**
     * Entries this store could not accumulate. Non-empty means the persisted
     * window is under-counting amounts (never over-counting).
     * @returns {WindowEntry[]}
     */
    quarantined() {
        return this._quarantined.slice();
    }

    /**
     * Clock anomalies noticed at load (G19): a state file written in the future,
     * or entries clamped back to now. Non-empty means the host clock is not
     * behaving, which matters because a FORWARD step ages entries out early and
     * silently re-opens spending budget.
     * @returns {string[]}
     */
    clockWarnings() {
        return (this._clockWarnings ?? []).slice();
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
        const now = this._now();
        this._state.entries.push({ t: now, action, tick, amount, txid: txid ?? null });
        // Stamped so a backward clock step across a reload is detectable (G19).
        this._state.lastSeen = Math.max(now, Number.isFinite(this._state.lastSeen) ? this._state.lastSeen : now);
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
        await this._persistence.write({
            version: WINDOW_STATE_VERSION,
            entries: this._state.entries,
            // Carried so the next load can tell the clock moved backward (G19).
            lastSeen: this._state.lastSeen ?? this._now(),
        });
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
