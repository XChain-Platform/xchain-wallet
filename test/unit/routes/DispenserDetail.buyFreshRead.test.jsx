// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The reads a dispenser buy makes at Approve decide whether it signs, so each
// one asks for a fresh read: the explorer wrapper serves an identical read
// from the last two seconds again and the explorer's answers are HTTP-cacheable
// for five, which would let a dispenser that opened at the pay-to a moment
// before Approve go unseen. The reads that render the page stay ordinary.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispenserDetail } from '../../../packages/core/src/shared/routes/DispenserDetail.jsx';

const CHAIN = 'dogecoin-testnet';
const BUYER = 'nBuyerBuyerBuyerBuyerBuyerBuyerBuyer1';
const OWNER = 'ndNNBSVgGUvHfh6k3xYmZVstV7nLRacsnH';

const buyerAddress = {
    id: 'addr-1', address: BUYER, publicKey: '02ab',
    derivationPath: "m/44'/1'/0'/0/0", source: 'hd',
};

// 100 DOGESWAP per fill for 5 MEMEVALID, behind a block list that names someone else.
const DISPENSER = {
    action_index: '817',
    source: OWNER,
    address: OWNER,
    give_tick: 'DOGESWAP',
    give_amount: '100',
    get_tick: 'MEMEVALID',
    get_coin: null,
    get_amount: '5',
    escrow_remaining: '1000',
    status: 'open',
    current_status: 'open',
    block_list: '55',
};

const COMPOSED = {
    psbt: '70736274ff', encoding: 'P2SH', actionString: 'SEND|1|MEMEVALID', version: 1,
    decoded: { summary: 'Send payment', details: [], warnings: [] },
    releaseEncoderInputsToken: 'reservation-token-1',
};

async function mount() {
    vi.useFakeTimers();
    const messaging = {
        getDispenserByActionIndex: vi.fn().mockResolvedValue(DISPENSER),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [buyerAddress] }),
        getDispenses: vi.fn().mockResolvedValue({ data: [] }),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                address: BUYER,
                balances: {
                    native: { tick: 'DOGE', quantity: '1000000000', divisibility: 8 },
                    tokens: [{ tick: 'MEMEVALID', quantity: '250', divisibility: 0 }],
                },
            }],
        }),
        getSettings: vi.fn().mockResolvedValue({}),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
        getDispensersForAddress: vi.fn().mockResolvedValue({ data: [DISPENSER] }),
        getTokenInfo: vi.fn().mockResolvedValue({ allowList: null, blockList: null }),
        getListByActionIndex: vi.fn().mockResolvedValue({ list: [{ address: 'nSomeoneElseSomeoneElseSomeoneElse1' }] }),
        composeForConfirm: vi.fn().mockResolvedValue(COMPOSED),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        reserve: vi.fn().mockResolvedValue(null),
        releaseReservation: vi.fn().mockResolvedValue(null),
        checkInputLiveness: vi.fn().mockResolvedValue({ verdict: 'live', spent: [] }),
        requoteNativeFee: vi.fn().mockResolvedValue(null),
        releaseEncoderInputs: vi.fn().mockResolvedValue({ released: 1 }),
        sendToken: vi.fn().mockResolvedValue({ txid: 'deadbeef' }),
        sendAssetHw: vi.fn(),
    };
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(DispenserDetail, {
                walletId: 'w', chainId: CHAIN, actionIndex: DISPENSER.action_index,
                onBack() {}, onCanceled() {},
            }),
        ),
    );
    for (let pass = 0; pass < 3; pass += 1) {
        await act(async () => {
            await vi.advanceTimersByTimeAsync(400);
        });
    }
    vi.useRealTimers();
    await screen.findByText(/250 MEMEVALID available/);
    return messaging;
}

async function openReview() {
    const buy = await screen.findByRole('button', { name: /^Buy \d+ fills?$/ });
    await waitFor(() => expect(buy).toBeEnabled());
    fireEvent.click(buy);
    return screen.findByTestId('confirm-approve');
}

async function approve() {
    fireEvent.change(await screen.findByLabelText(/Password/i), { target: { value: 'pw' } });
    const button = screen.getByTestId('confirm-approve');
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
}

const READS = ['getDispenserByActionIndex', 'getDispensersForAddress', 'getTokenInfo', 'getListByActionIndex'];

/** Each read's requests from call `from` on. */
function requestsSince(messaging, marks) {
    return Object.fromEntries(READS.map((name) => [
        name, messaging[name].mock.calls.slice(marks[name]).map(([req]) => req),
    ]));
}

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('dispenser buy reads fresh at Approve', () => {
    it('tags every Approve-time read fresh and leaves the review reads ordinary', async () => {
        const messaging = await mount();
        await openReview();
        const marks = Object.fromEntries(READS.map((name) => [name, messaging[name].mock.calls.length]));
        const before = requestsSince(messaging, Object.fromEntries(READS.map((name) => [name, 0])));

        await approve();
        await waitFor(() => expect(messaging.sendToken).toHaveBeenCalledTimes(1));

        const atApprove = requestsSince(messaging, marks);
        for (const name of READS) {
            expect(atApprove[name].length, name).toBeGreaterThan(0);
            for (const req of atApprove[name]) expect(req, name).toMatchObject({ fresh: true });
            for (const req of before[name]) expect(req.fresh, name).toBeUndefined();
        }
        expect(atApprove.getDispenserByActionIndex[0]).toEqual({
            chainId: CHAIN, actionIndex: DISPENSER.action_index, fresh: true,
        });
        expect(atApprove.getDispensersForAddress[0]).toEqual({ chainId: CHAIN, address: OWNER, fresh: true });
        expect(atApprove.getListByActionIndex[0]).toEqual({ chainId: CHAIN, actionIndex: '55', fresh: true });
    });

    it('refuses at Approve when the fresh pay-to read finds a dispenser the review did not name', async () => {
        const messaging = await mount();
        await openReview();
        messaging.getDispensersForAddress.mockImplementation(async (req) => ({
            data: req.fresh ? [DISPENSER, { ...DISPENSER, action_index: '901', give_tick: 'OTHERTOKEN' }] : [DISPENSER],
        }));
        await approve();
        expect(await screen.findByText(/Another open dispenser at this address \(#901\)/)).toBeInTheDocument();
        expect(messaging.sendToken).not.toHaveBeenCalled();
    });
});
