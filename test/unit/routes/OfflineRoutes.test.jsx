// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const reachability = vi.hoisted(() => ({
    loading: false,
    overall: 'offline',
    perChain: [],
    refresh: vi.fn(),
    lastChecked: null,
}));

vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({
    useReachability: () => reachability,
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { ReachabilityBanner } from '../../../packages/core/src/shared/components/ReachabilityBanner.jsx';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';
import { Receive } from '../../../packages/core/src/shared/routes/Receive.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { MarketsList } from '../../../packages/core/src/shared/routes/MarketsList.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import { writeBalanceCache } from '../../../packages/core/src/shared/utils/balanceCache.js';

const CHAIN = 'bitcoin-mainnet';
const WALLET = { id: 'offline-wallet', name: 'Offline Wallet' };
const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
let savedResizeObserver;

beforeAll(() => {
    savedResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
        observe() {}
        disconnect() {}
    };
});

afterAll(() => {
    globalThis.ResizeObserver = savedResizeObserver;
});

function messagingWith(defaults) {
    return new Proxy(defaults, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            target[prop] = stub;
            return stub;
        },
    });
}

function renderOffline(messaging, route) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ToastHost>
                <ReachabilityBanner />
                {route}
            </ToastHost>
        </MessagingProvider>,
    );
}

function expectOneOfflineNotice() {
    expect(screen.getAllByText('Wallet is offline')).toHaveLength(1);
}

beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    __clearTokenInfoCache();
    delete navigator.onLine;
});

