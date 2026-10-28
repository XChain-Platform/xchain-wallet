// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

const SESSION_CHANGE_TYPES = new Set([
    'wallet.create',
    'wallet.import',
    'wallet.importBackup.fresh',
    'wallet.lock',
    'wallet.unlock',
]);

// Messages that add, rename or remove a wallet record in the open vault. A
// sibling window re-reads its wallet list so its switcher and pickers match.
const WALLET_RECORD_CHANGE_TYPES = new Set([
    'wallet.add.import',
    'wallet.importBackup',
    'wallet.importBackupPointer',
    'wallet.rename',
    'wallet.remove',
]);

/**
 * Describe the process-wide UI state changed by a successful renderer
 * message. Read-only and failed messages produce no notification.
 *
 * A settings write reaches sibling windows as `settings`, or as `network`
 * when it moves the active network, the same split the extension publishes
 * to its other surfaces; both carry the full saved settings object.
 *
 * @param {{ type?: unknown, request?: unknown }} message
 * @param {{ ok?: unknown, result?: unknown }} response
 * @returns {{ kind: 'session' } | { kind: 'wallets' } | { kind: 'active-wallet', walletId: string }
 *   | { kind: 'settings' | 'network', settings: Record<string, unknown> } | null}
 */
export function stateChangeForMessage(message, response) {
    if (response?.ok !== true || typeof message?.type !== 'string') return null;
    if (SESSION_CHANGE_TYPES.has(message.type)) return { kind: 'session' };
    if (WALLET_RECORD_CHANGE_TYPES.has(message.type)) return { kind: 'wallets' };
    if (message.type === 'settings.update') return settingsChange(message.request, response.result);
    if (message.type === 'settings.setActiveNetwork') {
        const settings = /** @type {any} */ (response.result)?.settings;
        return isPlainObject(settings) ? { kind: 'network', settings } : null;
    }
    if (message.type !== 'wallet.setActive') return null;

    const walletId = message.request?.walletId;
    if (typeof walletId !== 'string' || !walletId) return null;
    return { kind: 'active-wallet', walletId };
}

/**
 * Read the patch the way the host's settings.update handler does: `patch` when present, else the request.
 *
 * @param {any} request
 * @param {unknown} result
 * @returns {{ kind: 'settings' | 'network', settings: Record<string, unknown> } | null}
 */
function settingsChange(request, result) {
    if (!isPlainObject(result)) return null;
    const patch = isPlainObject(request) && 'patch' in request ? request.patch : request;
    const movesNetwork = isPlainObject(patch) && Object.prototype.hasOwnProperty.call(patch, 'activeNetwork');
    return { kind: movesNetwork ? 'network' : 'settings', settings: /** @type {Record<string, unknown>} */ (result) };
}

/**
 * Accept only a non-null, non-array object, the shape a saved settings record has.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
