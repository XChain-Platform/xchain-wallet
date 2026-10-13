// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const { useFiatRate, useTickFiatRate } = vi.hoisted(() => ({
    useFiatRate: vi.fn(),
    useTickFiatRate: vi.fn(),
}));

vi.mock('../../../packages/core/src/shared/hooks/useFiatRate.js', () => ({
    useFiatRate,
    useTickFiatRate,
}));

const { useFeeFiat } = await import(
    '../../../packages/core/src/shared/hooks/useFeeFiat.js'
);

beforeEach(() => {
    vi.clearAllMocks();
    useFiatRate.mockReturnValue(null);
    useTickFiatRate.mockReturnValue(null);
});

describe('useFeeFiat', () => {
    it('formats native and protocol fees with their independent rates', () => {
        useFiatRate.mockReturnValue({ rate: 40_000, fiatCurrency: 'USD' });
        useTickFiatRate.mockReturnValue({ rate: 0.75, fiatCurrency: 'USD' });

        const { result } = renderHook(() => useFeeFiat({
            chainCoin: 'bitcoin',
            nativeTicker: 'BTC',
            settings: { fiatCurrency: 'USD' },
        }));

        expect(result.current.formatNativeFee('0.00025')).toBe('≈ $10.00 USD');
        expect(result.current.formatProtocolFee('2')).toBe('≈ $1.50 USD');
        expect(useFiatRate).toHaveBeenCalledWith({
            chainCoin: 'bitcoin',
            fiatCurrency: 'USD',
            allowCoingeckoFallback: true,
        });
        expect(useTickFiatRate).toHaveBeenCalledWith({
            chainCoin: 'bitcoin',
            tick: 'XCHAIN',
            nativeTicker: 'BTC',
            fiatCurrency: 'USD',
            allowCoingeckoFallback: true,
        });
    });

    it('uses updated chain, ticker, currency, and privacy settings after rerender', () => {
        const nativeRates = {
            EUR: { rate: 2, fiatCurrency: 'EUR' },
            GBP: { rate: 3, fiatCurrency: 'GBP' },
        };
        const protocolRates = {
            EUR: { rate: 4, fiatCurrency: 'EUR' },
            GBP: { rate: 5, fiatCurrency: 'GBP' },
        };
        useFiatRate.mockImplementation(({ fiatCurrency }) => nativeRates[fiatCurrency]);
        useTickFiatRate.mockImplementation(({ fiatCurrency }) => protocolRates[fiatCurrency]);
        const { result, rerender } = renderHook(
            (props) => useFeeFiat(props),
            {
                initialProps: {
                    chainCoin: 'bitcoin',
                    nativeTicker: 'BTC',
                    settings: {
                        fiatCurrency: 'EUR',
                        privacy: { priceDataEnabled: false },
                    },
                },
            },
        );

        expect(result.current.formatNativeFee('2')).toBe('≈ €4.00 EUR');
        expect(result.current.formatProtocolFee('2')).toBe('≈ €8.00 EUR');

        rerender({
            chainCoin: 'litecoin',
            nativeTicker: 'LTC',
            settings: {
                fiatCurrency: 'GBP',
                privacy: { priceDataEnabled: true },
            },
        });

        expect(result.current.formatNativeFee('2')).toBe('≈ £6.00 GBP');
        expect(result.current.formatProtocolFee('2')).toBe('≈ £10.00 GBP');
        expect(useFiatRate).toHaveBeenLastCalledWith({
            chainCoin: 'litecoin',
            fiatCurrency: 'GBP',
            allowCoingeckoFallback: true,
        });
        expect(useTickFiatRate).toHaveBeenLastCalledWith({
            chainCoin: 'litecoin',
            tick: 'XCHAIN',
            nativeTicker: 'LTC',
            fiatCurrency: 'GBP',
            allowCoingeckoFallback: true,
        });
    });

    it('returns null when a rate or a positive finite value is unavailable', () => {
        const { result, rerender } = renderHook(
            ({ rate }) => {
                useFiatRate.mockReturnValue(rate);
                useTickFiatRate.mockReturnValue(rate);
                return useFeeFiat();
            },
            { initialProps: { rate: null } },
        );

        expect(result.current.formatNativeFee('1')).toBeNull();

        rerender({ rate: { rate: 2, fiatCurrency: 'USD' } });
        expect(result.current.formatNativeFee('0')).toBeNull();
        expect(result.current.formatProtocolFee('-1')).toBeNull();
        expect(result.current.formatProtocolFee('not-a-number')).toBeNull();
    });
});
