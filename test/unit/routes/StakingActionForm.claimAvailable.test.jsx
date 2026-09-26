// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression test for the claim-rewards `availableAmt` bug: before this
// fix it filtered raw `getRewardsForAddress` accrual rows by a `status`
// field that endpoint never returns (validator_rewards rows have no
// status column), so it always computed 0 against real data and
// `handleReview` rejected every partial claim with "Amount exceeds the
// 0 XCHAIN available." before a confirm ever opened. PC-47 already fixed
// the same bug in StakeDetail's splitRewards via unclaimedRewards(); this
// proves the propagated fix here, driven against endpoint-shaped rows.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { StakingActionForm } from '../../../packages/core/src/shared/routes/StakingActionForm.jsx';

const ADDRESS = 'bc1qexampleexampleexampleexampleexampleex';
const ADDRESSES = {
    'bitcoin-mainnet': [
        {
            id: 'addr-1', address: ADDRESS, publicKey: '02ab',
            derivationPath: "m/84'/0'/0'/0/0", source: 'hd',
        },
    ],
};

// Endpoint-shaped accrual rows: id, source, signing_pubkey, reward_type,
// round_reference, amount, block_index, timestamp - NO status column,
// matching what getRewardsForAddress actually returns.
const REWARD_ROWS = [
    { id: 1, source: 'A', signing_pubkey: 'pk', reward_type: 'block', round_reference: 1, amount: '10', block_index: 1, timestamp: 1 },
    { id: 2, source: 'A', signing_pubkey: 'pk', reward_type: 'block', round_reference: 2, amount: '5', block_index: 2, timestamp: 2 },
];
// One VALID claim (subtracted) plus one the chain rejected, which PC-47
// keeps claimable (not subtracted): 10 + 5 - 3 = 12 available.
const CLAIM_ROWS = [
    { id: 1, amount: '3', status: 'valid' },
    { id: 2, amount: '100', status: 'rejected' },
];

function mountForm(extra = {}, mode = 'claim-rewards') {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getRewardsForAddress: vi.fn().mockResolvedValue(REWARD_ROWS),
        getRewardClaimsForAddress: vi.fn().mockResolvedValue(CLAIM_ROWS),
        composeForConfirm: vi.fn(() => new Promise(() => {})),
        ...extra,
    };
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(StakingActionForm, {
                mode, walletId: 'w', chainId: 'bitcoin-mainnet', onBack() {},
            }),
        ),
    );
    return messaging;
}

afterEach(() => cleanup());

describe('StakingActionForm claim-rewards availableAmt (PC-47 propagation)', () => {
    it('computes available from accrual minus VALID claims, not a status filter', async () => {
        const messaging = mountForm();
        expect(await screen.findByText('12 XCHAIN available')).toBeInTheDocument();
        expect(messaging.getRewardClaimsForAddress).toHaveBeenCalledWith({
            chainId: 'bitcoin-mainnet', address: ADDRESS,
        });
    });

    it('handleReview accepts a partial amount below the computed available total', async () => {
        const messaging = mountForm();
        await screen.findByText('12 XCHAIN available');

        fireEvent.change(await screen.findByLabelText(/^Amount/), { target: { value: '7' } });
        fireEvent.click(screen.getByRole('button', { name: 'Claim rewards' }));

        // Reaching the host compose round trip proves the client-side
        // amount check did NOT bounce this partial.
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        expect(messaging.composeForConfirm.mock.calls[0][0].actionData.params.AMOUNT).toBe('7');
        expect(screen.queryByText(/Amount exceeds/)).toBeNull();
    });

    it('still rejects an amount above the computed available total', async () => {
        const messaging = mountForm();
        await screen.findByText('12 XCHAIN available');

        fireEvent.change(await screen.findByLabelText(/^Amount/), { target: { value: '999' } });
        fireEvent.click(screen.getByRole('button', { name: 'Claim rewards' }));

        expect(await screen.findByText('Amount exceeds the 12 XCHAIN available.')).toBeInTheDocument();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('offers only tip-effective stake amounts and signing keys for unstake', async () => {
        const activeKey = 'a'.repeat(64);
        const oldKey = 'b'.repeat(64);
        mountForm({
            getStakesForAddress: vi.fn().mockResolvedValue([
                { signing_pubkey: oldKey, status: 'valid', amount: '90', activation_block: 1, deactivation_block: 80 },
                { signing_pubkey: activeKey, status: 'valid', amount: '12', activation_block: 90, deactivation_block: null },
            ]),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        }, 'unstake');

        expect(await screen.findByText('12 XCHAIN available')).toBeInTheDocument();
        expect(screen.getByLabelText(/Signing public key/)).toHaveValue(activeKey);
    });
});
