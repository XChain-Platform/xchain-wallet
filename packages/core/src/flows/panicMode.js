// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Panic mode (§26.5 / G068). A user-activated state that freezes ALL
// signing for a fixed window (default 24 hours). Activation is
// deliberately one-way for the duration: once on, the only ways out
// are (a) the timer expires or (b) the user explicitly deactivates
// from Settings → Safety with their wallet open.
//
// State persists so the freeze survives popup close, tab reload, even
// browser restart. Two persistence backends:
//   - Default (web/desktop renderers, tests): `localStorage`, read
//     synchronously on every access.
//   - Extension: an injected async store (chrome.storage.local) wired via
//     `configurePanicModePersistence`. localStorage does not exist in an
//     MV3 background service worker, and even in extension pages it is not
//     shared with the worker, so a freeze must live in chrome.storage.local
//     to (a) survive service-worker teardown and (b) be visible across the
//     popup / approval / background contexts. When configured, an in-memory
//     cache backs the synchronous reads and is hydrated at host boot; while
//     hydration is pending, `assertSigningAllowed` fails closed.
// The schema preference `settings.panicMode.enabled` is independent; it
// gates whether the feature is offered, not whether it is currently active.
//
// Threat model (Step 1 / signing freeze):
//   - Reading the locked-down vault is unaffected. The freeze is on
//     SIGNING outputs, not data access. A user who triggered panic
//     mode can still see balances, history, and settings while waiting
//     for the timer to expire or before manually deactivating.
//   - The freeze gates `submitWithSigner`, `signMessageFlow`,
//     `signPsbtFlow`, and `multisigSignLocally`. Adding new sign-path
//     flows must call `assertSigningAllowed` before invoking the
//     signer.
//   - The duress passphrase + decoy wallet flow (Step 6) layers on
//     top of this; neither is required for the freeze to work.

const STORAGE_KEY = 'xchain-wallet:panic';
export const DEFAULT_DURATION_MS = 24 * 60 * 60 * 1000;     // 24h
export const MIN_DURATION_MS = 60 * 1000;                    // 1m floor (tests)
export const MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000;     // 7d cap

let memoryFallback = null;

// Injected async persistence (extension: chrome.storage.local). When set, it
// is authoritative: reads come from the `memoryFallback` cache (hydrated from
// the store), and localStorage is bypassed so every extension context shares
// one source of truth.
/** @type {{ load: () => Promise<unknown>, save: (s: PanicModeState) => Promise<void>, clear: () => Promise<void> } | null} */
let persistentStore = null;
// True between `configurePanicModePersistence` and the first hydrate resolving.
// While true, `assertSigningAllowed` fails closed: we may be inside an active
// freeze whose state has not loaded yet after a service-worker restart.
let awaitingHydration = false;

/**
 * @typedef {Object} PanicModeState
 * @property {number} activatedAt   epoch-ms; 0 when inactive
 * @property {number} expiresAt     epoch-ms; 0 when inactive
 * @property {number} durationMs    duration the user picked at activation
 */

export class PanicModeActiveError extends Error {
    constructor(remainingMs, message) {
        super(message || `Signing is frozen by panic mode (${Math.ceil(remainingMs / 60000)} min remaining)`);
        this.name = 'PanicModeActiveError';
        this.remainingMs = remainingMs;
    }
}

/** @returns {PanicModeState} */
export function emptyPanicModeState() {
    return { activatedAt: 0, expiresAt: 0, durationMs: 0 };
}

function getStorage() {
    try {
        if (typeof globalThis.localStorage !== 'undefined' && globalThis.localStorage) {
            return globalThis.localStorage;
        }
    } catch (_err) { /* ignore */ }
    return null;
}

/**
 * Coerce an untrusted parsed record into a valid PanicModeState, falling back
 * to empty on anything malformed.
 * @param {unknown} parsed
 * @returns {PanicModeState}
 */
function coercePanicState(parsed) {
    const p = /** @type {any} */ (parsed);
    if (
        !p
        || typeof p.activatedAt !== 'number'
        || typeof p.expiresAt !== 'number'
        || typeof p.durationMs !== 'number'
        || p.activatedAt < 0
        || p.expiresAt < 0
        || p.durationMs < 0
    ) {
        return emptyPanicModeState();
    }
    return {
        activatedAt: Math.floor(p.activatedAt),
        expiresAt: Math.floor(p.expiresAt),
        durationMs: Math.floor(p.durationMs),
    };
}

/** @returns {PanicModeState} */
function readState() {
    // Injected persistence is authoritative: serve from the sync cache that
    // hydration / onChanged keeps current. localStorage is bypassed so the
    // cache is the single cross-context source of truth.
    if (persistentStore) {
        return memoryFallback ? { ...memoryFallback } : emptyPanicModeState();
    }
    const store = getStorage();
    if (!store) return memoryFallback ? { ...memoryFallback } : emptyPanicModeState();
    try {
        const raw = store.getItem(STORAGE_KEY);
        if (!raw) return emptyPanicModeState();
        return coercePanicState(JSON.parse(raw));
    } catch (_err) {
        return emptyPanicModeState();
    }
}

