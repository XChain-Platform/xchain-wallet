// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PollDetail } from '../../../packages/core/src/shared/routes/PollDetail.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'address-1',
    address: 'bc1qvotervotervotervotervotervoterxx',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

afterEach(cleanup);

describe('PollDetail rendering', () => {
    it('renders an open approval ballot and enforces its selection limit', async () => {
        const messaging = {
            governancePoll: vi.fn().mockResolvedValue({
                action_index: 7,
                tick: 'VOTE',
                question: 'Choose a release channel',
                options: ['Stable', 'Preview'],
                tally_mode: 'approval',
                weight_mode: 'balance',
                max_selections: 1,
                end_block: 120,
                poll_status: 'open',
            }),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
            governanceVotes: vi.fn().mockResolvedValue([]),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
        };

        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <PollDetail walletId="wallet-1" chainId={CHAIN} pollIndex={7} onBack={vi.fn()} />
            </MessagingProvider>,
        );

        expect(await screen.findByRole('heading', { name: 'Poll #7' })).toBeInTheDocument();
        expect(screen.getByText('Choose a release channel')).toBeInTheDocument();
        // Results first: the question, its token, network and time left, the
        // result card, then one-line sections Cast Your Vote, Rules to Pass
        // and Details.
        expect(screen.getByText('VOTE on Bitcoin · Closes in 3 h')).toBeInTheDocument();
        expect(screen.getByText('20 blocks remaining')).toBeInTheDocument();
        const card = screen.getByRole('region', { name: 'Poll results' });
        expect(card).toHaveTextContent('Voting is open. Results are counted when voting closes.');
        const titles = [...document.querySelectorAll('[data-form-section-title]')].map((el) => el.textContent);
        expect(titles).toEqual(['Cast Your Vote', 'From', 'Memo', 'Network fee', 'Rules to Pass', 'Details']);
        const follows = Node.DOCUMENT_POSITION_FOLLOWING;
        const cast = screen.getByRole('button', { name: /^Cast Your Vote/ });
        expect(cast).toHaveAttribute('aria-expanded', 'true');
        expect(card.compareDocumentPosition(cast) & follows).toBeTruthy();
        // From is the standard closed section: a locked Network and the
        // picker-backed address, above the ballot.
        fireEvent.click(screen.getByRole('button', { name: /^From\b/ }));
        const network = screen.getByRole('button', { name: 'Network: Bitcoin' });
        const from = screen.getByDisplayValue(ADDRESS.address);
        const ballot = screen.getByRole('group', { name: 'Choose up to 1 option' });
        expect(network).toBeDisabled();
        expect(network.compareDocumentPosition(from) & follows).toBeTruthy();
        expect(from.compareDocumentPosition(ballot) & follows).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Choose voting address' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'About ballot choices' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Vote' }).querySelector('svg')).not.toBeNull();
        const stable = await screen.findByRole('checkbox', { name: '0: Stable' });
        const preview = await screen.findByRole('checkbox', { name: '1: Preview' });

        fireEvent.click(stable);

        expect(stable).toBeChecked();
        expect(preview).toBeDisabled();
    });

    it('shows exact final weighted results, the latest own vote, and no closed-poll action', async () => {
        const messaging = {
            governancePoll: vi.fn().mockResolvedValue({
                action_index: 8,
                tick: 'VOTE',
                question: 'Choose one',
                options: ['Alpha', 'Beta', 'Gamma'],
                tally_mode: 'approval',
                weight_mode: 'quadratic',
                max_selections: 1,
                end_block: 120,
                poll_status: 'finalized',
                winning_option: 0,
            }),
            governancePollResults: vi.fn().mockResolvedValue({
                data: [
                    { option_index: 0, total_weight: '9007199254740993', voter_count: 12 },
                    { option_index: 1, total_weight: '9007199254740993', voter_count: 2 },
                    { option_index: 2, total_weight: '9007199254740993', voter_count: 1 },
                ],
            }),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 121 }),
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
            governanceVotes: vi.fn().mockResolvedValue({
                data: [
                    {
                        action_index: '9007199254740992', source: ADDRESS.address,
                        poll_index: 8, choice: 0, share: '1',
                    },
                    {
                        action_index: '9007199254740993', source: ADDRESS.address,
                        poll_index: 8, choice: 1, share: '1',
                    },
                    {
                        action_index: '9007199254740994', source: 'bc1qdelegate',
                        poll_index: 8, choice: 2, share: '1',
                    },
                ],
            }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
        };

        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <PollDetail walletId="wallet-1" chainId={CHAIN} pollIndex={8} onBack={vi.fn()} />
            </MessagingProvider>,
        );

        expect(await screen.findByText('Voting is closed for this poll.')).toBeInTheDocument();
        expect(screen.getByText('Voting is closed for this poll.').tagName).toBe('P');
        expect(screen.queryByRole('button', { name: /^(Vote|Change vote)$/ })).toBeNull();
        expect(await screen.findByText('1: Beta', { selector: 'dd' })).toBeInTheDocument();
        // The result card states the outcome, the winner and its share, and
        // one stacked bar with each option's share.
        expect(document.querySelector('[data-poll-outcome]')?.textContent).toBe('Decided');
        expect(screen.getByText('Winner: 0: Alpha, 34%')).toBeInTheDocument();
        const bar = screen.getByRole('img', { name: '0: Alpha 34%, 1: Beta 33%, 2: Gamma 33%' });
        expect([...bar.querySelectorAll('[data-percent]')].map((segment) => segment.getAttribute('data-percent')))
            .toEqual(['34', '33', '33']);
        expect(screen.getByText('34%')).toBeInTheDocument();
        expect(screen.getAllByText('33%')).toHaveLength(2);
        expect(messaging.governancePollResults).toHaveBeenCalledWith({ chainId: CHAIN, pollIndex: 8 });
    });

    it('refuses a poll definition whose action index does not match the requested poll', async () => {
        const messaging = {
            governancePoll: vi.fn().mockResolvedValue({
                action_index: 99,
                tick: 'VOTE',
                question: 'Wrong poll',
                options: ['Yes', 'No'],
                tally_mode: 'approval',
                poll_status: 'open',
            }),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
            governanceVotes: vi.fn().mockResolvedValue([]),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
        };

        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <PollDetail walletId="wallet-1" chainId={CHAIN} pollIndex={7} onBack={vi.fn()} />
            </MessagingProvider>,
        );

        expect(await screen.findByText('Poll not found.')).toBeInTheDocument();
        expect(screen.queryByText('Wrong poll')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Vote' })).toBeNull();
    });

    it('neutralizes and bounds hostile poll text while tolerating structured fields', async () => {
        const rlo = String.fromCharCode(0x202e);
        const questionPrefix = `Approve ${rlo}hidden`;
        const messaging = {
            governancePoll: vi.fn().mockResolvedValue({
                action_index: 7,
                tick: 'VOTE',
                question: `${questionPrefix}${'Q'.repeat(100_000)}`,
                options: ['<img src=x onerror=alert(1)>', { malformed: true }],
                tally_mode: 'approval',
                weight_mode: { malformed: true },
                max_selections: 1,
                end_block: 120,
                poll_status: 'open',
            }),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
            governanceVotes: vi.fn().mockResolvedValue([]),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
        };

        const view = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <PollDetail walletId="wallet-1" chainId={CHAIN} pollIndex={7} onBack={vi.fn()} />
            </MessagingProvider>,
        );

        const question = await screen.findByText((text) => text.startsWith('Approve '));
        expect(question.textContent).not.toContain(rlo);
        expect(question.textContent).toContain('\u2426');
        expect(question.textContent.length).toBeLessThanOrEqual(1_024);
        expect(screen.getByLabelText('0: <img src=x onerror=alert(1)>')).toBeInTheDocument();
        expect(screen.getByLabelText('1: Unavailable option')).toBeInTheDocument();
        expect(view.container.querySelector('img[onerror]')).toBeNull();
        expect(screen.getByText('approval / unavailable')).toBeInTheDocument();
    });
});
