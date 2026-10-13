// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Shared `chrome.runtime.sendMessage` wrapper used by every extension
// page (popup, approval window). Mirrors the MessageHost response
// envelope: resolves with `result`, rejects with an Error whose `name`
// matches the background-side error class and whose `code` /
// `retryAfterMs` / `burst` / `windowMs` survive the hop (the rebuild is
// MessageHost's own `hydrateEnvelopeError`, so every shell that unwraps the
// envelope keeps the same fields rather than whichever one was patched last).
//
// Kept here (not in `src/popup/` or `src/approval/`) so both entries
// can import the same implementation without depending on each other.
//
// This is also where the extension drops stale tick metadata. The
// flows run in the service worker, a different JS realm from the page holding
// the `useTokenInfo` cache, so `submitAction`'s own invalidation never reaches
// it. Every `action.*` route that resolves here invalidates the ticks its
// request named, which is the same set `submitAction` would have dropped.

import { invalidateTokenInfoForAction } from '@xchain-wallet/core/shared/utils/tokenInfoCache.js';
import { hydrateEnvelopeError } from '../background/MessageHost.js';
import { createSurfaceStateBroadcaster } from './surfaceStateSync.js';

let surfaceStateEvents;

function publishSettingsChange(settings) {
    surfaceStateEvents ??= createSurfaceStateBroadcaster();
    void surfaceStateEvents.publish('settings', { settings });
}

export const RUNTIME_MESSAGE_TIMEOUT_MS = 4_000;

function runtimeTransportError(message, code) {
    const error = new Error(message);
    error.name = 'RuntimeConnectionError';
    error.code = code;
    return error;
}

/**
 * @param {string} type
 * @param {unknown} [request]
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<unknown>}
 */
export function sendMessage(type, request, { timeoutMs = 0 } = {}) {
    return new Promise((resolve, reject) => {
        const runtime = globalThis.chrome?.runtime;
        if (!runtime?.sendMessage) {
            reject(runtimeTransportError(
                'chrome.runtime.sendMessage unavailable',
                'RUNTIME_UNAVAILABLE',
            ));
            return;
        }

        let settled = false;
        const settle = (callback, value) => {
            if (settled) return;
            settled = true;
            if (timeout) clearTimeout(timeout);
            callback(value);
        };
        const timeout = timeoutMs > 0
            ? setTimeout(() => {
                settle(
                    reject,
                    runtimeTransportError(
                        `background did not respond to "${type}"`,
                        'RUNTIME_TIMEOUT',
                    ),
                );
            }, timeoutMs)
            : null;

        const handleResponse = (response) => {
            const lastErr = runtime.lastError;
            if (lastErr) {
                settle(
                    reject,
                    runtimeTransportError(
                        lastErr.message || 'runtime connection failed',
                        'RUNTIME_DISCONNECTED',
                    ),
                );
                return;
            }
            if (!response || typeof response !== 'object') {
                settle(
                    reject,
                    runtimeTransportError(
                        `no response for "${type}"`,
                        'RUNTIME_NO_RESPONSE',
                    ),
                );
                return;
            }
            if (response.ok) {
                if (typeof type === 'string' && type.startsWith('action.')) {
                    const req = /** @type {any} */ (request);
                    invalidateTokenInfoForAction(req?.chainId, req);
                }
                if (type === 'settings.update' && response.result
                    && typeof response.result === 'object') {
                    publishSettingsChange(response.result);
                }
                settle(resolve, response.result);
                return;
            }
            settle(reject, hydrateEnvelopeError(response.error));
        };

        try {
            runtime.sendMessage({ type, request }, handleResponse);
        } catch (error) {
            settle(
                reject,
                runtimeTransportError(
                    error?.message || 'runtime connection failed',
                    'RUNTIME_DISCONNECTED',
                ),
            );
        }
    });
}
