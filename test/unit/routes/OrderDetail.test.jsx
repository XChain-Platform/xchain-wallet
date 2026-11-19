// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// My Orders as one plain list and the Order detail page its rows open
// (operator 2026-11-13), in the approved ring layout
// (wallet-orders-layout-1-ring). A row says its trade in words with the fill
// ring and the status word in place of a chip. The detail page leads with
// the large ring and the trade, then the Actions | Details | Matches toggle
// (G102), Actions first: one ActionList row per action the order allows
// (G101). Details holds the auto-pay setting and the facts, one row element
// per fact as Swap Details draws them; Matches holds the lifecycle. Edit and
// Cancel are standard forms (Form Standard) on their own routes, drawn in
// place where the host has none. Both pages read a fixed number of times
// however many rows the feeds return.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act as domAct, cleanup, fireEvent, render, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MyOrdersView } from '../../../packages/core/src/shared/routes/MyOrdersView.jsx';
import { OrderDetail, loadOrderDetail } from '../../../packages/core/src/shared/routes/OrderDetail.jsx';
import { OrderRow } from '../../../packages/core/src/shared/routes/OrderRow.jsx';
import { FillRing } from '../../../packages/core/src/shared/components/FillRing.jsx';
import { formatLocalDateTime } from '../../../packages/core/src/shared/utils/dateTime.js';

const CHAIN = 'dogecoin-testnet';
const OWN = 'ndDEAAyn7DcGeaQ6chBWH2vaSdYAXVGNhc';
const OTHER = 'nk6y8sMqJ4wHTf9xvBqhZ2rGnM3cV5wXyz';
const FUTURE = Math.floor(Date.now() / 1000) + 3600;
const PAST = Math.floor(Date.now() / 1000) - 3600;
const TX = 'ab'.repeat(32);

const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0', address: OWN, publicKey: '02aabbcc',
    derivationPath: "m/44'/1'/0'/0/0", source: 'hd', signerId: 'signer-1',
});

function orderRow(actionIndex, extra = {}) {
    return {
        action_index: String(actionIndex), source: OWN, tx_hash: TX,
        give_tick: 'DOGESWAP', give_coin: 'DOGE', give_amount: '500', give_ownership: 0,
        get_tick: null, get_coin: 'DOGE', get_amount: '10.5', get_ownership: 0,
        expiration: FUTURE, block_index: '67882087', status: 'valid',
        ...extra,
    };
}

// A list row as the feed hydrates it, carrying its detail's state block.
function hydrated(actionIndex, status = 'open', giveRemaining = '500', extra = {}) {
    return {
        ...orderRow(actionIndex, extra),
        state: { status, give_remaining: giveRemaining, expiration: String(extra.expiration ?? FUTURE), expiry_status: status === 'expired' ? 'expired' : 'open' },
    };
}

function harness({ addresses = [HD_ADDRESS], orders = [], cancels = [], details = {}, autopay = [], methods = {} } = {}) {
    const calls = [];
    const logged = (name, fn) => (...args) => { calls.push({ method: name, args: args[0] }); return fn(...args); };
    const target = {
        getAddressesByChain: logged('getAddressesByChain', () => Promise.resolve({ [CHAIN]: addresses })),
        getOrdersForAddress: logged('getOrdersForAddress', ({ address }) => Promise.resolve({
            data: orders.filter((o) => o.source === address),
        })),
        getOrderCancelsForAddress: logged('getOrderCancelsForAddress', () => Promise.resolve({ data: cancels })),
        getOrderDetail: logged('getOrderDetail', ({ actionIndex }) => Promise.resolve(details[String(actionIndex)] ?? null)),
        listAutopayOrders: logged('listAutopayOrders', () => Promise.resolve(autopay)),
        resolveAutopayIndexes: logged('resolveAutopayIndexes', () => Promise.resolve({})),
        setAutopayEnabled: logged('setAutopayEnabled', () => Promise.resolve({})),
        getOrderLifecycle: logged('getOrderLifecycle', ({ kind }) => Promise.resolve({
            data: kind === 'matches'
                ? [{ give_action_index: '700', get_action_index: '901', block_index: '67882100', give_amount: '200' }]
                : [],
        })),
        getSignerStatus: () => Promise.resolve({ status: 'locked' }),
        ...methods,
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return (args) => { calls.push({ method: String(prop), args }); return Promise.resolve({}); };
        },
    });
    return { messaging, calls };
}

