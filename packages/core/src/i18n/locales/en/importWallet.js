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
    'importWallet.wif.tab': 'Private key',
    'importWallet.wif.key': 'WIF private key',
    'importWallet.wif.keyHelp': 'Enter the WIF private key you want to import.',
    'importWallet.wif.chain': 'Coin network',
    'importWallet.wif.chainHelp': 'Choose the coin network that matches this private key.',
    'importWallet.wif.addressType': 'Private key type',
    'importWallet.wif.addressTypeHelp': 'Choose the address format to derive from this private key.',
    'importWallet.wif.addressHelp': 'Shows the address derived from the private key, network, and type.',
    'importWallet.wif.ack': "I understand this key isn't recoverable from a recovery phrase.",
    'importWallet.wif.ackHelp': 'Confirms that you saved this private key separately, because a recovery phrase can\'t restore it.',
    'importWallet.backup.file': 'Backup file',
    'importWallet.backup.fileHelp': 'Choose the encrypted backup file to restore.',
    'importWallet.cancelScan': 'Cancel scan',
    'importWallet.scanPointerQr': 'Scan pointer QR',
    'importWallet.backup.scannerAlt': 'Backup-pointer QR scanner',
    'importWallet.backup.pointerLoaded': 'Backup pointer loaded{name}.',
    'importWallet.backup.location': 'Location: {location}',
    'importWallet.backup.useFile': 'Use a file instead',
    'importWallet.backup.chooseFile': 'Choose backup file',
    'importWallet.backup.contents': 'Backup file contents',
    'importWallet.backup.contentsHelp': 'Paste the encrypted backup file contents into this field.',
    'importWallet.backup.contentsDescription': 'Paste backup file contents here, or drop a backup file onto the box.',
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
    'importWallet.phrase.bip39Detected': 'Standard recovery phrase detected',
    'importWallet.phrase.counterwalletDetected': 'Counterwallet/FreeWallet recovery phrase detected',
    'importWallet.phrase.notBip39UseFreeWallet':
        "This phrase doesn't pass the recovery phrase check. If it came from FreeWallet, use the From FreeWallet option.",
    'importWallet.phrase.suggestions': 'Recovery word suggestions',
    'importWallet.phrase.useWord': 'Use recovery word "{word}"',
    'importWallet.phrase.releaseToLoad': 'Release to load',
    'importWallet.phrase.help':
        'Enter a recovery phrase with 12, 15, 18, 21, or 24 words. Drop a .txt file with your recovery phrase to load it here.',
    'importWallet.phrase.freeWalletHelp':
        'Enter your 12-word FreeWallet recovery phrase. XChain Platform can detect a standard recovery phrase or the legacy Counterwallet/FreeWallet format automatically. Drop a .txt file with your recovery phrase to load it here.',
    'importWallet.walletNameHelp': 'Name this imported wallet on this device.',
    'importWallet.password.fullHelp': 'Encrypts this wallet on this device.',
    'importWallet.password.hint': 'At least {count} characters.',
    'importWallet.confirmPassword': 'Confirm password',
    'importWallet.confirmPasswordHelp': 'Enter the same password again to confirm it.',
    'importWallet.passphrase.toggle': 'This wallet uses an extra passphrase',
    'importWallet.passphrase.help': 'Extra passphrase help',
    'importWallet.passphrase.helpBody':
        'This extra secret combines with your recovery phrase to recreate the same wallet. It stays behind your password here; hardware wallets request it on the device and connect through Add Account, then Hardware Signer.',
    'importWallet.passphrase.label': 'Extra passphrase',
    'importWallet.passphrase.hint': 'Required to derive the same addresses as the original wallet.',
    'importWallet.passphrase.empty':
        "Enter the extra passphrase, or uncheck the box if this wallet doesn't use one.",
    'importWallet.backToSetup': 'Back to wallet setup',
    'importWallet.openInTab': 'Open in tab',
    'importWallet.walletElsewhere': 'This device already has a wallet, so nothing was imported here. Unlock that wallet to continue.',
    'importWallet.unlockExisting': 'Unlock',
};

addEnglish(messages);

export default messages;
