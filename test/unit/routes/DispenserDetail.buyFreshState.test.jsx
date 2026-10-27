// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A dispenser detail page that stays open while the dispenser closes, expires
// or sells out must not compose a payment to it. The payment reaches the
// creator and releases nothing, so the buy re-reads the dispenser before it
// composes and again at approval, and stops on a dispenser that is no longer
// open or that holds fewer complete fills than the buyer asked for.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispenserDetail } from '../../../packages/core/src/shared/routes/DispenserDetail.jsx';

const CHAIN = 'bitcoin-mainnet';
const BUYER = 'bc1qbuyerbuyerbuyerbuyerbuyerbuyerbuyerbu';
const OWNER = 'bc1qownerownerownerownerownerownerownerow';

const ADDRESSES = {
    [CHAIN]: [{
        id: 'addr-1', address: BUYER, publicKey: '02ab',
        derivationPath: "m/84'/0'/0'/0/0", source: 'hd',
    }],
};

const OPEN = {
    action_index: '3543',
    source: OWNER,
    address: OWNER,
    give_tick: 'PEPECREATURE',
    give_amount: '100',
    get_tick: 'MEMEVALID',
    get_amount: '5',
    escrow_remaining: '1000',
    status: 'open',
    current_status: 'open',
};

function mount() {
    const messaging = {
        getDispenserByActionIndex: vi.fn().mockResolvedValue(OPEN),
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getDispenses: vi.fn().mockResolvedValue({ data: [] }),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                address: BUYER,
                balances: {
                    native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                    tokens: [{ tick: 'MEMEVALID', quantity: '250', divisibility: 0 }],
                },
            }],
        }),
        getSettings: vi.fn().mockResolvedValue({}),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: '70736274ff', encoding: 'P2SH', actionString: 'SEND|1|MEMEVALID', version: 1,
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        sendToken: vi.fn().mockResolvedValue({ txid: 'deadbeef' }),
    };
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(DispenserDetail, {
                walletId: 'w', chainId: CHAIN, actionIndex: '3543', onBack() {}, onCanceled() {},
            }),
        ),
    );
    return messaging;
}

const buyButton = () => screen.getByRole('button', { name: /^Buy \d+ fills?$/ });

async function settle() {
    for (let pass = 0; pass < 3; pass += 1) {
        await act(async () => {
            await vi.advanceTimersByTimeAsync(400);
        });
    }
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('dispenser buy re-reads the dispenser before composing', () => {
    it('stops when the dispenser closed after the page loaded', async () => {
        const messaging = mount();
        await settle();
        expect(screen.getByText(/250 MEMEVALID available/)).toBeInTheDocument();
        messaging.getDispenserByActionIndex.mockResolvedValue({
            ...OPEN, current_status: 'closed', state: { status: 'closed', give_remaining: '0' },
        });
        fireEvent.click(buyButton());
        await settle();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
        expect(document.body.textContent).toMatch(/This dispenser was closed/);
        expect(screen.queryByRole('button', { name: /^Buy \d+ fills?$/ })).not.toBeInTheDocument();
        expect(screen.queryByTestId('confirm-approve')).not.toBeInTheDocument();
    });

    it('stops when the escrow fell below the fills asked for', async () => {
        const messaging = mount();
        await settle();
        fireEvent.change(screen.getByLabelText(/Fills/i), { target: { value: '3' } });
        messaging.getDispenserByActionIndex.mockResolvedValue({
            ...OPEN, state: { status: 'open', give_remaining: '200' },
        });
        fireEvent.click(buyButton());
        await settle();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
        expect(screen.getAllByRole('alert').map((a) => a.textContent).join(' ')).toMatch(/Only 2 complete fills remain/i);
    });

    it('still composes when the re-read shows the dispenser open', async () => {
        const messaging = mount();
        await settle();
        fireEvent.click(buyButton());
        await settle();
        expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('confirm-approve')).toBeInTheDocument();
    });

    it('still composes when the re-read fails', async () => {
        const messaging = mount();
        await settle();
        messaging.getDispenserByActionIndex.mockRejectedValue(new Error('explorer down'));
        fireEvent.click(buyButton());
        await settle();
        expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1);
    });
});
