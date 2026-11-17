// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Edit Order, Cancel Order, Edit Swap and Cancel Swap are on-chain
// transactions, so each is a standard Form Standard form (operator
// 2026-11-14, said twice): From (the owner address, fixed), the action's own
// section, Memo, then Speed and Fees at the bottom, and its action reaches
// the shared review screen through the normal confirm lane. Each route here
// runs on the real lane: compose, pre-flight, the review page, Approve.
// A blank memo composes exactly what the form composed before the Memo field.

import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act as domAct, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { EditOrderForm } from '../../../packages/core/src/shared/routes/EditOrderForm.jsx';
import { CancelOrderForm } from '../../../packages/core/src/shared/routes/CancelOrderForm.jsx';
import { EditSwapForm } from '../../../packages/core/src/shared/routes/EditSwapForm.jsx';
import { CancelSwapForm } from '../../../packages/core/src/shared/routes/CancelSwapForm.jsx';
import { navItemKey, useNavHistory } from '../../../packages/core/src/ui/navHistory.js';
import facts from '../../../packages/core/src/shared/routes/FactRows.module.css';

const CHAIN = 'dogecoin-testnet';
const OWN = 'ndDEAAyn7DcGeaQ6chBWH2vaSdYAXVGNhc';
const FUTURE = Math.floor(Date.now() / 1000) + 3600;
const NEW_EXPIRATION = '2099-01-01T00:00';
const NEW_EXPIRATION_SECONDS = String(Math.floor(Date.parse(NEW_EXPIRATION) / 1000));

const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0', address: OWN, publicKey: '02aabbcc',
    derivationPath: "m/44'/1'/0'/0/0", source: 'hd', signerId: 'signer-1',
});

const COMPOSED = Object.freeze({
    psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 1,
    chainId: CHAIN, networkFeeSats: 1234,
});

function row(action) {
    return {
        action, action_index: action === 'SWAP' ? '812' : '700', source: OWN, tx_hash: 'ab'.repeat(32),
        give_tick: 'DOGESWAP', give_coin: 'DOGE', give_amount: '500', give_ownership: 0,
        get_tick: null, get_coin: 'DOGE', get_amount: '10.5', get_ownership: 0,
        expiration: FUTURE, block_index: '67882087', status: 'valid',
        state: { status: 'open', give_remaining: '500', expiration: String(FUTURE) },
    };
}

const FORMS = [
    {
        route: 'edit-order', Component: EditOrderForm, action: 'ORDER', indexKey: 'ORDER_ACTION_INDEX', index: '700',
        button: 'Update Order', edit: true, sign: 'editOrder',
    },
    {
        route: 'cancel-order', Component: CancelOrderForm, action: 'ORDER', indexKey: 'ORDER_ACTION_INDEX', index: '700',
        button: 'Cancel Order', edit: false, sign: 'cancelOrder',
    },
    {
        route: 'edit-swap', Component: EditSwapForm, action: 'SWAP', indexKey: 'SWAP_ACTION_INDEX', index: '812',
        button: 'Update Swap', edit: true, sign: 'swapAction',
    },
    {
        route: 'cancel-swap', Component: CancelSwapForm, action: 'SWAP', indexKey: 'SWAP_ACTION_INDEX', index: '812',
        button: 'Cancel Swap', edit: false, sign: 'swapAction',
    },
];

beforeEach(() => {
    publishWalletModes({ wallets: [{ id: 'w', walletMode: 'full' }], activeWalletId: 'w' });
});
afterEach(() => { cleanup(); resetWalletModes(); });

async function drain(rounds = 40) {
    for (let i = 0; i < rounds; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
}

async function step(fn) {
    await domAct(async () => { fn(); await drain(); });
}

function harness(calls) {
    const log = (method, value) => (args) => { calls.push({ method, args }); return Promise.resolve(value); };
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [HD_ADDRESS] }),
        getSettings: () => Promise.resolve({}),
        listWallets: () => Promise.resolve([{ id: 'w', name: 'W', walletMode: 'full' }]),
        signerReady: () => Promise.resolve({ ready: true }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        getOrderDetail: () => Promise.resolve(row('ORDER')),
        getOrderCancelsForAddress: () => Promise.resolve({ data: [] }),
        listAutopayOrders: () => Promise.resolve([]),
        getSwapDetail: () => Promise.resolve({ data: row('SWAP') }),
        getSwapCancelsForAddress: () => Promise.resolve({ data: [] }),
        composeForConfirm: (args) => {
            calls.push({ method: 'composeForConfirm', args });
            return Promise.resolve({
                ...COMPOSED,
                decoded: { summary: `${args.actionData.action} change`, details: [], warnings: [] },
            });
        },
        preflight: log('preflight', { verdict: 'pass', findings: [] }),
    };
    return new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return log(String(prop), { txid: `tx-${String(prop)}`, psbtHex: 'bb00' });
        },
    });
}

