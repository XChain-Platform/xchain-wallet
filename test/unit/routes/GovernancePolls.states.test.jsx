// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { GovernancePolls } from '../../../packages/core/src/shared/routes/GovernancePolls.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';
import listPageStyles from '../../../packages/core/src/ui/ListPage.module.css';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = { address: 'bc1qexampleexampleexampleexampleexampleex' };
const betCardCss = readFileSync('packages/core/src/shared/components/BetMarketCard.module.css', 'utf8');
const betListCss = readFileSync('packages/core/src/shared/routes/BetFeedsList.module.css', 'utf8');

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

        expect(screen.getByRole('heading', { name: 'Governance Polls' })).toBeInTheDocument();
        const notice = screen.getByRole('status');
        expect(notice).toHaveTextContent(/Loading/);
        expect(notice.parentElement.firstElementChild).toBe(notice);
        expect(screen.queryByText('No governance address')).toBeNull();
    });

    it('renders poll loading through StatusMessage before the toolbar', async () => {
        mount({
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            governancePolls: vi.fn(() => pending()),
        });

        const notice = await screen.findByRole('status');
        expect(notice).toHaveTextContent('Loading governance polls');
        expect(notice.parentElement.firstElementChild).toBe(notice);
    });

    it('shows the empty-wallet state when no governance address exists', async () => {
        mount({ getAddressesByChain: vi.fn().mockResolvedValue({}) });

        const heading = await screen.findByRole('heading', { name: 'No governance address' });
        expect(heading).toBeInTheDocument();
        // The empty state sits inside the ListPage template, like the loading and error states.
        expect(heading.closest(`.${listPageStyles.page}`)).not.toBeNull();
        // Create poll lives in the plus menu, which only exists once a governance address does.
        expect(screen.queryByRole('button', { name: 'New poll or delegation' })).toBeNull();
        expect(screen.queryByRole('menuitem', { name: 'Create poll' })).toBeNull();
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
        fireEvent.click(screen.getByRole('button', { name: 'New poll or delegation' }));
        expect(screen.getByRole('menuitem', { name: 'Create poll' })).toBeInTheDocument();
    });

    it('renders the shared gauge cards, answer shares, binding state, vote weight and ruled actions', async () => {
        mount({
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            governancePolls: vi.fn().mockResolvedValue({
                data: [
                    {
                        action_index: 11,
                        tick: 'VOTE',
                        question: 'Ship the release?',
                        options: ['Ship', 'Wait'],
                        poll_status: 'open',
                        end_block: 500,
                    },
                    {
                        action_index: 12,
                        tick: 'VOTE',
                        question: 'Fund the next milestone?',
                        options: ['Fund', 'Wait'],
                        poll_status: 'finalized',
                        end_block: 750,
                        callback_contract_index: 9001,
                    },
                ],
            }),
            governancePollResults: vi.fn().mockResolvedValue({
                data: [
                    { option_index: 0, total_weight: '75', voter_count: 3 },
                    { option_index: 1, total_weight: '25', voter_count: 1 },
                ],
            }),
            governanceVotes: vi.fn().mockResolvedValue({
                data: [{ action_index: 20, poll_index: 12, source: ADDRESS.address, weight: '1200' }],
            }),
        });

        await screen.findByText('Ship the release?');
        const list = screen.getByRole('list');
        expect(list.tagName).toBe('UL');
        expect(list).toHaveAttribute('aria-label', 'Governance Polls');
        expect(betListCss).toMatch(/\.marketList\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill, minmax\(min\(100%, 290px\), 1fr\)\)/s);
        expect(betCardCss).toMatch(/\.card\s*\{[^}]*composes:\s*card from '\.\.\/\.\.\/ui\/Card\.module\.css'/s);
        const items = screen.getAllByRole('listitem');
        expect(items).toHaveLength(2);
        for (const item of items) {
            const row = item.querySelector('button');
            expect(row).not.toBeNull();
            expect(row).toHaveAttribute('data-poll-index');
            expect(row.querySelector('[data-question-card-gauge]')).not.toBeNull();
            expect(row.querySelector('svg')).not.toBeNull();
        }
        expect(screen.getByText('Binding')).toBeInTheDocument();
        expect(await screen.findAllByText('75%')).toHaveLength(2);
        expect([...document.querySelectorAll('[data-governance-card-weight]')]
            .some((node) => node.textContent.replace(/\s+/g, ' ') === '100 VOTE voting weight')).toBe(true);
        const voteChip = await screen.findByLabelText('Your vote: 1,200 VOTE');
        expect(voteChip).toHaveTextContent('1,200 VOTE');
        expect(screen.getAllByText('Closed')).toHaveLength(1);
        expect(screen.getByRole('tab', { name: 'My votes' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'My polls' })).toBeInTheDocument();

        // Create poll and Delegate votes are plus-menu items, each with an icon, and no
        // success-styled button sits on the page.
        const plus = screen.getByRole('button', { name: 'New poll or delegation' });
        expect(plus.querySelector('svg')).not.toBeNull();
        expect(document.querySelectorAll(`.${buttonStyles.success}`)).toHaveLength(0);
        fireEvent.click(plus);
        const create = screen.getByRole('menuitem', { name: 'Create poll' });
        expect(create.querySelector('svg')).not.toBeNull();
        const delegate = screen.getByRole('menuitem', { name: 'Delegate votes' });
        expect(delegate.querySelector('svg')).not.toBeNull();
    });
});