async function drain(rounds = 32) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function mount(element, messaging) {
    let utils;
    await domAct(async () => {
        utils = render(React.createElement(MessagingProvider, { shell: 'web', messaging }, element));
        await drain();
    });
    return utils;
}

const list = (utils) => utils.getByRole('list', { name: 'Orders' });
// A row is found by its order key: the ring layout's row names the trade, not its number.
const rowFor = (utils, index) => list(utils).querySelector(`[data-order-row="${CHAIN}:${index}"]`);
const rowIndexes = (utils) => within(list(utils)).getAllByRole('listitem')
    .map((li) => li.getAttribute('data-order-row').split(':')[1]);
// A detail page's action rows (G101) are named by their title, then their description.
const action = (title) => ({ name: new RegExp(`^${title}`) });
const header = (utils) => utils.getByRole('region', { name: 'Order' });

// Picks the Actions or Details tab when the page shows the toggle (G102).
async function chooseTab(utils, name) {
    const tab = utils.queryByRole('tab', { name });
    if (tab && tab.getAttribute('aria-selected') !== 'true') {
        await domAct(async () => { fireEvent.click(tab); await drain(); });
    }
}

// The value beside a label in the facts card, under Details.
async function fact(utils, label) {
    await chooseTab(utils, 'Details');
    const card = utils.getByLabelText('Order details');
    return within(card).getByText(label, { selector: 'dt' }).nextElementSibling;
}

afterEach(() => cleanup());

describe('the fill ring', () => {
    const ring = (props) => render(React.createElement(FillRing, props)).container.querySelector('[data-fill-ring]');

    it('draws each state with its tone, mark and share', () => {
        const partly = ring({ percent: 62, tone: 'warning', caption: 'Partly', label: '62% filled' });
        expect(partly).toHaveAttribute('data-tone', 'warning');
        expect(partly).toHaveTextContent('62%Partly');
        expect(within(partly).getByRole('img', { name: '62% filled' })).toBeTruthy();
        cleanup();

        const open = ring({ percent: 0, tone: 'accent', caption: 'Open' });
        expect(open).toHaveAttribute('data-tone', 'accent');
        expect(open).toHaveTextContent('0%Open');
        cleanup();

        const filled = ring({ percent: 100, tone: 'success', mark: 'tick', caption: 'Filled' });
        expect(filled).toHaveAttribute('data-mark', 'tick');
        expect(filled.querySelector('svg')).not.toBeNull();
        expect(filled).not.toHaveTextContent('100%');
        cleanup();

        const cancelled = ring({ percent: 0, tone: 'muted', mark: 'cross', caption: 'Cancelled' });
        expect(cancelled).toHaveAttribute('data-mark', 'cross');
        expect(cancelled).toHaveAttribute('data-tone', 'muted');
        cleanup();

        const expired = ring({ percent: 40, tone: 'muted', caption: 'Expired' });
        expect(expired).toHaveAttribute('data-tone', 'muted');
        expect(expired).toHaveTextContent('40%Expired');
        cleanup();

        // An unknown share reads as a dash, never 0%.
        expect(ring({ percent: null })).toHaveTextContent('-');
    });

    it('is the same size on every row and larger on a detail header', () => {
        expect(ring({ percent: 10 })).toHaveAttribute('data-size', 'sm');
        cleanup();
        expect(ring({ percent: 10, size: 'lg' })).toHaveAttribute('data-size', 'lg');
    });
});

