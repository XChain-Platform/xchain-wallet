// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The buy Confirm belongs to the wallet and dispenser it was opened for. A
// wallet switch while it is open leaves the detail page mounted under the
// new wallet, so Approve refuses the buy instead of signing it.

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

const COMPOSED = {
    psbt: '70736274ff', encoding: 'P2SH', actionString: 'SEND|1|MEMEVALID', version: 1,
    decoded: { summary: 'Send payment', details: [], warnings: [] },
};


function tree(messaging, walletId) {
    return React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(DispenserDetail, {
            walletId, chainId: CHAIN, actionIndex: TOKEN_PAID.action_index,
            onBack() {}, onCanceled() {},
        }),
    );
}

async function mount() {
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
        getDispensersForAddress: vi.fn().mockResolvedValue({ data: [TOKEN_PAID] }),
        composeForConfirm: vi.fn().mockResolvedValue(COMPOSED),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        reserve: vi.fn().mockResolvedValue(null),
        releaseReservation: vi.fn().mockResolvedValue(null),
        checkInputLiveness: vi.fn().mockResolvedValue({ verdict: 'live', spent: [] }),
        requoteNativeFee: vi.fn().mockResolvedValue(null),
        sendToken: vi.fn().mockResolvedValue({ txid: 'deadbeef' }),
        sendAssetHw: vi.fn(),
    };
    const view = render(tree(messaging, 'wallet-a'));
    for (let pass = 0; pass < 3; pass += 1) {
        await act(async () => {
            await vi.advanceTimersByTimeAsync(400);
        });
    }
    vi.useRealTimers();
    await screen.findByText(/250 MEMEVALID available/);
    return { messaging, view };
}

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('dispenser buy Confirm across a wallet switch', () => {
    it('refuses Approve after the active wallet changes under an open Confirm', async () => {
        const { messaging, view } = await mount();
        const buy = await screen.findByRole('button', { name: /^Buy \d+ fills?$/ });
        await waitFor(() => expect(buy).toBeEnabled());
        fireEvent.click(buy);
        await screen.findByTestId('confirm-approve');
        view.rerender(tree(messaging, 'wallet-b'));
        // The page reloads for the new wallet; the open Confirm comes back with it.
        const approve = await screen.findByTestId('confirm-approve', {}, { timeout: 5000 });
        fireEvent.change(await screen.findByLabelText(/Password/i), { target: { value: 'pw' } });
        await waitFor(() => expect(approve).toBeEnabled());
        fireEvent.click(approve);
        await waitFor(() => expect(screen.queryByTestId('confirm-approve')).toBeNull());
        expect(messaging.sendToken).not.toHaveBeenCalled();
        expect(messaging.sendAssetHw).not.toHaveBeenCalled();
    });
});
