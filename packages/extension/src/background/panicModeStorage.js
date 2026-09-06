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
// Mirrors signThrottleStorage / broadcastQueueStorage:
//   - Extension (SW or page) → chrome.storage.local
//   - No chrome.storage       → null (core falls back to localStorage)

const STORAGE_KEY = 'xchain.panicMode';

/**
 * @typedef {Object} PanicModeStorage
 * @property {() => Promise<unknown>} load
 * @property {(state: unknown) => Promise<void>} save
 * @property {() => Promise<void>} clear
 * @property {(onChange: (state: unknown) => void) => void} watch
 */

/**
 * @returns {PanicModeStorage | null}
 */
function createPanicModeStorage() {
    if (typeof chrome === 'undefined' || !chrome?.storage?.local) return null;
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
        async save(state) {
            return new Promise((resolve) => {
                try {
                    chrome.storage.local.set({ [STORAGE_KEY]: state }, () => resolve());
                } catch (_e) {
                    resolve();
                }
            });
        },
        async clear() {
            return new Promise((resolve) => {
                try {
                    chrome.storage.local.remove(STORAGE_KEY, () => resolve());
                } catch (_e) {
                    resolve();
                }
            });
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
 * worker and in every renderer entry (popup, approval). A no-op where
 * chrome.storage is unavailable.
 *
 * @param {{ configurePanicModePersistence: (s: unknown) => Promise<void>, applyExternalPanicModeState: (raw: unknown) => void }} flows
 * @returns {Promise<void>}
 */
export async function initPanicModePersistence(flows) {
    const store = createPanicModeStorage();
    if (!store) return;
    store.watch((state) => flows.applyExternalPanicModeState(state));
    await flows.configurePanicModePersistence(store);
}
