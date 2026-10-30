// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MessagingProvider } from '@xchain-wallet/core/shared/MessagingProvider.jsx';

// A fixed wallet, address book and balance set so the screen parts that read
// the messaging layer render the same way on every visit to the guide.
export const PART_WALLET_ID = 'wallet-example';
export const PART_ACCOUNT_ID = 'account-example';
export const PART_CHAIN_ID = 'bitcoin-mainnet';
export const PART_ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
export const PART_ADDRESS_TWO = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

const WALLETS = Object.freeze([{ id: PART_WALLET_ID, name: 'Everyday wallet' }]);
const ADDRESS_RECORDS = Object.freeze({
    [PART_CHAIN_ID]: [
        { address: PART_ADDRESS, label: 'Spending', source: 'software', accountId: PART_ACCOUNT_ID, walletId: PART_WALLET_ID, chainId: PART_CHAIN_ID },
        { address: PART_ADDRESS_TWO, label: 'Savings', source: 'software', accountId: PART_ACCOUNT_ID, walletId: PART_WALLET_ID, chainId: PART_CHAIN_ID },
    ],
});

// Unlisted methods resolve to an empty value, so a part that asks for more
// than the guide supplies shows its empty state instead of throwing.
const KNOWN = {
    getSettings: async () => ({ fiatCurrency: 'USD', language: 'en-US', hiddenTokens: [], pinnedTokens: [], privacy: { metadataFetchEnabled: true, blurOnBlur: false } }),
    listWallets: async () => WALLETS,
    getAddressesByChain: async () => ADDRESS_RECORDS,
    getWalletBalances: async () => ({}),
    // Absent on purpose: Home reads prices only when the method exists, and
    // the guide never asks a price service for anything.
    getNativePricesRequest: undefined,
    getListsForSource: async () => ({ lists: [] }),
};
const MESSAGING = new Proxy(KNOWN, {
    get(target, key) {
        if (key in target) return target[key];
        if (typeof key !== 'string' || key === 'then') return undefined;
        return async () => ({});
    },
});

export function PartsExampleProvider({ children }) {
    return (
        <MessagingProvider shell="web" messaging={MESSAGING}>
            {children}
        </MessagingProvider>
    );
}