describe('a My Orders row', () => {
    const item = (row, fill = null, key = `${CHAIN}:700`) => ({
        chainId: CHAIN, key, owner: HD_ADDRESS, row, cancelledKeys: new Set(), fill,
    });
    const drawRow = (props) => render(React.createElement('ul', null,
        React.createElement('li', null, React.createElement(OrderRow, { onOpen() {}, ...props }))));
    const ringOf = (utils) => utils.container.querySelector('[data-fill-ring]');

    it('says the trade in words: Sell a token, Buy with the native coin', () => {
        const sell = drawRow({ item: item(orderRow(700, { give_amount: '1000' })), status: 'open' });
        expect(sell.getByText('Sell 1,000 DOGESWAP')).toBeTruthy();
        expect(sell.getByText('for 10.5 DOGE')).toBeTruthy();
        cleanup();

        const buy = drawRow({
            item: item(orderRow(701, { give_tick: '', give_amount: '0.02', get_tick: 'PEPE', get_coin: '', get_amount: '5000' })),
            status: 'open',
        });
        expect(buy.getByText('Buy 5,000 PEPE')).toBeTruthy();
        expect(buy.getByText('for 0.02 DOGE')).toBeTruthy();
    });

    it('shows the ring and the status word for each state', () => {
        const cases = [
            ['partly', item(orderRow(700), { status: 'open', giveRemaining: '190' }), 'open', 'warning', null, '62', 'Partly'],
            ['open', item(orderRow(700), { status: 'open', giveRemaining: '500' }), 'open', 'accent', null, '0', 'Open'],
            ['filled', item(orderRow(700), { status: 'filled', giveRemaining: '0' }), 'filled', 'success', 'tick', '100', 'Filled'],
            ['cancelled', item(orderRow(700), null), 'cancelled', 'muted', 'cross', undefined, 'Closed'],
            ['expired', item(orderRow(700), { status: 'open', giveRemaining: '300', expiryStatus: 'expired' }), 'expired', 'muted', null, '40', 'Expired'],
            ['cancelling', item(orderRow(700), { status: 'cancelling', giveRemaining: '500' }), 'cancelling', 'muted', null, '0', 'Closing'],
        ];
        for (const [name, it, status, tone, mark, percent, word] of cases) {
            const utils = drawRow({ item: it, status });
            const ring = ringOf(utils);
            expect(ring.getAttribute('data-tone'), name).toBe(tone);
            expect(ring.getAttribute('data-mark'), name).toBe(mark);
            expect(ring.getAttribute('data-percent') ?? undefined, name).toBe(percent);
            expect(within(ring).getByText(word), name).toBeTruthy();
            cleanup();
        }
    });

    it('rounds the share down in exact decimals, never through a float', () => {
        // 0.57 * 100 is 56.99999999999999 as a float; 57 of 100 must read 57%.
        const utils = drawRow({ item: item(orderRow(700, { give_amount: '100' }), { status: 'open', giveRemaining: '43' }), status: 'open' });
        expect(ringOf(utils)).toHaveAttribute('data-percent', '57');
        cleanup();
        // A hair short of full stays under 100% while the order is still open.
        const almost = drawRow({ item: item(orderRow(700, { give_amount: '1000' }), { status: 'open', giveRemaining: '0.001' }), status: 'open' });
        expect(ringOf(almost)).toHaveAttribute('data-percent', '99');
    });

    it('shows when a feed-shaped row was placed, from its block timestamp', () => {
        // The explorer serves an order's block time as `timestamp` (Unix seconds).
        const placed = Math.floor(Date.now() / 1000) - 2 * 3600;
        const utils = drawRow({ item: item(orderRow(700, { timestamp: placed })), status: 'open' });
        expect(utils.getByText('2 hours ago')).toBeTruthy();
    });

    it('draws nothing for a missing order', () => {
        const { container } = render(React.createElement(OrderRow, {}));
        expect(container.innerHTML).toBe('');
    });
});

