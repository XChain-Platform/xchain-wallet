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
    'locked.beforeTryingAgainChangingNetworks': "before trying again. Changing networks won't skip the wait.",
    'locked.unlockingYourWalletSecurelyThis': 'Unlocking your wallet securely. This may take a moment.',
    'locked.unlockWallet2': 'Unlock Wallet',
    'locked.useBiometrics': 'Use biometrics',
    'locked.thisIsADemoWallet':
        'This is a demo wallet. Its password is randomly generated and not recoverable. Starting over deletes every wallet saved in this app on this device and returns you to onboarding.',
    'locked.forgotPassword': 'Forgot password?',
    'locked.restoreWalletAccess': 'Restore wallet access',
    'locked.yourPasswordCannotBeRecovered': "Your password can't be recovered or reset.",
    'locked.youCanRestoreTheWallet':
        'You can restore the wallet and choose a new password using its recovery phrase or an encrypted backup file.',
    'locked.useRecoveryPhrase': 'Use recovery phrase',
    'locked.useBackupFile': 'Use backup file',
    'locked.thisPermanentlyDeletesEveryWallet':
        'This permanently deletes every wallet saved in this app on this device, including its recovery information, accounts, addresses, and queued transactions.',
    'locked.fundsOnTheBlockchainAre': 'Funds on the blockchain are unaffected. Continue only if you have the',
    'locked.encryptedBackupFile': 'encrypted backup file',
    'locked.recoveryPhrase': 'recovery phrase',
    'locked.forEveryWalletYouNeed': 'for every wallet you need. After erasing this vault, the app opens the',
    'locked.backupFileRestore': 'backup-file restore',
    'locked.recoveryPhraseRestore': 'recovery-phrase restore',
    'locked.form': 'form.',
    'locked.eraseVaultAndRestore': 'Erase vault and restore',
    'locked.walletUsername': 'Wallet username',
    'locked.usesAPassphrase': 'uses a passphrase.',
    'locked.enterItOnceToFinish':
        "Enter it once to finish setting up this device. It will be stored on this device, protected by your wallet password, so you aren't asked again.",
    'locked.passphrase': 'Passphrase',
    'locked.countdown.seconds': '{count, plural, one {# second} other {# seconds}}',
    'locked.countdown.minutes': '{count, plural, one {# minute} other {# minutes}}',
    'locked.countdown.hours': '{count, plural, one {# hour} other {# hours}}',
    'locked.countdown.pair': '{first} {second}',
    'locked.thisPermanentlyDeletesEveryWallet2':
        "This permanently deletes every wallet saved in this app on this device, including its recovery information, accounts, addresses, and queued transactions. Make sure you have every recovery phrase or backup file you need. This can't be undone.",
};

addEnglish(messages);

export default messages;
