// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The single source of the wallet-level alerts the Alerts panel lists.
// Keep every alert and its wording here, so no shell carries a copy that drifts.
//
// A shell surfaces an alert by passing its handler and hides it by passing
// nothing, the same contract as the Actions menu (actionEntries.js).

/**
 * @typedef {Object} WalletAlert
 * @property {string} id              stable alert id, also the list key
 * @property {'info'} severity
 * @property {string} title
 * @property {string} message
 * @property {{ label: string, onSelect: () => void }} action
 */

/**
 * Build the alerts for the active wallet, in the order the panel lists them.
 *
 * @param {{ activeWallet?: { format?: string }|null, messagingUnread?: number }} state
 * @param {{ onMessaging?: () => void, onMigrateToBip39?: () => void }} [handlers]
 * @returns {WalletAlert[]}
 */
export function buildWalletAlerts({ activeWallet = null, messagingUnread = 0 } = {}, handlers = {}) {
    const { onMessaging, onMigrateToBip39 } = handlers || {};
    const alerts = [];
    // Show unread messages only when the shell can open Messaging.
    if (messagingUnread > 0 && typeof onMessaging === 'function') {
        alerts.push({
            id: 'unread-messages',
            severity: 'info',
            title: 'Unread messages',
            message: messagingUnread === 1
                ? 'You have 1 conversation with unread messages.'
                : `You have ${messagingUnread} conversations with unread messages.`,
            action: { label: 'Open Messaging', onSelect: onMessaging },
        });
    }
    // Offer the BIP39 upgrade only for a legacy-format wallet the shell can migrate.
    if (activeWallet?.format === 'counterwallet-legacy' && typeof onMigrateToBip39 === 'function') {
        alerts.push({
            id: 'legacy-format',
            severity: 'info',
            title: 'Older recovery phrase format',
            message: 'This wallet uses the older 12-word FreeWallet recovery phrase, which many other wallets cannot restore. Upgrading creates a new wallet with a standard (BIP39) recovery phrase; your current wallet stays as it is.',
            action: { label: 'Upgrade recovery phrase', onSelect: onMigrateToBip39 },
        });
    }
    return alerts;
}
