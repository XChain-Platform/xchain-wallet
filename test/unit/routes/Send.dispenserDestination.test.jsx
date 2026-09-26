// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A coin-paid dispenser is triggered by a bare Send to its address, with no
// XChain action naming it, so the review screen read as an ordinary payment.
// A refused purchase (stale oracle, payer off the allow list) keeps the coin,
// so this drives the real Send component to its confirm screen and reads the
// dispenser notice there. Fixtures follow the explorer's two lanes: the
// by-address list row has no lists or FIAT_CODE; the by-index detail does.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';

const CHAIN_ID = 'bitcoin-mainnet';
const FROM = 'bc1qsendersendersendersendersendersendersa';
const DISPENSER_ADDR = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

const COIN_DISPENSER_ROW = {
    action_index: '9001', block_index: 500,
    source: 'bc1qownerownerownerownerownerownerownerow',
    address: DISPENSER_ADDR,
    give_tick: 'DOGI', give_amount: '5',
    get_coin: 'BTC', get_amount: '0.01',
    status: 'valid', current_status: 'open', escrow_remaining: '500',
};
const TOKEN_DISPENSER_ROW = {
    ...COIN_DISPENSER_ROW,
    action_index: '9002',
    give_amount: '5',
    get_tick: 'XCHAIN',
    get_amount: '4',
    escrow_remaining: '10',
};
const ORACLE_ADDRESS = 'bc1qoracleoracleoracleoracleoracleoracle01';

function mount(extraMessaging = {}, sendProps = {}) {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN_ID]: [{
                id: 'addr-1', address: FROM, publicKey: '02ab',
                derivationPath: "m/84'/0'/0'/0/0", source: 'hd',
            }],
        }),
        getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: 'BTC', quantity: '1000000000', divisibility: 8 },
            tokens: [],
        }),
        getSettings: vi.fn().mockResolvedValue({ grace: { testSendThresholdSats: 0 } }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: true }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: '70736274ff', encoding: 'P2SH', actionString: 'SEND|1|…', version: 1,
        }),
        sendToken: vi.fn().mockResolvedValue({ txid: 'deadbeef' }),
        getAddressHistory: vi.fn().mockResolvedValue([]),
        getDispensersForAddress: vi.fn().mockResolvedValue({ data: [] }),
        ...extraMessaging,
    };
    const messaging = new Proxy(base, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            target[prop] = stub;
            return stub;
        },
    });
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(Send, { walletId: 'w', onBack() {}, ...sendProps }),
        ),
    );
    return messaging;
}

async function fillAndReview({ to, amount }) {
    fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: to } });
    fireEvent.change(await screen.findByLabelText(/^Amount \(/), { target: { value: amount } });
    fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
}

afterEach(() => cleanup());

// A negative assertion only means something once the debounced lookup ran.
async function lookupSettled(messaging) {
    await waitFor(() => expect(messaging.getDispensersForAddress).toHaveBeenCalled(), { timeout: 3000 });
    await new Promise((r) => { setTimeout(r, 50); });
}

