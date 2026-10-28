// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `importWallet.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    // --- wallet import -------------------------------------------
    'importWallet.lane': 'Wallet import options',
    'importWallet.recoveryPhrase': 'Recovery phrase',
    'importWallet.encryptedBackup': 'Encrypted backup',
    'importWallet.browse': 'Browse',
    'importWallet.import': 'Import',
    'importWallet.freeWallet.fullTitle': 'Import from FreeWallet',
    'importWallet.freeWallet.title': 'FreeWallet import',
    'importWallet.backup.fullTitle': 'Restore from encrypted backup',
    'importWallet.backup.title': 'Restore backup',
    'importWallet.existing.fullTitle': 'Import an existing wallet',
    'importWallet.wif.fullTitle': 'Import a private key',
    'importWallet.wif.title': 'Import private key',
    'importWallet.wif.subtitle':
        'Import one WIF private key as a wallet. Pick the matching network so the correct address is derived.',
    'importWallet.wif.tab': 'Private key',
    'importWallet.wif.key': 'WIF private key',
    'importWallet.wif.chain': 'Private key network',
    'importWallet.wif.ack': "I understand this key isn't recoverable from a recovery phrase.",
    'importWallet.freeWallet.fullSubtitle':
        'Enter your 12-word FreeWallet recovery phrase. XChain Platform can detect BIP39 or the legacy Counterwallet/FreeWallet format automatically.',
    'importWallet.freeWallet.subtitle':
        'Enter your 12-word FreeWallet recovery phrase.',
    'importWallet.phrase.fullSubtitle':
        'Enter a BIP39 recovery phrase with 12, 15, 18, 21, or 24 words, or a 12-word Counterwallet recovery phrase. XChain Platform detects the format.',
    'importWallet.phrase.subtitle':
        'Enter a recovery phrase with 12, 15, 18, 21, or 24 words.',
    'importWallet.backup.file': 'Backup file',
    'importWallet.cancelScan': 'Cancel scan',
    'importWallet.scanPointerQr': 'Scan pointer QR',
    'importWallet.backup.scannerAlt': 'Backup-pointer QR scanner',
    'importWallet.backup.pointerLoaded': 'Backup pointer loaded{name}.',
    'importWallet.backup.location': 'Location: {location}',
    'importWallet.backup.useFile': 'Use a file instead',
    'importWallet.backup.chooseFile': 'Choose backup file',
    'importWallet.backup.contents': 'Backup file contents',
    'importWallet.backup.placeholder.version': '"version":1,"kdf":',
    'importWallet.backup.placeholder.kdf': '"name":"argon2id"…',
    'importWallet.backup.overwrite': 'Overwrite if any record collides (advanced)',
    'importWallet.scanQr': 'Scan QR',
    'importWallet.phrase.scannerAlt':
        'Recovery phrase QR scanner',
    'importWallet.phrase.fullPlaceholder': 'word word word word word word word word word word word word',
    'importWallet.phrase.placeholder': 'word word word…',
    'importWallet.phrase.freeWalletCount': '{count} / 12 words',
    'importWallet.phrase.wordCount':
        '{count, plural, one {# word entered} other {# words entered}}',
    // {expected} is the accepted counts already joined as an "or" list.
    'importWallet.phrase.wrongWordCount': 'Expected {expected} words, got {count}.',
    'importWallet.phrase.bip39Detected': 'BIP39 recovery phrase detected',
    'importWallet.phrase.counterwalletDetected': 'Counterwallet/FreeWallet recovery phrase detected',
    'importWallet.phrase.notBip39UseFreeWallet':
        "This phrase doesn't pass the recovery phrase check. If it came from FreeWallet, use the From FreeWallet option.",
    'importWallet.phrase.suggestions': 'BIP39 word suggestions',
    'importWallet.phrase.useWord': 'Use BIP39 word "{word}"',
    'importWallet.phrase.releaseToLoad': 'Release to load',
    'importWallet.phrase.dropHint': 'Drop a .txt file with your recovery phrase to load it here.',
    'importWallet.password.fullHint':
        'At least {count} characters. Encrypts this wallet on this device.',
    'importWallet.password.hint': 'At least {count} characters.',
    'importWallet.confirmPassword': 'Confirm password',
    'importWallet.passphrase.toggle': 'This wallet uses a BIP39 passphrase',
    'importWallet.passphrase.help': 'BIP39 passphrase help',
    'importWallet.passphrase.helpBody':
        'This extra secret combines with your recovery phrase to recreate the same wallet. It stays behind your password here; hardware wallets request it on the device and connect through Add Account, then Hardware Signer.',
    'importWallet.passphrase.label': 'BIP39 passphrase',
    'importWallet.passphrase.hint': 'Required to derive the same addresses as the original wallet.',
    'importWallet.backToSetup': 'Back to wallet setup',
    'importWallet.openInTab': 'Open in tab',
    'importWallet.walletElsewhere': 'This device already has a wallet, so nothing was imported here. Unlock that wallet to continue.',
    'importWallet.unlockExisting': 'Unlock',
};

addEnglish(messages);

export default messages;