async function mount(form) {
    const calls = [];
    let utils;
    await domAct(async () => {
        utils = render(
            <MessagingProvider shell="web" messaging={harness(calls)}>
                <form.Component walletId="w" chainId={CHAIN} actionIndex={form.index} onBack={() => {}} />
            </MessagingProvider>,
        );
        await drain();
    });
    return { utils, calls };
}

const sectionOf = (utils, id) => utils.container.querySelector(`[data-form-section="${id}"]`);
const memoField = (utils) => within(sectionOf(utils, 'memo')).getByLabelText('Memo', { selector: 'textarea' });

async function makeEdit(utils) {
    const input = utils.getByLabelText('New expiration', { selector: 'input' });
    await step(() => fireEvent.change(input, { target: { value: NEW_EXPIRATION } }));
}

async function typeMemo(utils, value) {
    await step(() => fireEvent.change(memoField(utils), { target: { value } }));
}

async function submit(utils, form) {
    await step(() => fireEvent.click(utils.getByRole('button', { name: form.button })));
}

async function approve(utils) {
    const button = utils.getByTestId('confirm-approve');
    expect(button.disabled, 'Approve is live on the review page').toBe(false);
    await step(() => fireEvent.click(button));
}

const composeOf = (calls) => calls.find((c) => c.method === 'composeForConfirm');

describe.each(FORMS)('the $route form', (form) => {
    const expectedParams = (extra = {}) => ({
        VERSION: form.edit ? '2' : '1',
        [form.indexKey]: form.index,
        ...(form.edit ? { EXPIRATION: NEW_EXPIRATION_SECONDS } : {}),
        ...extra,
    });

    it('renders From, its own section, Memo, then Speed and Fees at the bottom', async () => {
        const { utils } = await mount(form);
        const frame = utils.container.querySelector(`[data-form-standard="${form.route}"]`);
        expect(frame).not.toBeNull();

        const order = [...frame.querySelectorAll('[data-form-section]')].map((s) => s.getAttribute('data-form-section'));
        expect(order[0]).toBe('from');
        expect(order.indexOf('main')).toBe(1);
        expect(order.indexOf('memo')).toBeGreaterThan(order.indexOf('main'));
        // Advanced sits directly above Speed and Fees, drawn by FeeSection (G98).
        expect(order.slice(-2)).toEqual(['advanced', 'fee']);

        // From names the owner address and offers no way to change it.
        const from = sectionOf(utils, 'from');
        expect(from.textContent).toContain(OWN.slice(0, 6));
        expect(from.textContent).toContain('Dogecoin');
        expect(sectionOf(utils, 'fee').querySelector('[data-form-section-title]')).toHaveTextContent('Speed and Fees');

        // Memo is closed and optional, as on Send and Create Order.
        const memoHeader = within(sectionOf(utils, 'memo')).getAllByRole('button', { hidden: true })[0];
        expect(memoHeader).toHaveAttribute('aria-expanded', 'false');
        expect(sectionOf(utils, 'memo').textContent).toContain('Optional');

        // What is changed or cancelled shows as the shared FactRows, no card of its own.
        const factsList = sectionOf(utils, 'main').querySelector('[data-trade-owner-facts]');
        expect(factsList.tagName).toBe('DL');
        expect(factsList.className).toContain(facts.list);
        expect([...factsList.querySelectorAll('dt')].map((dt) => dt.textContent)).toEqual(['Give', 'Get', form.action === 'SWAP' ? 'Swap' : 'Order']);
        expect(factsList.querySelectorAll('dd')[2]).toHaveTextContent(`#${form.index}`);

        // No radio buttons and no fee box of its own (G113, G119).
        expect(frame.querySelector('input[type="radio"]')).toBeNull();
        expect(frame.querySelector('[role="radiogroup"]')).toBeNull();
    });

    it('reaches the review screen and signs the composed bytes on Approve, a blank memo sending no MEMO', async () => {
        const { utils, calls } = await mount(form);
        if (form.edit) await makeEdit(utils);
        await submit(utils, form);

        const compose = composeOf(calls);
        expect(compose, 'the form composed through the confirm lane').toBeTruthy();
        expect(compose.args.actionData).toEqual({ action: form.action, params: expectedParams() });
        expect(utils.getByTestId('confirm-facts')).toBeTruthy();
        expect(calls.some((c) => c.method === form.sign), 'nothing signs before Approve').toBe(false);

        await approve(utils);
        const sign = calls.find((c) => c.method === form.sign);
        expect(sign, 'signed on Approve').toBeTruthy();
        expect(sign.args.prebuiltPsbt).toMatchObject({ psbtHex: 'aa00' });
        expect(sign.args.memo).toBeUndefined();
        expect(sign.args.params?.MEMO).toBeUndefined();
    });

    it('sends a typed memo as MEMO, trimmed, to compose and to the signing flow', async () => {
        const { utils, calls } = await mount(form);
        if (form.edit) await makeEdit(utils);
        await typeMemo(utils, '  thanks for trading  ');
        await submit(utils, form);

        expect(composeOf(calls).args.actionData.params).toEqual(expectedParams({ MEMO: 'thanks for trading' }));
        expect(utils.getByTestId('confirm-facts')).toBeTruthy();
        await approve(utils);
        const sign = calls.find((c) => c.method === form.sign);
        // cancelOrder reads `memo`; editOrder and swapAction read params.MEMO.
        if (form.sign === 'cancelOrder') expect(sign.args.memo).toBe('thanks for trading');
        else expect(sign.args.params.MEMO).toBe('thanks for trading');
    });

    it('refuses a memo the network would refuse, opening Memo and composing nothing', async () => {
        const { utils, calls } = await mount(form);
        if (form.edit) await makeEdit(utils);
        await typeMemo(utils, 'a|b');
        await submit(utils, form);

        expect(utils.getAllByText('Memo cannot contain "|" or ";".').length).toBeGreaterThan(0);
        expect(composeOf(calls)).toBeUndefined();
        const memoHeader = within(sectionOf(utils, 'memo')).getAllByRole('button')[0];
        expect(memoHeader).toHaveAttribute('aria-expanded', 'true');
        expect(memoField(utils)).toHaveAttribute('aria-invalid', 'true');
    });

    if (form.edit) {
        it('still asks for a change when only the memo is filled', async () => {
            const { utils, calls } = await mount(form);
            await typeMemo(utils, 'just a note');
            await submit(utils, form);
            expect(utils.getByText(/Change at least one field/)).toBeTruthy();
            expect(composeOf(calls)).toBeUndefined();
        });
    }
});

