// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The cancel-order and cancel-swap routes leave the session's Cancelling
// mark once their cancel broadcasts, so Order detail, Swap Details and the
// My Orders and My Swaps lists show it the moment Back returns there, the
// same as the in-place form did. The signing lane is stubbed to a broadcast.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act as domAct, cleanup, fireEvent, render } from '@testing-library/react';

const { ownerRun } = vi.hoisted(() => ({ ownerRun: vi.fn() }));

vi.mock('../../../packages/core/src/shared/hooks/useOwnerActionLane.js', () => ({
    useOwnerActionLane: () => ({
        open: false,
        composing: false,
        isWatcherMode: false,
        confirmProps: {},
        run: ownerRun,
    }),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CancelOrderForm } from '../../../packages/core/src/shared/routes/CancelOrderForm.jsx';
import { CancelSwapForm } from '../../../packages/core/src/shared/routes/CancelSwapForm.jsx';
import { hasOrderCancelBroadcast, orderKey } from '../../../packages/core/src/shared/utils/orderCancelMarks.js';
import { hasSwapCancelBroadcast } from '../../../packages/core/src/shared/utils/swapCancelMarks.js';

const CHAIN = 'dogecoin-testnet';
const OWN = 'ndDEAAyn7DcGeaQ6chBWH2vaSdYAXVGNhc';
const FUTURE = Math.floor(Date.now() / 1000) + 3600;
const TXID = 'c'.repeat(64);

const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0', address: OWN, publicKey: '02aabbcc',
    derivationPath: "m/44'/1'/0'/0/0", source: 'hd', signerId: 'signer-1',
});

function row(action) {
    return {
        action, action_index: action === 'SWAP' ? '812' : '700', source: OWN,
        give_tick: 'DOGESWAP', give_coin: 'DOGE', give_amount: '500', give_ownership: 0,
        get_tick: null, get_coin: 'DOGE', get_amount: '10.5', get_ownership: 0,
        expiration: FUTURE, block_index: '67882087', status: 'valid',
        state: { status: 'open', give_remaining: '500', expiration: String(FUTURE) },
    };
}

function messaging() {
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [HD_ADDRESS] }),
        getOrderDetail: () => Promise.resolve(row('ORDER')),
        getOrderCancelsForAddress: () => Promise.resolve({ data: [] }),
        listAutopayOrders: () => Promise.resolve([]),
        getSwapDetail: () => Promise.resolve({ data: row('SWAP') }),
        getSwapCancelsForAddress: () => Promise.resolve({ data: [] }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
    };
    return new Proxy(target, {
        get(t, prop) { return prop in t ? t[prop] : () => Promise.resolve({}); },
    });
}

async function drain(rounds = 40) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

afterEach(() => {
    cleanup();
    ownerRun.mockReset();
});

describe('a cancel route leaves the Cancelling mark once it broadcasts', () => {
    it.each([
        ['cancel-order', CancelOrderForm, '700', 'Cancel Order', (m) => hasOrderCancelBroadcast(m, orderKey(CHAIN, '700'))],
        ['cancel-swap', CancelSwapForm, '812', 'Cancel Swap', (m) => hasSwapCancelBroadcast(m, `${CHAIN}:812`)],
    ])('%s', async (_route, Component, actionIndex, button, marked) => {
        ownerRun.mockResolvedValue({ txid: TXID });
        const m = messaging();
        let utils;
        await domAct(async () => {
            utils = render(
                <MessagingProvider shell="web" messaging={m}>
                    <Component walletId="w" chainId={CHAIN} actionIndex={actionIndex} onBack={() => {}} />
                </MessagingProvider>,
            );
            await drain();
        });
        expect(marked(m)).toBe(false);
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: button }));
            await drain();
        });
        expect(ownerRun).toHaveBeenCalledTimes(1);
        // The cancel is v1 of the item's own action, with the fee pick riding along.
        const { actionData, encoderOpts } = ownerRun.mock.calls[0][0];
        expect(actionData.params).toMatchObject({ VERSION: '1' });
        expect(encoderOpts).toHaveProperty('feePerKb');
        expect(utils.getByText('Cancel broadcast')).toBeTruthy();
        expect(marked(m)).toBe(true);
    });
});
