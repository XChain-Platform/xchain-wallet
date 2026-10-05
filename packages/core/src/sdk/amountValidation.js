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

export function finiteResponseAmount(value, { source, field }) {
    const amount = Number(value);
    // Refuse non-finite numbers before they enter encoder output math.
    if (!Number.isFinite(amount)) {
        throw new NonFiniteAmountError({ source, field, value });
    }
    return amount;
}