describe('My Orders is one plain list', () => {
    const mixed = [
        hydrated(704, 'open', '500'),
        hydrated(703, 'filled', '0'),
        hydrated(702, 'expired', '500', { expiration: PAST }),
        hydrated(701, 'open', '500'),
    ];

    it('lists every order newest first in one list, each row with its ring and status word', async () => {
        const { messaging } = harness({ orders: mixed, cancels: [{ order_action_index: '701', source: OWN, status: 'valid' }] });
        const utils = await mount(React.createElement(MyOrdersView, { walletId: 'w', onBack() {} }), messaging);

        expect(utils.getAllByRole('list')).toHaveLength(1);
        expect(rowIndexes(utils)).toEqual(['704', '703', '702', '701']);
        const items = within(list(utils)).getAllByRole('listitem');
        expect(within(items[0]).getByText('Open')).toBeTruthy();
        expect(within(items[1]).getByText('Filled')).toBeTruthy();
        expect(within(items[2]).getByText('Expired')).toBeTruthy();
        expect(within(items[3]).getByText('Closed')).toBeTruthy();
        for (const li of items) expect(li.querySelector('[data-fill-ring]')).not.toBeNull();
        // The ring stands in place of the status chip.
        expect(list(utils).querySelector('[class*="chip"]')).toBeNull();
    });

    it('has no Open / Closed control: no sections, tabs or Closed status choice', async () => {
        const { messaging } = harness({ orders: mixed });
        const utils = await mount(React.createElement(MyOrdersView, { walletId: 'w', onBack() {} }), messaging);

        expect(utils.queryByRole('tablist')).toBeNull();
        expect(utils.queryByRole('radiogroup')).toBeNull();
        expect(utils.queryByRole('heading', { name: 'Open' })).toBeNull();
        expect(utils.queryByRole('heading', { name: 'Closed' })).toBeNull();
        expect(utils.queryByRole('list', { name: 'Open orders' })).toBeNull();
        expect(utils.queryByRole('list', { name: 'Closed orders' })).toBeNull();

        // A status filter stays in the filter menu, by real status.
        fireEvent.click(utils.getByRole('button', { name: 'Filter orders' }));
        // The themed dropdown (G96) lists its choices as options once opened.
        fireEvent.click(utils.getByRole('combobox', { name: 'Status' }));
        expect(utils.getAllByRole('option').map((o) => o.textContent))
            .toEqual(['All statuses', 'Open', 'Filled', 'Closed', 'Expired']);
        fireEvent.click(utils.getByRole('option', { name: 'Filled' }));
        expect(rowIndexes(utils)).toEqual(['703']);
    });

    it('makes each row one button that opens the order through the host route', async () => {
        const onOpenOrder = vi.fn();
        const { messaging } = harness({ orders: mixed });
        const utils = await mount(React.createElement(MyOrdersView, { walletId: 'w', onBack() {}, onOpenOrder }), messaging);

        const row = rowFor(utils, 703);
        const buttons = within(row).getAllByRole('button');
        expect(buttons).toHaveLength(1);
        // The standard drill-in chevron (G97).
        expect(buttons[0].querySelector('svg')).not.toBeNull();
        fireEvent.click(buttons[0]);
        expect(onOpenOrder).toHaveBeenCalledWith({ chainId: CHAIN, actionIndex: '703' });
    });

    it('opens the detail in place when the host has no order-detail route, and Back returns to the list', async () => {
        const { messaging } = harness({ orders: mixed, details: { 704: hydrated(704) } });
        const utils = await mount(React.createElement(MyOrdersView, { walletId: 'w', onBack() {} }), messaging);

        await domAct(async () => { fireEvent.click(within(rowFor(utils, 704)).getByRole('button')); await drain(); });
        expect(utils.getByRole('heading', { name: 'Order Detail' })).toBeTruthy();
        expect(await fact(utils, 'Order')).toHaveTextContent('#704');

        await domAct(async () => { fireEvent.click(utils.getByRole('button', { name: /back/i })); await drain(); });
        expect(list(utils)).toBeTruthy();
    });
});

