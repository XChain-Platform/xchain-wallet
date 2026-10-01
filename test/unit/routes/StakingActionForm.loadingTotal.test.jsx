// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A typed amount must never become a claim or unstake of everything. On
// 2026-09-30 a testnet claim typed 1 while the reward total still read
// "Loading…" and the chain recorded COLLECT|0, paying the whole 130: the
// form sent the absent-AMOUNT bytes whenever it could not compare the amount
// against a known total.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { StakingActionForm } from '../../../packages/core/src/shared/routes/StakingActionForm.jsx';

const ADDRESS = 'bc1qexampleexampleexampleexampleexampleex';
const ADDRESSES = {
    'bitcoin-mainnet': [
        { id: 'addr-1', address: ADDRESS, publicKey: '02ab', derivationPath: "m/84'/0'/0'/0/0", source: 'hd' },
    ],
};
const REWARD_ROWS = [
    { id: 1, source: 'A', signing_pubkey: 'pk', reward_type: 'block', round_reference: 1, amount: '100', block_index: 1, timestamp: 1 },
    { id: 2, source: 'A', signing_pubkey: 'pk', reward_type: 'block', round_reference: 2, amount: '30', block_index: 2, timestamp: 2 },
];
const PK = 'b'.repeat(64);
const never = () => new Promise(() => {});

function mountForm(extra = {}, mode = 'claim-rewards') {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getRewardsForAddress: vi.fn().mockResolvedValue(REWARD_ROWS),
        getRewardClaimsForAddress: vi.fn().mockResolvedValue([]),
        getStakesForAddress: vi.fn().mockResolvedValue([{ signing_pubkey: PK, amount: '25000' }]),
        composeForConfirm: vi.fn(never),
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

describe('StakingActionForm while the total is loading', () => {
    it('blocks a claim submit and says why, instead of claiming everything', async () => {
        const messaging = mountForm({ getRewardsForAddress: vi.fn(never) });
        const amount = await screen.findByLabelText(/^Amount/);
        await screen.findByText('Loading…');
        fireEvent.change(amount, { target: { value: '1' } });
        const button = screen.getByRole('button', { name: 'Claim rewards' });
        expect(button).toBeDisabled();
        fireEvent.submit(button.closest('form'));
        expect(await screen.findByText(/pending reward total is still loading/)).toBeInTheDocument();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('blocks an unstake submit the same way', async () => {
        const messaging = mountForm({ getStakesForAddress: vi.fn(never) }, 'unstake');
        const amount = await screen.findByLabelText(/^Amount/);
        await screen.findByText('Loading…');
        fireEvent.change(screen.getByLabelText(/Signing public key/i), { target: { value: PK } });
        fireEvent.change(amount, { target: { value: '1' } });
        const button = screen.getByRole('button', { name: 'Unstake' });
        expect(button).toBeDisabled();
        fireEvent.submit(button.closest('form'));
        expect(await screen.findByText(/staked balance is still loading/)).toBeInTheDocument();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });
});

describe('StakingActionForm encodes the amount that was typed', () => {
    it('claims exactly 1 of 130 as AMOUNT 1, never COLLECT|0', async () => {
        const messaging = mountForm();
        await screen.findByText('130 XCHAIN available');
        fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Claim rewards' }));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        const { action, params } = messaging.composeForConfirm.mock.calls[0][0].actionData;
        expect(action).toBe('COLLECT');
        expect(params).toEqual({ VERSION: '0', AMOUNT: '1' });
    });

    it('unstakes exactly 1 of 25,000 as AMOUNT 1', async () => {
        const messaging = mountForm({}, 'unstake');
        await screen.findByText('25,000 XCHAIN available');
        fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Unstake' }));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        const { action, params } = messaging.composeForConfirm.mock.calls[0][0].actionData;
        expect(action).toBe('UNSTAKE');
        expect(params).toEqual({ VERSION: '0', SIGNING_PUBKEY: PK, AMOUNT: '1' });
    });

    it('refuses an amount past 8 decimal places with a visible error', async () => {
        const messaging = mountForm();
        await screen.findByText('130 XCHAIN available');
        fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '1.123456789' } });
        fireEvent.click(screen.getByRole('button', { name: 'Claim rewards' }));
        expect(await screen.findByText(/at most 8 decimal places/)).toBeInTheDocument();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });
});

describe('stakingActionParams', () => {
    it('sends the typed amount when the total is unknown, never the absent-AMOUNT "everything" form', async () => {
        const { stakingActionParams } = await import('../../../packages/core/src/flows/unstakeClaimActions.js');
        expect(stakingActionParams({ isUnstake: false, amount: '1', availableAmt: null }).params)
            .toEqual({ VERSION: '0', AMOUNT: '1' });
        expect(stakingActionParams({ isUnstake: true, signingPubkey: PK, amount: '1', availableAmt: undefined }).params)
            .toEqual({ VERSION: '0', SIGNING_PUBKEY: PK, AMOUNT: '1' });
    });

    it('uses the absent-AMOUNT form only for an amount equal to a known total', async () => {
        const { stakingActionParams } = await import('../../../packages/core/src/flows/unstakeClaimActions.js');
        expect(stakingActionParams({ isUnstake: false, amount: '130', availableAmt: '130' }))
            .toMatchObject({ params: { VERSION: '0' }, isWholeAmount: true });
        expect(stakingActionParams({ isUnstake: false, amount: '1,000', availableAmt: '1000' }).params)
            .toEqual({ VERSION: '0' });
    });

    it('produces no params for a missing or unparsable amount', async () => {
        const { stakingActionParams } = await import('../../../packages/core/src/flows/unstakeClaimActions.js');
        for (const amount of ['', '0', 'all', '.', '1.123456789', undefined]) {
            expect(stakingActionParams({ isUnstake: false, amount, availableAmt: '130' }).params, String(amount)).toBeNull();
        }
    });
});
