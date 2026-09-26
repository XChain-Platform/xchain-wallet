// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// My orders and My swaps: Cancel and Edit on the shared confirm lane. They
// used to sign from their own panels with no decoded review and no dry run.
// The two views are twins, so every case runs against both: the pre-flight
// runs before the signature, the confirm page names the signing address, the
// device lane signs the same composed bytes, and watcher mode builds unsigned.

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
const HW_ADDRESS = Object.freeze({ ...HD_ADDRESS, id: 'addr-hw-0', source: 'ledger', signerId: 'signer-hw' });

const COMPOSED = Object.freeze({ psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 1 });
const PASS = Object.freeze({ verdict: 'pass', findings: [] });
const REFUSED = Object.freeze({
    verdict: 'fail',
    findings: [{ severity: 'error', overridable: false, code: 'INVALID_FIELD_VALUE', message: 'The network would refuse this action.' }],
});

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
        composeForConfirm: log('composeForConfirm', COMPOSED),
        preflight: log('preflight', preflight),
        ...view.feeds(rows),
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
            React.createElement(view.Component, { walletId: 'w', onBack() {} })));
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

async function approve(utils) {
    const btn = utils.container.querySelector('[data-testid="confirm-approve"]');
    if (btn && !btn.disabled) await step(() => fireEvent.click(btn));
}

const indexOf = (calls, method) => calls.findIndex((c) => c.method === method);

describe.each(VIEWS)('$name owner actions sign through the confirm page', (view) => {
    const signMethods = [...Object.values(view.software), ...Object.values(view.hardware)];
    const signCalls = (calls) => calls.filter((c) => signMethods.includes(c.method));

    it('cancels only after the pre-flight, signing the composed bytes', async () => {
        const { utils, calls } = await mount(view);
        await openAction(utils, 'Cancel');
        await step(() => fireEvent.click(utils.getByRole('button', { name: `Cancel ${view.noun}` })));

        expect(signCalls(calls), 'nothing signs before Approve').toHaveLength(0);
        const compose = calls.find((c) => c.method === 'composeForConfirm');
        expect(compose.args.actionData).toEqual({ action: view.action, params: { VERSION: '1', [view.indexKey]: '700' } });
        expect(compose.args.encoderOpts, 'DOGE pays its protocol fee natively').toMatchObject({ payFeeInNativeCoin: true });
        const from = utils.getByTestId('confirm-source').textContent;
        expect(from, 'the confirm page names the signer').toContain(OWN.slice(0, 6));
        expect(from).toContain(OWN.slice(-6));

        await approve(utils);
        const sign = calls.find((c) => c.method === view.software.cancel);
        expect(sign, 'signed on Approve').toBeTruthy();
        expect(indexOf(calls, view.software.cancel)).toBeGreaterThan(indexOf(calls, 'preflight'));
        expect(sign.args.prebuiltPsbt).toMatchObject({ psbtHex: 'aa00', encoding: 'psbt' });
    });

    it('blocks a cancel the pre-flight says the network would refuse', async () => {
        const { utils, calls } = await mount(view, { preflight: REFUSED });
        await openAction(utils, 'Cancel');
        await step(() => fireEvent.click(utils.getByRole('button', { name: `Cancel ${view.noun}` })));
        await approve(utils);

        expect(calls.some((c) => c.method === 'preflight')).toBe(true);
        expect(signCalls(calls)).toHaveLength(0);
    });

    it('edits a hardware owner on the device lane with the same composed bytes', async () => {
        const { utils, calls } = await mount(view, { owner: HW_ADDRESS });
        await openAction(utils, 'Edit');
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Set block-list' })));
        await step(() => fireEvent.click(utils.getByRole('button', { name: /Address list #2701/ })));
        await step(() => fireEvent.click(utils.getByRole('button', { name: `Edit ${view.noun}` })));

        const compose = calls.find((c) => c.method === 'composeForConfirm');
        expect(compose.args.actionData.params).toEqual({ VERSION: '2', [view.indexKey]: '700', BLOCK_LIST: '2701' });
        await approve(utils);
        const sign = calls.find((c) => c.method === view.hardware.edit);
        expect(sign, 'signed on the device lane').toBeTruthy();
        expect(sign.args.signerId).toBe('signer-hw');
        expect(sign.args.password, 'no password rides the device lane').toBeUndefined();
        expect(sign.args.prebuiltPsbt).toMatchObject({ psbtHex: 'aa00' });
    });

    it('offers a bound-list removal on regtest and sends the zero sentinel', async () => {
        const rows = [marketRow(700, { allow_list: '2701', block_list: '0' })];
        const { utils, calls } = await mount(view, { rows, chainId: 'dogecoin-regtest' });
        expect(utils.getByText(/Allow list #2701 · Block list none/)).toBeTruthy();
        await openAction(utils, 'Edit');
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Remove allow list' })));
        await step(() => fireEvent.click(utils.getByRole('button', { name: `Edit ${view.noun}` })));

        const compose = calls.find((c) => c.method === 'composeForConfirm');
        expect(compose.args.actionData.params).toEqual({
            VERSION: '2', [view.indexKey]: '700', ALLOW_LIST: '0',
        });
    });

    it('keeps the removal choice hidden while the activation is unarmed', async () => {
        const rows = [marketRow(700, { allow_list: '2701' })];
        const { utils } = await mount(view, { rows });
        await openAction(utils, 'Edit');
        expect(utils.queryByRole('button', { name: 'Remove allow list' })).toBeNull();
    });

    it('keeps watcher mode on its unsigned build, with no signature to pre-flight', async () => {
        const { utils, calls } = await mount(view, { settings: { walletMode: 'watcher' } });
        await openAction(utils, 'Cancel');
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Create unsigned transaction' })));

        expect(calls.find((c) => c.method === 'buildActionPsbtRequest').args.actionData.action).toBe(view.action);
        expect(calls.some((c) => c.method === 'composeForConfirm')).toBe(false);
        expect(signCalls(calls)).toHaveLength(0);
    });
});
