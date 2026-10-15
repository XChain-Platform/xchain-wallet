// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { clearDemoWalletId, markDemoWallet } from '../../../packages/core/src/flows/demoMode.js';
import { restoreLabelSyncAfterImport } from '../../../packages/core/src/flows/labelSync.js';
import { tokenInfoFor } from '../../../packages/core/src/flows/tokenInfo.js';
import { DispensersList } from '../../../packages/core/src/shared/routes/DispensersList.jsx';
import { MyOrdersView } from '../../../packages/core/src/shared/routes/MyOrdersView.jsx';
import { MySwapsView } from '../../../packages/core/src/shared/routes/MySwapsView.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';

const WALLET = 'demo-offline-wallet';
const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'demo-address',
    address: 'bc1qdemoownerownerownerownerownerownerowne',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};

function provider(messaging, child) {
    return <MessagingProvider shell="web" messaging={messaging}>{child}</MessagingProvider>;
}

function offlineMessaging() {
    const networkReads = [];
    const network = (name, value = {}) => vi.fn(async () => {
        networkReads.push(name);
        return value;
    });
    return {
        networkReads,
        messaging: {
            getAddressesByChain: vi.fn(async () => ({ [CHAIN]: [ADDRESS] })),
            getActiveAddresses: vi.fn(async () => ({ [CHAIN]: ADDRESS })),
            getSettings: vi.fn(async () => ({
                walletMode: 'full',
                activeNetwork: 'mainnet',
                privacy: { formDraftTtlMs: 0 },
            })),
            listContacts: vi.fn(async () => []),
            signerReady: vi.fn(async () => ({ ready: true })),
            getSignerStatus: vi.fn(async () => ({ status: 'unlocked' })),
            getOrdersForAddress: network('orders'),
            getOrderCancelsForAddress: network('order cancels'),
            getOrderDetail: network('order detail'),
            listAutopayOrders: network('autopay'),
            getSwapsForAddress: network('swaps'),
            getSwapCancelsForAddress: network('swap cancels'),
            getSwapDetail: network('swap detail'),
            getDispensersForSource: network('dispensers'),
            oracleFeeds: network('oracle feeds'),
            getChainTipBlockTime: network('chain time'),
            getNativePricesRequest: network('prices'),
            getAddressHistory: network('history'),
            getAddressBalances: network('balances'),
            getWalletBalances: network('wallet balances'),
            getAddressUtxos: network('utxos'),
            gatedSendReadiness: network('gated files'),
            estimateFee: network('fee estimate'),
            getSupplyHistory: network('supply history'),
            getHoldersForToken: network('holders'),
            listGatedContent: network('file list'),
            checkReachabilityRequest: network('reachability'),
            composeForConfirm: network('encoder'),
        },
    };
}

afterEach(() => {
    cleanup();
    clearDemoWalletId();
    vi.unstubAllGlobals();
});

describe('demo session offline boundary', () => {
    it('keeps owner lists, token detail, and Send off network messaging', async () => {
        markDemoWallet(WALLET);
        const { messaging, networkReads } = offlineMessaging();
        vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network called'))));
        vi.stubGlobal('ResizeObserver', class {
            observe() {}
            disconnect() {}
        });

        render(provider(messaging, <MyOrdersView walletId={WALLET} onBack={() => {}} />));
        expect(await screen.findByText('No orders yet')).toBeInTheDocument();
        cleanup();

        render(provider(messaging, <MySwapsView walletId={WALLET} onBack={() => {}} />));
        expect(await screen.findByText('No swaps yet')).toBeInTheDocument();
        cleanup();

        render(provider(messaging, (
            <DispensersList walletId={WALLET} onOpenDispenser={() => {}} onBack={() => {}} />
        )));
        expect(await screen.findByText('EXAMPLE')).toBeInTheDocument();
        cleanup();

        render(provider(messaging, (
            <TokenDetail
                walletId={WALLET}
                chainId={CHAIN}
                tick="BTC"
                kind="native"
                quantity="100000000"
                onBack={() => {}}
            />
        )));
        expect(await screen.findByRole('heading', { name: 'BTC' })).toBeInTheDocument();
        cleanup();

        render(provider(messaging, <Send walletId={WALLET} onBack={() => {}} />));
        expect(await screen.findByText(
            "Demo wallets can't move funds. Create a real wallet to send.",
        )).toBeInTheDocument();

        await waitFor(() => expect(networkReads).toEqual([]));
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('normalizes bundled demo metadata without explorer or URL reads', async () => {
        const sdk = {
            getToken: vi.fn(),
            getGatedFileRaw: vi.fn(),
            fileRawUrl: vi.fn(),
        };
        const fetch = vi.fn();
        const info = await tokenInfoFor({
            sdkRegistry: { get: vi.fn(() => sdk) },
            chainId: CHAIN,
            tick: 'EXAMPLE',
            demo: true,
            metadataFetchEnabled: true,
            fetch,
        });

        expect(info.name).toBeTruthy();
        expect(fetch).not.toHaveBeenCalled();
        expect(sdk.getToken).not.toHaveBeenCalled();
        expect(sdk.getGatedFileRaw).not.toHaveBeenCalled();
        expect(sdk.fileRawUrl).not.toHaveBeenCalled();
    });

    it('skips label-sync file discovery for a demo wallet', async () => {
        const sdk = { getFiles: vi.fn(), getGatedFileRaw: vi.fn() };
        const result = await restoreLabelSyncAfterImport({
            vault: { wallets: { get: vi.fn(async () => ({ id: WALLET, origin: 'demo', format: 'bip39' })) } },
            walletId: WALLET,
            password: 'throwaway-demo-password',
            chainIds: ['bitcoin-mainnet', 'bitcoin-testnet'],
            sdkRegistry: { get: vi.fn(() => sdk) },
        });

        expect(result.skipped).toBe('demo');
        expect(result.searchedChainIds).toEqual([]);
        expect(sdk.getFiles).not.toHaveBeenCalled();
        expect(sdk.getGatedFileRaw).not.toHaveBeenCalled();
    });
});
