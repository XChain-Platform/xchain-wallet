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
    // The concealed word grid's accessible name: the blurred cells hold
    // placeholder words, never the phrase, so assistive tech hears only this.
    'importWallet.recoveryPhraseHidden': 'Recovery phrase hidden',
    'importWallet.encryptedBackup': 'Encrypted backup',
    // Lane tab labels: one short word each, so three tabs fit 360px (G42).
    'importWallet.tab.phrase': 'Phrase',
    'importWallet.tab.backup': 'Backup',
    'importWallet.import': 'Import',
    'importWallet.walletType': 'Wallet type',
    'importWallet.walletTypeHelp': 'Choose the recovery phrase format used by the wallet you are importing.',
    'importWallet.walletType.bip39': 'Standard recovery phrase',
    'importWallet.walletType.bip39Description': '12 or 24 words, the standard recovery phrase',
    'importWallet.walletType.legacy': 'FreeWallet / PartyWallet',
    'importWallet.walletType.legacyDescription': '12 words from a legacy Counterparty wallet',
    'importWallet.backup.title': 'Restore Backup',
    'importWallet.wif.title': 'Import Private Key',
    'importWallet.wif.tab': 'Private key',
    'importWallet.wif.key': 'WIF private key',
    'importWallet.wif.keyHelp': 'Enter the WIF private key you want to import.',
    'importWallet.wif.coin': 'Coin',
    'importWallet.wif.coinHelp': 'Choose the coin family for this private key.',
    'importWallet.wif.chain': 'Coin network',
    'importWallet.wif.chainHelp': 'Choose the coin network that matches this private key.',
    'importWallet.wif.coinRequired': 'Choose a coin.',
    'importWallet.wif.networkRequired': 'Choose a coin network.',
    'importWallet.wif.networkMismatch': 'That private key is for a different coin network. Choose the network that matches its version byte.',
    'importWallet.wif.addressType': 'Address type',
    'importWallet.wif.addressTypeHelp': 'Choose the address format to derive from this private key.',
    'importWallet.wif.ack': "I understand this key isn't recoverable from a recovery phrase.",
    'importWallet.wif.ackHelp': 'Confirms that you saved this private key separately, because a recovery phrase can\'t restore it.',
    // --- restore from a backup file --------------------------------
    // The hidden file input's name; the area shows the longer title.
    'importWallet.backup.file': 'Backup file',
    'importWallet.backup.choose': 'Choose your backup file',
    // The drop area's second line, under its title: a fragment, not a sentence.
    'importWallet.backup.orDrop': 'or drop it here',
    'importWallet.backup.changeFile': 'Change File',
    'importWallet.backup.summary': 'Chosen backup file',
    // A backup whose header carries no readable name.
    'importWallet.backup.unnamed': 'Wallet backup',
    'importWallet.backup.backedUp': 'Backed up {date}',
    'importWallet.backup.fileMeta': '{name}, {size}',
    'importWallet.backup.password': 'Backup password',
    'importWallet.backup.passwordHelp':
        'The password you set when you saved this backup. It also unlocks the wallet inside when that wallet used the same one, and the wallet keeps its own password here; you can change it later in Security.',
    'importWallet.backup.passwordHelpAdd':
        'The password you set when you saved this backup. It also unlocks the wallet inside when that wallet used the same one.',
    'importWallet.backup.walletPassword': 'Wallet password',
    'importWallet.backup.walletPasswordHelp':
        'The password this wallet unlocked with on the device it was backed up from.',
    'importWallet.backup.walletPasswordReason': 'The file opened, but the wallet inside uses a different password.',
    'importWallet.backup.devicePassword': 'Your password on this device',
    'importWallet.backup.devicePasswordHelp':
        'The password you already unlock this app with. The restored wallet joins your other wallets under it.',
    'importWallet.backup.devicePasswordReason': 'This app unlocks with a different password. Enter it to add this wallet here.',
    'importWallet.backup.error.noFile': 'Choose a backup file.',
    'importWallet.backup.error.passwordRequired': 'Enter the backup password.',
    'importWallet.backup.error.walletPasswordRequired': 'Enter the wallet password.',
    'importWallet.backup.error.devicePasswordRequired': 'Enter your password on this device.',
    'importWallet.backup.error.wrongPassword': "That password doesn't open this backup.",
    'importWallet.backup.error.wrongWalletPassword': "That password doesn't open the wallet in this backup.",
    'importWallet.backup.error.wrongDevicePassword': "That isn't the password this app unlocks with.",
    'importWallet.backup.error.notBackup':
        "That isn't a wallet backup file this app can read. Choose the backup file you saved.",
    'importWallet.backup.error.newer':
        'This backup was made by a newer version of the app. Update the app, then restore it again.',
    'importWallet.backup.error.damaged':
        'The wallet inside this backup file is damaged, so no password can open it. Restore from a different backup file.',
    'importWallet.backup.error.unreadable': "Couldn't read the backup file. Choose another file and try again.",
    // {reason} is the drop zone's own size or type refusal, already a sentence.
    'importWallet.backup.error.fileRejected': '{reason} Choose a supported backup file and try again.',
    'importWallet.backup.error.generic': "That backup couldn't be restored. Check the backup file and try again.",
    'importWallet.backup.error.unavailable': "Restoring a backup isn't available in this app.",
    'importWallet.cancelScan': 'Cancel scan',
    'importWallet.scanQr': 'Scan QR',
    'importWallet.phrase.scannerAlt':
        'Recovery phrase QR scanner',
    'importWallet.phrase.fullPlaceholder': 'word word word word word word word word word word word word',
    'importWallet.phrase.placeholder': 'word word word…',
    'importWallet.phrase.legacyCount': '{count} / 12 words',
    'importWallet.phrase.wordCount':
        '{count, plural, one {# word entered} other {# words entered}}',
    // {expected} is the accepted counts already joined as an "or" list.
    'importWallet.phrase.wrongWordCount': 'Expected {expected} words, got {count}.',
    'importWallet.phrase.bip39Detected': 'Standard recovery phrase detected',
    'importWallet.phrase.legacyDetected': 'FreeWallet / Counterwallet recovery phrase detected',
    'importWallet.phrase.notBip39UseLegacy':
        "This phrase doesn't pass the standard recovery phrase check. Choose FreeWallet / PartyWallet as the Wallet type.",
    'importWallet.phrase.suggestions': 'Recovery word suggestions',
    'importWallet.phrase.useWord': 'Use recovery word "{word}"',
    'importWallet.phrase.releaseToLoad': 'Release to load',
    'importWallet.phrase.help':
        'Enter a recovery phrase with 12, 15, 18, 21, or 24 words. Drop a .txt file with your recovery phrase to load it here.',
    'importWallet.phrase.legacyHelp':
        'Enter a 12-word legacy recovery phrase. Drop a .txt file with your recovery phrase to load it here.',
    'importWallet.phrase.bip39WordList': 'Uses the standard English recovery word list.',
    'importWallet.phrase.legacyWordList': 'Uses the legacy Counterwallet/FreeWallet word list.',
    'importWallet.walletNameHelp': 'Name this imported wallet on this device.',
    'importWallet.password.fullHelp': 'Encrypts this wallet on this device.',
    'importWallet.password.hint': 'At least {count} characters.',
    'importWallet.confirmPassword': 'Confirm password',
    'importWallet.confirmPasswordHelp': 'Enter the same password again to confirm it.',
    'importWallet.passphrase.toggle': 'This wallet uses an extra passphrase',
    'importWallet.passphrase.helpBody':
        'This extra secret combines with your recovery phrase to recreate the same wallet. It stays behind your password here; hardware wallets request it on the device and connect through Pair Hardware Wallet.',
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
