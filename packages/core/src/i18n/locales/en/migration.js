// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { addEnglish } from '../../store.js';

const messages = {
    'migration.defaultWalletName': 'XChain Recovery Wallet',
    'migration.backupRestore':
        'These 12 words are your new recovery phrase. Write them on paper and store them safely. You can use the phrase to restore your new wallet on another device.',
    'migration.createWallet': 'Create New Wallet',
    'migration.encryptingWallet':
        'XChain Platform is encrypting the new wallet with your password. This can take a minute on some devices. Keep the app open. Your legacy wallet stays unchanged.',
    'migration.setupWallet': 'Set up new wallet',
    'migration.walletNameHelp': 'Names the new wallet in wallet lists on this device.',
};

addEnglish(messages);

export default messages;
