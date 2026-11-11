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
import { MySwapsView } from '../../../packages/core/src/shared/routes/MySwapsView.jsx';
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
        list: 'Open orders',
        noun: 'order',
        feeds: {
            getOrdersForAddress: () => Promise.resolve({ data: [row(800)] }),
            getOrderCancelsForAddress: () => Promise.resolve({ data: [] }),
        },
    },
    {
        name: 'My swaps',
        View: MySwapsView,
        list: 'Open swaps',
        noun: 'swap',
        feeds: {
            getSwapsForAddress: () => Promise.resolve({ data: [row(800)] }),
            getSwapCancelsForAddress: () => Promise.resolve({ data: [] }),
        },
    },
];

const hasIcon = (button) => button.querySelector('svg') !== null;

afterEach(() => cleanup());

describe.each(VIEWS)('$name follows the shared button and field rulings', ({ View, list, noun, feeds }) => {
    async function openRow() {
        const utils = await open(View, feeds);
        const openList = utils.queryByRole('list', { name: list });
        expect(openList).not.toBeNull();
        const item = within(openList).getByText('#800', { exact: false }).closest('li');
        return { utils, item };
    }

    it('gives every row button an icon', async () => {
        const { item } = await openRow();
        for (const name of ['Timeline', 'Edit', 'Cancel']) {
            expect(hasIcon(within(item).getByRole('button', { name }))).toBe(true);
        }
    });

    it('edit panel: one green named Update action with an icon, Optional pill and tips', async () => {
        const { utils, item } = await openRow();
        fireEvent.click(within(item).getByRole('button', { name: 'Edit' }));
        const submit = utils.getByRole('button', { name: `Update ${noun}` });
        expect(submit.className).toContain(buttonStyles.success);
        expect(hasIcon(submit)).toBe(true);
        expect(utils.queryByRole('button', { name: `Edit ${noun}` })).toBeNull();
        const greens = utils.getAllByRole('button').filter((b) => b.className.includes(buttonStyles.success));
        expect(greens).toHaveLength(1);

        expect(utils.queryByText(/\(optional\)/i)).toBeNull();
        const expiration = utils.container.querySelector('input[type="datetime-local"]');
        expect(expiration.labels[0].textContent).toBe('New expiration');
        expect(utils.getAllByText('Optional').length).toBeGreaterThanOrEqual(2);

        for (const name of ['Set allow-list', 'Set block-list']) {
            expect(hasIcon(utils.getByRole('button', { name }))).toBe(true);
        }
        // The expiration field and the access-list row each carry a "?" tip.
        const tips = utils.getAllByRole('button').filter((b) => b.getAttribute('aria-expanded') !== null && b.textContent.trim() === '?');
        expect(tips.length).toBeGreaterThanOrEqual(2);
    });

    it('cancel panel: the cancel action is the green forward action with an icon', async () => {
        const { utils, item } = await openRow();
        fireEvent.click(within(item).getByRole('button', { name: 'Cancel' }));
        const submit = utils.getByRole('button', { name: `Cancel ${noun}` });
        expect(submit.className).toContain(buttonStyles.success);
        expect(submit.className).not.toContain(buttonStyles.danger);
        expect(hasIcon(submit)).toBe(true);
    });
});