describe('Send review: destination matches an open dispenser', () => {
    it('states which dispenser and what the sender would receive', async () => {
        const messaging = mount({
            getDispensersForAddress: vi.fn().mockResolvedValue({ data: [COIN_DISPENSER_ROW] }),
        });
        await fillAndReview({ to: DISPENSER_ADDR, amount: '0.02' });
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled(), { timeout: 3000 });

        expect(await screen.findByText(/This pays dispenser #9001/, {}, { timeout: 3000 }))
            .toBeInTheDocument();
        expect(screen.getByText(/you would receive 10 DOGI/)).toBeInTheDocument();
        expect(messaging.getDispensersForAddress).toHaveBeenCalledWith({
            chainId: CHAIN_ID, address: DISPENSER_ADDR,
        });
    });

    it('says nothing extra for an ordinary address that is not a dispenser', async () => {
        const messaging = mount();
        await fillAndReview({ to: DISPENSER_ADDR, amount: '0.02' });
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled(), { timeout: 3000 });
        await lookupSettled(messaging);

        expect(screen.queryByText(/This pays dispenser/)).toBeNull();
    });

    it('shows a capped purchase for a matching token-priced dispenser', async () => {
        mount({
            getDispensersForAddress: vi.fn().mockResolvedValue({
                data: [COIN_DISPENSER_ROW, TOKEN_DISPENSER_ROW],
            }),
            getDispenserByActionIndex: vi.fn().mockResolvedValue({
                ...TOKEN_DISPENSER_ROW, state: { status: 'open', allow_list: '77' },
            }),
            getListByActionIndex: vi.fn().mockResolvedValue({
                list: [{ address: DISPENSER_ADDR }],
            }),
        }, { prefill: { chainId: CHAIN_ID, tick: 'XCHAIN' } });
        await fillAndReview({ to: DISPENSER_ADDR, amount: '12' });

        expect(await screen.findByText(/This pays dispenser #9002/, {}, { timeout: 3000 }))
            .toBeInTheDocument();
        expect(screen.getByText(/you would receive 10 DOGI, all it has left/)).toBeInTheDocument();
        expect(screen.getByText(/rest of this payment is not refunded/)).toBeInTheDocument();
        expect(screen.getByText(/address you are sending from is not allowed to buy/)).toBeInTheDocument();
        expect(screen.queryByText(/#9001/)).toBeNull();
    });

    it('shows no purchase hint when the sent token does not match the dispenser price token', async () => {
        const messaging = mount({
            getDispensersForAddress: vi.fn().mockResolvedValue({ data: [TOKEN_DISPENSER_ROW] }),
        }, { prefill: { chainId: CHAIN_ID, tick: 'OTHER' } });
        await fillAndReview({ to: DISPENSER_ADDR, amount: '12' });
        await lookupSettled(messaging);

        expect(screen.queryByText(/This pays dispenser/)).toBeNull();
    });

    it('warns when the sender is off the dispenser\'s allow list', async () => {
        mount({
            getDispensersForAddress: vi.fn().mockResolvedValue({ data: [COIN_DISPENSER_ROW] }),
            // The allow list is only on the by-index read, in its live state.
            getDispenserByActionIndex: vi.fn().mockResolvedValue({
                ...COIN_DISPENSER_ROW, address: undefined, get_address: DISPENSER_ADDR,
                allow_list: null, state: { status: 'open', allow_list: '77' },
            }),
            // Includes the dispenser's OWN pay-to address (so it is not the
            // D-161 self-barred case) but not the sender's, so the sender's
            // own membership is what refuses the buy.
            getListByActionIndex: vi.fn().mockResolvedValue({
                list: [{ address: DISPENSER_ADDR }],
            }),
        });
        await fillAndReview({ to: DISPENSER_ADDR, amount: '0.02' });
        await screen.findByText(/This pays dispenser #9001/, {}, { timeout: 3000 });

        expect(await screen.findByText(/address you are sending from is not allowed to buy/, {}, { timeout: 3000 }))
            .toBeInTheDocument();
    });

    it('warns when the dispenser\'s oracle has no current price', async () => {
        const oracleRow = { ...COIN_DISPENSER_ROW, get_amount: '0', oracle_address: ORACLE_ADDRESS };
        const messaging = mount({
            getDispensersForAddress: vi.fn().mockResolvedValue({ data: [oracleRow] }),
            getDispenserByActionIndex: vi.fn().mockResolvedValue({
                ...oracleRow, fiat_code: 'USD', fiat_amount: null,
            }),
            oracleFeeds: vi.fn().mockResolvedValue([{
                tick: 'DOGI', fiat: 'USD', live: null, pending: { value: '0.05' },
            }]),
        });
        await fillAndReview({ to: DISPENSER_ADDR, amount: '0.02' });

        expect(await screen.findByText(/This pays dispenser #9001: it is priced in USD/, {}, { timeout: 3000 }))
            .toBeInTheDocument();
        expect(await screen.findByText(/oracle has no current price/, {}, { timeout: 3000 }))
            .toBeInTheDocument();
        expect(messaging.oracleFeeds).toHaveBeenCalledWith({ chainId: CHAIN_ID, address: ORACLE_ADDRESS });
    });

    it('raises no oracle warning while the oracle has a live price', async () => {
        const oracleRow = { ...COIN_DISPENSER_ROW, get_amount: '0', oracle_address: ORACLE_ADDRESS };
        mount({
            getDispensersForAddress: vi.fn().mockResolvedValue({ data: [oracleRow] }),
            getDispenserByActionIndex: vi.fn().mockResolvedValue({ ...oracleRow, fiat_code: 'USD' }),
            oracleFeeds: vi.fn().mockResolvedValue([{ tick: 'DOGI', fiat: 'USD', live: { value: '0.05' } }]),
        });
        await fillAndReview({ to: DISPENSER_ADDR, amount: '0.02' });
        await screen.findByText(/This pays dispenser #9001/, {}, { timeout: 3000 });
        expect(screen.queryByText(/oracle has no current price/)).toBeNull();
    });

    it('ignores a dispenser that is no longer open', async () => {
        const messaging = mount({
            getDispensersForAddress: vi.fn().mockResolvedValue({
                data: [{ ...COIN_DISPENSER_ROW, current_status: 'cancelled' }],
            }),
        });
        await fillAndReview({ to: DISPENSER_ADDR, amount: '0.02' });
        await lookupSettled(messaging);
        expect(screen.queryByText(/This pays dispenser/)).toBeNull();
    });
});
