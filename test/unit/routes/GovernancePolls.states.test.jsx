// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { GovernancePolls } from '../../../packages/core/src/shared/routes/GovernancePolls.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = { address: 'bc1qexampleexampleexampleexampleexampleex' };

function pending() {
    return new Promise(() => {});
}

function mount(messaging) {
    const onOpenPoll = vi.fn();
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <GovernancePolls
                walletId="wallet-1"
                onOpenPoll={onOpenPoll}
                onCreate={() => {}}
                onDelegate={() => {}}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
    return onOpenPoll;
}

afterEach(() => cleanup());

describe('GovernancePolls states', () => {
    it('shows the initial loading state while wallet addresses resolve', () => {
        mount({ getAddressesByChain: vi.fn(() => pending()) });

        expect(screen.getByRole('heading', { name: 'Governance' })).toBeInTheDocument();
        expect(screen.getByText(/Loading/)).toBeInTheDocument();
        expect(screen.queryByText('No governance address')).toBeNull();
    });

    it('shows the empty-wallet state when no governance address exists', async () => {
        mount({ getAddressesByChain: vi.fn().mockResolvedValue({}) });

        expect(await screen.findByRole('heading', { name: 'No governance address' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Create poll' })).toBeNull();
    });

    it('shows address-loading failures without an empty-state claim', async () => {
        mount({ getAddressesByChain: vi.fn().mockRejectedValue(new Error('Wallet unavailable')) });

        expect(await screen.findByText('Wallet unavailable')).toBeInTheDocument();
        expect(screen.queryByText('No governance address')).toBeNull();
    });

    it('renders and opens a poll from the main state', async () => {
        const onOpenPoll = mount({
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            governancePolls: vi.fn().mockResolvedValue({
                data: [{
                    action_index: 11,
                    tick: 'VOTE',
                    question: 'Ship the release?',
                    poll_status: 'open',
                    end_block: 500,
                }],
            }),
        });

        await screen.findByText('Ship the release?');
        fireEvent.click(screen.getByRole('button', { name: /Ship the release/ }));
        expect(onOpenPoll).toHaveBeenCalledWith(CHAIN, 11);
        expect(screen.getByRole('button', { name: 'Create poll' })).toBeInTheDocument();
    });
});
