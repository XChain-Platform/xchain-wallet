// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// panicModeStorage: §26.5 / G068. Cross-context persistence for the
// panic-mode signing freeze.
//
// The core panicMode flow defaults to localStorage, which does not exist in
// an MV3 background service worker and is not shared between the popup and the
// worker even where it does exist. So the freeze silently dies on a
// service-worker restart (Chrome tears the worker down after ~30s idle) and a
// freeze set in the popup is invisible to the background enforcement gate.
//
// This adapter persists the freeze in chrome.storage.local, which every
// extension context (popup, approval, background) shares and which survives
// worker teardown. It mirrors the shape core's `configurePanicModePersistence`
// expects ({ load, save, clear }) and adds `watch` to relay cross-context
// updates via chrome.storage.onChanged.
//
// Storage alone is not enough to stop signing: when chrome.storage.local
// refuses a write (quota, a storage fault) no onChanged event fires, and the
// worker, which does the signing, would never hear of a freeze the popup
// shows. So a renderer also tells the worker directly (`panic.state.hold`),
// the worker holds that freeze in memory, and a refused write rejects so core
// can say the freeze is not saved.
//
// Mirrors signThrottleStorage / broadcastQueueStorage:
//   - Extension (SW or page) → chrome.storage.local
//   - No chrome.storage       → null (core falls back to localStorage)

const STORAGE_KEY = 'xchain.panicMode';

/** Popup and side panel to service worker: hold this freeze in memory now. */
export const PANIC_HOLD_MESSAGE_TYPE = 'panic.state.hold';
/** Any extension page to service worker: answer the freeze the worker enforces. */
export const PANIC_LOAD_MESSAGE_TYPE = 'panic.state.load';
/** After a deactivation reached storage: re-read storage and enforce what it holds. */
export const PANIC_RESYNC_MESSAGE_TYPE = 'panic.state.resync';

export const PANIC_STATE_MESSAGE_TYPES = new Set([
    PANIC_HOLD_MESSAGE_TYPE,
    PANIC_LOAD_MESSAGE_TYPE,
    PANIC_RESYNC_MESSAGE_TYPE,
]);

/**
 * @typedef {Object} PanicModeStorage
 * @property {() => Promise<unknown>} load
 * @property {(state: unknown) => Promise<void>} save
 * @property {() => Promise<void>} clear
 * @property {(onChange: (state: unknown) => void) => void} watch
 */

/**
 * chrome.storage reports a refused write (quota, a storage fault) through
 * `runtime.lastError` inside the callback, not by throwing. A write counts as
 * done only when the callback runs with no lastError.
 *
 * @param {(done: () => void) => void} start
 * @returns {Promise<void>}
 */
