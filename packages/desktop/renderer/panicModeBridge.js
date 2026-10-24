// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The renderer's view of the panic-mode freeze, kept in main.
//
// Every signer and every broadcast runs in main, so the freeze the renderer
// arms (Settings > Safety, the duress passphrase) is sent to main, and the
// notice and Settings row show main's answer. A freeze an older build left
// in renderer localStorage is handed to main once at boot and then removed,
// in that order, so an interrupted hand-off leaves it readable.
//
// Other windows learn of a change when they regain focus: each one reloads
// main's state then, unless one of its own writes is still on its way.

const LOAD = 'panic.state.load';
const SAVE = 'panic.state.save';
const CLEAR = 'panic.state.clear';

function legacyStorage() {
    try {
        if (typeof globalThis.localStorage !== 'undefined' && globalThis.localStorage) {
            return globalThis.localStorage;
        }
    } catch (_err) { /* SecurityError; treat as absent */ }
    return null;
}

/**
 * @param {object} deps
 * @param {any} deps.flows                core flows (configurePanicModePersistence, applyExternalPanicModeState,
 *                                        isSigningFrozen, PANIC_STORAGE_KEY)
 * @param {(type: string, request?: unknown) => Promise<unknown>} deps.sendMessage
 * @param {{ addEventListener: (type: string, fn: () => void) => void } | null} [deps.focusTarget]
 * @returns {Promise<void>}
 */
export async function installDesktopPanicModeBridge({ flows, sendMessage, focusTarget = null }) {
    let writesInFlight = 0;
    const track = async (promise) => {
        writesInFlight += 1;
        try { await promise; } finally { writesInFlight -= 1; }
    };
    const store = {
        load: () => sendMessage(LOAD),
        save: (state) => track(sendMessage(SAVE, state)),
        clear: () => track(sendMessage(CLEAR)),
    };

    await adoptLegacyFreeze({ flows, sendMessage });
    await flows.configurePanicModePersistence(store);

    if (focusTarget && typeof focusTarget.addEventListener === 'function') {
        focusTarget.addEventListener('focus', () => {
            if (writesInFlight > 0) return;
            Promise.resolve(sendMessage(LOAD))
                .then((state) => { if (writesInFlight === 0) flows.applyExternalPanicModeState(state); })
                .catch(() => { /* main unreachable; the last known state stays */ });
        });
    }
}

async function adoptLegacyFreeze({ flows, sendMessage }) {
    const local = legacyStorage();
    if (!local) return;
    let raw = null;
    try { raw = local.getItem(flows.PANIC_STORAGE_KEY); } catch (_err) { return; }
    if (!raw) return;
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (_err) { parsed = null; }
    try {
        if (parsed && flows.isSigningFrozen(parsed)) {
            const held = await sendMessage(LOAD);
            const mainExpiry = Number(/** @type {any} */ (held)?.expiresAt) || 0;
            if (mainExpiry < Number(parsed.expiresAt)) await sendMessage(SAVE, parsed);
        }
        local.removeItem(flows.PANIC_STORAGE_KEY);
    } catch (_err) {
        // Main did not take it: keep the local copy so the next boot retries.
    }
}
