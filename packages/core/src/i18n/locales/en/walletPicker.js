// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `walletPicker.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    'walletPicker.title': 'Wallets',
    'walletPicker.manage': 'Manage wallet',
    'walletPicker.emptyTitle': 'No wallets yet',
    'walletPicker.emptyBody': 'Wallets available to this app appear here.',
    'walletPicker.demoPrefix': 'Demo wallet · ',
    'walletPicker.legacy': 'FreeWallet (legacy)',
    'walletPicker.importedKey': 'Imported key',
    'walletPicker.bip39': 'BIP39',
    'walletPicker.passphraseNeeded': ' · needs its passphrase at unlock',
    'walletPicker.detailsFor': 'Wallet details for {wallet}',
};

addEnglish(messages);

export default messages;
