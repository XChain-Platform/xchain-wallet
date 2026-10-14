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
});