describe('offline route behavior from reachability', () => {
    it('keeps cached Home balances and blocks Send with a reason', async () => {
        // Offline, Home starts from its saved balance copy and does not ask
        // the services for fresh balances.
        const balances = {
            [CHAIN]: [{
                address: ADDRESS,
                balances: {
                    native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                    tokens: [],
                },
            }],
        };
        writeBalanceCache(WALLET.id, null, {
            balances,
            activeByChain: {},
            fetchedAt: Date.now() - 60_000,
        });
        const messaging = messagingWith({
            listWallets: vi.fn().mockResolvedValue([WALLET]),
            listAccounts: vi.fn().mockResolvedValue([]),
            getWalletBalances: vi.fn().mockResolvedValue(balances),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({}),
            getAddressesByChain: vi.fn().mockResolvedValue({}),
        });

        renderOffline(messaging, (
            <Home activeWalletId={WALLET.id} onSend={vi.fn()} onReceive={() => {}} />
        ));

        expect(await screen.findByText('BTC · Bitcoin')).toBeInTheDocument();
        expect(messaging.getWalletBalances).not.toHaveBeenCalled();
        expectOneOfflineNotice();
        const send = screen.getByRole('button', { name: 'Send' });
        expect(send).toHaveAttribute('aria-disabled', 'true');
        expect(send).toHaveAttribute('title', 'Send needs a network connection');
    });

    it('keeps cached Send inputs and disables submission with a reason', async () => {
        const messaging = messagingWith({
            getAddressesByChain: vi.fn().mockResolvedValue({
                [CHAIN]: [{ id: 'address-1', address: ADDRESS, source: 'hd' }],
            }),
            getActiveAddresses: vi.fn().mockResolvedValue({
                [CHAIN]: { id: 'address-1', address: ADDRESS },
            }),
            getAddressBalances: vi.fn().mockResolvedValue({
                native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                tokens: [],
            }),
            getSettings: vi.fn().mockResolvedValue({
                walletMode: 'full',
                activeNetwork: 'mainnet',
                grace: { testSendThresholdSats: 0 },
                privacy: { formDraftTtlMs: 0 },
            }),
            signerReady: vi.fn().mockResolvedValue({ ready: false }),
            getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
            listContacts: vi.fn().mockResolvedValue([]),
            getRecentDestinations: vi.fn().mockResolvedValue([]),
            getAddressHistory: vi.fn().mockResolvedValue([]),
            gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
        });

        renderOffline(messaging, <Send walletId={WALLET.id} onBack={() => {}} />);

        expect(await screen.findByDisplayValue(ADDRESS)).toBeInTheDocument();
        expectOneOfflineNotice();
        const send = screen.getByRole('button', { name: 'Send' });
        expect(send).toBeDisabled();
        expect(send).toHaveAttribute('title', 'Sending needs a network connection');
        expect(screen.getByText(/cached balance remains available/i)).toBeInTheDocument();
        fireEvent.submit(document.getElementById('send-form'));
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('keeps the cached Receive address and local actions available', async () => {
        const cachedAddress = {
            id: 'address-1',
            address: ADDRESS,
            addressType: 'p2wpkh',
            source: 'hd',
            derivationPath: "m/84'/0'/0'/0/0",
        };
        const messaging = messagingWith({
            getSettings: vi.fn().mockResolvedValue({
                activeNetwork: 'mainnet',
                fees: { [CHAIN]: { strategy: 'normal' } },
            }),
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [cachedAddress] }),
            getNewestAddress: vi.fn().mockResolvedValue(cachedAddress),
            getMultisigConfigs: vi.fn().mockResolvedValue([]),
            generateReceiveAddress: vi.fn().mockResolvedValue(cachedAddress),
        });

        renderOffline(messaging, <Receive walletId={WALLET.id} />);

        expect(await screen.findByDisplayValue(ADDRESS)).toBeInTheDocument();
        expectOneOfflineNotice();
        expect(screen.getByRole('button', { name: 'Generate new address' })).toBeEnabled();
    });

    it('keeps cached History rows and disables refresh with a reason', async () => {
        const messaging = messagingWith({
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: ADDRESS }] }),
            getAddressHistory: vi.fn().mockResolvedValue([{
                action: 'SEND',
                action_index: 12,
                block_index: 100,
                timestamp: Math.floor(Date.now() / 1000),
                tx_hash: 'abc123',
                details: {
                    source: ADDRESS,
                    destination: 'bc1qrecipient',
                    tick: 'BTC',
                    amount: '1.25',
                },
            }]),
            getLinksForAddress: vi.fn().mockResolvedValue([]),
            getAddressMempool: vi.fn().mockResolvedValue([]),
            getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
            getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
            getSettings: vi.fn().mockResolvedValue({}),
        });

        renderOffline(messaging, <History walletId={WALLET.id} />);

        expect(await screen.findByRole('button', { name: /Send.*Confirmed/i })).toBeInTheDocument();
        expectOneOfflineNotice();
        const refresh = screen.getByRole('button', { name: 'Refresh history' });
        expect(refresh).toBeDisabled();
        expect(refresh).toHaveAttribute('title', 'Refreshing history needs a network connection');
    });

    it('keeps cached Token Detail data and disables network actions with reasons', async () => {
        const messaging = messagingWith({
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            getTokenInfo: vi.fn().mockResolvedValue({ creator: ADDRESS }),
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
            getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
            listGatedContent: vi.fn().mockResolvedValue([]),
            getSupplyHistory: vi.fn().mockResolvedValue([]),
        });

        renderOffline(messaging, (
            <TokenDetail
                walletId={WALLET.id}
                chainId={CHAIN}
                tick="CACHE"
                kind="token"
                quantity="10"
                divisibility={0}
                onBack={() => {}}
                onSend={vi.fn()}
                onReceive={vi.fn()}
                onBuy={vi.fn()}
            />
        ));

        const balance = await screen.findByRole('region', { name: 'CACHE balance' });
        expect(balance).toHaveTextContent('10');
        expectOneOfflineNotice();
        const actions = within(screen.getByRole('group', { name: 'Quick actions' }));
        expect(actions.getByRole('button', { name: 'Send' })).toBeDisabled();
        expect(actions.getByText('Send needs a network connection.')).toBeInTheDocument();
        expect(actions.getByRole('button', { name: 'Trade' })).toBeDisabled();
        expect(actions.getByText('Trade needs a network connection.')).toBeInTheDocument();
    });

    it('keeps cached Markets rows and disables opening a market with a reason', async () => {
        const messaging = messagingWith({
            getMarkets: vi.fn().mockResolvedValue([
                { tick1: 'BTC', tick2: 'CACHE', depth: 5 },
            ]),
            listWatchlistForWallet: vi.fn().mockResolvedValue([]),
        });

        renderOffline(messaging, (
            <MarketsList
                walletId={WALLET.id}
                selectedAsset={{ chainId: CHAIN, tick: 'BTC' }}
                onChangeAsset={() => {}}
                onOpenMarket={vi.fn()}
            />
        ));

        expect(await screen.findByText('CACHE')).toBeInTheDocument();
        expectOneOfflineNotice();
        const open = screen.getByRole('button', { name: 'Open CACHE market' });
        expect(open).toBeDisabled();
        expect(open).toHaveAttribute('title', 'Opening a market needs a network connection');
    });
});
