// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// How large an airdrop's recipient LIST this wallet can sign.
//
// The airdrop publishes its recipients as one LIST v0 (`LIST|0|TYPE||...ITEM`).
// Up to the legacy 8 KB compiled ceiling that LIST rides a data carrier the
// wallet verifies byte for byte. Above it the encoder moves it into a Taproot
// envelope, and the SDK decoder the reveal check reads refuses LIST v0's
// variadic ITEM field outright (REST_FIELD_UNSUPPORTED), so the wallet cannot
// verify what it would sign and refuses it. On a chain or signer with no
// envelope the same list is refused at 8 KB anyway. So 8 KB compiled is the
// ceiling on every lane, and it is a BYTE limit: how many recipients fit
// depends on how long their addresses are (about 180 native segwit addresses,
// about 125 Taproot ones).
//
// The sizing itself is the shared variadic-action sizer, which a unit test pins
// byte-equal to the SDK's own createAction; this file keeps the airdrop's
// LIST v0 vocabulary on top of it.

import { MAX_VERIFIABLE_ACTION_BYTES, variadicActionBytes, variadicActionFit, variadicActionString } from '../flows/variadicActionSize.js';

/** The compiled size, in bytes, above which this wallet cannot sign a LIST. */
export const MAX_SIGNABLE_LIST_BYTES = MAX_VERIFIABLE_ACTION_BYTES;

const listParams = (items, type) => ({ VERSION: '0', TYPE: String(type), ITEM: items });

/**
 * The LIST v0 action string the airdrop form composes for these items.
 * The memo field stays empty: the form never sets one on the LIST leg.
 *
 * @param {string[]} items
 * @param {string} type   '1' for a token list, '2' for an address list
 * @returns {string}
 */
export function listActionString(items, type) {
    return variadicActionString('LIST', listParams(items, type));
}

/**
 * Compiled size of the LIST these items make, as the confirm lane sizes it.
 *
 * @param {string[]} items
 * @param {string} type
 * @returns {number}
 */
export function listActionBytes(items, type) {
    return variadicActionBytes('LIST', listParams(items, type));
}

/**
 * How many of these items, taken in order, fit in one signable LIST.
 *
 * @param {string[]} items
 * @param {string} type
 * @returns {number}  items.length when the whole list fits
 */
export function maxListItemsThatFit(items, type) {
    return variadicActionFit('LIST', listParams(items, type)).fit;
}

/**
 * Split items into consecutive batches that each fit one signable LIST.
 * An item too large to fit even on its own ends the split with null, since no
 * batching can carry it.
 *
 * @param {string[]} items
 * @param {string} type
 * @returns {string[][]|null}
 */
export function splitListItems(items, type) {
    const batches = [];
    let rest = items.slice();
    while (rest.length > 0) {
        const n = maxListItemsThatFit(rest, type);
        if (n === 0) return null;
        batches.push(rest.slice(0, n));
        rest = rest.slice(n);
    }
    return batches;
}
