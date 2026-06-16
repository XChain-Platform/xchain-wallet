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
// matches the background-side error class.
//
// Kept here (not in `src/popup/` or `src/approval/`) so both entries
// can import the same implementation without depending on each other.

/**
 * @param {string} type
 * @param {unknown} [request]
 * @returns {Promise<unknown>}
 */
export function sendMessage(type, request) {
    return new Promise((resolve, reject) => {
        const runtime = globalThis.chrome?.runtime;
        if (!runtime?.sendMessage) {
            reject(new Error('chrome.runtime.sendMessage unavailable'));
            return;
        }
        runtime.sendMessage({ type, request }, (response) => {
            const lastErr = runtime.lastError;
            if (lastErr) {
                reject(new Error(lastErr.message || 'runtime error'));
                return;
            }
            if (!response || typeof response !== 'object') {
                reject(new Error(`no response for "${type}"`));
                return;
            }
            if (response.ok) {
                resolve(response.result);
                return;
            }
            const err = new Error(response.error?.message || 'unknown error');
            err.name = response.error?.name || 'Error';
            reject(err);
        });
    });
}