/** @param {PanicModeState} state */
function writeState(state) {
    if (persistentStore) {
        // Cache first so synchronous reads reflect the write immediately, then
        // mirror to the async store (best-effort; the cache already holds it).
        memoryFallback = state.expiresAt === 0 ? null : { ...state };
        try {
            if (state.expiresAt === 0) void persistentStore.clear();
            else void persistentStore.save({ ...state });
        } catch (_err) { /* best-effort; cache is source of truth this session */ }
        return;
    }
    const store = getStorage();
    if (!store) {
        memoryFallback = { ...state };
        return;
    }
    try {
        if (state.expiresAt === 0) {
            store.removeItem(STORAGE_KEY);
        } else {
            store.setItem(STORAGE_KEY, JSON.stringify(state));
        }
    } catch (_err) {
        memoryFallback = { ...state };
    }
}

/**
 * Wire an async persistence backend (extension: chrome.storage.local) and
 * hydrate the synchronous cache from it. Call once per context at boot. While
 * the initial load is in flight, `assertSigningAllowed` fails closed.
 *
 * @param {{ load: () => Promise<unknown>, save: (s: PanicModeState) => Promise<void>, clear: () => Promise<void> } | null} store
 * @returns {Promise<void>}
 */
export async function configurePanicModePersistence(store) {
    persistentStore = store || null;
    if (!persistentStore) {
        awaitingHydration = false;
        return;
    }
    awaitingHydration = true;
    try {
        const persisted = await persistentStore.load();
        applyExternalPanicModeState(persisted);
    } catch (_err) {
        // Load failed: leave the cache empty. A subsequent onChanged or write
        // will repopulate it; fail-closed only covers the load window.
    } finally {
        awaitingHydration = false;
    }
}

/**
 * Apply a state snapshot observed from the persistent store (initial hydrate
 * or a cross-context `storage.onChanged` event) into the synchronous cache.
 *
 * @param {unknown} raw
 */
export function applyExternalPanicModeState(raw) {
    const state = coercePanicState(raw);
    memoryFallback = state.expiresAt === 0 ? null : state;
}

/** @param {number} durationMs @returns {number} clamped */
function clampDuration(durationMs) {
    if (!Number.isFinite(durationMs)) return DEFAULT_DURATION_MS;
    return Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, Math.floor(durationMs)));
}

/** @returns {PanicModeState} */
export function getPanicModeState() {
    return readState();
}

/**
 * @param {PanicModeState} [state]
 * @param {number} [nowMs]
 * @returns {boolean}
 */
export function isSigningFrozen(state = readState(), nowMs = Date.now()) {
    if (!state || state.expiresAt === 0) return false;
    return state.expiresAt > nowMs;
}

/**
 * @param {PanicModeState} state
 * @param {number} [nowMs]
 * @returns {number}
 */
export function getPanicRemainingMs(state, nowMs = Date.now()) {
    if (!state || state.expiresAt === 0) return 0;
    const diff = state.expiresAt - nowMs;
    return diff > 0 ? diff : 0;
}

/**
 * Activate panic mode. Idempotent: re-activating with a fresh
 * duration replaces the previous state without prompting.
 *
 * @param {object} [opts]
 * @param {number} [opts.durationMs]
 * @param {number} [opts.nowMs]
 * @returns {PanicModeState}
 */
export function activatePanicMode({ durationMs, nowMs = Date.now() } = {}) {
    const dur = clampDuration(durationMs ?? DEFAULT_DURATION_MS);
    const next = {
        activatedAt: nowMs,
        expiresAt: nowMs + dur,
        durationMs: dur,
    };
    writeState(next);
    return next;
}

/**
 * Manually deactivate panic mode (Settings UX). The user has chosen to
 * exit the freeze before its timer expires.
 */
export function deactivatePanicMode() {
    writeState(emptyPanicModeState());
}

/** Reset for tests. */
export function clearPanicModeState() {
    memoryFallback = null;
    persistentStore = null;
    awaitingHydration = false;
    const store = getStorage();
    if (store) {
        try { store.removeItem(STORAGE_KEY); } catch (_err) { /* ignore */ }
    }
}

/**
 * Throws `PanicModeActiveError` when the freeze is active. Every flow
 * that drives a Signer must call this before invoking the signer.
 *
 * @param {number} [nowMs]
 */
export function assertSigningAllowed(nowMs = Date.now()) {
    // Fail closed while persisted freeze state is still loading (e.g. right
    // after a service-worker restart): a freeze may be active but unread.
    if (awaitingHydration) {
        throw new PanicModeActiveError(
            0,
            'Signing is paused while panic-mode state finishes loading',
        );
    }
    const state = readState();
    if (state.expiresAt === 0) return;
    if (state.expiresAt <= nowMs) {
        // Timer expired. Auto-clear and let the call through.
        writeState(emptyPanicModeState());
        return;
    }
    throw new PanicModeActiveError(state.expiresAt - nowMs);
}
