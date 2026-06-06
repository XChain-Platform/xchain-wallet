// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// `window.xchainWalletBridge.sendMessage` wrapper. Mirrors the
// extension's `chromeMessaging.js` envelope-unwrapping behaviour so
// the rest of the renderer can branch on typed errors exactly like
// the popup does.
//
// Keep this file free of React imports — the React layer consumes
// these helpers via `messaging.js` (the popup/web parity module).

/**
 * @param {string} type
 * @param {unknown} [request]
 * @returns {Promise<unknown>}
 */
export async function sendMessage(type, request) {
    const bridge = /** @type {any} */ (globalThis).xchainWalletBridge;
    if (!bridge || typeof bridge.sendMessage !== 'function') {
        throw new Error(
            'xchainWalletBridge not exposed — is the preload script loading, and is the BrowserWindow configured with contextIsolation=true + the preload path?',
        );
    }
    const response = await bridge.sendMessage({ type, request });
    if (!response || typeof response !== 'object') {
        throw new Error(`no response for "${type}"`);
    }
    if (response.ok) return response.result;
    const err = new Error(response.error?.message || 'unknown error');
    err.name = response.error?.name || 'Error';
    throw err;
}
