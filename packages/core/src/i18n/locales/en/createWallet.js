// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `createWallet.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    // Copy moved out of JSX literals by the i18n sweep.
    'createWallet.backToPreviousStep': 'Back to previous step',
    'createWallet.walletCreationStatus': 'Wallet creation status',
    'createWallet.step3Of3': 'Step 3 of 3',
    'createWallet.createWallet': 'Create wallet',
    'createWallet.walletAlreadyCreated': 'Wallet already created',
    'createWallet.staleWindowNotice': 'The recovery phrase shown in this window was not saved, because another window created a wallet. Write down nothing from this window.',
    'createWallet.verifyRecoveryPhrase': 'Verify recovery phrase',
    'createWallet.word': 'Word {p}',
    'createWallet.step2Of3': 'Step 2 of 3',
    'createWallet.copyingIsDisabledToKeep':
        'Copying is disabled to keep your recovery phrase out of shared clipboards.',
    'createWallet.iHaveSavedMyRecovery': 'I have saved my recovery phrase safely.',
    'createWallet.step1Of3': 'Step 1 of 3',
    'createWallet.atLeastCharactersUseA':
        'At least {MIN_PASSWORD_LENGTH} characters. Use a unique password; longer is stronger.',
    'createWallet.useABip39PassphraseAdvanced': 'Use a BIP39 passphrase (advanced)',
    'createWallet.thisExtraSecretCombinesWith':
        'This extra secret combines with your recovery phrase to create a different wallet and must match exactly when you restore. Hardware wallets handle it on the device.',
    'createWallet.saveThisPassphraseSeparatelyFrom':
        "Save this passphrase separately from your recovery phrase. You need both to restore this wallet. It can't be reset or recovered, and a missing or mistyped passphrase opens a different wallet without warning. Capitalization and spaces matter.",
    'createWallet.requiredWhenEnabled': 'Required when enabled.',
    'createWallet.recoveryPhraseLength': 'Recovery phrase length',
    'createWallet.xchainPlatformIsEncryptingYour':
        'XChain Platform is encrypting your wallet with your password. This can take a minute on some devices. Keep the app open.',
    'createWallet.enterTheRequestedWordsFrom':
        'Enter the requested words from the recovery phrase you wrote down.',
    'createWallet.enterTheRequestedWordsTo': 'Enter the requested words to confirm your recovery phrase.',
    'createWallet.theseWordsAreYourRecovery':
        'These {words, select, twentyFour {twenty-four} other {twelve}} words are your recovery phrase. Write them on paper and store them in a safe place. {RECOVERY_PHRASE_WARNING} You can use it to restore your wallet on a new device.',
    'createWallet.writeTheseWordsOnPaper':
        'Write these {wordCount} words on paper and store your recovery phrase safely. {RECOVERY_PHRASE_WARNING}',
    'createWallet.yourPasswordEncryptsThisWallet':
        'Your password encrypts this wallet on this device. If you forget it, you can restore the wallet with the recovery phrase shown next.',
    'createWallet.yourPasswordEncryptsThisWallet2': 'Your password encrypts this wallet on this device.',
};

addEnglish(messages);

export default messages;
