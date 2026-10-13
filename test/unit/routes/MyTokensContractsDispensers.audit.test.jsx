// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ContractsList } from '../../../packages/core/src/shared/routes/ContractsList.jsx';
import { DispensersList } from '../../../packages/core/src/shared/routes/DispensersList.jsx';
import { MyTokens } from '../../../packages/core/src/shared/routes/MyTokens.jsx';

const CHAIN = 'bitcoin-testnet';
const ADDRESS = 'tb1qaudit0000000000000000000000000000000';
const ADDRESSES = { [CHAIN]: [{ address: ADDRESS }] };

function mount(node, messaging) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            {node}
        </MessagingProvider>,
    );
}

function contractMessaging(overrides = {}) {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getContractsForSource: vi.fn().mockResolvedValue({ data: [] }),
        getDepositsForAddress: vi.fn().mockResolvedValue({ data: [] }),
        getWithdrawalsForAddress: vi.fn().mockResolvedValue({ data: [] }),
        getContractsBrowseAll: vi.fn().mockResolvedValue({ data: [] }),
        ...overrides,
    };
}

afterEach(() => cleanup());

describe('MyTokens list states and actions', () => {
    it('offers the first issue action from the true empty state', async () => {
        const onIssue = vi.fn();
        mount(
            <MyTokens walletId="w" onBack={() => {}} onIssue={onIssue} onSelectTick={() => {}} />,
            {
                getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
                getOwnedTokens: vi.fn().mockResolvedValue([]),
            },
        );

        expect(await screen.findByText('Tokens this wallet owns appear here.')).toBeInTheDocument();
        const actions = screen.getAllByRole('button', { name: 'Issue token' });
        fireEvent.click(actions[actions.length - 1]);
        expect(onIssue).toHaveBeenCalledTimes(1);
    });

    it('announces loading and retries a failed ownership lookup', async () => {
        const getOwnedTokens = vi.fn()
            .mockRejectedValueOnce(new Error('private transport detail'))
            .mockResolvedValueOnce([]);
        mount(
            <MyTokens walletId="w" onBack={() => {}} onIssue={() => {}} onSelectTick={() => {}} />,
            {
                getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
                getOwnedTokens,
            },
        );

        expect(screen.getByRole('status', { name: 'Loading owned tokens' })).toBeInTheDocument();
        expect(await screen.findByText('Could not load your owned tokens. Try again.')).toBeInTheDocument();
        expect(document.body.textContent).not.toContain('private transport detail');
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await waitFor(() => expect(getOwnedTokens).toHaveBeenCalledTimes(2));
        expect(await screen.findByText('No owned tokens yet')).toBeInTheDocument();
    });
});

describe('ContractsList ownership and empty actions', () => {
    it('offers publishing from the empty owned section', async () => {
        const onDeploy = vi.fn();
        mount(
            <ContractsList walletId="w" onBack={() => {}} onDeploy={onDeploy} onOpenContract={() => {}} />,
            contractMessaging(),
        );

        expect(await screen.findByText('No published contracts')).toBeInTheDocument();
        const actions = screen.getAllByRole('button', { name: /Publish contract/ });
        fireEvent.click(actions[actions.length - 1]);
        expect(onDeploy).toHaveBeenCalledTimes(1);
    });

    it('calls the source a publisher and gives its row an explicit open action', async () => {
        const onOpenContract = vi.fn();
        mount(
            <ContractsList walletId="w" onBack={() => {}} onOpenContract={onOpenContract} />,
            contractMessaging({
                getContractsForSource: vi.fn().mockResolvedValue({
                    data: [{ action_index: '12', source: ADDRESS, status: 'valid', meta_name: 'Escrow' }],
                }),
            }),
        );

        const row = await screen.findByRole('button', { name: 'Open Escrow (C:BTC:12)' });
        expect(row).toHaveTextContent('published by');
        expect(row).not.toHaveTextContent('owner');
        fireEvent.click(row);
        expect(onOpenContract).toHaveBeenCalledWith(CHAIN, '12');
    });

    it('distinguishes a filtered miss from a truly empty section', async () => {
        mount(
            <ContractsList walletId="w" onBack={() => {}} onOpenContract={() => {}} />,
            contractMessaging({
                getContractsBrowseAll: vi.fn().mockResolvedValue({
                    data: [{ action_index: '12', status: 'valid', meta_name: 'Escrow' }],
                }),
            }),
        );

        expect(await screen.findByRole('button', { name: 'Open Escrow (C:BTC:12)' })).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Filter contracts'), { target: { value: 'treasury' } });
        expect(await screen.findByText('No matching contracts')).toBeInTheDocument();
        expect(screen.getByText('No published contracts')).toBeInTheDocument();
    });

    it('hides transport details in a retryable chain error', async () => {
        const getContractsForSource = vi.fn()
            .mockRejectedValueOnce(new Error('private transport detail'))
            .mockResolvedValueOnce({ data: [] });
        mount(
            <ContractsList walletId="w" onBack={() => {}} onOpenContract={() => {}} />,
            contractMessaging({ getContractsForSource }),
        );

        expect(await screen.findByText("Couldn't load contracts on Bitcoin. Try again.")).toBeInTheDocument();
        expect(document.body.textContent).not.toContain('private transport detail');
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await waitFor(() => expect(getContractsForSource).toHaveBeenCalledTimes(2));
        expect(await screen.findByText('No published contracts')).toBeInTheDocument();
    });

    it('does not query contracts for malformed address entries', async () => {
        const messaging = contractMessaging({
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{}] }),
        });
        mount(
            <ContractsList walletId="w" onBack={() => {}} onOpenContract={() => {}} />,
            messaging,
        );

        expect(await screen.findByText('No supported address')).toBeInTheDocument();
        expect(messaging.getContractsForSource).not.toHaveBeenCalled();
        expect(messaging.getContractsBrowseAll).not.toHaveBeenCalled();
    });
});

describe('DispensersList supported-address empty state', () => {
    it('does not offer creation when chain buckets contain no usable address', async () => {
        const getDispensersForSource = vi.fn();
        mount(
            <DispensersList
                walletId="w"
                onBack={() => {}}
                onCreateDispenser={() => {}}
                onOpenDispenser={() => {}}
            />,
            {
                getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{}] }),
                getDispensersForSource,
            },
        );

        expect(await screen.findByText('No supported address')).toBeInTheDocument();
        expect(getDispensersForSource).not.toHaveBeenCalled();
    });

    it('hides transport details in a retryable list error', async () => {
        const getDispensersForSource = vi.fn()
            .mockRejectedValueOnce(new Error('private transport detail'))
            .mockResolvedValueOnce({ data: [] });
        mount(
            <DispensersList walletId="w" onBack={() => {}} onOpenDispenser={() => {}} />,
            {
                getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
                getDispensersForSource,
            },
        );

        expect(await screen.findByText(/Couldn't load some dispensers/)).toBeInTheDocument();
        expect(document.body.textContent).not.toContain('private transport detail');
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await waitFor(() => expect(getDispensersForSource).toHaveBeenCalledTimes(2));
        expect(await screen.findByText('No dispensers yet')).toBeInTheDocument();
    });
});
