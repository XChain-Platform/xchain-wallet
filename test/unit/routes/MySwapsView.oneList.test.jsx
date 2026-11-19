// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Operator ruling 2026-11-13: My Swaps is one plain list of every swap,
// newest first, in one list card, each row with its status chip and no
// Open/Closed choice. Every row opens that swap's details, and the page's
// reads never grow with its rows.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act as domAct, cleanup, fireEvent, render, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MySwapsView } from '../../../packages/core/src/shared/routes/MySwapsView.jsx';

const CHAIN = 'dogecoin-testnet';
const OWN = 'ndDEAAyn7DcGeaQ6chBWH2vaSdYAXVGNhc';
const NOW = Math.floor(Date.now() / 1000);
const FUTURE = NOW + 3600;

const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0', address: OWN, publicKey: '02aabbcc',
    derivationPath: "m/44'/1'/0'/0/0", source: 'hd', signerId: 'signer-1',
});

function swapRow(actionIndex, extra = {}) {
    return {
        action_index: String(actionIndex), source: OWN,
        give_tick: 'DOGESWAP', give_coin: 'DOGE', give_amount: '500', give_ownership: 0,
        get_tick: null, get_coin: 'DOGE', get_amount: '10.5', get_ownership: 0,
        expiration: FUTURE, block_index: '67882087', status: 'valid', swap_status: 'open',
        ...extra,
    };
}

function harness(swaps, cancels = []) {
    const reads = [];
    const counted = (name, fn) => vi.fn((...args) => { reads.push(name); return fn(...args); });
    const target = {
        getAddressesByChain: counted('getAddressesByChain', async () => ({ [CHAIN]: [HD_ADDRESS] })),
        getSwapsForAddress: counted('getSwapsForAddress', async () => ({ data: swaps })),
        getSwapCancelsForAddress: counted('getSwapCancelsForAddress', async () => ({ data: cancels })),
        getSwapDetail: counted('getSwapDetail', async () => null),
        getSwapLifecycle: counted('getSwapLifecycle', async () => ({ data: [] })),
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
        },
    });
    return { messaging, reads };
}

async function open(messaging, props = {}) {
    let utils;
    await domAct(async () => {
        utils = render(React.createElement(MessagingProvider, { shell: 'web', messaging },
            React.createElement(MySwapsView, { walletId: 'w', onBack() {}, ...props })));
        for (let i = 0; i < 24; i += 1) await Promise.resolve();
    });
    return utils;
}

afterEach(() => cleanup());

describe('My Swaps: one list', () => {
    it('lists open, settled, cancelled and expired swaps together, newest first, each with its ring', async () => {
        const { messaging } = harness([
            swapRow(801, { swap_status: 'complete' }),
            swapRow(804),
            swapRow(802, { expiration: NOW - 60 }),
            swapRow(803),
        ], [{ action_index: '9000', swap_action_index: '803', source: OWN, status: 'valid' }]);
        const utils = await open(messaging);

        const lists = utils.getAllByRole('list');
        expect(lists).toHaveLength(1);
        const list = utils.getByRole('list', { name: 'Swaps' });
        const rows = within(list).getAllByRole('listitem');
        expect(rows.map((row) => row.getAttribute('data-swap-row'))).toEqual(['804', '803', '802', '801'].map((i) => `${CHAIN}:${i}`));
        // The ring layout (wallet-orders-layout-1-ring): the swap in words, then
        // the fill ring with the status word under it in place of the chip.
        expect(within(rows[0]).getByText('Swap 500 DOGESWAP')).toBeTruthy();
        expect(within(rows[0]).getByText('for 10.5 DOGE')).toBeTruthy();
        const rings = rows.map((row) => row.querySelector('[data-fill-ring]'));
        expect(rings.map((ring) => ring.textContent)).toEqual(['0%Open', 'Closed', '0%Expired', 'Settled']);
        expect(rings.map((ring) => ring.getAttribute('data-mark'))).toEqual([null, 'cross', null, 'tick']);
        expect(rings.map((ring) => ring.getAttribute('data-percent'))).toEqual(['0', '0', '0', '100']);
        expect(list.querySelector('[data-testid="swap-status-chip"]')).toBeNull();

        // No Open/Closed sections, tabs or status choice.
        expect(utils.queryByRole('heading', { name: 'Open' })).toBeNull();
        expect(utils.queryByRole('heading', { name: 'Closed' })).toBeNull();
        expect(utils.queryByRole('tablist')).toBeNull();
        fireEvent.click(utils.getByRole('button', { name: 'Filter swaps' }));
        expect(utils.queryByRole('combobox', { name: 'Status' })).toBeNull();
        expect(utils.getByRole('combobox', { name: 'Sort' })).toBeTruthy();
    });

    it('opens a swap from anywhere on its row, holding no actions in the row', async () => {
        const onOpenSwap = vi.fn();
        const { messaging } = harness([swapRow(810), swapRow(811, { swap_status: 'complete' })]);
        const utils = await open(messaging, { onOpenSwap });

        for (const [index, status] of [['810', 'Open'], ['811', 'Settled']]) {
            const row = utils.getByRole('list', { name: 'Swaps' }).querySelector(`[data-swap-row="${CHAIN}:${index}"]`);
            const buttons = within(row).getAllByRole('button');
            expect(buttons).toHaveLength(1);
            expect(buttons[0]).toHaveAccessibleName(`Open swap #${index}: give 500 DOGESWAP, get 10.5 DOGE, ${status}`);
            fireEvent.click(within(row).getByText('Swap 500 DOGESWAP'));
            expect(onOpenSwap).toHaveBeenLastCalledWith(CHAIN, index);
        }
        expect(onOpenSwap).toHaveBeenCalledTimes(2);
    });

    it('makes the same reads for 2 swaps as for 25, and no read per swap', async () => {
        const counts = [];
        for (const size of [2, 25]) {
            const { messaging, reads } = harness(Array.from({ length: size }, (_, i) => swapRow(900 + i)));
            const utils = await open(messaging);
            expect(within(utils.getByRole('list', { name: 'Swaps' })).getAllByRole('listitem')).toHaveLength(size);
            counts.push([...reads].sort());
            cleanup();
        }
        expect(counts[0]).toEqual(['getAddressesByChain', 'getSwapCancelsForAddress', 'getSwapsForAddress']);
        expect(counts[1]).toEqual(counts[0]);
    });
});