function storageWrite(start) {
    return new Promise((resolve, reject) => {
        try {
            start(() => {
                const lastError = chrome.runtime?.lastError;
                if (lastError) {
                    reject(new Error(lastError.message || 'chrome.storage.local write failed'));
                    return;
                }
                resolve();
            });
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * @param {{ notifyWorker?: ((type: string, request?: unknown) => Promise<unknown>) | null }} [opts]
 * @returns {PanicModeStorage | null}
 */
function createPanicModeStorage({ notifyWorker = null } = {}) {
    if (typeof chrome === 'undefined' || !chrome?.storage?.local) return null;
    const tellWorker = (type, request) => {
        if (!notifyWorker) return;
        Promise.resolve()
            .then(() => notifyWorker(type, request))
            .catch(() => { /* the worker reads storage when it wakes */ });
    };
    return {
        async load() {
            return new Promise((resolve) => {
                try {
                    chrome.storage.local.get(STORAGE_KEY, (items) => {
                        resolve(items?.[STORAGE_KEY] ?? null);
                    });
                } catch (_e) {
                    resolve(null);
                }
            });
        },
        // The worker signs, so it hears of a freeze directly and at once; the
        // storage write that follows is what lets the freeze outlive it.
        async save(state) {
            tellWorker(PANIC_HOLD_MESSAGE_TYPE, state);
            await storageWrite((done) => chrome.storage.local.set({ [STORAGE_KEY]: state }, done));
        },
        // Removing a key that was never stored raises no onChanged event, so a
        // worker holding a freeze whose save was refused is told to re-read.
        async clear() {
            await storageWrite((done) => chrome.storage.local.remove(STORAGE_KEY, done));
            tellWorker(PANIC_RESYNC_MESSAGE_TYPE);
        },
        watch(onChange) {
            try {
                chrome.storage.onChanged.addListener((changes, area) => {
                    if (area !== 'local') return;
                    if (!Object.prototype.hasOwnProperty.call(changes, STORAGE_KEY)) return;
                    onChange(changes[STORAGE_KEY]?.newValue ?? null);
                });
            } catch (_e) {
                // No onChanged support: cross-context sync degrades to
                // per-context reads; the persisted value is still shared.
            }
        },
    };
}

/**
 * Wire panic-mode persistence into the core flow for the current extension
 * context and relay cross-context updates. Safe to call in the background
 * worker and in every renderer entry (popup, side panel, approval). A no-op
 * where chrome.storage is unavailable.
 *
 * A renderer passes `notifyWorker` (its runtime sendMessage). Its writes then
 * reach the service worker directly as well as through storage, and at boot it
 * adopts any freeze the worker holds that storage does not, so a page opened
 * after a refused save still shows the freeze the worker enforces. The worker
 * itself passes nothing and reads storage alone.
 *
 * @param {{ configurePanicModePersistence: (s: unknown) => Promise<void>, applyExternalPanicModeState: (raw: unknown) => void, holdPanicModeFreeze?: (raw: unknown, opts?: { unsaved?: boolean }) => unknown, isSigningFrozen?: (state?: any) => boolean }} flows
 * @param {{ notifyWorker?: ((type: string, request?: unknown) => Promise<unknown>) | null }} [opts]
 * @returns {Promise<void>}
 */
export async function initPanicModePersistence(flows, { notifyWorker = null } = {}) {
    const store = createPanicModeStorage({ notifyWorker });
    if (!store) return;
    store.watch((state) => flows.applyExternalPanicModeState(state));
    await flows.configurePanicModePersistence(store);
    if (!notifyWorker || typeof flows.holdPanicModeFreeze !== 'function') return;
    let held = null;
    try {
        held = await notifyWorker(PANIC_LOAD_MESSAGE_TYPE);
    } catch (_err) {
        return;
    }
    const stored = await store.load();
    const heldExpiry = Number(/** @type {any} */ (held)?.expiresAt) || 0;
    const storedExpiry = Number(/** @type {any} */ (stored)?.expiresAt) || 0;
    if (heldExpiry > storedExpiry && heldExpiry > Date.now()) {
        flows.holdPanicModeFreeze(held, { unsaved: true });
    }
}

/**
 * The service worker's side of the direct channel. Attached at worker start,
 * ahead of the vault, because the duress passphrase arms panic mode from the
 * Locked screen. Extension pages only: a web page reaching the content-script
 * relay gets FORBIDDEN_SENDER.
 *
 *   hold    hold the given freeze in memory (core never lets it shorten or
 *           lift one), answer the freeze now enforced
 *   load    answer the freeze now enforced
 *   resync  re-read storage and enforce exactly what it holds; this is how a
 *           deactivation that reached storage lifts a held freeze, and it
 *           cannot lift one storage still records
 *
 * @param {{ flows: { holdPanicModeFreeze: (raw: unknown) => unknown, getPanicModeState: () => unknown, applyExternalPanicModeState: (raw: unknown) => void }, isTrustedSender: (sender: unknown, runtimeId: string | undefined) => boolean }} deps
 * @param {{ id?: string, onMessage: { addListener: Function, removeListener: Function } }} [chromeRuntime]
 * @returns {() => void} detach fn
 */
export function attachPanicStateListener({ flows, isTrustedSender }, chromeRuntime) {
    const runtime = chromeRuntime ?? /** @type {any} */ (globalThis.chrome?.runtime);
    if (!runtime || !runtime.onMessage) return () => {};
    const store = createPanicModeStorage();

    const listener = (message, sender, sendResponse) => {
        if (!message || typeof message !== 'object') return false;
        if (!PANIC_STATE_MESSAGE_TYPES.has(message.type)) return false;
        const respond = (response) => {
            try { sendResponse(response); } catch (_err) { /* caller is gone */ }
        };
        if (!isTrustedSender(sender, runtime.id)) {
            respond({
                ok: false,
                error: {
                    name: 'BridgeError',
                    code: 'FORBIDDEN_SENDER',
                    message: 'this message type is not available to web origins',
                },
            });
            return true;
        }
        if (message.type === PANIC_HOLD_MESSAGE_TYPE) {
            respond({ ok: true, result: flows.holdPanicModeFreeze(message.request) });
            return true;
        }
        if (message.type === PANIC_LOAD_MESSAGE_TYPE) {
            respond({ ok: true, result: flows.getPanicModeState() });
            return true;
        }
        (async () => {
            const stored = store ? await store.load() : null;
            flows.applyExternalPanicModeState(stored);
            respond({ ok: true, result: flows.getPanicModeState() });
        })().catch((err) => {
            respond({ ok: false, error: { name: 'Error', message: String(err?.message || err) } });
        });
        return true;
    };

    runtime.onMessage.addListener(listener);
    return () => runtime.onMessage.removeListener(listener);
}