describe('Order detail', () => {
    const open = (detail, messaging, extra = {}) => mount(
        React.createElement(OrderDetail, { walletId: 'w', chainId: CHAIN, actionIndex: '700', onBack() {}, ...extra }),
        messaging,
    );

    it('leads with the large ring, the trade and its status', async () => {
        const { messaging } = harness({ details: { 700: hydrated(700, 'open', '200') } });
        const utils = await open(null, messaging);

        const card = header(utils);
        const ring = card.querySelector('[data-fill-ring]');
        expect(ring).toHaveAttribute('data-size', 'lg');
        expect(ring).toHaveAttribute('data-percent', '60');
        expect(within(card).getByRole('img', { name: '60% filled' })).toBeTruthy();
        expect(within(card).getByText('Selling')).toBeTruthy();
        expect(within(card).getByText('500 DOGESWAP')).toBeTruthy();
        expect(within(card).getByText('for 10.5 DOGE')).toBeTruthy();
        expect(within(card).getByText('Partly filled')).toBeTruthy();
        const topLine = card.querySelector('[data-trade-header-top-line]');
        expect(within(topLine).getByText('Selling')).toBeTruthy();
        expect(within(topLine).getByText('Partly filled')).toBeTruthy();
        expect(topLine.nextElementSibling).toHaveTextContent('500 DOGESWAP');
        expect(topLine.nextElementSibling.nextElementSibling).toHaveTextContent('for 10.5 DOGE');
    });

    it('shows Actions first and chosen, every action one ActionList row', async () => {
        const onOpenMarket = vi.fn();
        const { messaging } = harness({ details: { 700: hydrated(700, 'open', '200') } });
        const utils = await open(null, messaging, { onOpenMarket });

        const tabs = utils.getAllByRole('tab');
        expect(tabs.map((tab) => tab.textContent)).toEqual(['Actions', 'Details', 'Matches']);
        expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
        // Every tab carries its icon (G13).
        for (const tab of tabs) expect(tab.querySelector('svg')).not.toBeNull();
        const actions = utils.getByRole('list', { name: 'Order actions' });
        const titles = within(actions).getAllByRole('listitem').map((li) => li.textContent);
        expect(titles).toEqual([
            'Edit orderChange the expiry or the allow and block lists',
            'Open the DOGESWAP / DOGE marketSee the book and trade',
            "View on the explorerThe order's transaction",
            'Copy transaction IDabab…abab',
            'Cancel orderReturns the 200 DOGESWAP still escrowed',
        ]);

        // Cancel is the danger row and names what it returns.
        const cancel = utils.getByRole('button', action('Cancel order'));
        expect(cancel).toHaveAttribute('data-tone', 'danger');
        // The market row uses the shell's market navigation, pair quote last.
        fireEvent.click(utils.getByRole('button', action('Open the DOGESWAP / DOGE market')));
        expect(onOpenMarket).toHaveBeenCalledWith(CHAIN, 'DOGESWAP', 'DOGE');
        // The explorer row opens the order's transaction.
        const explorer = utils.getByRole('link', action('View on the explorer'));
        expect(explorer).toHaveAttribute('href', expect.stringMatching(new RegExp(`/TDOGE/tx/${TX}$`)));
        expect(explorer).toHaveAttribute('target', '_blank');
        expect(explorer).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('copies the transaction ID from its row and says so in place of the short id', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        const saved = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
        try {
            const { messaging } = harness({ details: { 700: hydrated(700) } });
            const utils = await open(null, messaging);
            const copy = utils.getByRole('button', action('Copy transaction ID'));
            expect(copy).toHaveTextContent('abab…abab');
            await domAct(async () => { fireEvent.click(copy); await drain(); });
            expect(writeText).toHaveBeenCalledWith(TX);
            expect(utils.getByRole('button', action('Copy transaction ID'))).toHaveTextContent('Copied');
        } finally {
            if (saved) Object.defineProperty(navigator, 'clipboard', saved);
            else delete navigator.clipboard;
        }
    });

    it('leaves the market row out when the host gives no market navigation', async () => {
        const { messaging } = harness({ details: { 700: hydrated(700) } });
        const utils = await open(null, messaging);
        expect(utils.queryByRole('button', action('Open the'))).toBeNull();
        expect(utils.getByRole('button', action('Edit order'))).toBeTruthy();
    });

    it('holds the price, fills, expiry and transaction under Details', async () => {
        const { messaging } = harness({ details: { 700: hydrated(700, 'open', '200') } });
        const utils = await open(null, messaging);

        expect(await fact(utils, 'Price')).toHaveTextContent('0.021 DOGE each');
        expect(await fact(utils, 'Filled')).toHaveTextContent('300 of 500 DOGESWAP');
        expect(await fact(utils, 'Remaining')).toHaveTextContent('200 DOGESWAP');
        expect(await fact(utils, 'Order')).toHaveTextContent('#700');
        expect(await fact(utils, 'Expires')).toHaveTextContent(formatLocalDateTime(FUTURE));
        const tx = await fact(utils, 'Transaction');
        expect(tx).toHaveTextContent('abab…abab');
        // No copy buttons in Details (operator ruling); the explorer link stays, as on Swap Details.
        expect(within(tx).queryByRole('button')).toBeNull();
        expect(within(tx).getByRole('link', { name: 'View on the explorer' }))
            .toHaveAttribute('href', expect.stringMatching(new RegExp(`/TDOGE/tx/${TX}$`)));
        expect(within(utils.getByLabelText('Order details')).queryByText('Tx', { selector: 'dt' })).toBeNull();
    });

    it('draws Details as Swap Details does: one row per fact, the network named, the lists in words', async () => {
        const { messaging } = harness({ details: { 700: hydrated(700, 'open', '200', { allow_list: '2701' }) } });
        const utils = await open(null, messaging);
        await chooseTab(utils, 'Details');
        const card = utils.getByLabelText('Order details');

        // Each label and its value share one row element, so each row has one divider line.
        const rows = [...card.children];
        expect(rows.length).toBeGreaterThan(5);
        for (const row of rows) {
            expect(row.tagName).toBe('DIV');
            expect([...row.children].map((el) => el.tagName)).toEqual(['DT', 'DD']);
        }
        expect(card.querySelectorAll(':scope > dt, :scope > dd')).toHaveLength(0);

        // Network shows its icon and name; From the whole address when it fits (G99).
        expect(utils.getByTestId('order-detail-network')).toHaveTextContent('Dogecoin');
        expect(utils.getByTestId('order-detail-from').querySelector(`[title="${OWN}"]`)).toBeTruthy();
        expect(await fact(utils, 'Allow list')).toHaveTextContent('List #2701');
        expect(await fact(utils, 'Block list')).toHaveTextContent('None');
        expect(card.querySelector('button')).toBeNull();
    });

    it('never reads the zeroed remaining of a terminal order as a fill', async () => {
        const filled = await open(null, harness({ details: { 700: hydrated(700, 'filled', '0') } }).messaging);
        expect(await fact(filled, 'Filled')).toHaveTextContent('500 of 500 DOGESWAP');
        expect(await fact(filled, 'Remaining')).toHaveTextContent('0 DOGESWAP');
        cleanup();

        // The indexer zeroes give_remaining on a cancel or an expiry; nothing matched.
        for (const [status, extra] of [['cancelled', {}], ['expired', { expiration: PAST }]]) {
            const utils = await open(null, harness({ details: { 700: hydrated(700, status, '0', extra) } }).messaging);
            expect(within(header(utils)).getByText(status === 'cancelled' ? 'Closed' : 'Expired')).toBeTruthy();
            await chooseTab(utils, 'Details');
            const card = utils.getByLabelText('Order details');
            expect(within(card).queryByText('Filled', { selector: 'dt' })).toBeNull();
            expect(within(card).queryByText('Remaining', { selector: 'dt' })).toBeNull();
            cleanup();
        }
    });

    it('shows the order matches in the Matches tab, not under Details', async () => {
        const { messaging, calls } = harness({ details: { 700: hydrated(700, 'open', '300') } });
        const utils = await open(null, messaging);

        // The matches read only once Matches is chosen.
        expect(calls.some((c) => c.method === 'getOrderLifecycle')).toBe(false);
        expect(utils.queryByRole('button', { name: 'Timeline' })).toBeNull();
        await chooseTab(utils, 'Details');
        expect(utils.queryByRole('region', { name: 'Matches' })).toBeNull();
        expect(calls.some((c) => c.method === 'getOrderLifecycle')).toBe(false);

        await chooseTab(utils, 'Matches');
        expect(utils.getByRole('tab', { name: 'Matches' })).toHaveAttribute('aria-selected', 'true');
        expect(utils.queryByLabelText('Order details')).toBeNull();
        const matches = utils.getByRole('region', { name: 'Matches' });
        expect(within(matches).getByRole('heading', { name: 'Matches' })).toBeTruthy();
        const rail = within(matches).getByRole('list', { name: /lifecycle/i });
        expect(within(rail).getByText(/Filled \/ matched/)).toBeTruthy();
    });

    it('opens the standard Edit and Cancel forms in place when the host has no form routes', async () => {
        const { messaging } = harness({ details: { 700: hydrated(700) } });
        const utils = await open(null, messaging);

        fireEvent.click(utils.getByRole('button', action('Edit order')));
        expect(utils.getByRole('heading', { name: 'Edit Order' })).toBeTruthy();
        expect(utils.getByRole('button', { name: 'Update Order' })).toBeTruthy();
        // The Form Standard frame: From with Network, the main section, Speed and Fees.
        expect(utils.container.querySelector('[data-form-standard="edit-order"]')).not.toBeNull();
        fireEvent.click(utils.getByRole('button', { name: /back/i }));

        fireEvent.click(utils.getByRole('button', action('Cancel order')));
        expect(utils.getByRole('heading', { name: 'Cancel Order' })).toBeTruthy();
        expect(utils.container.querySelector('[data-form-standard="cancel-order"]')).not.toBeNull();
        // The cancel note moved to the review screen (G105).
        expect(utils.container.querySelector('[data-warning-line]')).toBeNull();
    });

    it('opens the edit-order and cancel-order routes when the host wires them', async () => {
        const onEditOrder = vi.fn();
        const onCancelOrder = vi.fn();
        const { messaging } = harness({ details: { 700: hydrated(700) } });
        const utils = await open(null, messaging, { onEditOrder, onCancelOrder });

        fireEvent.click(utils.getByRole('button', action('Edit order')));
        expect(onEditOrder).toHaveBeenCalledWith({ chainId: CHAIN, actionIndex: '700' });
        fireEvent.click(utils.getByRole('button', action('Cancel order')));
        expect(onCancelOrder).toHaveBeenCalledWith({ chainId: CHAIN, actionIndex: '700' });
        // The page stays put; the route draws the form.
        expect(utils.queryByRole('heading', { name: 'Edit Order' })).toBeNull();
        expect(utils.queryByRole('heading', { name: 'Cancel Order' })).toBeNull();
    });

    it('leaves Edit and Cancel out on a filled, cancelled or foreign order', async () => {
        const cases = [
            harness({ details: { 700: hydrated(700, 'filled', '0') } }),
            harness({ details: { 700: hydrated(700) }, cancels: [{ order_action_index: '700', source: OWN, status: 'valid' }] }),
            harness({ details: { 700: hydrated(700, 'open', '500', { source: OTHER }) } }),
        ];
        const expected = ['Filled', 'Closed', 'Open'];
        for (const [i, { messaging }] of cases.entries()) {
            const utils = await open(null, messaging);
            expect(within(header(utils)).getByText(expected[i])).toBeTruthy();
            // Left out, not drawn disabled: only the explorer and copy rows remain.
            const actions = utils.getByRole('list', { name: 'Order actions' });
            expect(within(actions).getAllByRole('listitem')).toHaveLength(2);
            expect(utils.queryByRole('button', action('Edit order'))).toBeNull();
            expect(utils.queryByRole('button', action('Cancel order'))).toBeNull();
            cleanup();
        }
    });

    it('says a native-coin order has nothing escrowed, and heads Details with its auto-pay switch', async () => {
        const nativeGive = hydrated(700, 'open', '1', { give_tick: '', give_coin: 'DOGE', give_amount: '1', get_tick: 'DOGESWAP', get_amount: '50' });
        const record = { id: 'ap-1', chainId: CHAIN, orderActionIndex: '700', autopay: false };
        const { messaging, calls } = harness({ details: { 700: nativeGive }, autopay: [record] });
        const utils = await open(null, messaging);

        expect(within(header(utils)).getByText('Buying')).toBeTruthy();
        expect(within(header(utils)).getByText('50 DOGESWAP')).toBeTruthy();
        expect(utils.getByRole('button', action('Cancel order'))).toHaveTextContent('Takes the order off the book');

        await chooseTab(utils, 'Details');
        const toggle = utils.getByRole('switch', { name: /Auto-pay off/ });
        // The setting row comes before the facts card.
        const facts = utils.getByLabelText('Order details');
        expect(toggle.compareDocumentPosition(facts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        await domAct(async () => { fireEvent.click(toggle); await drain(); });
        expect(calls.find((c) => c.method === 'setAutopayEnabled').args).toEqual({ id: 'ap-1', enabled: true });
        // The records are bound to their orders before they are read.
        const order = calls.map((c) => c.method);
        expect(order.indexOf('resolveAutopayIndexes')).toBeLessThan(order.indexOf('listAutopayOrders'));
    });

    it('shows a plain not-found state for an unknown order', async () => {
        const { messaging } = harness({ details: {} });
        const utils = await open(null, messaging);
        expect(utils.getByText('Order not found')).toBeTruthy();
        expect(utils.queryByRole('button', action('Cancel order'))).toBeNull();
    });

    it('ignores a read for an order the page has moved away from', async () => {
        let releaseOld;
        const oldRead = new Promise((resolve) => { releaseOld = resolve; });
        const { messaging } = harness({
            methods: {
                getOrderDetail: ({ actionIndex }) => (String(actionIndex) === '700'
                    ? oldRead
                    : Promise.resolve(hydrated(800))),
            },
        });
        const utils = await open(null, messaging);
        await domAct(async () => {
            utils.rerender(React.createElement(MessagingProvider, { shell: 'web', messaging },
                React.createElement(OrderDetail, { walletId: 'w', chainId: CHAIN, actionIndex: '800', onBack() {} })));
            await drain();
        });
        expect(await fact(utils, 'Order')).toHaveTextContent('#800');
        await domAct(async () => { releaseOld(hydrated(700)); await drain(); });
        expect(await fact(utils, 'Order')).toHaveTextContent('#800');
    });
});

describe('reads stay flat as rows grow', () => {
    const count = (calls) => calls.reduce((acc, c) => ({ ...acc, [c.method]: (acc[c.method] || 0) + 1 }), {});

    it('loads an order detail in the same reads at 1 and at 60 addresses, cancels and auto-pay records', async () => {
        const nativeGive = hydrated(700, 'open', '1', { give_tick: '', give_amount: '1', get_tick: 'DOGESWAP' });
        const sized = (n) => {
            const addresses = [HD_ADDRESS, ...Array.from({ length: n - 1 }, (_, i) => ({ ...HD_ADDRESS, id: `a${i}`, address: `addr-${i}` }))];
            const cancels = Array.from({ length: n }, (_, i) => ({ order_action_index: String(900 + i), source: OWN, status: 'valid' }));
            const autopay = Array.from({ length: n }, (_, i) => ({ id: `ap-${i}`, chainId: CHAIN, orderActionIndex: String(900 + i) }));
            return harness({ addresses, cancels, autopay, details: { 700: nativeGive } });
        };
        const small = sized(1);
        const large = sized(60);
        const a = await loadOrderDetail(small.messaging, { walletId: 'w', chainId: CHAIN, actionIndex: '700' });
        const b = await loadOrderDetail(large.messaging, { walletId: 'w', chainId: CHAIN, actionIndex: '700' });
        expect(a.item.owner.address).toBe(OWN);
        expect(b.item.owner.address).toBe(OWN);
        expect(count(large.calls)).toEqual(count(small.calls));
        expect(count(small.calls)).toEqual({
            getAddressesByChain: 1, getOrderDetail: 1, getOrderCancelsForAddress: 1,
            resolveAutopayIndexes: 1, listAutopayOrders: 1,
        });
    });

    it('renders the detail page in the same reads at 1 and at 60 cancel rows', async () => {
        const reads = async (n) => {
            const cancels = Array.from({ length: n }, (_, i) => ({ order_action_index: String(900 + i), source: OWN, status: 'valid' }));
            const { messaging, calls } = harness({ cancels, details: { 700: hydrated(700) } });
            await mount(React.createElement(OrderDetail, { walletId: 'w', chainId: CHAIN, actionIndex: '700', onBack() {} }), messaging);
            cleanup();
            return count(calls);
        };
        expect(await reads(60)).toEqual(await reads(1));
    });

    it('loads the list in the same reads at 2 and at 60 hydrated orders', async () => {
        const reads = async (n) => {
            const orders = Array.from({ length: n }, (_, i) => hydrated(1000 + i));
            const { messaging, calls } = harness({ orders });
            const utils = await mount(React.createElement(MyOrdersView, { walletId: 'w', onBack() {} }), messaging);
            expect(within(list(utils)).getAllByRole('listitem')).toHaveLength(n);
            cleanup();
            return count(calls);
        };
        const small = await reads(2);
        expect(await reads(60)).toEqual(small);
        // The page's own data reads: one per feed per address, none per row.
        // (getSettings is the app-wide settings hook, the same at any size.)
        const { getSettings: _settings, ...data } = small;
        expect(data).toEqual({ getAddressesByChain: 1, getOrdersForAddress: 1, getOrderCancelsForAddress: 1 });
    });
});
