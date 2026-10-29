// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `common.*` keys, loaded at startup by i18n/index.js.

import { addEnglish } from '../../store.js';

const messages = {
    // --- common ---------------------------------------------------
    'common.back': 'Back',
    'common.backToHome': 'Back to home',
    'common.exitHint': 'Press Back again to exit.',
    'common.cancel': 'Cancel',
    'common.clear': 'Clear',
    'common.copy': 'Copy',
    'common.copyTransactionId': 'Copy transaction ID',
    'common.tryAgain': 'Try again',
    'common.openNetworkSettings': 'Open network settings',
    'common.done': 'Done',
    'common.loading': 'Loading…',
    'common.password': 'Password',
    'common.showPassword': 'Show password',
    'common.hidePassword': 'Hide password',
    'common.showPassphrase': 'Show passphrase',
    'common.hidePassphrase': 'Hide passphrase',
    'common.confirm': 'Confirm',
    'common.typedConfirmationHint': 'Type {word} exactly in capitals with no spaces.',
    'common.typedConfirmationAdvancedHint': 'This cannot be undone. Type {word} exactly in capitals with no spaces.',
    'common.typedConfirmationCallbackHint':
        'This recalls every unit of the token from all holders and pays them the amount above. It cannot be undone. Type CALLBACK exactly in capitals with no spaces.',
    'common.typedConfirmationCallbackReviewHint':
        'Recalls all supply and pays holders. Irreversible. Type CALLBACK exactly in capitals with no spaces.',
    'common.typedConfirmationDestroyHint':
        'This burns the amount above and cannot be undone. Type DESTROY exactly in capitals with no spaces.',
    'common.typedConfirmationDestroyReviewHint':
        'Destroying tokens is irreversible. Type DESTROY exactly in capitals with no spaces.',
    'common.typedConfirmationListShareHint':
        'Sharing is permanent and cannot be undone. Type SHARE exactly in capitals with no spaces.',
    'common.typedConfirmationListTransferHint':
        'List ownership changes permanently when this transaction confirms. Type TRANSFER exactly in capitals with no spaces.',
    'common.typedConfirmationListTransferReviewHint':
        'Ownership transfer is permanent. Type TRANSFER exactly in capitals with no spaces.',
    'common.typedConfirmationOracleHint':
        'This changes your published price by {deviationPct} and cannot be undone for 24 hours. Type PUBLISH exactly in capitals with no spaces.',
    'common.typedConfirmationSleepHint':
        'This pauses XChain actions from your address and cannot be undone before the wake block. Type LOCK exactly in capitals with no spaces.',
    'common.typedConfirmationSweepHint':
        'Everything in the selected categories moves to the destination, including anything the preview did not list. Type SWEEP exactly in capitals with no spaces.',
    'common.typedConfirmationSweepReviewHint':
        'Everything in the selected categories moves, including anything not listed in the preview. Type SWEEP exactly in capitals with no spaces.',
    'common.typedConfirmationLockBelowHint':
        'Locking is permanent. Every flag checked below can never be unlocked. Type LOCK exactly in capitals with no spaces.',
    'common.typedConfirmationLockAboveHint':
        'Locking is permanent. Every flag checked above can never be unlocked. Type LOCK exactly in capitals with no spaces.',
    'common.settingsUnavailable': 'Settings unavailable.',
    'common.vaultConflict': 'This wallet changed in another window. Nothing was lost. Reload to see the latest, then try again.',
    'common.edit': 'Edit',
    'common.estimateUnavailable': 'Estimate unavailable',
    'common.networkFeeUnavailable': 'Network fee estimate unavailable.',
    'common.notAvailable': 'Not available',
    'common.preview': 'Preview',
    'common.review': 'Review',
    'common.watcherBuildsUnsigned':
        'Watcher mode: this wallet builds an unsigned transaction. Sign it with your signer wallet, then bring the signed transaction to a wallet that can broadcast it.',
    'common.contactName': 'Contact name',
    'common.allNetworks': 'All networks',
};

addEnglish(messages);

export default messages;
