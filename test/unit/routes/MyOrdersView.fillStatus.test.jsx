// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// My orders must not offer Cancel on an order the chain has already filled,
// and must not call a filled order "Cancelled" because a cancel was refused.
//
// The order list feed carries only the ORDER action's validity, so a fully
// filled order looks exactly like an open one there: status valid, no cancel
// row, future expiration. The view used to file it under Open with working
// Edit and Cancel; the cancel then broadcast an ORDER_CANCEL the indexer
// refused as "order not open", fee spent. That refused cancel appears in the
// cancels feed with an invalid status, and the view counted it as a cancel,
// so the filled order was then shown as Cancelled.
//
// The fill signal is the per-order detail's `state` block: `status` is the
// indexer's latest order status (`complete` once fully filled) and
// `give_remaining` is the give amount net of settled matches.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act as domAct, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MyOrdersView, deriveStatus, fillStateOf } from '../../../packages/core/src/shared/routes/MyOrdersView.jsx';

const CHAIN = 'dogecoin-testnet';
const OWN = 'ndDEAAyn7DcGeaQ6chBWH2vaSdYAXVGNhc';
const OTHER = 'nk6y8sMqJ4wHTf9xvBqhZ2rGnM3cV5wXyz';

const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0',
    address: OWN,
    publicKey: '02aabbcc',
    derivationPath: "m/44'/1'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

const FUTURE = Math.floor(Date.now() / 1000) + 3600;

// An order row as the list feed serves it: validity only, no fill state.
function orderRow(actionIndex, extra = {}) {
    return {
        action_index: String(actionIndex),
        source: OWN,
        give_tick: 'DOGESWAP',
        give_coin: 'DOGE',
        give_amount: '500',
        give_ownership: 0,
        get_tick: null,
        get_coin: 'DOGE',
        get_amount: '10.5',
        get_ownership: 0,
        expiration: FUTURE,
        block_index: '67882087',
        status: 'valid',
        ...extra,
    };
}

// A cancel row as the cancels feed serves it; refused attempts are listed
// too, distinguished only by their status.
function cancelRow(actionIndex, orderActionIndex, status) {
    return { action_index: String(actionIndex), order_action_index: String(orderActionIndex), source: OWN, status };
}

// An order detail as the explorer serves it, trimmed to the `state` block
// the view reads.
function detail(actionIndex, status, giveRemaining) {
    return {
        action: 'ORDER',
        action_index: String(actionIndex),
        status: 'valid',
        state: { give_remaining: giveRemaining, get_remaining: '0', expiration: String(FUTURE), status },
    };
}

function harness({ orders = [], cancels = [], details = {} } = {}) {
    const calls = [];
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [HD_ADDRESS] }),
        getOrdersForAddress: () => Promise.resolve({ data: orders }),
        getOrderCancelsForAddress: () => Promise.resolve({ data: cancels }),
        getOrderDetail: (args) => {
            calls.push({ method: 'getOrderDetail', args });
            const d = details[String(args.actionIndex)];
            return d instanceof Error ? Promise.reject(d) : Promise.resolve(d ?? null);
        },
        listAutopayOrders: () => Promise.resolve([]),
        getSignerStatus: () => Promise.resolve({ status: 'locked' }),
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return (args) => {
                calls.push({ method: String(prop), args });
                return Promise.resolve({});
            };
        },
    });
    return { messaging, calls };
}

async function drain(rounds = 24) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function open(messaging) {
    let utils;
    await domAct(async () => {
        utils = render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(MyOrdersView, { walletId: 'w', onBack() {} }),
            ),
        );
        await drain();
    });
    return utils;
}

function section(utils, label) {
    return utils.queryByRole('list', { name: label });
}

function rowFor(list, actionIndex) {
    return within(list).getByText(`#${actionIndex}`, { exact: false }).closest('li');
}

afterEach(() => cleanup());

describe('MyOrdersView: cancel rows', () => {
    it('ignores a refused ORDER_CANCEL and honours an applied one', async () => {
        const { messaging } = harness({
            orders: [orderRow(665), orderRow(645)],
            cancels: [
                cancelRow(680, 665, 'invalid: ORDER_ACTION_INDEX (order not open)'),
                cancelRow(681, 645, 'valid'),
            ],
            details: { 665: detail(665, 'open', '500') },
        });
        const utils = await open(messaging);

        const openList = section(utils, 'Open orders');
        const closedList = section(utils, 'Closed orders');
        expect(openList).not.toBeNull();
        expect(closedList).not.toBeNull();

        // The refused cancel changed nothing on chain, so #665 is still open.
        const stillOpen = rowFor(openList, 665);
        expect(within(stillOpen).getByText('Open')).toBeTruthy();
        expect(within(stillOpen).queryByText('Cancelled')).toBeNull();

        // The applied cancel closed #645.
        const closed = rowFor(closedList, 645);
        expect(within(closed).getByText('Cancelled')).toBeTruthy();
    });

    it('derives cancelled from the key set the loader built', () => {
        // The loader is what filters cancel rows by status (pinned through the
        // rendered outcome above); the derivation only consults the set.
        const item = { key: `${CHAIN}:1`, row: orderRow(1), fill: null };
        expect(deriveStatus(item, new Set([`${CHAIN}:1`]), 0)).toBe('cancelled');
        expect(deriveStatus(item, new Set(), 0)).toBe('open');
    });
});

