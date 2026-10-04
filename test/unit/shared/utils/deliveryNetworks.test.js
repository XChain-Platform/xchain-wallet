// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it, vi } from 'vitest';
import { buildDeliveryNetworkOptions } from '../../../../packages/core/src/shared/utils/deliveryNetworks.js';

describe('buildDeliveryNetworkOptions', () => {
    it('sorts the supported delivery networks and labels their tradeoffs', () => {
        const coins = {
            'dogecoin-mainnet': 'dogecoin',
            'bitcoin-mainnet': 'bitcoin',
            'litecoin-mainnet': 'litecoin',
        };
        const chainRegistry = { get: (id) => ({ coin: coins[id] }) };
        const chainIconSmallUrl = vi.fn((id) => `/icons/${id}.svg`);
        const renderIcon = vi.fn((url) => ({ image: url }));

        const options = buildDeliveryNetworkOptions({
            addressesByChain: {
                'dogecoin-mainnet': ['D-address'],
                'bitcoin-mainnet': ['bc1-address'],
                'litecoin-mainnet': ['ltc1-address'],
            },
            chainRegistry,
            chainIconSmallUrl,
            renderIcon,
        });

        expect(options.map(({ value, label }) => ({ value, label }))).toEqual([
            { value: 'bitcoin-mainnet', label: 'Bitcoin (slowest + strongest)' },
            { value: 'litecoin-mainnet', label: 'Litecoin (faster + cheaper)' },
            { value: 'dogecoin-mainnet', label: 'Dogecoin (fastest + cheapest)' },
        ]);
        expect(options.map(({ icon }) => icon)).toEqual([
            { image: '/icons/bitcoin-mainnet.svg' },
            { image: '/icons/litecoin-mainnet.svg' },
            { image: '/icons/dogecoin-mainnet.svg' },
        ]);
    });

    it('skips unknown chains and leaves an unconfigured coin name bare', () => {
        const coins = { 'monero-mainnet': 'monero' };
        const chainRegistry = { get: (id) => coins[id] ? { coin: coins[id] } : undefined };
        const chainIconSmallUrl = vi.fn(() => null);
        const renderIcon = vi.fn((url) => ({ image: url }));

        const options = buildDeliveryNetworkOptions({
            addressesByChain: { 'unknown-mainnet': [], 'monero-mainnet': [] },
            chainRegistry,
            chainIconSmallUrl,
            renderIcon,
        });

        expect(options).toEqual([{
            value: 'monero-mainnet',
            coin: 'monero',
            label: 'monero',
            icon: null,
        }]);
        expect(chainIconSmallUrl).toHaveBeenCalledOnce();
        expect(renderIcon).not.toHaveBeenCalled();
    });

    it('returns no options when addressesByChain is undefined', () => {
        const chainRegistry = { get: vi.fn((id) => ({ coin: id })) };
        const chainIconSmallUrl = vi.fn((id) => `/icons/${id}.svg`);
        const renderIcon = vi.fn((url) => ({ image: url }));

        expect(buildDeliveryNetworkOptions({
            addressesByChain: undefined,
            chainRegistry,
            chainIconSmallUrl,
            renderIcon,
        })).toEqual([]);
        expect(chainRegistry.get).not.toHaveBeenCalled();
    });
});
