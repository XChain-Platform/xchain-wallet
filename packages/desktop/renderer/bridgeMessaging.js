// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// `window.xchainWalletBridge.sendMessage` wrapper. Mirrors the
// extension's `chromeMessaging.js` envelope-unwrapping behaviour so
// the rest of the renderer can branch on typed errors exactly like
// the popup does.
//
// Keep this file free of React imports. The React layer consumes
// these helpers via `messaging.js` (the popup/web parity module).
//
// Desktop runs its flows in the Electron MAIN process, a different
// realm from the renderer holding the `useTokenInfo` cache, so
// `submitAction`'s own invalidation never reaches it. Every `action.*` route
// that resolves here drops the tick records its request named, matching what
// the extension does for the same reason.

import { invalidateTokenInfoForAction } from '@xchain-wallet/core/shared/utils/tokenInfoCache.js';
import { hydrateEnvelopeError } from '@xchain-wallet/extension/src/background/MessageHost.js';

/**
 * @param {string} type
 * @param {unknown} [request]
 * @returns {Promise<unknown>}
 */
export async function sendMessage(type, request) {
    const bridge = /** @type {any} */ (globalThis).xchainWalletBridge;
    if (!bridge || typeof bridge.sendMessage !== 'function') {
        throw new Error(
            'xchainWalletBridge not exposed. Is the preload script loading, and is the BrowserWindow configured with contextIsolation=true + the preload path?',
        );
    }
    const response = await bridge.sendMessage({ type, request });
    if (!response || typeof response !== 'object') {
        throw new Error(`no response for "${type}"`);
    }
    if (response.ok) {
        if (typeof type === 'string' && type.startsWith('action.')) {
            const req = /** @type {any} */ (request);
            invalidateTokenInfoForAction(req?.chainId, req);
        }
        return response.result;
    }
    // The MAIN process runs the SAME bridge handlers the extension
    // service worker does (createDesktopMessageHost wraps createBackgroundHost,
    // which loads bridge/handlers.js out of app.asar), so its envelope now
    // carries `code` and the THROTTLED hints. Rebuilding the Error by hand here
    // dropped all four on the desktop shell only - the one shell where the
    // handlers and their consumer are in different processes and drift silently.
    throw hydrateEnvelopeError(response.error);
}