describe('MyOrdersView: fills', () => {
    it('files a fully filled order under Closed as Filled with no Edit or Cancel', async () => {
        const { messaging } = harness({
            orders: [orderRow(665)],
            details: { 665: detail(665, 'complete', '0') },
        });
        const utils = await open(messaging);

        expect(section(utils, 'Open orders')).toBeNull();
        const closedList = section(utils, 'Closed orders');
        expect(closedList).not.toBeNull();
        const row = rowFor(closedList, 665);
        expect(within(row).getByText('Filled')).toBeTruthy();
        expect(within(row).queryByRole('button', { name: 'Edit' })).toBeNull();
        expect(within(row).queryByRole('button', { name: 'Cancel' })).toBeNull();
        // The timeline stays available on a closed order.
        expect(within(row).getByRole('button', { name: 'Timeline' })).toBeTruthy();
    });

    it('keeps a partly filled order under Open and shows what is left', async () => {
        const { messaging } = harness({
            orders: [orderRow(700)],
            details: { 700: detail(700, 'open', '200') },
        });
        const utils = await open(messaging);

        const openList = section(utils, 'Open orders');
        expect(openList).not.toBeNull();
        expect(section(utils, 'Closed orders')).toBeNull();
        const row = rowFor(openList, 700);
        expect(within(row).getByText('Open')).toBeTruthy();
        expect(within(row).getByText('Remaining 200 of 500 DOGESWAP')).toBeTruthy();
        expect(within(row).getByRole('button', { name: 'Edit' })).toBeTruthy();
        expect(within(row).getByRole('button', { name: 'Cancel' })).toBeTruthy();
    });

    it('leaves an unmatched order with a future expiration Open with both buttons', async () => {
        const { messaging } = harness({
            orders: [orderRow(701)],
            details: { 701: detail(701, 'open', '500') },
        });
        const utils = await open(messaging);

        const openList = section(utils, 'Open orders');
        const row = rowFor(openList, 701);
        expect(within(row).getByText('Open')).toBeTruthy();
        expect(within(row).queryByText('Remaining', { exact: false })).toBeNull();
        expect(within(row).getByRole('button', { name: 'Edit' })).toBeTruthy();
        expect(within(row).getByRole('button', { name: 'Cancel' })).toBeTruthy();
    });

    it('reads the detail only for orders the feeds still call open', async () => {
        const { messaging, calls } = harness({
            orders: [
                orderRow(710),
                orderRow(711, { expiration: Math.floor(Date.now() / 1000) - 60 }),
                orderRow(712),
                orderRow(713, { status: 'invalid: GIVE_AMOUNT (insufficient balance)' }),
            ],
            cancels: [cancelRow(720, 712, 'valid')],
            details: { 710: detail(710, 'open', '500') },
        });
        await open(messaging);

        const reads = calls.filter((c) => c.method === 'getOrderDetail').map((c) => c.args.actionIndex);
        expect(reads).toEqual(['710']);
    });

    it('falls back to the feeds when the detail read fails or lacks a state block', async () => {
        const { messaging } = harness({
            orders: [orderRow(720), orderRow(721)],
            details: { 720: new Error('explorer unavailable'), 721: { action: 'ORDER', status: 'valid' } },
        });
        const utils = await open(messaging);

        const openList = section(utils, 'Open orders');
        expect(openList).not.toBeNull();
        expect(within(rowFor(openList, 720)).getByText('Open')).toBeTruthy();
        expect(within(rowFor(openList, 721)).getByText('Open')).toBeTruthy();
    });
});

describe('deriveStatus with a fill state', () => {
    const base = { key: `${CHAIN}:9`, row: orderRow(9) };

    it('maps the detail statuses onto the view statuses', () => {
        expect(deriveStatus({ ...base, fill: { status: 'complete', giveRemaining: '0' } }, new Set(), 0)).toBe('filled');
        expect(deriveStatus({ ...base, fill: { status: 'cancelled', giveRemaining: '0' } }, new Set(), 0)).toBe('cancelled');
        expect(deriveStatus({ ...base, fill: { status: 'expired', giveRemaining: '0' } }, new Set(), 0)).toBe('expired');
        expect(deriveStatus({ ...base, fill: { status: 'open', giveRemaining: '500' } }, new Set(), 0)).toBe('open');
        expect(deriveStatus({ ...base, fill: { status: 'open', giveRemaining: '0' } }, new Set(), 0)).toBe('filled');
    });

    it('lets an in-flight cancel or expiry fall through to the feeds', () => {
        // 'cancelling' arrives with a valid cancel row; 'expiring' with a past
        // expiration. Neither is decided by the detail alone.
        expect(deriveStatus({ ...base, fill: { status: 'cancelling', giveRemaining: '500' } }, new Set(), 0)).toBe('open');
        expect(deriveStatus({ ...base, fill: { status: 'cancelling', giveRemaining: '500' } }, new Set([base.key]), 0)).toBe('cancelled');
        expect(deriveStatus({ ...base, fill: { status: 'expiring', giveRemaining: '500' } }, new Set(), FUTURE + 1)).toBe('expired');
    });

    it('reads the state block off a detail and nothing else', () => {
        expect(fillStateOf(detail(1, 'complete', '0'))).toEqual({ status: 'complete', giveRemaining: '0' });
        expect(fillStateOf({ action: 'ORDER' })).toBeNull();
        expect(fillStateOf(null)).toBeNull();
        expect(fillStateOf([])).toBeNull();
    });
});
