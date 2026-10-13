// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CreatePollForm } from '../../../packages/core/src/shared/routes/CreatePollForm.jsx';
import { DelegateVoteForm } from '../../../packages/core/src/shared/routes/DelegateVoteForm.jsx';
import { GovernancePolls } from '../../../packages/core/src/shared/routes/GovernancePolls.jsx';
import { PollDetail } from '../../../packages/core/src/shared/routes/PollDetail.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = Object.freeze({
    id: 'address-1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

function messagingWith(overrides = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'mainnet' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        getChainTipBlockTime: vi.fn().mockResolvedValue({ blockTime: 0 }),
        governancePolls: vi.fn().mockResolvedValue([]),
        governancePoll: vi.fn().mockResolvedValue(null),
        governancePollResults: vi.fn().mockResolvedValue([]),
        composeVoteForConfirm: vi.fn().mockResolvedValue({ psbt: '00', encoding: 'psbt' }),
    };
    Object.assign(target, overrides);
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            if (typeof property !== 'string') return undefined;
            return vi.fn().mockResolvedValue(null);
        },
    });
}

function mount(Component, props, messaging = messagingWith()) {
    return render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(Component, props),
    ));
}

describe('governance route audit', () => {
    it('manages poll options and validates the close block and selection count before compose', async () => {
        const messaging = messagingWith();
        mount(CreatePollForm, {
            walletId: 'wallet-1', chainId: CHAIN, presetTick: 'VOTE', onBack() {},
        }, messaging);
        await screen.findByDisplayValue(ADDRESS.address);

        fireEvent.click(screen.getByRole('button', { name: 'Add option' }));
        expect(screen.getByLabelText('Option 2')).toBeTruthy();
        fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[2]);
        expect(screen.queryByLabelText('Option 2')).toBeNull();

        fireEvent.change(screen.getByLabelText('Option 0'), { target: { value: 'Yes' } });
        fireEvent.change(screen.getByLabelText('Option 1'), { target: { value: 'No' } });
        fireEvent.change(screen.getByLabelText('Closes at block'), { target: { value: '100' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create poll' }));
        expect(await screen.findByText('End block must be above the current indexed block (100).')).toBeTruthy();

        fireEvent.change(screen.getByLabelText('Closes at block'), { target: { value: '244' } });
        expect(await screen.findByText(/Estimated close: ~/)).toBeTruthy();
        fireEvent.change(screen.getByLabelText('Max selections'), { target: { value: '3' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create poll' }));
        expect(await screen.findByText('Max selections must be a whole number from 1 to 2.')).toBeTruthy();
        expect(messaging.composeVoteForConfirm).not.toHaveBeenCalled();
    });

    it('keeps delegation required-field messages reachable from the primary action', async () => {
        mount(DelegateVoteForm, { walletId: 'wallet-1', chainId: CHAIN, onBack() {} });
        await screen.findByDisplayValue(ADDRESS.address);
        const action = screen.getByRole('button', { name: 'Delegate votes' });
        expect(action).toBeEnabled();
        fireEvent.click(action);
        expect(await screen.findByText('Governance token is required.')).toBeTruthy();
    });

    it('unwraps explorer poll rows and displays finalized results', async () => {
        const messaging = messagingWith({
            governancePoll: vi.fn().mockResolvedValue({
                data: [{
                    action_index: 7,
                    tick: 'VOTE',
                    question: 'Ship it?',
                    poll_status: 'finalized',
                    options: ['Yes', 'No'],
                    tally_mode: 'approval',
                    weight_mode: 'balance',
                    end_block: 120,
                    winning_option: 0,
                }],
            }),
            governancePollResults: vi.fn().mockResolvedValue({
                data: [{ option_index: 0, total_weight: '42', voter_count: 3 }],
            }),
        });
        mount(PollDetail, {
            walletId: 'wallet-1', chainId: CHAIN, pollIndex: 7, onBack() {},
        }, messaging);

        expect(await screen.findByText('Ship it?')).toBeTruthy();
        expect(screen.getByText('Decided')).toBeTruthy();
        expect(screen.getAllByText('0: Yes')).toHaveLength(2);
        expect(screen.getByText('42')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Vote' })).toBeNull();
    });

    it('reports a missing poll instead of leaving the loading state forever', async () => {
        mount(PollDetail, {
            walletId: 'wallet-1', chainId: CHAIN, pollIndex: 404, onBack() {},
        });
        expect(await screen.findByText('Poll not found.')).toBeTruthy();
        expect(screen.queryByText('Loading poll…')).toBeNull();
    });

    it('rejects invalid split shares before composing a ballot', async () => {
        const messaging = messagingWith({
            governancePoll: vi.fn().mockResolvedValue({
                action_index: 8,
                tick: 'VOTE',
                poll_status: 'open',
                options: ['Yes', 'No'],
                tally_mode: 'split',
                max_selections: 2,
            }),
        });
        mount(PollDetail, {
            walletId: 'wallet-1', chainId: CHAIN, pollIndex: 8, onBack() {},
        }, messaging);

        const share = await screen.findByLabelText('0: Yes');
        fireEvent.change(share, { target: { value: 'not-a-number' } });
        fireEvent.click(screen.getByRole('button', { name: 'Vote' }));
        expect(await screen.findByText('Each split share must be a positive number.')).toBeTruthy();
        expect(messaging.composeVoteForConfirm).not.toHaveBeenCalled();
    });

    it('shows the poll-list empty state after a successful empty read', async () => {
        mount(GovernancePolls, {
            walletId: 'wallet-1', onOpenPoll() {}, onCreate() {}, onDelegate() {}, onBack() {},
        });
        expect(await screen.findByText('No polls on this chain yet.')).toBeTruthy();
        expect(screen.getByText('Create the first one.')).toBeTruthy();
    });
});
