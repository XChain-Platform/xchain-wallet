// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// My orders and My swaps follow the shared button and field rulings (U56,
// U57, U63): every row button carries an icon, the edit and cancel panels
// have one green named forward action with an icon, the new expiration uses
// the Optional pill instead of "(optional)" text, and the access-list row
// carries its own help tip.

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act as domAct, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MyOrdersView } from '../../../packages/core/src/shared/routes/MyOrdersView.jsx';
import { MySwapsWithDetail } from '../mySwapsWithDetail.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

const CHAIN = 'dogecoin-testnet';
const OWN = 'ndDEAAyn7DcGeaQ6chBWH2vaSdYAXVGNhc';
const FUTURE = Math.floor(Date.now() / 1000) + 3600;

const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0', address: OWN, publicKey: '02aabbcc',
    derivationPath: "m/44'/1'/0'/0/0", source: 'hd', signerId: 'signer-1',
});

function row(actionIndex) {
    return {
        action_index: String(actionIndex), source: OWN,
        give_tick: 'DOGESWAP', give_coin: 'DOGE', give_amount: '500', give_ownership: 0,
        get_tick: null, get_coin: 'DOGE', get_amount: '10.5', get_ownership: 0,
        expiration: FUTURE, block_index: '67882087', status: 'valid',
    };
}

async function open(View, extra) {
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [HD_ADDRESS] }),
        getSignerStatus: () => Promise.resolve({ status: 'locked' }),
        ...extra,
    };
    const messaging = new Proxy(target, {
        get(t, prop) { return prop in t ? t[prop] : () => Promise.resolve({}); },
    });
    let utils;
    await domAct(async () => {
        utils = render(React.createElement(MessagingProvider, { shell: 'web', messaging },
            React.createElement(View, { walletId: 'w', onBack() {} })));
        for (let i = 0; i < 24; i += 1) await Promise.resolve();
    });
    return utils;
}

const VIEWS = [
    {
        name: 'My orders',
        View: MyOrdersView,
        // One plain list; Cancel, Edit and Timeline live on the order's detail page.
        list: 'Orders',
        detailPage: true,
        noun: 'order',
        feeds: {
            getOrdersForAddress: () => Promise.resolve({ data: [row(800)] }),
            getOrderCancelsForAddress: () => Promise.resolve({ data: [] }),
            getOrderDetail: () => Promise.resolve({
                ...row(800),
                state: { status: 'open', give_remaining: '500', expiration: String(FUTURE) },
            }),
        },
    },
    {
        name: 'My swaps',
        // The list with its row opening Swap Details, as each shell wires it.
        View: MySwapsWithDetail,
        // One plain list (no Status filter); Cancel and Edit live on the swap's details page.
        list: 'Swaps',
        detailPage: true,
        detailButtons: ['Edit swap', 'Cancel swap'],
        statusFilter: false,
        noun: 'swap',
        feeds: {
            getSwapsForAddress: () => Promise.resolve({ data: [row(800)] }),
            getSwapCancelsForAddress: () => Promise.resolve({ data: [] }),
            getSwapDetail: () => Promise.resolve({ action: 'SWAP', ...row(800) }),
        },
    },
];

const hasIcon = (button) => button.querySelector('svg') !== null;

afterEach(() => cleanup());

