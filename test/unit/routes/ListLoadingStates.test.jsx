// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ContactsList } from '../../../packages/core/src/shared/routes/ContactsList.jsx';
import { ContractsList } from '../../../packages/core/src/shared/routes/ContractsList.jsx';
import { DispensersList } from '../../../packages/core/src/shared/routes/DispensersList.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';
import { MarketsList } from '../../../packages/core/src/shared/routes/MarketsList.jsx';
import { MessagingInbox } from '../../../packages/core/src/shared/routes/MessagingInbox.jsx';
import { MyLists } from '../../../packages/core/src/shared/routes/MyLists.jsx';
import { MyTokens } from '../../../packages/core/src/shared/routes/MyTokens.jsx';
import { StakingList } from '../../../packages/core/src/shared/routes/StakingList.jsx';

const CHAIN = 'bitcoin-testnet';
const ADDRESS = 'tb1qloadingstate0000000000000000000000000';

function pending() {
    return new Promise(() => {});
}

function mount(Component, messaging, props = {}) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Component walletId="w1" onBack={() => {}} {...props} />
        </MessagingProvider>,
    );
}

afterEach(() => cleanup());

describe('list first-load states', () => {
    it('keeps the contacts empty state hidden while contacts load', () => {
        mount(ContactsList, { listContacts: vi.fn(() => pending()) });

        expect(screen.getByRole('status', { name: 'Loading contacts' })).toBeInTheDocument();
        expect(screen.queryByText(/No contacts yet/)).toBeNull();
    });

    it('keeps the history empty state hidden while history loads', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: ADDRESS }] }),
            getAddressHistory: vi.fn(() => pending()),
            getLinksForAddress: vi.fn(() => pending()),
            getAddressMempool: vi.fn(() => pending()),
            getPendingTxsForAddress: vi.fn(() => pending()),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
            getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
            getSettings: vi.fn().mockResolvedValue({}),
        };
        mount(History, messaging);

        await waitFor(() => expect(messaging.getAddressHistory).toHaveBeenCalled());
        expect(screen.getByRole('status', { name: 'Loading history' })).toBeInTheDocument();
        expect(screen.queryByText('No activity yet')).toBeNull();
    });

    it('keeps the dispensers empty state hidden while dispensers load', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: ADDRESS }] }),
            getDispensersForSource: vi.fn(() => pending()),
        };
        mount(DispensersList, messaging, { onOpenDispenser: () => {} });

        await waitFor(() => expect(messaging.getDispensersForSource).toHaveBeenCalled());
        expect(screen.getByRole('status', { name: 'Loading dispensers' })).toBeInTheDocument();
        expect(screen.queryByText('No dispensers yet')).toBeNull();
    });

    it('keeps the markets empty state hidden while markets load', () => {
        const messaging = {
            getMarkets: vi.fn(() => pending()),
            listWatchlistForWallet: vi.fn().mockResolvedValue([]),
        };
        mount(MarketsList, messaging, {
            selectedAsset: { chainId: CHAIN, tick: 'BTC' },
            onChangeAsset: () => {},
            onOpenMarket: () => {},
        });

        expect(screen.getByRole('status', { name: 'Loading markets' })).toBeInTheDocument();
        expect(screen.queryByText('No markets for BTC')).toBeNull();
    });

    it('keeps contract empty states hidden while contract lists load', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: ADDRESS }] }),
            getContractsForSource: vi.fn(() => pending()),
            getDepositsForAddress: vi.fn(() => pending()),
            getWithdrawalsForAddress: vi.fn(() => pending()),
            getContractsBrowseAll: vi.fn(() => pending()),
        };
        mount(ContractsList, messaging, { onOpenContract: () => {} });

        await waitFor(() => expect(messaging.getContractsForSource).toHaveBeenCalled());
        expect(screen.getAllByRole('status', { name: /Loading contracts/ }).length).toBeGreaterThan(0);
        expect(screen.queryByText(/No contracts published/)).toBeNull();
        expect(screen.queryByText(/No contracts indexed/)).toBeNull();
    });

    it('keeps the lists empty state hidden while lists load', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: ADDRESS }] }),
            getListsForSource: vi.fn(() => pending()),
        };
        mount(MyLists, messaging, { onOpenList: () => {} });

        await waitFor(() => expect(messaging.getListsForSource).toHaveBeenCalled());
        expect(screen.getByRole('status', { name: 'Loading lists' })).toBeInTheDocument();
        expect(screen.queryByText('No lists yet')).toBeNull();
    });

    it('keeps the messaging empty state hidden while messages load', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({
                [CHAIN]: [{ id: 'a1', address: ADDRESS, source: 'hd', role: 'receive' }],
            }),
            listContacts: vi.fn().mockResolvedValue([]),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            getMessagingInboxSweep: vi.fn(() => pending()),
        };
        mount(MessagingInbox, messaging);

        await waitFor(() => expect(messaging.getMessagingInboxSweep).toHaveBeenCalled());
        expect(screen.getByRole('status', { name: 'Loading messages' })).toBeInTheDocument();
        expect(screen.queryByText('No messages yet')).toBeNull();
    });

    it('keeps the staking empty state hidden while positions load', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: ADDRESS }] }),
            getStakesForAddress: vi.fn(() => pending()),
            getDelegationsForAddress: vi.fn(() => pending()),
            getRewardsForAddress: vi.fn(() => pending()),
            getRewardClaimsForAddress: vi.fn(() => pending()),
            getContractStakesForAddress: vi.fn(() => pending()),
            getContractUnstakesForAddress: vi.fn(() => pending()),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
        };
        mount(StakingList, messaging, { onOpenStake: () => {} });

        await waitFor(() => expect(messaging.getStakesForAddress).toHaveBeenCalled());
        expect(screen.getByRole('status', { name: 'Loading staking positions' })).toBeInTheDocument();
        expect(screen.queryByText(/Nothing staked yet/)).toBeNull();
    });

    it('retries a failed list load without showing its empty state', async () => {
        const messaging = {
            getMarkets: vi.fn()
                .mockRejectedValueOnce(new Error('transport detail'))
                .mockResolvedValueOnce([]),
            listWatchlistForWallet: vi.fn().mockResolvedValue([]),
        };
        mount(MarketsList, messaging, {
            selectedAsset: { chainId: CHAIN, tick: 'BTC' },
            onChangeAsset: () => {},
            onOpenMarket: () => {},
        });

        expect(await screen.findByText('Could not load markets. Try again.')).toBeInTheDocument();
        expect(screen.queryByText('No markets for BTC')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await waitFor(() => expect(messaging.getMarkets).toHaveBeenCalledTimes(2));
        expect(await screen.findByText('No markets for BTC')).toBeInTheDocument();
    });
});

