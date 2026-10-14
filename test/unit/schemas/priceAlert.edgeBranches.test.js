// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { createPriceAlert } from '../../../packages/core/src/schemas/priceAlert.js';

describe('price alert creation edge branches', () => {
    it('defaults an absent fiat currency to usd', () => {
        const alert = createPriceAlert({
            walletId: 'wallet-1',
            chainId: 'bitcoin-mainnet',
            direction: 'above',
            targetFiat: 70_000,
        });

        expect(alert.fiatCurrency).toBe('usd');
    });
});
