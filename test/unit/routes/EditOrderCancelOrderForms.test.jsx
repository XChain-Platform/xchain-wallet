// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Edit Order, Cancel Order, Edit Swap and Cancel Swap are standard forms on
// their own routes (edit-order, cancel-order, edit-swap, cancel-swap), the
// way every other action form is (operator 2026-11-14): the Form Standard
// frame with From (Network and the owner address), the main section
// pre-filled from the order or swap, Memo, Speed and Fees, the status slot
// and one green action with its icon. Each route reads its item by chain and
// index. The review path is in TradeOwnerActionForm.review.test.jsx.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act as domAct, cleanup, render, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ROUTE_REGISTRY } from '../../../packages/core/src/shared/routeRegistry.js';
import { EditOrderForm } from '../../../packages/core/src/shared/routes/EditOrderForm.jsx';
import { CancelOrderForm } from '../../../packages/core/src/shared/routes/CancelOrderForm.jsx';
import { EditSwapForm } from '../../../packages/core/src/shared/routes/EditSwapForm.jsx';
import { CancelSwapForm } from '../../../packages/core/src/shared/routes/CancelSwapForm.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

const CHAIN = 'dogecoin-testnet';
const OWN = 'ndDEAAyn7DcGeaQ6chBWH2vaSdYAXVGNhc';
const OTHER = 'nk6y8sMqJ4wHTf9xvBqhZ2rGnM3cV5wXyz';
const FUTURE = Math.floor(Date.now() / 1000) + 3600;

const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0', address: OWN, publicKey: '02aabbcc',
    derivationPath: "m/44'/1'/0'/0/0", source: 'hd', signerId: 'signer-1',
});

function row(action, extra = {}) {
    return {
        action, action_index: action === 'SWAP' ? '812' : '700', source: OWN, tx_hash: 'ab'.repeat(32),
        give_tick: 'DOGESWAP', give_coin: 'DOGE', give_amount: '500', give_ownership: 0,
        get_tick: null, get_coin: 'DOGE', get_amount: '10.5', get_ownership: 0,
        expiration: FUTURE, block_index: '67882087', status: 'valid', allow_list: '2701',
        state: { status: 'open', give_remaining: '500', expiration: String(FUTURE), allow_list: '2701' },
        ...extra,
    };
}

function harness(extra = {}, { size = 1, calls = null } = {}) {
    // `size` grows the wallet's addresses and the owner's cancels feed together.
    const addresses = [HD_ADDRESS, ...Array.from({ length: size - 1 }, (_, i) => ({ ...HD_ADDRESS, id: `a${i}`, address: `addr-${i}` }))];
    const cancels = Array.from({ length: size }, (_, i) => ({
        order_action_index: String(900 + i), swap_action_index: String(900 + i), source: OWN, status: 'valid',
    }));
    const log = (name, fn) => (...args) => { calls?.push(name); return fn(...args); };
    const target = {
        getAddressesByChain: log('getAddressesByChain', () => Promise.resolve({ [CHAIN]: addresses })),
        getOrderDetail: log('getOrderDetail', () => Promise.resolve(row('ORDER', extra))),
        getOrderCancelsForAddress: log('getOrderCancelsForAddress', () => Promise.resolve({ data: cancels })),
        listAutopayOrders: log('listAutopayOrders', () => Promise.resolve([])),
        getSwapDetail: log('getSwapDetail', () => Promise.resolve({ data: row('SWAP', extra) })),
        getSwapCancelsForAddress: log('getSwapCancelsForAddress', () => Promise.resolve({ data: cancels })),
        getSignerStatus: () => Promise.resolve({ status: 'locked' }),
    };
    return new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => { calls?.push(String(prop)); return Promise.resolve({}); };
        },
    });
}

async function drain(rounds = 40) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function mount(Component, props, messaging = harness()) {
    let utils;
    await domAct(async () => {
        utils = render(React.createElement(MessagingProvider, { shell: 'web', messaging },
            React.createElement(Component, { walletId: 'w', chainId: CHAIN, onBack() {}, ...props })));
        await drain();
    });
    return utils;
}

const FORMS = [
    { route: 'edit-order', Component: EditOrderForm, index: '700', title: 'Edit Order', button: 'Update Order', facts: 'Order', edit: true },
    { route: 'cancel-order', Component: CancelOrderForm, index: '700', title: 'Cancel Order', button: 'Cancel Order', facts: 'Order', edit: false },
    { route: 'edit-swap', Component: EditSwapForm, index: '812', title: 'Edit Swap', button: 'Update Swap', facts: 'Swap', edit: true },
    { route: 'cancel-swap', Component: CancelSwapForm, index: '812', title: 'Cancel Swap', button: 'Cancel Swap', facts: 'Swap', edit: false },
];

