// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AccountPicker } from '../../../packages/core/src/shared/routes/AccountPicker.jsx';
import { BetFeedsList } from '../../../packages/core/src/shared/routes/BetFeedsList.jsx';
import { CrossChainTemplates } from '../../../packages/core/src/shared/routes/CrossChainTemplates.jsx';
import { GovernancePolls } from '../../../packages/core/src/shared/routes/GovernancePolls.jsx';
import { ListDetail } from '../../../packages/core/src/shared/routes/ListDetail.jsx';

const BTC = 'bitcoin-mainnet';
const DOGE = 'dogecoin-mainnet';
const ADDRESS = { address: 'bc1qloadingstates000000000000000000000000' };
const TECHNICAL_ERROR = 'GET /BTC/api/private returned HTTP 503';

function pending() {
    return new Promise(() => {});
}

function mount(children, messaging) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            {children}
        </MessagingProvider>,
    );
}

function expectBusy(name) {
    expect(screen.getByRole('status', { name })).toHaveAttribute('aria-busy', 'true');
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('A-L route load failures', () => {
    it('retries AccountPicker with a plain failure sentence', async () => {
        const listAccounts = vi.fn()
            .mockRejectedValueOnce(new Error(TECHNICAL_ERROR))
            .mockResolvedValueOnce([]);
        mount(
            <AccountPicker
                walletId="wallet-1"
                activeAccountId={null}
                onSwitch={() => {}}
                onAddAccount={() => {}}
                onBack={() => {}}
            />,
            { listAccounts },
        );

        expect(await screen.findByText('Could not load accounts. Try again.')).toBeInTheDocument();
        expect(screen.queryByText(TECHNICAL_ERROR)).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(await screen.findByText('No accounts yet')).toBeInTheDocument();
        expect(listAccounts).toHaveBeenCalledTimes(2);
    });

    it('marks a slow AccountPicker load as busy', () => {
        mount(
            <AccountPicker
                walletId="wallet-1"
                activeAccountId={null}
                onSwitch={() => {}}
                onAddAccount={() => {}}
                onBack={() => {}}
            />,
            { listAccounts: vi.fn(() => pending()) },
        );

        expectBusy('Loading accounts');
    });

    it('retries BetFeedsList with a plain failure sentence', async () => {
        const betFeeds = vi.fn()
            .mockRejectedValueOnce(new Error(TECHNICAL_ERROR))
            .mockResolvedValueOnce({ data: [] });
        mount(
            <BetFeedsList walletId="wallet-1" onOpenMarket={() => {}} onBack={() => {}} />,
            {
                getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [ADDRESS] }),
                betFeeds,
            },
        );

        expect(await screen.findByText('Could not load betting markets. Try again.')).toBeInTheDocument();
        expect(screen.queryByText(TECHNICAL_ERROR)).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(await screen.findByText('No markets')).toBeInTheDocument();
        expect(betFeeds).toHaveBeenCalledTimes(2);
    });

    it('marks a slow BetFeedsList market load as busy', async () => {
        mount(
            <BetFeedsList walletId="wallet-1" onOpenMarket={() => {}} onBack={() => {}} />,
            {
                getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [ADDRESS] }),
                betFeeds: vi.fn(() => pending()),
            },
        );

        await waitFor(() => expectBusy('Loading betting markets'));
    });

    it('retries CrossChainTemplates with a plain failure sentence', async () => {
        const getAddressesByChain = vi.fn()
            .mockRejectedValueOnce(new Error(TECHNICAL_ERROR))
            .mockResolvedValueOnce({ [BTC]: [ADDRESS], [DOGE]: [{ address: 'Dloadingstates' }] });
        mount(
            <CrossChainTemplates walletId="wallet-1" onLaunch={() => {}} onBack={() => {}} />,
            { getAddressesByChain },
        );

        expect(await screen.findByText('Could not load wallet chains. Try again.')).toBeInTheDocument();
        expect(screen.queryByText(TECHNICAL_ERROR)).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect((await screen.findAllByRole('button', { name: 'Use template' })).length).toBeGreaterThan(0);
        expect(getAddressesByChain).toHaveBeenCalledTimes(2);
    });

    it('marks a slow CrossChainTemplates load as busy', () => {
        mount(
            <CrossChainTemplates walletId="wallet-1" onLaunch={() => {}} onBack={() => {}} />,
            { getAddressesByChain: vi.fn(() => pending()) },
        );

        expectBusy('Loading cross-chain templates');
    });

    it('retries GovernancePolls with a plain failure sentence', async () => {
        const governancePolls = vi.fn()
            .mockRejectedValueOnce(new Error(TECHNICAL_ERROR))
            .mockResolvedValueOnce([]);
        mount(
            <GovernancePolls
                walletId="wallet-1"
                onOpenPoll={() => {}}
                onCreate={() => {}}
                onDelegate={() => {}}
                onBack={() => {}}
            />,
            {
                getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [ADDRESS] }),
                governancePolls,
            },
        );

        expect(await screen.findByText('Could not load governance polls. Try again.')).toBeInTheDocument();
        expect(screen.queryByText(TECHNICAL_ERROR)).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(await screen.findByText('No polls yet')).toBeInTheDocument();
        expect(governancePolls).toHaveBeenCalledTimes(2);
    });

    it('marks a slow GovernancePolls poll load as busy', async () => {
        mount(
            <GovernancePolls
                walletId="wallet-1"
                onOpenPoll={() => {}}
                onCreate={() => {}}
                onDelegate={() => {}}
                onBack={() => {}}
            />,
            {
                getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [ADDRESS] }),
                governancePolls: vi.fn(() => pending()),
            },
        );

        await waitFor(() => expectBusy('Loading governance polls'));
    });

    it('retries ListDetail with a plain failure sentence', async () => {
        const getListByActionIndex = vi.fn()
            .mockRejectedValueOnce(new Error(TECHNICAL_ERROR))
            .mockResolvedValueOnce(null);
        mount(
            <ListDetail
                chainId={BTC}
                actionIndex="7"
                onBack={() => {}}
                onFork={() => {}}
            />,
            { getListByActionIndex },
        );

        expect(await screen.findByText("Couldn't load this list. Something went wrong. Try again.")).toBeInTheDocument();
        expect(screen.queryByText(TECHNICAL_ERROR)).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(await screen.findByText('List not found')).toBeInTheDocument();
        expect(getListByActionIndex).toHaveBeenCalledTimes(2);
    });

    it('marks a slow ListDetail load as busy', () => {
        mount(
            <ListDetail
                chainId={BTC}
                actionIndex="7"
                onBack={() => {}}
                onFork={() => {}}
            />,
            { getListByActionIndex: vi.fn(() => pending()) },
        );

        expectBusy('Loading list details');
    });
});
