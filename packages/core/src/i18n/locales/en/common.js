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
    'common.settingsUnavailable': 'Settings unavailable.',
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
