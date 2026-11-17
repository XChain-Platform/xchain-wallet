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
// row, future expiration. The view used to offer working Edit and Cancel on
// it; the cancel then broadcast an ORDER_CANCEL the indexer refused as
// "order not open", fee spent. That refused cancel appears in the cancels
// feed with an invalid status, and the view counted it as a cancel, so the
// filled order was then shown as Cancelled.
//
// The fill signal is the per-order detail's `state` block: `status` is the
// indexer's latest order status (`complete` once fully filled) and
// `give_remaining` is the give amount net of settled matches. Since
// 2026-11-13 the list is one plain list and Cancel and Edit live on the
// order's detail page, which a row opens.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act as domAct, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MyOrdersView, deriveStatus, fillStateOf } from '../../../packages/core/src/shared/routes/MyOrdersView.jsx';
import { OrderActionPanel } from '../../../packages/core/src/shared/routes/OrderActionPanel.jsx';
import { formatLocalDateTime } from '../../../packages/core/src/shared/utils/dateTime.js';

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

// An order detail as the explorer serves it: the order's own fields plus
// the `state` block the views read.
function detail(actionIndex, status, giveRemaining) {
    return {
        ...orderRow(actionIndex),
        action: 'ORDER',
        state: { give_remaining: giveRemaining, get_remaining: '0', expiration: String(FUTURE), status },
    };
}

function harness({ orders = [], cancels = [], details = {}, ordersError = null, cancelsError = null, methods = {} } = {}) {
    const calls = [];
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [HD_ADDRESS] }),
        getOrdersForAddress: () => ordersError
            ? Promise.reject(ordersError)
            : Promise.resolve({ data: orders }),
        getOrderCancelsForAddress: () => cancelsError
            ? Promise.reject(cancelsError)
            : Promise.resolve({ data: cancels }),
        getOrderDetail: (args) => {
            calls.push({ method: 'getOrderDetail', args });
            const d = details[String(args.actionIndex)];
            return d instanceof Error ? Promise.reject(d) : Promise.resolve(d ?? null);
        },
        listAutopayOrders: () => Promise.resolve([]),
        getSignerStatus: () => Promise.resolve({ status: 'locked' }),
        ...methods,
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

function orderList(utils) {
    return utils.queryByRole('list', { name: 'Orders' });
}

// A row is found by its order key (the ring layout's row names the trade, not its number).
function rowFor(list, actionIndex) {
    const row = list.querySelector(`[data-order-row="${CHAIN}:${actionIndex}"]`);
    if (!row) throw new Error(`no row for order #${actionIndex}`);
    return row;
}

// Opens an order's detail page from its row.
async function openOrder(utils, actionIndex) {
    const row = rowFor(orderList(utils), actionIndex);
    await domAct(async () => {
        fireEvent.click(within(row).getByRole('button'));
        await drain();
    });
    await utils.findByRole('heading', { name: 'Order Detail' });
}