describe.each(VIEWS)('$name follows the shared button and field rulings', ({
    View, list, detailPage, noun, feeds, detailButtons = ['Edit order', 'Cancel order'], statusFilter = true,
}) => {
    // A detail page's action rows (G101) are named by their title, then their description.
    const actionName = (title) => new RegExp(`^${title}`);
    async function openRow() {
        const utils = await open(View, feeds);
        const openList = utils.queryByRole('list', { name: list });
        expect(openList).not.toBeNull();
        // The one row, which names the trade ("Sell 500 DOGESWAP") rather than its number.
        const item = within(openList).getAllByRole('listitem')[0];
        return { utils, item };
    }

    async function openDetail(utils, item) {
        await domAct(async () => {
            fireEvent.click(within(item).getByRole('button'));
            for (let i = 0; i < 24; i += 1) await Promise.resolve();
        });
    }

    // Opens Cancel or Edit: from the order's detail page, or from the row.
    async function clickAction(utils, item, label) {
        if (!detailPage) {
            fireEvent.click(within(item).getByRole('button', { name: label }));
            return;
        }
        await openDetail(utils, item);
        fireEvent.click(utils.getByRole('button', { name: actionName(`${label} ${noun}`) }));
    }

    it('gives every row button an icon', async () => {
        const { utils, item } = await openRow();
        if (detailPage) {
            // The row is one button ending in the drill-in chevron (G97); the
            // actions it used to hold sit on the detail page, each with an icon.
            expect(hasIcon(within(item).getByRole('button'))).toBe(true);
            await openDetail(utils, item);
            for (const name of detailButtons) {
                expect(hasIcon(utils.getByRole('button', { name: actionName(name) }))).toBe(true);
            }
            return;
        }
        for (const name of ['Timeline', 'Edit', 'Cancel']) {
            expect(hasIcon(within(item).getByRole('button', { name }))).toBe(true);
        }
    });

    it('edit panel: one green named Update action with an icon, Optional pill and tips', async () => {
        const { utils, item } = await openRow();
        await clickAction(utils, item, 'Edit');
        const submit = utils.getByRole('button', { name: `Update ${noun[0].toUpperCase()}${noun.slice(1)}` });
        expect(submit.className).toContain(buttonStyles.success);
        expect(hasIcon(submit)).toBe(true);
        expect(utils.queryByRole('button', { name: `Edit ${noun}` })).toBeNull();
        const greens = utils.getAllByRole('button').filter((b) => b.className.includes(buttonStyles.success));
        expect(greens).toHaveLength(1);

        expect(utils.queryByText(/\(optional\)/i)).toBeNull();
        const expiration = utils.container.querySelector('input[type="datetime-local"]');
        expect(expiration.labels[0].textContent).toBe('New expiration');
        expect(utils.getAllByText('Optional').length).toBeGreaterThanOrEqual(2);

        // Allow and block lists are picker fields like Token, never grey buttons.
        expect(utils.queryByRole('button', { name: 'Set Allow-List' })).toBeNull();
        expect(utils.queryByRole('button', { name: 'Set Block-List' })).toBeNull();
        for (const name of ['Allow list: None set', 'Block list: None set']) {
            expect(hasIcon(utils.getByRole('button', { name }))).toBe(true);
        }
        // The expiration field and each list field carry a "?" tip.
        const tips = utils.getAllByRole('button').filter((b) => b.getAttribute('aria-expanded') !== null && b.textContent.trim() === '?');
        expect(tips.length).toBeGreaterThanOrEqual(3);
        // Facts are label-left rows, and no loose "Current:" note remains.
        expect(utils.queryByText(/^Current: allow list/)).toBeNull();
    });

    it('filter panel: the Status and Sort dropdowns carry no visible label', async () => {
        const { utils } = await openRow();
        fireEvent.click(utils.getByRole('button', { name: `Filter ${noun}s` }));
        // My Swaps is one list with a status chip per row, so it has no Status filter.
        if (statusFilter) expect(utils.getByRole('combobox', { name: 'Status' })).toBeTruthy();
        else expect(utils.queryByRole('combobox', { name: 'Status' })).toBeNull();
        expect(utils.getByRole('combobox', { name: 'Sort' })).toBeTruthy();
        expect(utils.queryByText('Status', { selector: 'label' })).toBeNull();
        expect(utils.queryByText('Sort', { selector: 'label' })).toBeNull();
    });

    it('cancel panel: the cancel action is the green forward action with an icon', async () => {
        const { utils, item } = await openRow();
        await clickAction(utils, item, 'Cancel');
        const submit = utils.getByRole('button', { name: `Cancel ${noun[0].toUpperCase()}${noun.slice(1)}` });
        expect(submit.className).toContain(buttonStyles.success);
        expect(submit.className).not.toContain(buttonStyles.danger);
        expect(hasIcon(submit)).toBe(true);
        // The cancel note is the review screen's warning (G105), never a block on the form.
        expect(utils.container.querySelector('[data-warning-line]')).toBeNull();
        expect(utils.container.querySelector(`[data-form-standard="cancel-${noun}"]`)).not.toBeNull();
    });
});
