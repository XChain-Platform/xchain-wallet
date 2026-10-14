// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback } from 'react';
import { registry as registryLib } from '@xchain-wallet/core';
import { coinToFiat } from '../../flows/priceLookup.js';
import { formatFiat } from '../components/BalanceList.jsx';
import { useFiatRate, useTickFiatRate } from './useFiatRate.js';

const chainRegistry = registryLib.defaultRegistry();

/**
 * Fiat formatters for the two fees an XChain action can disclose.
 * Network fees use the chain coin's rate. Protocol fees use XCHAIN's own
 * rate, so a BTC price is never applied to an XCHAIN-denominated amount.
 */
export function useFeeFiat({ chainId, chainCoin, nativeTicker, settings } = {}) {
    const fiatCurrency = settings?.fiatCurrency || 'USD';
    const allowCoingeckoFallback = settings?.privacy?.priceDataEnabled !== false;
    // The action's own chain decides: test coins have no market price even
    // when another network is active. Without a chain, the active network does.
    const networkKind = chainId ? chainRegistry.get(chainId)?.networkKind : null;
    const enabled = networkKind
        ? networkKind === 'mainnet'
        : Boolean(settings)
            && settings.activeNetwork !== 'testnet'
            && settings.activeNetwork !== 'regtest';
    const nativeRate = useFiatRate({
        chainCoin,
        fiatCurrency,
        allowCoingeckoFallback,
        enabled,
    });
    const protocolRate = useTickFiatRate({
        chainCoin,
        tick: 'XCHAIN',
        nativeTicker,
        fiatCurrency,
        allowCoingeckoFallback,
        enabled,
    });

    const formatAtRate = useCallback((amount, rate) => {
        const value = coinToFiat(amount, rate);
        if (value == null || !Number.isFinite(value) || value <= 0) return null;
        const code = String(rate?.fiatCurrency || fiatCurrency).toUpperCase();
        return `≈ ${formatFiat(value, code)} ${code}`;
    }, [fiatCurrency]);

    return {
        formatNativeFee: useCallback(
            (amount) => formatAtRate(amount, nativeRate),
            [formatAtRate, nativeRate],
        ),
        formatProtocolFee: useCallback(
            (amount) => formatAtRate(amount, protocolRate),
            [formatAtRate, protocolRate],
        ),
    };
}
