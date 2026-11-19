// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const priceLookup = vi.hoisted(() => ({
    getTokenFiatRate: vi.fn(),
    refreshTokenFiatRate: vi.fn(),
}));

vi.mock('../../../packages/core/src/flows/priceLookup.js', () => priceLookup);

import { createTokenPriceLookup } from '../../../packages/core/src/notifications/tokenPriceLookup.js';

describe('createTokenPriceLookup', () => {
    beforeEach(() => {
        priceLookup.getTokenFiatRate.mockReset().mockReturnValue(null);
        priceLookup.refreshTokenFiatRate.mockReset().mockResolvedValue({ updated: false });
    });

    it('returns a null entry for an unpriceable token', async () => {
        const allowCoingeckoFallback = vi.fn(() => false);
        const getTokenPrices = createTokenPriceLookup({
            chainRegistry: { get: vi.fn(() => ({ coin: 'bitcoin' })) },
            allowCoingeckoFallback,
        });

        await expect(getTokenPrices({
            items: [{ chainId: 'bitcoin-mainnet', tick: 'nope' }],
            fiatCurrency: 'usd',
        })).resolves.toEqual({ prices: { 'bitcoin-mainnet::NOPE': null } });
        expect(priceLookup.refreshTokenFiatRate).toHaveBeenCalledWith({
            chainCoin: 'bitcoin',
            tick: 'NOPE',
            nativeTicker: 'BTC',
            fiatCurrency: 'USD',
            allowCoingeckoFallback: false,
        });
        expect(priceLookup.getTokenFiatRate).toHaveBeenCalledWith({
            chainCoin: 'bitcoin',
            tick: 'NOPE',
            fiatCurrency: 'USD',
        });
        expect(allowCoingeckoFallback).toHaveBeenCalledTimes(1);
    });
});
