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
// Writes fail safe. Turning the freeze on takes effect in memory before the
// store is asked, and a refused save leaves it on in memory with the save
// status PANIC_SAVE_UNSAVED, so the screen can say it will not survive a
// restart instead of claiming a saved freeze. Turning it off asks the store
// first and lifts the freeze only once the store has taken the change; a
// refused clear keeps it on (PANIC_SAVE_CLEAR_FAILED).
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

import { logConsole } from '../shared/utils/logConsole.js';

const STORAGE_KEY = 'xchain-wallet:panic';

/** The localStorage key, exported so the native shells can migrate off it. */
export const PANIC_STORAGE_KEY = STORAGE_KEY;

// How the freeze was armed. This is NOT a security control; it is
// the input to the disclosure policy in `shared/safety/panicNotice.js`:
//   'self'    the user armed it deliberately from Settings -> Safety, so the
//             wallet may say so plainly on Home and Send.
//   'duress'  the duress passphrase armed it. The whole point of that flow is
//             that an observer standing over the user sees no cue, so ambient
//             surfaces MUST stay silent about it.
// Either way the sign screen must stop claiming the wallet is ready to sign;
// only the announcement differs.
export const PANIC_ARMED_SELF = 'self';
export const PANIC_ARMED_DURESS = 'duress';

export const DEFAULT_DURATION_MS = 24 * 60 * 60 * 1000;     // 24h
export const MIN_DURATION_MS = 60 * 1000;                    // 1m floor (tests)
export const MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000;     // 7d cap

let memoryFallback = null;
let memoryFallbackActive = false;
let storageFailureLogged = false;

function keepMemoryFallback(state) {
    memoryFallback = state.expiresAt === 0 ? null : { ...state };
    memoryFallbackActive = true;
    noteStorageFailure('local storage write failed; using in-memory state');
}

// Injected async persistence (extension: chrome.storage.local). When set, it
// is authoritative: reads come from the `memoryFallback` cache (hydrated from
// the store), and localStorage is bypassed so every extension context shares
// one source of truth.
/** @type {{ load: () => Promise<unknown>, save: (s: PanicModeState) => Promise<void>, clear: () => Promise<void> } | null} */
let persistentStore = null;
let persistenceGeneration = 0;
// True between `configurePanicModePersistence` and the first hydrate resolving.
// While true, `assertSigningAllowed` fails closed: we may be inside an active
// freeze whose state has not loaded yet after a service-worker restart.
let awaitingHydration = false;

function persistBestEffort(operation) {
    try {
        void Promise.resolve(operation()).catch(() => {});
    } catch (_err) { /* the synchronous cache remains authoritative */ }
}

/** Run a store write and hand back its outcome as a promise, whether it throws or rejects. */
function runStoreWrite(operation) {
    try {
        return Promise.resolve(operation());
    } catch (err) {
        return Promise.reject(err);
    }
}

// A freeze this context keeps in memory that the persistent store may not
// hold: an activation whose save was refused, an active freeze whose clear was
// refused, or a freeze another context handed over directly
// (`holdPanicModeFreeze`, the extension popup telling the service worker).
// Hydration and re-configuration never drop it, so a refused write cannot be
// undone by the next read of the store. A deactivation, a cleared record
// observed from the store, a wipe, or the timer ends it.
/** @type {PanicModeState | null} */
let heldFreeze = null;

/** The last panic write reached its store (or there has been none). */
export const PANIC_SAVE_OK = 'saved';
/** Panic mode is on in memory, but the store refused the record: a restart loses it. */
export const PANIC_SAVE_UNSAVED = 'unsaved';
/** Turning panic mode off was refused by the store, so the freeze stays on. */
export const PANIC_SAVE_CLEAR_FAILED = 'clear-failed';

/** @type {'saved'|'unsaved'|'clear-failed'} */
let saveStatus = PANIC_SAVE_OK;
/** @type {Set<(status: string) => void>} */
const saveStatusListeners = new Set();
// Only the newest write may report its outcome; an older one settling late
// must not overwrite the status of the write that replaced it.
let writeToken = 0;

function setSaveStatus(next) {
    if (saveStatus === next) return;
    saveStatus = next;
    for (const listener of [...saveStatusListeners]) {
        try { listener(next); } catch (_err) { /* a listener fault never blocks the others */ }
    }
}

/**
 * Whether the freeze this context shows is the one its store holds.
 * @returns {'saved'|'unsaved'|'clear-failed'}
 */
