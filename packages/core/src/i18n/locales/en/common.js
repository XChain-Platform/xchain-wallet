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
    'common.exitHint': 'Press Back again to exit.',
    'common.cancel': 'Cancel',
    'common.clear': 'Clear',
    'common.copy': 'Copy',
    'common.copyTransactionId': 'Copy Transaction ID',
    'common.tryAgain': 'Try Again',
    'common.openNetworkSettings': 'Open Network Settings',
    'common.done': 'Done',
    'common.loading': 'Loading…',
    'common.checking': 'Checking…',
    'common.password': 'Password',
    'common.showPassword': 'Show password',
    'common.hidePassword': 'Hide password',
    'common.showPassphrase': 'Show passphrase',
    'common.hidePassphrase': 'Hide passphrase',
    'common.confirm': 'Confirm',
    'common.typedConfirmationHint': 'Type {word} exactly in capitals with no spaces.',
    // A typed DESTROY, SWEEP or LOCK uses the plain hint above: what the
    // action does is said once, in the confirm screen's warnings card
    // (i18n/locales/en/actionWarnings.js).
    'common.typedConfirmationOracleHint':
        "This changes your published price by {deviationPct} and can't be undone for 24 hours. Type PUBLISH exactly in capitals with no spaces.",
    'common.settingsUnavailable': 'Settings unavailable.',
    'common.vaultConflict': 'This wallet changed in another window. Nothing was lost. Reload to see the latest, then try again.',
    'common.networkFeeUnavailable': 'Network fee estimate unavailable.',
    'common.notAvailable': 'Not available',
    'common.watcherBuildsUnsigned':
        'Another phone signs for this wallet: this prepares the transaction for it. Sign it there, then bring the signed transaction to a wallet that can broadcast it.',
    'common.contactName': 'Contact name',
    'common.allNetworks': 'All networks',
    'common.dispensers.selectMarket': 'Select Market',
    'common.dispensers.backToDispensers': 'Back to dispensers',
};

addEnglish(messages);

export default messages;
