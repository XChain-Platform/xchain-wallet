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
const pollCss = readFileSync('packages/core/src/shared/routes/GovernancePolls.module.css', 'utf8');

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

        expect(screen.getByRole('heading', { name: 'Governance polls' })).toBeInTheDocument();
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

    it('renders polls as one flush list with governance icons and ruled actions', async () => {
        mount({
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            governancePolls: vi.fn().mockResolvedValue({
                data: [
                    {
                        action_index: 11,
                        tick: 'VOTE',
                        question: 'Ship the release?',
                        poll_status: 'open',
                        end_block: 500,
                    },
                    {
                        action_index: 12,
                        tick: 'VOTE',
                        question: 'Fund the next milestone?',
                        poll_status: 'finalized',
                        end_block: 750,
                    },
                ],
            }),
        });

        await screen.findByText('Ship the release?');
        const list = screen.getByRole('list');
        expect(list.tagName).toBe('UL');
        expect(pollCss).toMatch(/\.pollList\s*\{[^}]*composes:\s*flush from '\.\.\/\.\.\/ui\/Card\.module\.css'/s);
        expect(pollCss).toMatch(/\.pollList > li \+ li\s*\{[^}]*border-top:\s*1px solid var\(--xc-border\)/s);
        const pollCardRule = pollCss.match(/\.pollCard\s*\{([^}]*)\}/s)?.[1];
        expect(pollCardRule).not.toContain('composes: card');
        const items = screen.getAllByRole('listitem');
        expect(items).toHaveLength(2);
        for (const item of items) {
            const row = item.querySelector('button');
            expect(row).not.toBeNull();
            expect(item.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
        }

        const create = screen.getByRole('button', { name: 'Create poll' });
        expect(create).toHaveClass(buttonStyles.success);
        expect(create.querySelector('svg')).not.toBeNull();
        expect(document.querySelectorAll(`.${buttonStyles.success}`)).toHaveLength(1);

        const delegate = screen.getByRole('button', { name: 'Delegate votes' });
        expect(delegate).toHaveClass(buttonStyles.secondary);
        expect(delegate).not.toHaveClass(buttonStyles.success);
        expect(delegate.querySelector('svg')).not.toBeNull();
    });
});