export function getPanicModeSaveStatus() {
    return saveStatus;
}

/**
 * @param {(status: 'saved'|'unsaved'|'clear-failed') => void} listener
 * @returns {() => void} unsubscribe
 */
export function subscribePanicModeSaveStatus(listener) {
    saveStatusListeners.add(listener);
    return () => { saveStatusListeners.delete(listener); };
}

/**
 * The stricter of two records: the one frozen for longer.
 * @param {PanicModeState} base
 * @param {PanicModeState | null} other
 * @returns {PanicModeState}
 */
function stricterState(base, other) {
    if (!other || other.expiresAt === 0) return base;
    if (!base || base.expiresAt === 0 || other.expiresAt > base.expiresAt) return { ...other };
    return base;
}

function noteStorageFailure(message) {
    if (storageFailureLogged) return;
    storageFailureLogged = true;
    logConsole.record({ source: 'panic-mode', level: 'warn', message });
}

/**
 * @typedef {Object} PanicModeState
 * @property {number} activatedAt   epoch-ms; 0 when inactive
 * @property {number} expiresAt     epoch-ms; 0 when inactive
 * @property {number} durationMs    duration the user picked at activation
 * @property {'self'|'duress'} [armedBy]   present only while active
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
        || !Number.isFinite(p.activatedAt)
        || !Number.isFinite(p.expiresAt)
        || !Number.isFinite(p.durationMs)
        || p.activatedAt < 0
        || p.expiresAt < 0
        || p.durationMs < 0
    ) {
        return emptyPanicModeState();
    }
    const base = {
        activatedAt: Math.floor(p.activatedAt),
        expiresAt: Math.floor(p.expiresAt),
        durationMs: Math.floor(p.durationMs),
    };
    // `armedBy` rides along only on an ACTIVE record, so the inactive shape
    // stays exactly what it has always been.
    if (base.expiresAt === 0) return base;
    return { ...base, armedBy: coerceArmedBy(p.armedBy) };
}

/**
 * Read provenance off an untrusted persisted record. Deliberately asymmetric
 * with `normalizeArmedBy` below: on the READ side anything we do not
 * positively recognise as self-armed is treated as duress-armed, because the
 * fail-safe direction is silence. A record written by an older build has no
 * `armedBy`; announcing it on Home could be the exact disclosure the duress
 * flow exists to avoid, while staying quiet only reproduces today's behaviour
 * (the freeze is still stated in Settings -> Safety and on the sign screen).
 *
 * @param {unknown} raw
 * @returns {'self'|'duress'}
 */
function coerceArmedBy(raw) {
    return raw === PANIC_ARMED_SELF ? PANIC_ARMED_SELF : PANIC_ARMED_DURESS;
}

/**
 * Read provenance off a caller's activation options. On the WRITE side the
 * default is self-armed: the only caller that arms silently is the duress
 * passphrase, and it says so explicitly.
 *
 * @param {unknown} raw
 * @returns {'self'|'duress'}
 */
function normalizeArmedBy(raw) {
    return raw === PANIC_ARMED_DURESS ? PANIC_ARMED_DURESS : PANIC_ARMED_SELF;
}

/**
 * Provenance of an active freeze, for the disclosure policy. Returns
 * `'duress'` for an unrecognised or absent value (see `coerceArmedBy`), and
 * `null` when no freeze is active.
 *
 * @param {PanicModeState} [state]
 * @returns {'self'|'duress'|null}
 */
export function getPanicArmedBy(state = readState()) {
    if (!state || state.expiresAt === 0) return null;
    return coerceArmedBy(state.armedBy);
}

/** @returns {PanicModeState} */
function readState() {
    return stricterState(readStoredState(), heldFreeze);
}

