// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit tests for the COINPAY base-unit amount guard (§41.4). The
// obligation's coin_amount becomes a native-coin output; a value past
// JS safe-integer precision (reachable for large DOGE) would be rounded
// and mispay the seller, so the flow must fail closed rather than sign a
// wrong output.

import { describe, it, expect } from 'vitest';
import { coinpayAction } from '../../../packages/core/src/flows/coinpayAction.js';

const BASE = {
    orderMatchActionIndex: '12345',
    payeeAddress: 'bc1qpayee',
};

describe('flows/coinpayAction coinAmount guard', () => {
    it('rejects a non-integer amount string (incl. scientific notation)', async () => {
        await expect(coinpayAction({ ...BASE, coinAmount: '12.5' }))
            .rejects.toThrow(/must be an integer/);
        await expect(coinpayAction({ ...BASE, coinAmount: '1e7' }))
            .rejects.toThrow(/must be an integer/);
    });

    it('rejects a zero / negative amount', async () => {
        await expect(coinpayAction({ ...BASE, coinAmount: '0' }))
            .rejects.toThrow(/positive number/);
        await expect(coinpayAction({ ...BASE, coinAmount: -5 }))
            .rejects.toThrow(/positive number/);
    });

    it('fails closed on an amount past safe-integer precision (large DOGE)', async () => {
        // 90071992547409910 koinu ~= 900,719,925 DOGE, well past
        // Number.MAX_SAFE_INTEGER; Number() would silently round it.
        await expect(coinpayAction({ ...BASE, coinAmount: '90071992547409910' }))
            .rejects.toThrow(/safe integer precision/);
        await expect(coinpayAction({ ...BASE, coinAmount: Number.MAX_SAFE_INTEGER + 2 }))
            .rejects.toThrow(/safe integer precision/);
    });

    it('accepts a valid in-range amount (proceeds past the amount guard)', async () => {
        // A valid amount clears every amount guard and only then fails on
        // the missing `from` source, proving the amount was accepted.
        await expect(coinpayAction({ ...BASE, coinAmount: '100000000' }))
            .rejects.toThrow(/from is required/);
    });
});
