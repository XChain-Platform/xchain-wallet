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
        expect(screen.getByText('20 blocks remaining')).toBeInTheDocument();
        const stable = screen.getByRole('checkbox', { name: '0: Stable' });
        const preview = screen.getByRole('checkbox', { name: '1: Preview' });

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
        expect(screen.getAllByRole('progressbar').map((bar) => bar.getAttribute('aria-valuenow')))
            .toEqual(['34', '33', '33']);
        expect(screen.getByText('34%')).toBeInTheDocument();
        expect(screen.getAllByText('33%')).toHaveLength(2);
        expect(messaging.governancePollResults).toHaveBeenCalledWith({ chainId: CHAIN, pollIndex: 8 });
    });
});
