// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `locked.*` keys, loaded at startup by i18n/index.js.

import { addEnglish } from '../../store.js';

const messages = {
    // Copy moved out of JSX literals by the i18n sweep.
    'locked.saveWalletPassphrase': 'Save wallet passphrase',
    'locked.unlockWallet': 'Unlock wallet',
    'locked.tooManyIncorrectPasswordsOn': 'Too many incorrect passwords on this device. Wait',
    'locked.beforeTryingAgain': 'before trying again.',
    'locked.autoLockUnsaved': "The wallet locked because its auto-lock timer couldn't be saved.",
    'locked.unlockingYourWalletSecurelyThis': 'Unlocking your wallet securely. This may take a moment.',
    'locked.unlockWallet2': 'Unlock Wallet',
    'locked.enterYourPassword': 'Enter your wallet password.',
    'locked.enterThePassphrase': 'Enter the passphrase.',
    'locked.passwordHelp':
        "The password you set for this wallet on this device. It only unlocks the wallet here and isn't used to restore it.",
    'locked.useBiometrics': 'Use Biometrics',
    'locked.thisIsADemoWallet': 'This is a demo wallet.',
    'locked.forgotPassword': 'Forgot Password?',
    // Forgot Password (operator ruling 2026-11-16): reset with a recovery
    // phrase, restore from a checked backup file, or erase after 48 hours.
    'locked.forgot.introTitle': 'Recovery Options',
    'locked.forgot.intro': 'Choose how to get back into your wallet. A matching phrase or backup can restore access now. Other erases wait 48 hours.',
    'locked.forgot.checking': 'Checking what this device can do…',
    'locked.forgot.typeWipe': 'Type WIPE exactly to continue.',
    'locked.forgot.eraseFailed': "Couldn't erase wallet data. Close and reopen the app, then try again.",
    'locked.forgot.phrase.title': 'Reset with Recovery Phrase',
    'locked.forgot.phrase.pageTitle': 'Reset Password',
    'locked.forgot.phrase.rowDescription': 'Type the recovery phrase of any wallet on this device and choose a new password. Nothing is erased.',
    'locked.forgot.phrase.introTitle': 'Keep Wallet Data',
    'locked.forgot.phrase.intro': 'Your wallets, imported keys and contacts stay as they are. Only the password changes.',
    'locked.forgot.phrase.label': 'Recovery Phrase',
    'locked.forgot.phrase.help': 'The 12 or 24 words of any wallet on this device, in order, separated by spaces.',
    'locked.forgot.phrase.newPassword': 'New Password',
    'locked.forgot.phrase.newPasswordHelp': 'At least 8 characters. It unlocks the wallet on this device from now on.',
    'locked.forgot.phrase.confirmPassword': 'Confirm New Password',
    'locked.forgot.phrase.confirmPasswordHelp': "Type the new password again so a typo can't lock you out.",
    'locked.forgot.phrase.submit': 'Reset Password',
    'locked.forgot.phrase.required': 'Enter the recovery phrase.',
    'locked.forgot.phrase.passwordTooShort': 'Use at least 8 characters.',
    'locked.forgot.phrase.passwordMismatch': "The two passwords don't match.",
    'locked.forgot.phrase.mismatch': "That recovery phrase doesn't match any wallet on this device. Check each word and try again.",
    'locked.forgot.phrase.stale': 'The phrase matched, but this device\'s reset data is out of date. Restore from a backup file or a recovery phrase instead.',
    'locked.forgot.phrase.unavailable': "This device can't reset the password with a recovery phrase.",
    'locked.forgot.phrase.failed': "Couldn't reset the password. Close and reopen the app, then try again.",
    'locked.forgot.phrase.doneTitle': 'Password Reset',
    'locked.forgot.phrase.doneBody': 'Your password was reset and every wallet is unlocked. Use the new password from now on.',
    'locked.forgot.phrase.doneSkipped':
        'Your password was reset. {count, plural, one {# wallet uses} other {# wallets use}} a different password and kept it.',
    'locked.forgot.backup.title': 'Restore from Backup File',
    'locked.forgot.backup.pageTitle': 'Restore Backup',
    'locked.forgot.backup.rowDescription': 'A backup from this wallet can restore now. A different wallet waits 48 hours.',
    'locked.forgot.backup.introTitle': 'Check Backup First',
    'locked.forgot.backup.intro': 'Choose the backup file and type its password. Nothing is erased unless the file opens.',
    'locked.forgot.backup.fileLabel': 'Backup File',
    'locked.forgot.backup.fileHelp': 'The encrypted backup file saved from this wallet.',
    'locked.forgot.backup.choose': 'Choose Backup File',
    'locked.forgot.backup.password': 'Backup File Password',
    'locked.forgot.backup.passwordHelp': 'The password you chose when you saved this backup file.',
    'locked.forgot.backup.walletPassword': 'Wallet Password',
    'locked.forgot.backup.walletPasswordHelp': 'The password this wallet used on the device it was backed up from.',
    'locked.forgot.backup.check': 'Check Backup File',
    'locked.forgot.backup.noFile': 'Choose the backup file to check.',
    'locked.forgot.backup.unreadable': "That file couldn't be read. Choose it again.",
    'locked.forgot.backup.passwordRequired': 'Enter the backup file password.',
    'locked.forgot.backup.walletPasswordRequired': 'Enter the password of the wallet inside the file.',
    'locked.forgot.backup.wrongPassword': "That isn't this backup file's password.",
    'locked.forgot.backup.walletPasswordNeeded': 'The file opened, but the wallet inside has its own password. Enter it here.',
    'locked.forgot.backup.wrongWalletPassword': "That isn't the wallet's password.",
    'locked.forgot.backup.notBackup': "That file isn't a wallet backup.",
    'locked.forgot.backup.damaged': 'That backup file is damaged, so no password can open it. Choose a different file.',
    'locked.forgot.backup.failed': "Couldn't check the backup file. Try again.",
    'locked.forgot.backup.unavailable': "Checking a backup file isn't available here.",
    'locked.forgot.backup.verifiedTitle': 'Backup File Checked',
    'locked.forgot.backup.verified': 'The file and its password open the wallet inside.',
    'locked.forgot.backup.verifiedNamed': 'The file and its password open {name}.',
    'locked.forgot.backup.eraseBody':
        "Every wallet on this device is erased, then the backup restore opens. Choose the same file there and type its password again. Funds on the blockchain aren't affected.",
    'locked.forgot.backup.foreignBody': 'This backup is from a different wallet. Erasing this device waits 48 hours.',
    'locked.forgot.backup.eraseAndRestore': 'Erase and Restore',
    'locked.forgot.erase.title': 'Erase Everything',
    'locked.forgot.erase.rowDescription': 'Erase every wallet on this device after a 48-hour wait.',
    'locked.forgot.erase.warningTitle': 'Erases Every Wallet on This Device',
    'locked.forgot.erase.warningBody':
        'This removes every wallet, imported private key, contact and queued transaction on this device. Imported private keys are gone for good unless you have a backup file. The erase waits 48 hours: the lock screen shows the time left, and unlocking stops it.',
    'locked.forgot.erase.submit': 'Schedule Erase',
    'locked.forgot.erase.deviceAuthFailed': 'Confirm with your device to schedule the erase.',
    'locked.forgot.erase.scheduleFailed': "Couldn't schedule the erase on this device. Try again.",
    'locked.erase.scheduledTitle': 'Erase Scheduled',
    'locked.erase.scheduledBody': 'Every wallet on this device is erased in {time}. Unlock to cancel it.',
    'locked.erase.dueBody': 'The erase is due. It runs the next time the app opens unless you unlock first.',
    'locked.erase.running': 'Erasing every wallet on this device…',
    'locked.erase.cancel': 'Cancel Erase',
    'locked.erase.cancelAndUnlock': 'Cancel Erase and Unlock',
    'locked.erase.cancelledTitle': 'Erase Cancelled',
    'locked.erase.cancelledBody': 'The scheduled erase was cancelled because you unlocked the wallet.',
    'locked.erase.cancelFailedTitle': 'Erase Still Scheduled',
    'locked.erase.cancelFailedBody':
        "This unlock couldn't cancel the scheduled erase. Cancel it from the notice at the top of the wallet.",
    // Unlocked-app notice for an erase scheduled from a lock screen (another tab on web).
    'locked.erase.unlockedTitle': 'An erase of this wallet was scheduled from the lock screen',
    'locked.erase.unlockedBody': 'Every wallet on this device is erased in {time} unless you cancel it.',
    'locked.erase.unlockedDueBody': 'The erase is due and runs the next time the app opens unless you cancel it.',
    'locked.erase.cancelFailed': "Couldn't cancel the erase on this device. Try again.",
    'locked.restoreWalletAccess': 'Ways back into your wallet',
    'locked.walletUsername': 'Wallet username',
    'locked.usesAPassphrase': 'uses a passphrase.',
    'locked.enterItOnceToFinish':
        "Enter it once to finish setting up this device. It will be stored on this device, protected by your wallet password, so you aren't asked again.",
    'locked.passphrase': 'Passphrase',
    'locked.passphraseHelp': 'The extra passphrase this wallet was set up with, typed exactly, capitals and spaces included. It opens the addresses that belong to this wallet.',
    'locked.countdown.seconds': '{count, plural, one {# second} other {# seconds}}',
    'locked.countdown.minutes': '{count, plural, one {# minute} other {# minutes}}',
    'locked.countdown.hours': '{count, plural, one {# hour} other {# hours}}',
    'locked.countdown.pair': '{first} {second}',
    // PC-16 Phase B: auto pay keeps paying armed orders while locked.
    'locked.autopay.on': 'Auto pay is on for {count, plural, one {# order} other {# orders}}, up to {cap}.',
    'locked.autopay.onNoOrders': 'Auto pay is on. No armed order has anything left to pay.',
    'locked.autopay.stop': 'Stop',
    'locked.autopay.stopAria': 'Stop auto pay',
    'locked.autopay.stopFailed': "Auto pay couldn't be stopped. Try again.",
    'locked.thisPermanentlyDeletesEveryWallet2':
        "This permanently deletes every wallet saved in this app on this device, including its recovery information, accounts, addresses, and queued transactions. Make sure you have every recovery phrase or backup file you need. This can't be undone.",
};

addEnglish(messages);

export default messages;
