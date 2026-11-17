// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { selectOption } from '../../helpers/selectOption.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { GovernancePolls } from '../../../packages/core/src/shared/routes/GovernancePolls.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'address-1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02example',
};
const POLLS = [
    {
        action_index: 11,
        block_index: 90,
        tick: 'VOTE',
        question: 'Ship the release?',
        options: ['Yes', 'No'],
        poll_status: 'open',
        end_block: 500,
        max_selections: 1,
    },
    {
        action_index: 12,
        block_index: 80,
        tick: 'VOTE',
        question: 'Fund the next milestone?',
        options: ['Fund', 'Wait'],
        poll_status: 'finalized',
        end_block: 300,
        max_selections: 1,
        winning_option: 0,
    },
];

let layoutWidth = 0;
const realRect = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
        if (this.hasAttribute('data-list-detail')) {
            return { width: layoutWidth, height: 800, top: 0, left: 0, right: layoutWidth, bottom: 800, x: 0, y: 0, toJSON() {} };
        }
        return realRect.call(this);
    });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    layoutWidth = 0;
    globalThis.localStorage?.clear();
});

function messaging() {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: ADDRESS.id }),
        governancePolls: vi.fn().mockResolvedValue({ data: POLLS }),
        governancePoll: vi.fn(({ pollIndex }) => Promise.resolve({ data: POLLS.filter((poll) => String(poll.action_index) === String(pollIndex)) })),
        governancePollResults: vi.fn().mockResolvedValue({ data: [] }),
        governanceVotes: vi.fn().mockResolvedValue({ data: [] }),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
    };
}

function mount(api, onOpenPoll = vi.fn()) {
    render(
        <MessagingProvider shell="web" messaging={api}>
            <GovernancePolls
                walletId="wallet-1"
                onOpenPoll={onOpenPoll}
                onCreate={vi.fn()}
                onDelegate={vi.fn()}
                onBack={vi.fn()}
            />
        </MessagingProvider>,
    );
    return onOpenPoll;
}

describe('GovernancePolls wide split', () => {
    it('preselects the first poll and renders one page around two independently named panels', async () => {
        layoutWidth = 1046;
        mount(messaging());

        const detail = await screen.findByRole('region', { name: 'Ship the release?' });
        const list = screen.getByRole('region', { name: 'Governance polls' });
        expect(within(list).getByRole('button', { name: /Ship the release/ })).toHaveAttribute('aria-current', 'true');
        expect(await within(detail).findByRole('heading', { name: 'Ship the release?' })).toBeInTheDocument();
        expect(screen.getByRole('separator', { name: 'Resize the governance list' })).toBeInTheDocument();
        expect(screen.getAllByRole('heading', { level: 1 }).map((heading) => heading.textContent)).toEqual(['Governance Polls']);
        expect(document.querySelectorAll('main')).toHaveLength(1);
    });

    it('swaps the detail in place without opening a route', async () => {
        layoutWidth = 1686;
        const onOpenPoll = mount(messaging());
        const firstList = await screen.findByRole('region', { name: 'Governance polls' });

        fireEvent.click(within(firstList).getByRole('button', { name: /Fund the next milestone/ }));

        const detail = await screen.findByRole('region', { name: 'Fund the next milestone?' });
        expect(await within(detail).findByRole('heading', { name: 'Fund the next milestone?' })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Governance polls' })).toBe(firstList);
        expect(within(firstList).getByRole('button', { name: /Fund the next milestone/ })).toHaveAttribute('aria-current', 'true');
        expect(onOpenPoll).not.toHaveBeenCalled();
    });
});

describe('GovernancePolls narrow layout and filters', () => {
    it('keeps row navigation below the split breakpoint', async () => {
        layoutWidth = 640;
        const onOpenPoll = mount(messaging());
        const row = await screen.findByRole('button', { name: /Ship the release/ });

        await waitFor(() => expect(row.closest('[data-list-detail]')).toHaveAttribute('data-list-detail', 'list'));
        expect(screen.queryByRole('separator')).toBeNull();
        fireEvent.click(row);
        expect(onOpenPoll).toHaveBeenCalledWith(CHAIN, 11);
    });

    it('keeps the status choice in the header filter and filters the list', async () => {
        layoutWidth = 640;
        mount(messaging());
        await screen.findByRole('button', { name: /Ship the release/ });

        fireEvent.click(screen.getByRole('button', { name: 'Filter polls' }));
        selectOption(screen.getByRole('combobox', { name: 'Status' }), 'closed');

        expect(screen.queryByRole('button', { name: /Ship the release/ })).toBeNull();
        expect(screen.getByRole('button', { name: /Fund the next milestone/ })).toBeInTheDocument();
    });

    it('mirrors prediction-market views with All, My votes and My polls', async () => {
        layoutWidth = 640;
        const api = messaging();
        api.governancePolls.mockResolvedValue({
            data: [
                { ...POLLS[0], source: 'bc1qsomeoneelse' },
                { ...POLLS[1], source: ADDRESS.address },
            ],
        });
        api.governanceVotes.mockResolvedValue({ data: [{ poll_index: 11, source: ADDRESS.address }] });
        mount(api);
        await screen.findByRole('button', { name: /Ship the release/ });

        fireEvent.click(screen.getByRole('tab', { name: 'My votes' }));
        await waitFor(() => expect(screen.getByRole('button', { name: /Ship the release/ })).toBeInTheDocument());
        expect(screen.queryByRole('button', { name: /Fund the next milestone/ })).toBeNull();

        fireEvent.click(screen.getByRole('tab', { name: 'My polls' }));
        expect(screen.queryByRole('button', { name: /Ship the release/ })).toBeNull();
        expect(screen.getByRole('button', { name: /Fund the next milestone/ })).toBeInTheDocument();
    });
});