/** @returns {PanicModeState} */
function readStoredState() {
    // Injected persistence is authoritative: serve from the sync cache that
    // hydration / onChanged keeps current. localStorage is bypassed so the
    // cache is the single cross-context source of truth.
    if (persistentStore) {
        return memoryFallback ? { ...memoryFallback } : emptyPanicModeState();
    }
    if (memoryFallbackActive) {
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

/**
 * Turn a freeze on. Memory first, so this context refuses to sign from the
 * moment of the call whatever the store does; the store write follows. A
 * refused write keeps the freeze in memory (`heldFreeze`) and reports
 * PANIC_SAVE_UNSAVED rather than claiming a saved freeze.
 *
 * @param {PanicModeState} state  an active record
 * @returns {Promise<boolean>} whether the store took the record
 */
function writeActiveState(state) {
    const token = ++writeToken;
    if (persistentStore) {
        persistenceGeneration += 1;
        awaitingHydration = false;
        memoryFallback = { ...state };
        const store = persistentStore;
        return runStoreWrite(() => store.save({ ...state })).then(
            () => {
                if (token === writeToken) setSaveStatus(PANIC_SAVE_OK);
                return true;
            },
            () => {
                if (token === writeToken) {
                    heldFreeze = { ...state };
                    setSaveStatus(PANIC_SAVE_UNSAVED);
                    noteStorageFailure('panic-mode store refused the freeze; it is held in memory only');
                }
                return false;
            },
        );
    }
    const store = getStorage();
    if (!store) {
        keepMemoryFallback(state);
        setSaveStatus(PANIC_SAVE_UNSAVED);
        return Promise.resolve(false);
    }
    try {
        store.setItem(STORAGE_KEY, JSON.stringify(state));
        memoryFallback = null;
        memoryFallbackActive = false;
        setSaveStatus(PANIC_SAVE_OK);
        return Promise.resolve(true);
    } catch (_err) {
        keepMemoryFallback(state);
        setSaveStatus(PANIC_SAVE_UNSAVED);
        return Promise.resolve(false);
    }
}

/**
 * Turn the freeze off at the user's request. The store goes first and memory
 * follows only once it has taken the change: a refused clear leaves the
 * record (and so the freeze) in place, so this context keeps refusing to sign
 * and reports PANIC_SAVE_CLEAR_FAILED.
 *
 * @returns {Promise<boolean>} whether the freeze is now off
 */
function writeClearedState() {
    const token = ++writeToken;
    const prior = readState();
    if (persistentStore) {
        persistenceGeneration += 1;
        awaitingHydration = false;
        const store = persistentStore;
        return runStoreWrite(() => store.clear()).then(
            () => {
                if (token === writeToken) {
                    memoryFallback = null;
                    heldFreeze = null;
                    setSaveStatus(PANIC_SAVE_OK);
                }
                return true;
            },
            () => {
                if (token === writeToken) {
                    if (prior.expiresAt !== 0) heldFreeze = { ...prior };
                    setSaveStatus(PANIC_SAVE_CLEAR_FAILED);
                    noteStorageFailure('panic-mode store refused the deactivation; the freeze stays on');
                }
                return false;
            },
        );
    }
    const store = getStorage();
    if (!store) {
        keepMemoryFallback(emptyPanicModeState());
        heldFreeze = null;
        setSaveStatus(PANIC_SAVE_OK);
        return Promise.resolve(true);
    }
    try {
        store.removeItem(STORAGE_KEY);
        memoryFallback = null;
        memoryFallbackActive = false;
        heldFreeze = null;
        setSaveStatus(PANIC_SAVE_OK);
        return Promise.resolve(true);
    } catch (_err) {
        if (prior.expiresAt !== 0) heldFreeze = { ...prior };
        setSaveStatus(PANIC_SAVE_CLEAR_FAILED);
        return Promise.resolve(false);
    }
}

/**
 * Drop a freeze whose timer has run out. An expired record reads as no
 * freeze whatever the store holds, so memory clears at once and the store
 * clear is best-effort.
 */
function expireState() {
    writeToken += 1;
    heldFreeze = null;
    setSaveStatus(PANIC_SAVE_OK);
    if (persistentStore) {
        persistenceGeneration += 1;
        awaitingHydration = false;
        memoryFallback = null;
        const store = persistentStore;
        persistBestEffort(() => store.clear());
        return;
    }
    const store = getStorage();
    if (!store) {
        keepMemoryFallback(emptyPanicModeState());
        return;
    }
    try {
        store.removeItem(STORAGE_KEY);
        memoryFallback = null;
        memoryFallbackActive = false;
    } catch (_err) {
        keepMemoryFallback(emptyPanicModeState());
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
    if (store != null && (
        typeof store.load !== 'function'
        || typeof store.save !== 'function'
        || typeof store.clear !== 'function'
    )) {
        throw new TypeError('configurePanicModePersistence: store must implement load, save, and clear');
    }
    const generation = ++persistenceGeneration;
    persistentStore = store || null;
    memoryFallback = null;
    memoryFallbackActive = false;
    if (!persistentStore) {
        awaitingHydration = false;
        return;
    }
    const configuredStore = persistentStore;
    awaitingHydration = true;
    try {
        const persisted = await configuredStore.load();
        if (generation === persistenceGeneration && persistentStore === configuredStore) {
            adoptStoredState(persisted);
        }
    } catch (_err) {
        // Load failed: leave the cache empty. A subsequent onChanged or write
        // will repopulate it; fail-closed only covers the load window.
    } finally {
        if (generation === persistenceGeneration) awaitingHydration = false;
    }
}

/**
 * Apply a state snapshot observed from the persistent store (initial hydrate
 * or a cross-context `storage.onChanged` event) into the synchronous cache.
 *
 * @param {unknown} raw
 */
export function applyExternalPanicModeState(raw) {
    const state = adoptStoredState(raw);
    // A record observed going away is a deactivation made elsewhere, so a
    // freeze held in memory ends with it. The boot read of the store (below)
    // is not: an empty store there may only mean a refused write.
    if (state.expiresAt === 0) {
        writeToken += 1;
        heldFreeze = null;
        setSaveStatus(PANIC_SAVE_OK);
    }
}

/**
 * @param {unknown} raw
 * @returns {PanicModeState}
 */
function adoptStoredState(raw) {
    persistenceGeneration += 1;
    awaitingHydration = false;
    const state = coercePanicState(raw);
    memoryFallback = state.expiresAt === 0 ? null : state;
    memoryFallbackActive = false;
    return state;
}

/**
 * Hold a freeze another context reports, in memory, on top of whatever the
 * store says. The extension service worker calls this when the popup or side
 * panel turns panic mode on, so signing stops in the worker at once even if
 * the store refuses the record. Only a freeze can be held; an inactive or
 * expired record is ignored, and a shorter freeze never shortens a longer one.
 *
 * @param {unknown} raw
 * @param {{ unsaved?: boolean }} [opts]  unsaved: the reporting context knows its store does not hold this record
 * @returns {PanicModeState} the state this context now enforces
 */
export function holdPanicModeFreeze(raw, { unsaved = false } = {}) {
    const state = coercePanicState(raw);
    if (!isSigningFrozen(state)) return readState();
    heldFreeze = stricterState(heldFreeze || emptyPanicModeState(), state);
    if (unsaved) setSaveStatus(PANIC_SAVE_UNSAVED);
    return readState();
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
 * @param {'self'|'duress'} [opts.armedBy]   defaults to 'self'; the duress
 *        passphrase passes 'duress' so ambient surfaces stay silent
 * @returns {PanicModeState}
 */
export function activatePanicMode({ durationMs, nowMs = Date.now(), armedBy } = {}) {
    const dur = clampDuration(durationMs ?? DEFAULT_DURATION_MS);
    const next = {
        activatedAt: nowMs,
        expiresAt: nowMs + dur,
        durationMs: dur,
        armedBy: normalizeArmedBy(armedBy),
    };
    void writeActiveState(next);
    return next;
}

/**
 * Manually deactivate panic mode (Settings UX). The user has chosen to
 * exit the freeze before its timer expires. Resolves true once the freeze is
 * off; false when the store refused the change and the freeze stays on
 * (see `getPanicModeSaveStatus`).
 *
 * @returns {Promise<boolean>}
 */
export function deactivatePanicMode() {
    return writeClearedState();
}

/** Clear the active freeze while keeping the configured persistence backend. */
export function clearPanicModeState() {
    writeToken += 1;
    memoryFallback = null;
    memoryFallbackActive = false;
    awaitingHydration = false;
    heldFreeze = null;
    setSaveStatus(PANIC_SAVE_OK);
    if (persistentStore) {
        persistenceGeneration += 1;
        const store = persistentStore;
        persistBestEffort(() => store.clear());
        return;
    }
    const store = getStorage();
    if (store) {
        try { store.removeItem(STORAGE_KEY); } catch (_err) { /* ignore */ }
    }
}

/** Test seam: forget any injected persistence. */
export function __resetPanicModePersistenceForTests() {
    persistenceGeneration += 1;
    persistentStore = null;
    memoryFallback = null;
    memoryFallbackActive = false;
    storageFailureLogged = false;
    awaitingHydration = false;
    heldFreeze = null;
    saveStatus = PANIC_SAVE_OK;
    writeToken += 1;
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
        expireState();
        return;
    }
    throw new PanicModeActiveError(state.expiresAt - nowMs);
}