// The value beside a label in the detail page's facts card, which sits
// under the Details tab once the page offers more than one action (G102).
function fact(utils, label) {
    const detailsTab = utils.queryByRole('tab', { name: 'Details' });
    if (detailsTab && detailsTab.getAttribute('aria-selected') !== 'true') fireEvent.click(detailsTab);
    const card = utils.getByLabelText('Order details');
    const term = within(card).getByText(label, { selector: 'dt' });
    return term.nextElementSibling;
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
        expect(document.body.textContent).not.toMatch(/regtest|testnet|Not mainnet/i);

        // One list, no Open / Closed sections.
        const list = orderList(utils);
        expect(list).not.toBeNull();
        expect(utils.queryByRole('list', { name: 'Open orders' })).toBeNull();
        expect(utils.queryByRole('list', { name: 'Closed orders' })).toBeNull();

        // The refused cancel changed nothing on chain, so #665 is still open.
        const stillOpen = rowFor(list, 665);
        expect(within(stillOpen).getByText('Open')).toBeTruthy();
        expect(within(stillOpen).queryByText('Closed')).toBeNull();

        // The applied cancel closed #645 (the label reads Closed, operator 2026-11-14).
        const closed = rowFor(list, 645);
        expect(within(closed).getByText('Closed')).toBeTruthy();
        expect(within(closed).queryByText('Cancelled')).toBeNull();
        // The status column takes the word's natural width (never clipped).
        const ring = closed.querySelector('[data-fill-ring]');
        expect(ring.getAttribute('data-column')).toBe('fit');
        expect(ring.getAttribute('data-status')).toBe('cancelled');
        expect(within(stillOpen).getByText('Open').closest('[data-fill-ring]').getAttribute('data-column')).toBe('fit');
    });

    it('derives cancelled from the key set the loader built', () => {
        // The loader is what filters cancel rows by status (pinned through the
        // rendered outcome above); the derivation only consults the set.
        const item = { key: `${CHAIN}:1`, row: orderRow(1), fill: null };
        expect(deriveStatus(item, new Set([`${CHAIN}:1`]), 0)).toBe('cancelled');
        expect(deriveStatus(item, new Set(), 0)).toBe('open');
    });

    it('opens no detail for a malformed order ID, and the form refuses one before review', async () => {
        const { messaging, calls } = harness({
            orders: [orderRow('bad-id')],
            details: { 'bad-id': detail('bad-id', 'open', '500') },
        });
        const utils = await open(messaging);
        await openOrder(utils, 'bad-id');
        expect(utils.getByText('Order not found')).toBeTruthy();
        expect(utils.queryByRole('button', { name: /^Cancel order/ })).toBeNull();
        cleanup();

        // The form keeps its own guard for any caller that reaches it.
        let panel;
        await domAct(async () => {
            panel = render(
                React.createElement(
                    MessagingProvider,
                    { shell: 'web', messaging },
                    React.createElement(OrderActionPanel, {
                        type: 'cancel',
                        item: { chainId: CHAIN, owner: HD_ADDRESS, row: orderRow('bad-id'), key: `${CHAIN}:bad-id`, cancelledKeys: new Set() },
                        chainAddresses: [HD_ADDRESS],
                        variant: 'web',
                        walletId: 'w',
                        messaging,
                        onDone() {},
                        onBack() {},
                    }),
                ),
            );
            await drain();
        });
        fireEvent.click(panel.getByRole('button', { name: 'Cancel Order' }));
        expect(await panel.findByRole('alert')).toHaveTextContent('Order ID must be a positive whole number.');
        expect(calls.some((call) => call.method === 'composeForConfirm')).toBe(false);
    });

    it('explains that an edit needs at least one changed field', async () => {
        const { messaging, calls } = harness({
            orders: [orderRow(700)],
            details: { 700: detail(700, 'open', '500') },
        });
        const utils = await open(messaging);
        await openOrder(utils, 700);

        fireEvent.click(utils.getByRole('button', { name: /^Edit order/ }));
        const submit = utils.getByRole('button', { name: 'Update Order' });
        expect(submit).toBeEnabled();
        fireEvent.click(submit);

        expect(await utils.findByRole('alert')).toHaveTextContent(
            'Change at least one field (expiration, allow-list, or block-list).',
        );
        expect(calls.some((call) => call.method === 'composeForConfirm')).toBe(false);
    });

    it('shows plain copy when the encoder refuses a cancel', async () => {
        const raw = 'editOrder: indexer POST /internal/order/700 returned 500';
        const { messaging } = harness({
            orders: [orderRow(700)],
            details: { 700: detail(700, 'open', '500') },
            methods: { composeForConfirm: vi.fn().mockRejectedValue(new Error(raw)) },
        });
        const utils = await open(messaging);
        await openOrder(utils, 700);

        // The detail page's Cancel Order opens the form; its submit is the second.
        fireEvent.click(utils.getByRole('button', { name: /^Cancel order/ }));
        fireEvent.click(utils.getByRole('button', { name: 'Cancel Order' }));

        await waitFor(() => expect(utils.getByRole('alert')).toHaveTextContent(
            'Could not cancel the order. Try again.',
        ));
        expect(utils.container).not.toHaveTextContent('/internal/order/700');
    });

    it('refreshes lifecycle before composing when an open order expires', async () => {
        const expired = detail(740, 'expired', '0');
        // The list read, the detail page's read, then the fresh re-check.
        const freshDetail = vi.fn()
            .mockResolvedValueOnce(detail(740, 'open', '500'))
            .mockResolvedValueOnce(detail(740, 'open', '500'))
            .mockResolvedValueOnce({
                ...expired,
                state: { ...expired.state, expiration: String(Math.floor(Date.now() / 1000) - 1) },
            });
        const composeForConfirm = vi.fn();
        const { messaging } = harness({
            orders: [orderRow(740)],
            methods: { getOrderDetail: freshDetail, composeForConfirm },
        });
        const utils = await open(messaging);
        await openOrder(utils, 740);

        fireEvent.click(utils.getByRole('button', { name: /^Cancel order/ }));
        fireEvent.click(utils.getByRole('button', { name: 'Cancel Order' }));

        expect(await utils.findByRole('alert')).toHaveTextContent(
            'This order is not open. Refresh My orders and try again.',
        );
        expect(freshDetail).toHaveBeenCalledTimes(3);
        expect(freshDetail.mock.calls[2][0]).toMatchObject({ actionIndex: '740', fresh: true });
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('refreshes cancellation state before composing from a stale open order', async () => {
        // The list read, the detail page's read, then the fresh re-check.
        const cancelReader = vi.fn()
            .mockResolvedValueOnce({ data: [] })
            .mockResolvedValueOnce({ data: [] })
            .mockResolvedValueOnce({ data: [cancelRow(760, 741, 'valid')] });
        const composeForConfirm = vi.fn();
        const { messaging } = harness({
            orders: [orderRow(741)],
            details: { 741: detail(741, 'open', '500') },
            methods: { getOrderCancelsForAddress: cancelReader, composeForConfirm },
        });
        const utils = await open(messaging);
        await openOrder(utils, 741);

        fireEvent.click(utils.getByRole('button', { name: /^Cancel order/ }));
        fireEvent.click(utils.getByRole('button', { name: 'Cancel Order' }));

        expect(await utils.findByRole('alert')).toHaveTextContent(
            'This order is not open. Refresh My orders and try again.',
        );
        expect(cancelReader).toHaveBeenCalledTimes(3);
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('keeps valid orders usable when explorer arrays contain malformed rows', async () => {
        const { messaging } = harness({
            orders: [null, 17, orderRow(750), orderRow(750)],
            cancels: [null, 'bad-row'],
            details: { 750: detail(750, 'open', '500') },
        });
        const utils = await open(messaging);

        expect(utils.queryByText('Could not load your orders. Try again.')).toBeNull();
        const list = orderList(utils);
        expect(list).not.toBeNull();
        expect(list.querySelectorAll(`[data-order-row="${CHAIN}:750"]`)).toHaveLength(1);
        expect(within(list).getAllByText('Sell 500 DOGESWAP')).toHaveLength(1);
    });
});

describe('MyOrdersView: fills', () => {
    // G91: a failed read shows the plain empty state with no page error or
    // Try Again; the reachability banner reports network trouble once.
    it('shows the plain empty state, never a page error, when the order feed fails', async () => {
        const { messaging } = harness({ ordersError: new Error('Order explorer unavailable') });
        const utils = await open(messaging);

        expect(utils.getByText('No orders yet')).toBeTruthy();
        expect(utils.queryByText('Order explorer unavailable')).toBeNull();
        expect(utils.queryByText('Could not load your orders. Try again.')).toBeNull();
        expect(utils.queryByRole('button', { name: 'Try Again' })).toBeNull();
    });

    it('does not offer cancel when the cancellation status feed fails', async () => {
        const { messaging } = harness({
            orders: [orderRow(702)],
            cancelsError: new Error('Cancel status unavailable'),
        });
        const utils = await open(messaging);

        expect(utils.getByText('No orders yet')).toBeTruthy();
        expect(utils.queryByText('Cancel status unavailable')).toBeNull();
        expect(utils.queryByRole('button', { name: /Cancel/ })).toBeNull();
    });

    it('shows a fully filled order as Filled, and its detail offers no Edit or Cancel', async () => {
        const { messaging } = harness({
            orders: [orderRow(665)],
            details: { 665: detail(665, 'filled', '0') },
        });
        const utils = await open(messaging);

        const row = rowFor(orderList(utils), 665);
        expect(within(row).getByText('Filled')).toBeTruthy();
        await openOrder(utils, 665);
        expect(utils.queryByRole('button', { name: /^Edit order/ })).toBeNull();
        expect(utils.queryByRole('button', { name: /^Cancel order/ })).toBeNull();
        // The matches stay available on a closed order, under Details.
        expect(fact(utils, 'Filled')).toHaveTextContent('500 of 500 DOGESWAP');
        expect(utils.getByRole('region', { name: 'Matches' })).toBeTruthy();
    });

    it('shows a partly filled order as Partly with its ring, and its detail shows what is left', async () => {
        const { messaging } = harness({
            orders: [orderRow(700)],
            details: { 700: detail(700, 'open', '200') },
        });
        const utils = await open(messaging);

        const row = rowFor(orderList(utils), 700);
        // Still open for the filter and the actions; the ring says how far it got.
        expect(within(row).getByText('Partly')).toBeTruthy();
        expect(within(row).getByRole('img', { name: '60% filled' })).toBeTruthy();
        await openOrder(utils, 700);
        expect(utils.getByText('Partly filled')).toBeTruthy();
        expect(utils.getByRole('button', { name: /^Edit order/ })).toBeTruthy();
        expect(utils.getByRole('button', { name: /^Cancel order/ })).toHaveTextContent('Returns the 200 DOGESWAP still escrowed');
        expect(fact(utils, 'Filled')).toHaveTextContent('300 of 500 DOGESWAP');
        expect(fact(utils, 'Remaining')).toHaveTextContent('200 DOGESWAP');
    });

    it('leaves an unmatched order with a future expiration Open with both actions', async () => {
        const { messaging } = harness({
            orders: [orderRow(701)],
            details: { 701: detail(701, 'open', '500') },
        });
        const utils = await open(messaging);

        expect(within(rowFor(orderList(utils), 701)).getByText('Open')).toBeTruthy();
        await openOrder(utils, 701);
        expect(utils.getByRole('button', { name: /^Edit order/ })).toBeTruthy();
        expect(utils.getByRole('button', { name: /^Cancel order/ })).toBeTruthy();
        expect(fact(utils, 'Filled')).toHaveTextContent('0 of 500 DOGESWAP');
        expect(fact(utils, 'Remaining')).toHaveTextContent('500 DOGESWAP');
    });

    it('reads detail before treating the creation expiration as terminal', async () => {
        const past = Math.floor(Date.now() / 1000) - 60;
        const { messaging, calls } = harness({
            orders: [
                orderRow(710),
                orderRow(711, { expiration: past }),
                orderRow(712),
                orderRow(713, { status: 'invalid: GIVE_AMOUNT (insufficient balance)' }),
            ],
            cancels: [cancelRow(720, 712, 'valid')],
            details: { 710: detail(710, 'open', '500'), 711: detail(711, 'open', '500') },
        });
        const utils = await open(messaging);

        const reads = calls.filter((c) => c.method === 'getOrderDetail').map((c) => c.args.actionIndex);
        expect(reads.sort()).toEqual(['710', '711']);
        expect(within(rowFor(orderList(utils), 711)).getByText('Open')).toBeTruthy();
        await openOrder(utils, 711);
        expect(fact(utils, 'Expires')).toHaveTextContent(formatLocalDateTime(FUTURE));
    });

    it('falls back to the feeds when the detail read fails or lacks a state block', async () => {
        const { messaging } = harness({
            orders: [orderRow(720), orderRow(721)],
            details: { 720: new Error('explorer unavailable'), 721: { action: 'ORDER', status: 'valid' } },
        });
        const utils = await open(messaging);

        const list = orderList(utils);
        expect(list).not.toBeNull();
        expect(within(rowFor(list, 720)).getByText('Open')).toBeTruthy();
        expect(within(rowFor(list, 721)).getByText('Open')).toBeTruthy();
    });

    it('does not render a millisecond value as an expiration thousands of years away', async () => {
        const msExpiry = Date.now();
        const { messaging } = harness({
            orders: [orderRow(730)],
            details: {
                730: {
                    ...orderRow(730),
                    state: {
                        status: 'open',
                        give_remaining: '500',
                        expiration: String(msExpiry),
                    },
                },
            },
        });
        const utils = await open(messaging);
        await openOrder(utils, 730);

        expect(fact(utils, 'Expires')).toHaveTextContent('No expiration');
        expect(utils.queryByText(formatLocalDateTime(msExpiry), { exact: false })).toBeNull();
    });
});

describe('deriveStatus with a fill state', () => {
    const base = { key: `${CHAIN}:9`, row: orderRow(9) };

    it('maps the detail statuses onto the view statuses', () => {
        expect(deriveStatus({ ...base, fill: { status: 'complete', giveRemaining: '0' } }, new Set(), 0)).toBe('filled');
        expect(deriveStatus({ ...base, fill: { status: 'filled', giveRemaining: '0' } }, new Set(), 0)).toBe('filled');
        expect(deriveStatus({ ...base, fill: { status: 'cancelling', giveRemaining: '500' } }, new Set(), 0)).toBe('cancelling');
        expect(deriveStatus({ ...base, fill: { status: 'cancelled', giveRemaining: '0' } }, new Set(), 0)).toBe('cancelled');
        expect(deriveStatus({ ...base, fill: { status: 'expiring', giveRemaining: '500' } }, new Set(), 0)).toBe('expiring');
        expect(deriveStatus({ ...base, fill: { status: 'expired', giveRemaining: '0' } }, new Set(), 0)).toBe('expired');
        expect(deriveStatus({ ...base, fill: { status: 'open', giveRemaining: '500' } }, new Set(), 0)).toBe('open');
        expect(deriveStatus({ ...base, fill: { status: 'open', giveRemaining: '0' } }, new Set(), 0)).toBe('filled');
    });

    it('lets an applied cancel outrank an in-flight lifecycle status', () => {
        expect(deriveStatus({ ...base, fill: { status: 'cancelling', giveRemaining: '500' } }, new Set([base.key]), 0)).toBe('cancelled');
    });

    it('reads the state block off a detail and nothing else', () => {
        expect(fillStateOf(detail(1, 'complete', '0'))).toEqual({
            status: 'complete', giveRemaining: '0', expiration: String(FUTURE),
        });
        expect(fillStateOf({ action: 'ORDER' })).toBeNull();
        expect(fillStateOf(null)).toBeNull();
        expect(fillStateOf([])).toBeNull();
    });
});
