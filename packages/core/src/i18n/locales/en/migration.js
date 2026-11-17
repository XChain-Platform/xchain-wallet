// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { addEnglish } from '../../store.js';

const messages = {
    'migration.defaultWalletName': 'XChain Recovery Wallet',
    'migration.backupRestore':
        'These 12 words are your new recovery phrase. Write them on paper and store them safely. You can use the phrase to restore your new wallet on another device.',
    'migration.encryptingWallet':
        'XChain Platform is encrypting the new wallet with your password. This can take a minute on some devices. Keep the app open. Your legacy wallet stays unchanged.',
    'migration.setupWallet': 'Set up new wallet',
    'migration.walletNameHelp': 'Names the new wallet in wallet lists on this device.',
    'migration.title': 'Upgrade Wallet',
    'migration.backupPageLabel': 'Back up new recovery phrase',
    'migration.backupConfirmLabel':
        'I have written down the new recovery phrase and stored it safely.',
    'migration.backupConfirmHelp':
        'Confirms that the new phrase is saved somewhere safe. Next you type back a few of its words to prove it, before the new wallet is made.',
    'migration.verifyPageLabel': 'Verify new recovery phrase',
    'migration.verifyNote':
        'Enter the requested words from the recovery phrase you just wrote down. The new wallet is created only after every word matches.',
    'migration.wordLabel': 'Word {position}',
    'migration.wordHelp':
        'Type word {position} of the new recovery phrase you just wrote down.',
    'migration.doneNote':
        'Your new recovery phrase is verified and the wallet is saved. Your legacy wallet is unchanged, and nothing moves until you review and submit a sweep. Each sweep can move token balances and token ownerships, and checks that gated-content unlock keys are stored safely first.',
    'migration.sendCoinsSeparately': 'Send native coin balances separately.',
    'migration.loadFailed': 'Some migration addresses failed to load.',
    'migration.loading': 'Loading migration addresses…',
    'migration.noneToSweep': 'No legacy addresses are available to sweep.',
    'migration.noLegacyAddress': 'No legacy address on this network.',
    'migration.legacyAddress': 'Legacy address',
    'migration.newAddress': 'New address',
    'migration.swept': 'Swept',
    'migration.reviewSweep': 'Review Sweep',
    'migration.dismissList': 'Dismiss List',
    'migration.finish': 'Finish',
    'migration.whyUpgrade':
        'This makes a new wallet with a standard recovery phrase and new addresses. You write down the new phrase, then move your tokens from the old wallet into the new one. Coins (BTC, LTC, DOGE) move only when you send them yourself, so keep some for network fees. The old wallet stays on this device unchanged.',
    'migration.generatePhrase': 'Generate Recovery Phrase',
    'migration.walletNameLabel': 'New wallet name',
    'migration.passwordHelp':
        'Encrypts the new wallet on this device. Use at least {min} characters.',
    'migration.confirmPasswordHelp':
        'Type the same password again to confirm the new wallet password.',
};

addEnglish(messages);

export default messages;
