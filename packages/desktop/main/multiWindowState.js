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

/**
 * Describe the process-wide UI state changed by a successful renderer
 * message. Read-only and failed messages produce no notification.
 *
 * @param {{ type?: unknown, request?: unknown }} message
 * @param {{ ok?: unknown }} response
 * @returns {{ kind: 'session' } | { kind: 'active-wallet', walletId: string } | null}
 */
export function stateChangeForMessage(message, response) {
    if (response?.ok !== true || typeof message?.type !== 'string') return null;
    if (SESSION_CHANGE_TYPES.has(message.type)) return { kind: 'session' };
    if (message.type !== 'wallet.setActive') return null;

    const walletId = message.request?.walletId;
    if (typeof walletId !== 'string' || !walletId) return null;
    return { kind: 'active-wallet', walletId };
}