afterEach(() => cleanup());

describe.each(FORMS)('the $route route', ({ route, Component, index, title, button, facts, edit }) => {
    it('is a registered route of its own, given the item by chain and action index', () => {
        expect(ROUTE_REGISTRY[route]).toMatchObject({ component: Component.name, nav: 'markets' });
        expect(ROUTE_REGISTRY[route].minimalProps).toMatchObject({ chainId: expect.any(String), actionIndex: expect.any(String) });
    });

    it('draws the Form Standard frame: From with Network, the main section, Speed and Fees, one green action', async () => {
        const utils = await mount(Component, { actionIndex: index });

        expect(utils.getByRole('heading', { name: title })).toBeTruthy();
        const form = utils.container.querySelector(`[data-form-standard="${route}"]`);
        expect(form).not.toBeNull();

        // Sections in standard order: From, the main section, Memo, Speed and Fees.
        const sections = [...form.querySelectorAll('[data-form-section]')].map((s) => s.getAttribute('data-form-section'));
        expect(sections[0]).toBe('from');
        expect(sections.indexOf('main')).toBeGreaterThan(0);
        expect(sections.indexOf('memo')).toBeGreaterThan(sections.indexOf('main'));
        expect(sections.at(-1)).toBe('fee');

        // From holds the Network field and the owner address, locked to the item.
        const from = form.querySelector('[data-form-section="from"]');
        expect(within(from).getAllByText('Network', { exact: false }).length).toBeGreaterThan(0);
        expect(from.textContent).toContain('Dogecoin');
        const fee = form.querySelector('[data-form-section="fee"]');
        expect(fee.querySelector('[data-form-section-title]')).toHaveTextContent('Speed and Fees');

        // The main section opens on load, pre-filled from the item.
        const main = form.querySelector('[data-form-section="main"]');
        expect(main).toHaveAttribute('data-form-main');
        const card = within(main).getByLabelText(facts, { selector: 'dl' });
        expect(card).toHaveTextContent('500 DOGESWAP');
        expect(card).toHaveTextContent(`#${index}`);

        // One green action with its icon, its label a Title Case verb (G50).
        const submit = utils.getByRole('button', { name: button });
        expect(submit.className).toContain(buttonStyles.success);
        expect(submit.querySelector('svg')).not.toBeNull();
        // No warning block on the form: the review screen carries it (G105).
        expect(utils.container.querySelector('[data-warning-line]')).toBeNull();
    });

    it(edit ? 'offers the new expiration and the bound lists, pre-filled' : 'has no edit fields', async () => {
        const utils = await mount(Component, { actionIndex: index });
        if (edit) {
            expect(utils.getByLabelText('New expiration', { selector: 'input' })).toBeTruthy();
            expect(utils.getByRole('button', { name: /^Allow list: Allow list #2701/ })).toBeTruthy();
            expect(utils.getByRole('button', { name: /^Block list: None set/ })).toBeTruthy();
        } else {
            expect(utils.queryByLabelText('New expiration', { selector: 'input' })).toBeNull();
        }
    });

    it('refuses an item this wallet did not place, with the reason', async () => {
        const utils = await mount(Component, { actionIndex: index }, harness({ source: OTHER }));
        expect(utils.getByRole('heading', { name: title })).toBeTruthy();
        expect(utils.getByText(/not in this wallet, so this wallet cannot change it/)).toBeTruthy();
        expect(utils.queryByRole('button', { name: button })).toBeNull();
    });

    it('makes the same reads at 1 and at 60 addresses and cancels', async () => {
        const reads = async (size) => {
            const calls = [];
            await mount(Component, { actionIndex: index }, harness({}, { size, calls }));
            cleanup();
            return calls.reduce((acc, name) => ({ ...acc, [name]: (acc[name] || 0) + 1 }), {});
        };
        const small = await reads(1);
        expect(await reads(60)).toEqual(small);
        // The item's own fixed reads, one each: never one per address or cancel.
        const own = route.endsWith('order')
            ? ['getAddressesByChain', 'getOrderDetail', 'getOrderCancelsForAddress']
            : ['getAddressesByChain', 'getSwapDetail', 'getSwapCancelsForAddress'];
        for (const name of own) expect(small[name], name).toBe(1);
    });

    it('goes Back through the host', async () => {
        const onBack = vi.fn();
        const utils = await mount(Component, { actionIndex: index, onBack });
        await domAct(async () => { utils.getByRole('button', { name: /back/i }).click(); await drain(); });
        expect(onBack).toHaveBeenCalledTimes(1);
    });
});
