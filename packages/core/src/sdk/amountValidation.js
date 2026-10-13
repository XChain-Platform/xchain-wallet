// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

export class NonFiniteAmountError extends TypeError {
    constructor({ source, field, value }) {
        super(`${source} returned a non-finite ${field}`);
        this.name = 'NonFiniteAmountError';
        this.code = 'NON_FINITE_AMOUNT';
        this.source = source;
        this.field = field;
        this.value = value;
    }
}

export class InvalidSatsAmountError extends TypeError {
    constructor({ source, field, value }) {
        super(`${source} returned ${field} that is not a whole, non-negative satoshi amount`);
        this.name = 'InvalidSatsAmountError';
        this.code = 'INVALID_SATS_AMOUNT';
        this.source = source;
        this.field = field;
        this.value = value;
    }
}

// Read a server-quoted satoshi amount, accepting only what the encoder will accept as an output.
export function satsResponseAmount(value, { source, field }) {
    // Refuse non-finite numbers before they enter encoder output math.
    if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new NonFiniteAmountError({ source, field, value });
    }
    // Accept only a number or an all-digit string (Number() reads null, '' and ' ' as 0, a silent fee skip).
    const amount = typeof value === 'number' ? value
        : (typeof value === 'string' && /^\d+$/.test(value)) ? Number(value)
        : NaN;
    // Refuse fractional, negative or beyond-2^53 amounts, as the encoder's satoshi parser does.
    if (!Number.isSafeInteger(amount) || amount < 0) {
        throw new InvalidSatsAmountError({ source, field, value });
    }
    return amount;
}
