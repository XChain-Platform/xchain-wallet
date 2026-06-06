// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Panic mode — §26.5 / G068. A user-activated state that freezes ALL
// signing for a fixed window (default 24 hours). Activation is
// deliberately one-way for the duration: once on, the only ways out
// are (a) the timer expires or (b) the user explicitly deactivates
// from Settings → Safety with their wallet open.
//
// State persists in localStorage so the freeze survives popup close,
// tab reload, even browser restart. The schema preference
// `settings.panicMode.enabled` is independent — it gates whether the
// feature is offered, not whether it is currently active.
//
// Threat model (Step 1 / signing freeze):
//   - Reading the locked-down vault is unaffected. The freeze is on
//     SIGNING outputs, not data access — a user who triggered panic
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

/**
 * @typedef {Object} PanicModeState
 * @property {number} activatedAt   epoch-ms; 0 when inactive
 * @property {number} expiresAt     epoch-ms; 0 when inactive
 * @property {number} durationMs    duration the user picked at activation
 */

export class PanicModeActiveError extends Error {
    constructor(remainingMs) {
        super(`Signing is frozen by panic mode (${Math.ceil(remainingMs / 60000)} min remaining)`);
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

/** @returns {PanicModeState} */
function readState() {
    const store = getStorage();
    if (!store) return memoryFallback ? { ...memoryFallback } : emptyPanicModeState();
    try {
        const raw = store.getItem(STORAGE_KEY);
        if (!raw) return emptyPanicModeState();
        const parsed = JSON.parse(raw);
        if (
            !parsed
            || typeof parsed.activatedAt !== 'number'
            || typeof parsed.expiresAt !== 'number'
            || typeof parsed.durationMs !== 'number'
            || parsed.activatedAt < 0
            || parsed.expiresAt < 0
            || parsed.durationMs < 0
        ) {
            return emptyPanicModeState();
        }
        return {
            activatedAt: Math.floor(parsed.activatedAt),
            expiresAt: Math.floor(parsed.expiresAt),
            durationMs: Math.floor(parsed.durationMs),
        };
    } catch (_err) {
        return emptyPanicModeState();
    }
}

/** @param {PanicModeState} state */
function writeState(state) {
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
 * Activate panic mode. Idempotent — re-activating with a fresh
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
    const state = readState();
    if (state.expiresAt === 0) return;
    if (state.expiresAt <= nowMs) {
        // Timer expired — auto-clear and let the call through.
        writeState(emptyPanicModeState());
        return;
    }
    throw new PanicModeActiveError(state.expiresAt - nowMs);
}
