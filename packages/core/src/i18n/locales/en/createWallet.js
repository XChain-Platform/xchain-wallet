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
    'createWallet.createWallet': 'Create Wallet',
    'createWallet.walletAlreadyCreated': 'Wallet already created',
    'createWallet.staleWindowNotice': 'The recovery phrase shown in this window was not saved, because another window created a wallet. Write down nothing from this window.',
    'createWallet.verifyRecoveryPhrase': 'Verify Recovery Phrase',
    'createWallet.word': 'Word {p}',
    'createWallet.wordHelp': 'Word number {p} of the recovery phrase you just wrote down, typed exactly as written.',
    'createWallet.step2Of3': 'Step 2 of 3',
    'createWallet.copyingIsDisabledToKeep':
        'Copying is disabled to keep your recovery phrase out of shared clipboards.',
    'createWallet.iHaveSavedMyRecovery': 'I have saved my recovery phrase safely.',
    'createWallet.revealPhraseFirst': 'Reveal your recovery phrase and write it down first.',
    'createWallet.tickSavedFirst': 'Write the recovery phrase down, then tick "I have saved my recovery phrase safely."',
    'createWallet.savedPhraseHelp': 'Confirms that the recovery phrase is written down somewhere safe. Next you type back a few of its words to prove it.',
    'createWallet.step1Of3': 'Step 1 of 3',
    'createWallet.walletNameHelp': 'The name this wallet shows under on this device. You can rename it later.',
    'createWallet.passwordAdvice':
        'Your password encrypts this wallet on this device. If you forget it, you can restore the wallet with the recovery phrase shown next. At least {MIN_PASSWORD_LENGTH} characters; use a unique password, and longer is stronger.',
    'createWallet.confirmPasswordHelp': 'Type the same password again so a typo never locks you out.',
    'createWallet.recoveryPhraseLengthHelp':
        'How many words your recovery phrase has. Both are secure; 12 words are quicker to write down and check.',
    'createWallet.confirmPassphraseHelp': 'Type the extra passphrase again. It must match exactly, capitals and spaces included.',
    'createWallet.useABip39PassphraseAdvanced': 'Use an extra passphrase',
    'createWallet.extraPassphraseTitle': 'Extra Passphrase',
    'createWallet.extraPassphraseOn': 'On',
    'createWallet.extraPassphraseOff': 'Off',
    'createWallet.thisExtraSecretCombinesWith':
        'This extra secret combines with your recovery phrase to create a different wallet and must match exactly when you restore. Hardware wallets handle it on the device.',
    'createWallet.saveThisPassphraseSeparatelyFrom':
        "Save this passphrase separately from your recovery phrase. You need both to restore this wallet. It can't be reset or recovered, and a missing or mistyped passphrase opens a different wallet without warning. Capitalization and spaces matter.",
    'createWallet.requiredWhenEnabled': 'Required when enabled.',
    'createWallet.recoveryPhraseLength': 'Recovery phrase length',
    'createWallet.xchainPlatformIsEncryptingYour':
        'XChain Platform is encrypting your wallet with your password. This can take a minute on some devices. Keep the app open.',
    'createWallet.showRecoveryPhraseTitle': 'Show Recovery Phrase',
    'createWallet.showRecoveryPhrasePasswordHelp':
        'The password that unlocks this wallet on this device. Enter it, then press Reveal; the recovery phrase shows only after it checks out.',
    'createWallet.recoveryPhraseScreenShare':
        'If you are screen-sharing or recording, stop now.',
    'createWallet.recoveryPhraseNotice':
        'Write these words down, keep them offline, and never share them with anyone.',
    'createWallet.enterTheExtraPassphraseOrUncheck':
        'Enter the extra passphrase, or uncheck the box to create a wallet without one.',
    'createWallet.extraPassphrasesDoNotMatch': "Extra passphrases don't match.",
};

addEnglish(messages);

export default messages;
