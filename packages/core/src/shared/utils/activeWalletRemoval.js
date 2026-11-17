// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { clearActiveWallet, writeActiveWallet } from './activeWalletMemory.js';
import { wipeWalletStorage } from './wipeWalletStorage.js';

/**
 * After the ACTIVE wallet is removed: make another listed wallet active, or
 * wipe local wallet storage when none is left, then reload so no screen keeps
 * the removed wallet selected. Only the active wallet needs this; removing any
 * other wallet leaves the active one as it is.
 *
 * Shared by Settings' Remove wallet and the per-wallet Remove Wallet page, so
 * both leave the app in the same state.
 *
 * @param {object} opts
 * @param {{ listWallets?: () => Promise<any> }} opts.messaging
 * @param {string} opts.removedWalletId
 * @param {() => void} opts.reload
 */
export async function handOverAfterActiveWalletRemoved({ messaging, removedWalletId, reload }) {
    clearActiveWallet();
    try {
        // A fresh list is required before a replacement is picked.
        if (typeof messaging?.listWallets !== 'function') {
            throw new Error('Could not refresh the wallet list.');
        }
        const listed = await messaging.listWallets();
        const wallets = Array.isArray(listed) ? listed : listed?.wallets;
        // An unknown response shape is refused, so an empty-looking result cannot wipe a real vault.
        if (!Array.isArray(wallets)) {
            throw new Error('Could not refresh the wallet list.');
        }
        const nextWallet = wallets.find((wallet) => wallet?.id && wallet.id !== removedWalletId);
        if (nextWallet) {
            writeActiveWallet(nextWallet.id);
        } else {
            await wipeWalletStorage();
        }
    } finally {
        // Reload even when the replacement could not be chosen.
        reload();
    }
}
