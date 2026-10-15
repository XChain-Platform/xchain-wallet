// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The balances a wallet SHOWS, as opposed to the balances it can spend.
//
// A demo wallet shows sample holdings synthesized from its own address
// records. Its action forms read the same sample holdings: the host's balance
// flow answers a demo wallet from the same fixture (issue #82), because the
// demo lands on mainnet and its addresses must never reach a real explorer.
//
// Home and the command palette both show holdings, and they once disagreed:
// Home synthesized, the palette read the chain,
// so a palette entry opened a coin's detail screen at 0 while Home listed 100.
// Every display surface reads through here so the two cannot drift again.

import { synthesizeDemoBalances } from '../../flows/demoFixtures.js';
import { isDemoWallet } from '../../flows/demoMode.js';

/**
 * @param {{ getWalletBalances: Function, getAddressesByChain?: Function }} messaging
 * @param {string} walletId
 * @param {string | null} [accountId]
 * @returns {Promise<Record<string, any[]>>}  the `getWalletBalances` shape
 */
export async function loadDisplayBalances(messaging, walletId, accountId) {
    if (isDemoWallet(walletId) && typeof messaging.getAddressesByChain === 'function') {
        const byChain = await messaging.getAddressesByChain(walletId, accountId);
        return synthesizeDemoBalances(byChain);
    }
    return messaging.getWalletBalances(walletId, accountId);
}
