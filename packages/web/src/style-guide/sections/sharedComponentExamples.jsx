// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { registry as registryLib } from '@xchain-wallet/core';
import { MessagingProvider } from '@xchain-wallet/core/shared/MessagingProvider.jsx';
import { buildBalanceRows } from '@xchain-wallet/core/shared/components/BalanceList.jsx';

const RAW_BALANCES = {
    'bitcoin-mainnet': [{
        address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
        balances: {
            native: {
                tick: 'BTC',
                displayName: 'Bitcoin',
                quantity: '123456789',
                divisibility: 8,
                fiatRate: 62000,
            },
            tokens: [{
                tick: 'PEPECREATURE',
                displayName: 'Pepe creature',
                quantity: '4200000000000',
                divisibility: 8,
                fiatRate: 0.004414,
            }],
        },
    }],
    'litecoin-mainnet': [{
        address: 'ltc1qg82w3d7z4h3s4q6jh8v2c5x9n0m2ka7yp6tdgw',
        balances: {
            native: {
                tick: 'LTC',
                displayName: 'Litecoin',
                quantity: '1550000000',
                divisibility: 8,
                fiatRate: 79.64,
            },
            tokens: [],
        },
    }],
    'dogecoin-mainnet': [{
        address: 'D7Y55nwG7h3bRGW6z9pKcY8yXzW4aMNc2D',
        balances: {
            native: {
                tick: 'DOGE',
                displayName: 'Dogecoin',
                quantity: '1234567000000',
                divisibility: 8,
                fiatRate: 0.15,
            },
            tokens: [],
        },
    }],
};

export const SAMPLE_BALANCE_ROWS = Object.freeze(
    buildBalanceRows(RAW_BALANCES, registryLib.defaultRegistry()),
);

const SETTINGS = Object.freeze({
    fiatCurrency: 'USD',
    language: 'en-US',
    hiddenTokens: [],
    pinnedTokens: [],
    privacy: { metadataFetchEnabled: true, blurOnBlur: false },
});

const MESSAGING = Object.freeze({
    getSettings: async () => SETTINGS,
    getWalletBalances: async () => RAW_BALANCES,
    getNativePricesRequest: async () => ({
        prices: {
            'bitcoin-mainnet': { change24hPct: 1.5 },
            'litecoin-mainnet': { change24hPct: -0.4 },
            'dogecoin-mainnet': { change24hPct: 0.8 },
        },
    }),
});

export function SharedComponentExampleProvider({ children }) {
    return (
        <MessagingProvider shell="web" messaging={MESSAGING}>
            {children}
        </MessagingProvider>
    );
}
