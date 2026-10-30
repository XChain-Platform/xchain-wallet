// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A bet is judged by the block it lands in, so a market that closes while the
// review is on screen turns Approve into a payment that joins no pool: the
// miner fee and the protocol fee are spent and the stake is lost to the
// rejection. The market page reads the market again at Approve, after the
// review, and a market that no longer takes bets stops the signature.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BetFeedDetail } from '../../../packages/core/src/shared/routes/BetFeedDetail.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'address-1',
    address: 'bc1qbettorbettorbettorbettorbettorbettorbx',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};
const ORACLE = 'bc1qoracleoracleoracleoracleoracleoraclex';

const FEED = Object.freeze({
    action_index: '730010',
    source: ORACLE,
    label: 'Will it ship?',
    outcomes: 'Yes,No',
    tick: 'EXAMPLE',
    fee: '2.5',
    min_amount: '25',
    deadline: Math.floor(Date.now() / 1000) + 86400,
    expire_at: Math.floor(Date.now() / 1000) + 172800,
    feed_status: 'open',
    pools: [{ outcome: 0, pool: '150', bet_count: 2 }],
    timeline: [{ status: 'open', block_index: 4217 }],
});

const CLOSED = Object.freeze({
    ...FEED,
    deadline: Math.floor(Date.now() / 1000) - 60,
    feed_status: 'closed',
});

function messagingWith({ atApprove }) {
    let composed = false;
    const placeBetAction = vi.fn().mockResolvedValue({ txid: 'tx-bet' });
    const releaseEncoderInputs = vi.fn().mockResolvedValue({ released: 1 });
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        // The market reads open for the page and for the read before compose;
        // the read after the review opens is the one under test.
        betFeed: vi.fn(async () => {
            if (!composed) return { data: [{ ...FEED }] };
            return atApprove();
        }),
        bets: vi.fn().mockResolvedValue({ data: [] }),
        betProjectPayout: vi.fn().mockResolvedValue(null),
        composeBetForConfirm: vi.fn(async () => {
            composed = true;
            return {
                psbt: 'aa00', encoding: 'psbt', actionString: 'BET|1|730010|0|30', version: 1,
                releaseEncoderInputsToken: 'release-1',
                params: { feedActionIndex: '730010', outcome: 0, amount: '30' },
            };
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        checkInputLiveness: vi.fn().mockResolvedValue({ verdict: 'live', spent: [] }),
        requoteNativeFee: vi.fn().mockResolvedValue(null),
        reserve: vi.fn().mockResolvedValue({}),
        releaseReservation: vi.fn().mockResolvedValue({}),
        releaseEncoderInputs,
        placeBetAction,
        placeBetActionHw: vi.fn().mockResolvedValue({ txid: 'tx-bet-hw' }),
    };
}

function mount(messaging) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <BetFeedDetail walletId="wallet-1" chainId={CHAIN} feedIndex="730010" onBack={vi.fn()} />
        </MessagingProvider>,
    );
}

async function openReview() {
    fireEvent.click(await screen.findByRole('button', { name: 'Yes' }));
    fireEvent.change(screen.getByLabelText(/Stake/), { target: { value: '30' } });
    const review = screen.getByRole('button', { name: /Review bet/ });
    await waitFor(() => expect(review).not.toBeDisabled());
    fireEvent.click(review);
    return waitFor(() => {
        const approve = screen.getAllByRole('button').find((b) => /approve/i.test(b.textContent || '') && !b.disabled);
        expect(approve).toBeTruthy();
        return approve;
    });
}

afterEach(() => {
    cleanup();
});

describe('BetFeedDetail reads the market again at Approve', () => {
    it('refuses before signing when the market closes after the review opens', async () => {
        const messaging = messagingWith({ atApprove: () => ({ data: [{ ...CLOSED }] }) });
        mount(messaging);
        const approve = await openReview();

        fireEvent.click(approve);

        expect(await screen.findByText(/no longer takes bets/)).toBeInTheDocument();
        expect(messaging.placeBetAction).not.toHaveBeenCalled();
        expect(messaging.placeBetActionHw).not.toHaveBeenCalled();
    });

    it('refuses before signing when the market is cancelled after the review opens', async () => {
        const messaging = messagingWith({ atApprove: () => ({ data: [{ ...FEED, feed_status: 'cancelled' }] }) });
        mount(messaging);
        const approve = await openReview();

        fireEvent.click(approve);

        expect(await screen.findByText(/no longer takes bets/)).toBeInTheDocument();
        expect(messaging.placeBetAction).not.toHaveBeenCalled();
    });

    it('signs once when the market still reads open at Approve', async () => {
        const messaging = messagingWith({ atApprove: () => ({ data: [{ ...FEED }] }) });
        mount(messaging);
        const approve = await openReview();

        fireEvent.click(approve);

        await waitFor(() => expect(messaging.placeBetAction).toHaveBeenCalledTimes(1));
    });

    it('signs when the market read at Approve fails, since an unknown market is not a closed one', async () => {
        const messaging = messagingWith({ atApprove: () => { throw new Error('indexer unavailable'); } });
        mount(messaging);
        const approve = await openReview();

        fireEvent.click(approve);

        await waitFor(() => expect(messaging.placeBetAction).toHaveBeenCalledTimes(1));
        expect(screen.queryByText(/no longer takes bets/)).not.toBeInTheDocument();
    });
});
