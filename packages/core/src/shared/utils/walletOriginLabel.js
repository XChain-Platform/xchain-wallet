// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { t } from '../../i18n/index.js';

// One dictionary key per stored wallet origin (schemas/wallet.js
// WALLET_ORIGINS), so no origin ever shows as its raw stored value.
const ORIGIN_LABEL_KEYS = {
    created: 'walletDetails.originLabel.created',
    demo: 'walletDetails.originLabel.demo',
    'imported-mnemonic': 'walletDetails.originLabel.importedMnemonic',
    'imported-wif': 'walletDetails.originLabel.importedWif',
    'imported-xchain-backup': 'walletDetails.originLabel.importedBackup',
    'imported-freewallet': 'walletDetails.originLabel.importedFreewallet',
    unknown: 'walletDetails.originLabel.unknown',
};

/**
 * Readable label for a wallet's stored origin. An origin this build does not
 * know, or none at all, reads as not recorded rather than as a raw value.
 *
 * @param {string | null | undefined} origin
 * @returns {string}
 */
export function walletOriginLabel(origin) {
    const known = typeof origin === 'string' && Object.hasOwn(ORIGIN_LABEL_KEYS, origin);
    return t(known ? ORIGIN_LABEL_KEYS[origin] : ORIGIN_LABEL_KEYS.unknown);
}