describe('filtered list empty states', () => {
    it('resets a contact search without showing the address-book empty state', async () => {
        const contact = {
            id: 'alice',
            name: 'Alice',
            notes: '',
            entries: [{ chain: 'bitcoin', address: ADDRESS, label: '' }],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
        };
        mount(ContactsList, { listContacts: vi.fn().mockResolvedValue([contact]) });
        await screen.findByText('Alice');

        fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'missing' } });
        expect(await screen.findByText('No results for these filters')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
        expect(screen.getByLabelText('Search contacts')).toHaveValue('');
        expect(await screen.findByText('Alice')).toBeInTheDocument();
        expect(screen.queryByText('No contacts yet')).toBeNull();
    });

    it('resets a dispenser search without showing the dispenser empty state', async () => {
        const row = {
            action_index: '7',
            block_index: 100,
            source: ADDRESS,
            give_tick: 'FILTERTOKEN',
            give_amount: '2',
            get_coin: 'BTC',
            get_amount: '1',
            current_status: 'open',
            escrow_remaining: '10',
        };
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: ADDRESS }] }),
            getDispensersForSource: vi.fn().mockResolvedValue({ data: [row] }),
        };
        mount(DispensersList, messaging, { onOpenDispenser: () => {} });
        await screen.findByText('open');

        fireEvent.change(screen.getByLabelText('Search dispensers'), { target: { value: 'missing' } });
        expect(await screen.findByText('No results for these filters')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
        expect(screen.getByLabelText('Search dispensers')).toHaveValue('');
        expect(await screen.findByText('open')).toBeInTheDocument();
        expect(screen.queryByText('No dispensers yet')).toBeNull();
    });

    it('resets market search and tab filters to reveal existing markets', async () => {
        const messaging = {
            getMarkets: vi.fn().mockResolvedValue([{ tick1: 'BTC', tick2: 'DOGE', depth: 10 }]),
            getDispensersForToken: vi.fn().mockResolvedValue([]),
            listWatchlistForWallet: vi.fn().mockResolvedValue([]),
        };
        mount(MarketsList, messaging, {
            selectedAsset: { chainId: 'bitcoin-mainnet', tick: 'BTC' },
            onChangeAsset: () => {},
            onOpenMarket: () => {},
        });
        await screen.findByText('DOGE');

        fireEvent.change(screen.getByLabelText('Search markets'), { target: { value: 'missing' } });
        fireEvent.click(screen.getByRole('tab', { name: 'Watchlist' }));
        expect(await screen.findByText('No results for these filters')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
        expect(screen.getByLabelText('Search markets')).toHaveValue('');
        expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
        expect(await screen.findByText('DOGE')).toBeInTheDocument();
    });

    it('resets token filters without showing the owned-token empty state', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: ADDRESS }] }),
            getOwnedTokens: vi.fn().mockResolvedValue([{
                tick: 'FILTERME',
                description: 'owned but no balance held',
                locked: false,
                divisibility: 8,
                totalSupply: '1000',
                maxSupply: null,
                youOwn: false,
            }]),
        };
        mount(MyTokens, messaging, { onIssue: () => {}, onSelectTick: () => {} });
        await screen.findByText('FILTERME');

        fireEvent.click(screen.getByRole('radio', { name: 'Holding' }));
        expect(await screen.findByText('No results for these filters')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
        expect(screen.getByRole('radio', { name: 'All' })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByLabelText('Search your tokens by ticker or description')).toHaveValue('');
        expect(await screen.findByText('FILTERME')).toBeInTheDocument();
        expect(screen.queryByText('No owned tokens yet')).toBeNull();
    });
});
