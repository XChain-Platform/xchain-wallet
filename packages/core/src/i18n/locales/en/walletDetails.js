// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `walletDetails.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    // --- wallet management --------------------------------------
    'walletDetails.title': 'Wallet details',
    'walletDetails.name': 'Name',
    'walletDetails.type': 'Type',
    'walletDetails.origin': 'Origin',
    'walletDetails.originLabel.created': 'Generated in this wallet',
    'walletDetails.originLabel.demo': 'Created for demo mode',
    'walletDetails.originLabel.importedMnemonic': 'Imported from a recovery phrase',
    'walletDetails.originLabel.importedWif': 'Imported single private key',
    'walletDetails.originLabel.importedBackup': 'Restored from backup file',
    'walletDetails.originLabel.importedFreewallet': 'Imported from FreeWallet',
    'walletDetails.originLabel.unknown': 'Not recorded',
    'walletDetails.passphrase': 'BIP39 passphrase status',
    'walletDetails.created': 'Created',
    'walletDetails.demoWallet': 'Demo wallet (throwaway)',
    'walletDetails.id': 'ID',
    'walletDetails.upgradeRecovery': 'Upgrade recovery phrase',
};

addEnglish(messages);

export default messages;