// Back from each form returns to the detail page it was opened from, with
// the same order or swap, the way the shells wire it: the detail page sets
// the ref and opens the form route, and the form's Back (and Done) is
// nav.back.
describe('Back from an edit or cancel form returns to its detail page', () => {
    const PAIRS = [
        ['order-detail', 'edit-order', 'orderRef'],
        ['order-detail', 'cancel-order', 'orderRef'],
        ['swap-detail', 'edit-swap', 'swapRef'],
        ['swap-detail', 'cancel-swap', 'swapRef'],
    ];

    it.each(PAIRS)('%s, then %s, then Back', (detail, formRoute, refField) => {
        function Shell() {
            const [ref, setRef] = useState(/** @type {any} */ (null));
            const nav = useNavHistory({
                capture: () => ({ [refField]: ref }),
                restore: (ctx) => setRef(ctx[refField]),
                itemKey: navItemKey,
            });
            const shown = `${nav.view}:${ref ? ref.actionIndex : '-'}`;
            return (
                <>
                    <output>{shown}</output>
                    <button type="button" onClick={() => nav.navigate('markets')}>List</button>
                    <button type="button" onClick={() => { setRef({ chainId: CHAIN, actionIndex: '700' }); nav.navigate(detail); }}>Open 700</button>
                    <button type="button" onClick={() => { setRef({ chainId: CHAIN, actionIndex: '700' }); nav.navigate(formRoute); }}>Open form</button>
                    <button type="button" onClick={nav.back}>Back</button>
                </>
            );
        }
        render(<Shell />);
        const click = (name) => fireEvent.click(screen.getByRole('button', { name }));
        const shown = () => screen.getByRole('status').textContent;
        click('List');
        click('Open 700');
        click('Open form');
        expect(shown()).toBe(`${formRoute}:700`);
        click('Back');
        expect(shown()).toBe(`${detail}:700`);
        // One more Back leaves the detail page for the list it came from.
        click('Back');
        expect(shown()).toBe('markets:-');
    });
});
