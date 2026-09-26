// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A partial COLLECT must be submittable against endpoint-shaped reward
// rows (no status column): the form has to emit AMOUNT for a strict
// partial and omit it when the whole pending balance is claimed.

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
    { id: 1, source: 'A', signing_pubkey: 'pk', reward_type: 'block', round_reference: 1, amount: '10', block_index: 1, timestamp: 1 },
    { id: 2, source: 'A', signing_pubkey: 'pk', reward_type: 'block', round_reference: 2, amount: '5', block_index: 2, timestamp: 2 },
];

function mountForm(extra = {}, mode = 'claim-rewards') {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getRewardsForAddress: vi.fn().mockResolvedValue(REWARD_ROWS),
        getRewardClaimsForAddress: vi.fn().mockResolvedValue([]),
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

describe('StakingActionForm partial COLLECT', () => {
    it('submits a strict partial with AMOUNT', async () => {
        const messaging = mountForm();
        await screen.findByText('15 XCHAIN available');
        fireEvent.change(await screen.findByLabelText(/^Amount/), { target: { value: '4' } });
        fireEvent.click(screen.getByRole('button', { name: 'Claim rewards' }));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        expect(messaging.composeForConfirm.mock.calls[0][0].actionData.params).toEqual({ VERSION: '0', AMOUNT: '4' });
    });

    it('omits AMOUNT when claiming the full pending balance', async () => {
        const messaging = mountForm();
        await screen.findByText('15 XCHAIN available');
        fireEvent.click(screen.getByRole('button', { name: 'Claim rewards' }));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        expect(messaging.composeForConfirm.mock.calls[0][0].actionData.params).toEqual({ VERSION: '0' });
    });
});

describe('StakingActionForm partial UNSTAKE', () => {
    it('keeps an amount one atomic unit below the available stake', async () => {
        const signingPubkey = 'a'.repeat(64);
        const composeForConfirm = vi.fn(() => new Promise(() => {}));
        const messaging = mountForm({
            getStakesForAddress: vi.fn().mockResolvedValue([{
                signing_pubkey: signingPubkey,
                amount: '90071992.54740902',
            }]),
            composeForConfirm,
        }, 'unstake');

        expect(await screen.findByText('90,071,992.54740902 XCHAIN available'))
            .toBeInTheDocument();
        fireEvent.change(screen.getByLabelText(/^Amount/), {
            target: { value: '90071992.54740901' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Unstake' }));

        await waitFor(() => expect(composeForConfirm).toHaveBeenCalledTimes(1));
        expect(messaging.composeForConfirm.mock.calls[0][0].actionData.params.AMOUNT)
            .toBe('90071992.54740901');
    });
});
