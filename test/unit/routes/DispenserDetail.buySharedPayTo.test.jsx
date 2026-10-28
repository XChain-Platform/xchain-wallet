// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// One payment fills every open dispenser behind its pay-to address that sells
// for the same asset, so a dispenser opened there after the page read its
// neighbours takes part of a buy the review priced against this dispenser
// alone. The buy reads the pay-to again before composing and at approval, and
// stops when it finds an open dispenser the review did not name.

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

// 100 DOGESWAP per fill for 5 MEMEVALID.
const TOKEN_PAID = {
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
};
// A second dispenser on the same pay-to, selling for the same token.
const NEIGHBOUR = { ...TOKEN_PAID, action_index: '901', give_tick: 'OTHERTOKEN', get_amount: '50' };
// A neighbour selling for another asset is not filled by this payment.
const UNRELATED = { ...TOKEN_PAID, action_index: '902', get_tick: 'XCHAIN' };

const COMPOSED = {
    psbt: '70736274ff', encoding: 'P2SH', actionString: 'SEND|1|MEMEVALID', version: 1,
    decoded: { summary: 'Send payment', details: [], warnings: [] },
    releaseEncoderInputsToken: 'reservation-token-1',
};

async function mount({ destinationRows = [TOKEN_PAID] } = {}) {
    vi.useFakeTimers();
    const messaging = {
        getDispenserByActionIndex: vi.fn().mockResolvedValue(TOKEN_PAID),
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
        getDispensersForAddress: vi.fn().mockResolvedValue({ data: destinationRows }),
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
                walletId: 'w', chainId: CHAIN, actionIndex: TOKEN_PAID.action_index,
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

const buyButton = () => screen.findByRole('button', { name: /^Buy \d+ fills?$/ });

async function openReview() {
    const buy = await buyButton();
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

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('dispenser buy re-reads the dispensers behind its pay-to', () => {
    it('stops at approval when another dispenser opened at the pay-to after the review', async () => {
        const messaging = await mount();
        await openReview();
        messaging.getDispensersForAddress.mockResolvedValue({ data: [TOKEN_PAID, NEIGHBOUR] });
        await approve();
        expect(await screen.findByText(/Another open dispenser at this address \(#901\)/)).toBeInTheDocument();
        expect(messaging.sendToken).not.toHaveBeenCalled();
    });

    // The refusal asks for a fresh review, which composes again; inputs the
    // encoder still holds for the refused compose would leave it nothing to spend.
    it('hands the reserved inputs back when approval stops on a new dispenser', async () => {
        const messaging = await mount();
        await openReview();
        messaging.getDispensersForAddress.mockResolvedValue({ data: [TOKEN_PAID, NEIGHBOUR] });
        await approve();
        expect(await screen.findByText(/Another open dispenser at this address \(#901\)/)).toBeInTheDocument();
        await waitFor(() => expect(messaging.releaseEncoderInputs).toHaveBeenCalledWith({ token: 'reservation-token-1' }));
        expect(messaging.releaseEncoderInputs).toHaveBeenCalledTimes(1);
        expect(messaging.sendToken).not.toHaveBeenCalled();
    });

    it('hands the reserved inputs back when the dispenser closes under an open review', async () => {
        const messaging = await mount();
        await openReview();
        messaging.getDispenserByActionIndex.mockResolvedValue({ ...TOKEN_PAID, status: 'closed', current_status: 'closed' });
        await approve();
        await waitFor(() => expect(messaging.releaseEncoderInputs).toHaveBeenCalledWith({ token: 'reservation-token-1' }));
        await waitFor(() => expect(document.body.textContent).toMatch(/This dispenser was closed/));
        expect(messaging.sendToken).not.toHaveBeenCalled();
    });

    it('stops before composing when the pay-to holds a dispenser the page did not read', async () => {
        const messaging = await mount();
        messaging.getDispensersForAddress.mockResolvedValue({ data: [TOKEN_PAID, NEIGHBOUR] });
        fireEvent.click(await buyButton());
        expect(await screen.findByText(/Another open dispenser at this address \(#901\)/)).toBeInTheDocument();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
        // The page reads the pay-to again, so the next review names both dispensers.
        await waitFor(() => expect(messaging.getDispensersForAddress.mock.calls.length).toBeGreaterThanOrEqual(3));
        await openReview();
        expect(screen.getByText(/This pays the 2 open dispensers at this address/)).toBeInTheDocument();
        expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1);
    });

    it('signs once the review names every dispenser at the pay-to', async () => {
        const messaging = await mount({ destinationRows: [TOKEN_PAID, NEIGHBOUR] });
        await openReview();
        expect(screen.getByText(/This pays the 2 open dispensers at this address/)).toBeInTheDocument();
        await approve();
        await waitFor(() => expect(messaging.sendToken).toHaveBeenCalledTimes(1));
    });

    it('ignores a dispenser at the pay-to that sells for another asset', async () => {
        const messaging = await mount();
        await openReview();
        messaging.getDispensersForAddress.mockResolvedValue({ data: [TOKEN_PAID, UNRELATED] });
        await approve();
        await waitFor(() => expect(messaging.sendToken).toHaveBeenCalledTimes(1));
    });

    it('signs when the pay-to read fails', async () => {
        const messaging = await mount();
        await openReview();
        messaging.getDispensersForAddress.mockRejectedValue(new Error('explorer down'));
        await approve();
        await waitFor(() => expect(messaging.sendToken).toHaveBeenCalledTimes(1));
    });
});
