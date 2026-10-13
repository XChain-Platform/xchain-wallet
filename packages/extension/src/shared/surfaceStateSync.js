// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Popup and side-panel pages are separate JavaScript realms. The background
// publishes committed session, wallet and network changes through
// chrome.storage.session so every open trusted extension surface sees them.

export const SURFACE_STATE_STORAGE_KEY = 'xchain:surface-state-event';

const KINDS = new Set(['session', 'wallet', 'network']);

/**
 * @param {{
 *   storageArea?: { set: Function },
 *   runtime?: { lastError?: unknown },
 *   now?: () => number,
 * }} [deps]
 */
export function createSurfaceStateBroadcaster(deps = {}) {
    const storageArea = deps.storageArea
        ?? /** @type {any} */ (globalThis.chrome?.storage?.session);
    const runtime = deps.runtime
        ?? /** @type {any} */ (globalThis.chrome?.runtime);
    const now = deps.now ?? Date.now;
    let serial = 0;

    return {
        /**
         * @param {'session' | 'wallet' | 'network'} kind
         * @param {Record<string, unknown>} [payload]
         * @returns {Promise<boolean>}
         */
        publish(kind, payload = {}) {
            if (!KINDS.has(kind) || typeof storageArea?.set !== 'function') {
                return Promise.resolve(false);
            }
            serial += 1;
            const event = { kind, payload, revision: `${now()}:${serial}` };
            return new Promise((resolve) => {
                let settled = false;
                const finish = (ok) => {
                    if (settled) return;
                    settled = true;
                    resolve(ok);
                };
                const callback = () => finish(!runtime?.lastError);
                try {
                    const pending = storageArea.set({ [SURFACE_STATE_STORAGE_KEY]: event }, callback);
                    if (pending && typeof pending.then === 'function') {
                        pending.then(() => finish(true), () => finish(false));
                    }
                } catch {
                    finish(false);
                }
            });
        },
    };
}

/**
 * @param {(event: { kind: 'session' | 'wallet' | 'network', payload: Record<string, unknown>, revision: string }) => void} onEvent
 * @param {{ addListener: Function, removeListener: Function }} [storageChanges]
 * @returns {() => void}
 */
export function attachSurfaceStateListener(onEvent, storageChanges) {
    const changes = storageChanges
        ?? /** @type {any} */ (globalThis.chrome?.storage?.onChanged);
    if (typeof onEvent !== 'function' || typeof changes?.addListener !== 'function') {
        return () => {};
    }
    const listener = (updates, areaName) => {
        if (areaName !== 'session') return;
        const event = updates?.[SURFACE_STATE_STORAGE_KEY]?.newValue;
        if (!event || !KINDS.has(event.kind) || typeof event.revision !== 'string') return;
        const payload = event.payload;
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
        onEvent(event);
    };
    changes.addListener(listener);
    return () => changes.removeListener(listener);
}

/**
 * Apply a validated background event to one popup or side-panel realm.
 * Callers inject React setters so this small state machine stays unit-testable.
 *
 * @param {{ kind: string, payload?: Record<string, unknown> }} event
 * @param {{
 *   refreshSession?: () => unknown,
 *   selectWallet?: (walletId: string) => unknown,
 *   settingsChanged?: (settings: Record<string, unknown>) => unknown,
 *   remountNetworkState?: () => unknown,
 * }} handlers
 */
export function applySurfaceStateEvent(event, handlers) {
    if (event?.kind === 'session') {
        return handlers.refreshSession?.();
    }
    if (event?.kind === 'wallet') {
        const walletId = event.payload?.walletId;
        if (typeof walletId === 'string' && walletId) {
            return handlers.selectWallet?.(walletId);
        }
        return undefined;
    }
    if (event?.kind === 'network') {
        const settings = event.payload?.settings;
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return undefined;
        handlers.settingsChanged?.(settings);
        return handlers.remountNetworkState?.();
    }
    return undefined;
}
