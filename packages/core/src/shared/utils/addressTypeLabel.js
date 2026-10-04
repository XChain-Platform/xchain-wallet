// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Name each single-key address type by its family word, as MultisigBadge does for multisig.
export const ADDRESS_TYPE_LABEL = Object.freeze({
    p2pkh: 'Classic',
    'p2sh-p2wpkh': 'SegWit (compatible)',
    p2wpkh: 'SegWit',
    p2tr: 'Taproot',
});

/**
 * Plain name for a stored address type, or the upper-cased code for a type
 * with no family word yet (so a new type still shows something).
 *
 * @param {string} type   e.g. 'p2wpkh'
 * @returns {string}
 */
export function addressTypeLabel(type) {
    return ADDRESS_TYPE_LABEL[type] || String(type).toUpperCase();
}
