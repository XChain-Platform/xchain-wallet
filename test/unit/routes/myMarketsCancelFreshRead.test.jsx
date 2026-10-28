// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// My orders and My swaps re-read the offer before a cancel or edit composes,
// so an offer that filled or was cancelled since the list loaded is refused
// before anything is signed. Those re-reads are fresh: the list loaded the
// same reads a moment earlier, and a reused or HTTP-cached answer would be
// the list's own.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act as domAct, fireEvent, cleanup, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MyOrdersView } from '../../../packages/core/src/shared/routes/MyOrdersView.jsx';
import { MySwapsView } from '../../../packages/core/src/shared/routes/MySwapsView.jsx';

const CHAIN = 'dogecoin-testnet';
const OWN = 'ndDEAAyn7DcGeaQ6chBWH2vaSdYAXVGNhc';
const FUTURE = Math.floor(Date.now() / 1000) + 3600;

const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0', address: OWN, publicKey: '02aabbcc',
    derivationPath: "m/44'/1'/0'/0/0", source: 'hd', signerId: 'signer-1',
});

const COMPOSED = Object.freeze({
    psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 1,
    chainId: CHAIN, networkFeeSats: 1234,
});
const PASS = Object.freeze({ verdict: 'pass', findings: [] });

function marketRow(actionIndex, extra = {}) {
    return {
        action_index: String(actionIndex), source: OWN,
        give_tick: 'DOGESWAP', give_coin: 'DOGE', give_amount: '500', give_ownership: 0,
        get_tick: 'OTHER', get_coin: 'DOGE', get_amount: '10', get_ownership: 0,
        expiration: FUTURE, block_index: '67882087', status: 'valid',
        ...extra,
    };
}

// The two views, and what each one's owner actions compose and sign with.
const VIEWS = [
    {
        name: 'My orders',
        Component: MyOrdersView,
        action: 'ORDER',
        indexKey: 'ORDER_ACTION_INDEX',
        noun: 'order',
        createProp: 'onCreateOrder',
        createLabel: 'New order',
        software: { cancel: 'cancelOrder', edit: 'editOrder' },
        hardware: { cancel: 'cancelOrderHw', edit: 'editOrderHw' },
        feeds: (rows) => ({
            getOrdersForAddress: () => Promise.resolve({ data: rows }),
            getOrderCancelsForAddress: () => Promise.resolve({ data: [] }),
            getOrderDetail: ({ actionIndex }) => Promise.resolve({
                action: 'ORDER', action_index: actionIndex, status: 'valid',
                state: { give_remaining: '500', get_remaining: '10', expiration: String(FUTURE), status: 'open' },
            }),
            listAutopayOrders: () => Promise.resolve([]),
        }),
    },
    {
        name: 'My swaps',
        Component: MySwapsView,
        action: 'SWAP',
        indexKey: 'SWAP_ACTION_INDEX',
        noun: 'swap',
        createProp: 'onCreateSwap',
        createLabel: 'New swap',
        software: { cancel: 'swapAction', edit: 'swapAction' },
        hardware: { cancel: 'swapActionHw', edit: 'swapActionHw' },
        feeds: (rows) => ({
            getSwapsForAddress: () => Promise.resolve({ data: rows }),
            getSwapCancelsForAddress: () => Promise.resolve({ data: [] }),
        }),
    },
];

beforeEach(() => {
    vi.useFakeTimers({
        toFake: [
            'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
            'setImmediate', 'clearImmediate', 'requestAnimationFrame',
            'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
        ],
    });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

async function drain(rounds = 24) {
    for (let i = 0; i < rounds; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
}

async function mount(view, {
    owner = HD_ADDRESS,
    rows = [marketRow(700)],
    settings = { walletMode: 'full' },
    preflight = PASS,
    chainId = CHAIN,
    onCreate,
} = {}) {
    const calls = [];
    const log = (method, value) => (args) => { calls.push({ method, args }); return Promise.resolve(value); };
    const target = {
        getAddressesByChain: () => Promise.resolve({ [chainId]: [owner] }),
        getSettings: () => Promise.resolve(settings),
        signerReady: () => Promise.resolve({ ready: true }),
        getSignerStatus: () => Promise.resolve({ status: owner.source === 'hd' ? 'unlocked' : 'available' }),
        getListsForSource: () => Promise.resolve({ data: [{ action_index: '2701', type: '2', status: 'valid' }] }),
        getListByActionIndex: () => Promise.resolve({ list: [] }),
        composeForConfirm: (args) => {
            calls.push({ method: 'composeForConfirm', args });
            const noun = args.actionData.action === 'ORDER' ? 'order' : 'swap';
            const index = args.actionData.params.ORDER_ACTION_INDEX
                || args.actionData.params.SWAP_ACTION_INDEX;
            return Promise.resolve({
                ...COMPOSED,
                decoded: {
                    summary: `Cancel ${noun} (#${index})`,
                    details: [{ label: `${noun} action index`, value: index }],
                    warnings: [],
                },
            });
        },
        preflight: log('preflight', preflight),
        ...Object.fromEntries(Object.entries(view.feeds(rows)).map(([name, fn]) => [name, (args) => { calls.push({ method: name, args }); return fn(args); }])),
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return log(String(prop), { txid: `tx-${String(prop)}`, psbtHex: 'bb00' });
        },
    });
    let utils;
    await domAct(async () => {
        utils = render(React.createElement(MessagingProvider, { shell: 'web', messaging },
            React.createElement(view.Component, {
                walletId: 'w',
                onBack() {},
                [view.createProp]: onCreate,
            })));
        await drain();
    });
    return { utils, calls };
}

async function step(fn) {
    await domAct(async () => { fn(); await drain(); });
}

async function openAction(utils, label) {
    const row = within(utils.getByRole('list', { name: /^Open / })).getByText('#700', { exact: false }).closest('li');
    await step(() => fireEvent.click(within(row).getByRole('button', { name: label })));
}


const RECHECKS = {
    'My orders': ['getOrderCancelsForAddress', 'getOrderDetail'],
    'My swaps': ['getSwapCancelsForAddress', 'getSwapDetail'],
};

describe.each(VIEWS)('$name re-reads the offer fresh before a cancel', (view) => {
    it('asks for fresh reads at the re-check and ordinary reads for the list', async () => {
        const { utils, calls } = await mount(view);
        const listed = calls.length;
        for (const name of RECHECKS[view.name]) {
            for (const c of calls.slice(0, listed).filter((x) => x.method === name)) {
                expect(c.args?.fresh, name + ' on list load').toBeUndefined();
            }
        }
        await openAction(utils, 'Cancel');
        await step(() => fireEvent.click(utils.getByRole('button', { name: `Cancel ${view.noun}` })));

        expect(calls.find((c) => c.method === 'composeForConfirm'), 'the cancel composes').toBeTruthy();
        for (const name of RECHECKS[view.name]) {
            const recheck = calls.slice(listed).filter((c) => c.method === name);
            expect(recheck.length, name).toBeGreaterThan(0);
            for (const c of recheck) expect(c.args, name).toMatchObject({ chainId: CHAIN, fresh: true });
        }
    });
});
