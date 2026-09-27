// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// My swaps must not offer Edit or Cancel on a swap the indexer already
// settled. Unlike the order list, the swap list feed (getSwapsForAddress)
// carries the indexer's latest lifecycle status inline on every row as
// `swap_status`: 'open' | 'complete' | 'cancelled' | 'expired'. The view
// used to know only cancelled / invalid / expired / open, so a 'complete'
// row still fell through to the expiration check and was shown as Open
// with live Edit and Cancel buttons.
//
// An older explorer's list reader may not carry `swap_status` at all; that
// is read as no information, not as "not settled", and falls through to
// the existing expiration/open logic unchanged.

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act as domAct, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MySwapsView, deriveStatus } from '../../../packages/core/src/shared/routes/MySwapsView.jsx';

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

// A swap row as the list feed serves it. `swap_status` is the indexer's
// lifecycle status, absent on an older explorer's reader.
function swapRow(actionIndex, extra = {}) {
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

// A cancel row as the swap_cancels feed serves it.
function cancelRow(actionIndex, swapActionIndex, status) {
    return { action_index: String(actionIndex), swap_action_index: String(swapActionIndex), source: OWN, status };
}

function swapDetail(actionIndex, status, expiration) {
    return { action: 'SWAP', action_index: String(actionIndex), state: { status, expiration } };
}

function harness({ swaps = [], cancels = [], details = {} } = {}) {
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [HD_ADDRESS] }),
        getSwapsForAddress: () => Promise.resolve({ data: swaps }),
        getSwapCancelsForAddress: () => Promise.resolve({ data: cancels }),
        getSwapDetail: ({ actionIndex }) => Promise.resolve(details[String(actionIndex)] ?? null),
        getSignerStatus: () => Promise.resolve({ status: 'locked' }),
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
        },
    });
    return { messaging };
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
                React.createElement(MySwapsView, { walletId: 'w', onBack() {} }),
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

describe('MySwapsView: settled status', () => {
    it('files a swap_status "complete" row under Closed as Settled with no Edit or Cancel', async () => {
        const { messaging } = harness({
            swaps: [swapRow(665, { swap_status: 'complete' })],
        });
        const utils = await open(messaging);

        expect(section(utils, 'Open swaps')).toBeNull();
        const closedList = section(utils, 'Closed swaps');
        expect(closedList).not.toBeNull();
        const row = rowFor(closedList, 665);
        expect(within(row).getByText('Settled')).toBeTruthy();
        expect(within(row).queryByRole('button', { name: 'Edit' })).toBeNull();
        expect(within(row).queryByRole('button', { name: 'Cancel' })).toBeNull();
    });

    it('keeps a swap_status "open" row with a future expiration under Open with both buttons', async () => {
        const { messaging } = harness({
            swaps: [swapRow(700, { swap_status: 'open' })],
        });
        const utils = await open(messaging);

        const openList = section(utils, 'Open swaps');
        expect(openList).not.toBeNull();
        expect(section(utils, 'Closed swaps')).toBeNull();
        const row = rowFor(openList, 700);
        expect(within(row).getByText('Open')).toBeTruthy();
        expect(within(row).getByRole('button', { name: 'Edit' })).toBeTruthy();
        expect(within(row).getByRole('button', { name: 'Cancel' })).toBeTruthy();
    });

    it('uses an edited expiration from swap detail', async () => {
        const past = Math.floor(Date.now() / 1000) - 60;
        const { messaging } = harness({
            swaps: [swapRow(702, { swap_status: 'open', expiration: past })],
            details: { 702: swapDetail(702, 'open', FUTURE) },
        });
        const utils = await open(messaging);

        const row = rowFor(section(utils, 'Open swaps'), 702);
        expect(within(row).getByText('Open')).toBeTruthy();
        expect(within(row).getByText(`Expires ${new Date(FUTURE * 1000).toLocaleString()}`)).toBeTruthy();
    });

    it('treats a missing swap_status as no information (older explorer compatibility)', async () => {
        const row = { key: `${CHAIN}:701`, row: swapRow(701) };
        delete row.row.swap_status;
        expect(deriveStatus(row, new Set(), 0)).toBe('open');

        const { messaging } = harness({ swaps: [swapRow(701)] });
        const utils = await open(messaging);
        const openList = section(utils, 'Open swaps');
        expect(openList).not.toBeNull();
        const rendered = rowFor(openList, 701);
        expect(within(rendered).getByText('Open')).toBeTruthy();
    });

    it('lets a cancelled-feed row win over swap_status "complete"', () => {
        const item = { key: `${CHAIN}:9`, row: swapRow(9, { swap_status: 'complete' }) };
        expect(deriveStatus(item, new Set([`${CHAIN}:9`]), 0)).toBe('cancelled');
    });
});

describe('deriveStatus with swap_status', () => {
    const base = { key: `${CHAIN}:9` };

    it('maps the indexer statuses onto the view statuses, case- and space-insensitively', () => {
        expect(deriveStatus({ ...base, row: swapRow(9, { swap_status: 'complete' }) }, new Set(), 0)).toBe('settled');
        expect(deriveStatus({ ...base, row: swapRow(9, { swap_status: 'COMPLETE' }) }, new Set(), 0)).toBe('settled');
        expect(deriveStatus({ ...base, row: swapRow(9, { swap_status: ' complete ' }) }, new Set(), 0)).toBe('settled');
        expect(deriveStatus({ ...base, row: swapRow(9, { swap_status: 'cancelled' }) }, new Set(), 0)).toBe('cancelled');
        expect(deriveStatus({ ...base, row: swapRow(9, { swap_status: 'expired' }) }, new Set(), 0)).toBe('expired');
        expect(deriveStatus({ ...base, row: swapRow(9, { swap_status: 'open' }) }, new Set(), 0)).toBe('open');
    });

    it('falls through an unknown swap_status to the expiration check', () => {
        const pastExp = { ...base, row: swapRow(9, { swap_status: 'weird', expiration: 1 }) };
        expect(deriveStatus(pastExp, new Set(), 1000)).toBe('expired');
        const futureExp = { ...base, row: swapRow(9, { swap_status: 'weird' }) };
        expect(deriveStatus(futureExp, new Set(), 0)).toBe('open');
    });

    it('falls through a missing swap_status to the expiration check', () => {
        const row = swapRow(9, { expiration: 1 });
        delete row.swap_status;
        expect(deriveStatus({ ...base, row }, new Set(), 1000)).toBe('expired');
    });
});
