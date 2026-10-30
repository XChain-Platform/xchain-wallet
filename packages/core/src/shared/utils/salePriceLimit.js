// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Limits on the price of a name sale that the form can judge before
// composing. A price the network refuses spends the fees for nothing, and a
// token price above that token's maximum supply is a sale no buyer can take.

import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/manageToken.js';
import { compareDecimalStrings } from './amountFormat.js';

// The ledger stores amounts as DECIMAL(60,18), so the network refuses an
// amount with more integer digits than that leaves room for.
export const MAX_PRICE_INTEGER_DIGITS = 42;

/**
 * The refusal for a sale price past these limits, or null.
 *
 * @param {string} price              a plain decimal the form already accepted
 * @param {object} [opts]
 * @param {string | null} [opts.supplyCap]   the price token's maximum supply; omitted for a coin price
 * @param {string} [opts.tick]               the price token
 * @returns {string | null}
 */
export function salePriceLimitError(price, { supplyCap = null, tick = '' } = {}) {
    const text = String(price ?? '').trim();
    if (text.split('.')[0].replace(/^0+(?=[0-9])/, '').length > MAX_PRICE_INTEGER_DIGITS) {
        return t('manageToken.sellName.priceTooLarge', { digits: MAX_PRICE_INTEGER_DIGITS });
    }
    const cap = String(supplyCap ?? '').trim();
    if (compareDecimalStrings(cap, '0') === 1 && compareDecimalStrings(text, cap) === 1) {
        return t('manageToken.sellName.priceAboveSupply', { supply: cap, tick: String(tick || '').trim() });
    }
    return null;
}
