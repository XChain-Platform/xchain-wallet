// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// My orders and My swaps read each open offer's lifecycle once per load.
//
// The per-owner list feeds (orders.forAddress, swaps.forAddress) already
// hydrate every row with its action detail's `state` block when the chain
// clock is current. Reading the same detail again for every open row doubles
// the cost: a wallet with 2,000 open orders sends 4,000 action reads per visit
// and takes 32 s to open against a 20 ms explorer. A row that arrives with a
// lifecycle status is read from the row; only a row without one costs a
// detail read, and a hydrated filled order still files under Closed.

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act as domAct, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MyOrdersView } from '../../../packages/core/src/shared/routes/MyOrdersView.jsx';
import { MySwapsView } from '../../../packages/core/src/shared/routes/MySwapsView.jsx';

const CHAIN = 'dogecoin-testnet';
const OWN = 'ndDEAAyn7DcGeaQ6chBWH2vaSdYAXVGNhc';
const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0',
    address: OWN,
    publicKey: '02aabbcc',
    derivationPath: "m/44'/1'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
const FUTURE = Math.floor(Date.now() / 1000) + 3600;

function offerRow(actionIndex, state) {
    return {
        action_index: String(actionIndex),
        source: OWN,
        give_tick: 'DOGESWAP',
        give_amount: '500',
        get_tick: 'PEPE',
        get_amount: '10',
        expiration: FUTURE,
        block_index: '67882087',
        status: 'valid',
        ...(state ? { state } : {}),
    };
}

function harness({ rows, detailMethod, listMethod, cancelsMethod }) {
    const reads = [];
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [HD_ADDRESS] }),
        [listMethod]: () => Promise.resolve({ data: rows }),
        [cancelsMethod]: () => Promise.resolve({ data: [] }),
        [detailMethod]: ({ actionIndex }) => {
            reads.push(String(actionIndex));
            const row = rows.find((r) => r.action_index === String(actionIndex));
            return Promise.resolve({ action_index: String(actionIndex), state: { status: 'open', give_remaining: row?.give_amount, expiration: FUTURE } });
        },
        listAutopayOrders: () => Promise.resolve([]),
        getSignerStatus: () => Promise.resolve({ status: 'locked' }),
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
        },
    });
    return { messaging, reads };
}

async function open(View, messaging) {
    let utils;
    await domAct(async () => {
        utils = render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(View, { walletId: 'w', onBack() {} }),
        ));
        for (let i = 0; i < 40; i += 1) await Promise.resolve();
    });
    return utils;
}

afterEach(() => cleanup());

describe('My orders reuses the hydrated lifecycle', () => {
    it('reads no order detail for rows the list feed already hydrated', async () => {
        const rows = Array.from({ length: 40 }, (_, i) => offerRow(1000 + i, {
            status: 'open', give_remaining: '500', expiration: FUTURE, expiry_status: 'open',
        }));
        const { messaging, reads } = harness({
            rows, detailMethod: 'getOrderDetail', listMethod: 'getOrdersForAddress', cancelsMethod: 'getOrderCancelsForAddress',
        });
        const utils = await open(MyOrdersView, messaging);
        const list = utils.getByRole('list', { name: 'Open orders' });
        expect(within(list).getAllByRole('listitem')).toHaveLength(40);
        expect(reads).toEqual([]);
    });

    it('files a hydrated filled order under Closed without a detail read', async () => {
        const rows = [
            offerRow(2001, { status: 'open', give_remaining: '500', expiration: FUTURE, expiry_status: 'open' }),
            offerRow(2002, { status: 'filled', give_remaining: '0', expiration: FUTURE, expiry_status: 'open' }),
        ];
        const { messaging, reads } = harness({
            rows, detailMethod: 'getOrderDetail', listMethod: 'getOrdersForAddress', cancelsMethod: 'getOrderCancelsForAddress',
        });
        const utils = await open(MyOrdersView, messaging);
        const closed = utils.getByRole('list', { name: 'Closed orders' });
        expect(within(closed).getByText(/#2002/)).toBeTruthy();
        expect(reads).toEqual([]);
    });

    it('still reads the detail of a row that arrived without a lifecycle status', async () => {
        const rows = [
            offerRow(3001, { status: 'open', give_remaining: '500', expiration: FUTURE }),
            offerRow(3002, { expiry_status: 'unknown' }),
            offerRow(3003),
        ];
        const { messaging, reads } = harness({
            rows, detailMethod: 'getOrderDetail', listMethod: 'getOrdersForAddress', cancelsMethod: 'getOrderCancelsForAddress',
        });
        await open(MyOrdersView, messaging);
        expect(reads.sort()).toEqual(['3002', '3003']);
    });
});

describe('My swaps reuses the hydrated lifecycle', () => {
    it('reads no swap detail for rows the list feed already hydrated', async () => {
        const rows = Array.from({ length: 30 }, (_, i) => offerRow(5000 + i, {
            status: 'open', expiration: FUTURE, expiry_status: 'open',
        }));
        const { messaging, reads } = harness({
            rows, detailMethod: 'getSwapDetail', listMethod: 'getSwapsForAddress', cancelsMethod: 'getSwapCancelsForAddress',
        });
        const utils = await open(MySwapsView, messaging);
        const list = utils.getByRole('list', { name: 'Open swaps' });
        expect(within(list).getAllByRole('listitem')).toHaveLength(30);
        expect(reads).toEqual([]);
    });

    it('still reads the detail of a swap row without a lifecycle status', async () => {
        const rows = [offerRow(6001, { status: 'open', expiration: FUTURE }), offerRow(6002)];
        const { messaging, reads } = harness({
            rows, detailMethod: 'getSwapDetail', listMethod: 'getSwapsForAddress', cancelsMethod: 'getSwapCancelsForAddress',
        });
        await open(MySwapsView, messaging);
        expect(reads).toEqual(['6002']);
    });
});
