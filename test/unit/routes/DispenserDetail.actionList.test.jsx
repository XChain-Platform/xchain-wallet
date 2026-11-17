// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// G101, G102 and G104 on the dispenser page (layout 2, "Activity, one row per
// setting"): three tabs, Actions, Details and Activity, for every viewer, with
// Actions first and chosen on arrival. The owner's action list is Refill,
// Change expiration, Allow and block lists, Close, then Copy action index and
// the explorer link; each setting row shows its current value and opens its
// own form page, whose Back returns to the tabs. A buyer's first row is Buy,
// which opens the Buy page. Activity merges the fills and the lifecycle
// events into one dated list, newest first.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act as domAct, cleanup, fireEvent, render, within } from '@testing-library/react';
import React from 'react';

const copyText = vi.fn(() => Promise.resolve({ ok: true }));
vi.mock('../../../packages/core/src/shared/clipboard.js', () => ({ copyText: (...args) => copyText(...args) }));

const { MessagingProvider } = await import('../../../packages/core/src/shared/MessagingProvider.jsx');
const { DispenserDetail, formatUnixDate } = await import('../../../packages/core/src/shared/routes/DispenserDetail.jsx');

const CHAIN = 'bitcoin-mainnet';
const OWNER = 'bc1qownerownerownerownerownerownerownerown';
const DISPENSER_ADDRESS = 'bc1qdispdispdispdispdispdispdispdispdispdi';
const EXPIRES_AT = 1893456000;

const OWNER_ADDRESS = Object.freeze({
    id: 'addr-owner', address: OWNER, publicKey: '02aa', derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd', signerId: 'signer-1', chainId: CHAIN,
});
const STRANGER_ADDRESS = Object.freeze({
    id: 'addr-other', address: 'bc1qstrangerstrangerstrangerstrangerstran', publicKey: '02bb',
    derivationPath: "m/84'/0'/0'/0/3", source: 'hd', signerId: 'signer-1', chainId: CHAIN,
});

const OPEN = Object.freeze({
    action_index: '3030',
    block_index: 100,
    source: OWNER,
    get_address: DISPENSER_ADDRESS,
    give_tick: 'ALM0NDJ0Y',
    give_amount: '1.00000000',
    give_escrow: '100.00000000',
    give_ownership: 0,
    get_coin: 'BTC',
    get_tick: null,
    get_amount: '0.00100000',
    expiration: null,
    allow_list: null,
    block_list: null,
    status: 'valid',
    current_status: 'open',
    state: { status: 'open', give_remaining: '40', expiration: EXPIRES_AT, allow_list: '77', block_list: null },
});
const CLOSING = Object.freeze({
    ...OPEN,
    current_status: 'cancelling',
    state: { ...OPEN.state, status: 'cancelling' },
});

// Two fills either side of one refill, fed by different reads.
const FILL_OLD = {
    action_index: '3101', dispenser_action_index: '3030', give_tick: 'ALM0NDJ0Y', give_amount: '1',
    get_coin: 'BTC', get_amount: '0.001', status: 'valid', block_index: 101,
};
const FILL_NEW = {
    action_index: '3105', dispenser_action_index: '3030', give_tick: 'ALM0NDJ0Y', give_amount: '1',
    get_coin: 'BTC', get_amount: '0.001', status: 'valid', block_index: 105,
};
const REFILL = {
    action_index: '3103', dispenser_action_index: '3030', give_escrow: '20', status: 'valid', block_index: 103,
};

function stubMessaging({ dispenser, walletAddress, dispenses = [], edits = [] }) {
    const target = {
        getDispenserByActionIndex: () => Promise.resolve(dispenser),
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [walletAddress] }),
        getActiveAddresses: () => Promise.resolve({}),
        getDispenses: vi.fn(() => Promise.resolve({ data: dispenses })),
        getDispenserLifecycle: vi.fn(({ kind }) => Promise.resolve({ data: kind === 'edits' ? edits : [] })),
        getWalletBalances: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        getListByActionIndex: vi.fn(() => Promise.resolve(null)),
    };
    const proxy = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
        },
    });
    return { proxy, target };
}

async function drain(rounds = 24) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function mount({ dispenser = OPEN, walletAddress = OWNER_ADDRESS, dispenses, edits } = {}) {
    let utils;
    const { proxy, target } = stubMessaging({ dispenser, walletAddress, dispenses, edits });
    await domAct(async () => {
        utils = render(
            <MessagingProvider shell="web" messaging={proxy}>
                <DispenserDetail walletId="w" chainId={CHAIN} actionIndex={dispenser.action_index} onBack={() => {}} onCanceled={() => {}} />
            </MessagingProvider>,
        );
        await drain();
    });
    return Object.assign(utils, { messaging: target });
}

async function press(utils, name) {
    await domAct(async () => {
        fireEvent.click(utils.getByRole('button', { name }));
        await drain();
    });
}

async function pickTab(utils, name) {
    await domAct(async () => { fireEvent.click(utils.getByRole('tab', { name })); await drain(); });
}

const tabNames = (utils) => within(utils.getByRole('tablist', { name: 'Dispenser sections' }))
    .getAllByRole('tab').map((tab) => tab.textContent);
const rowTitles = (utils) => within(utils.getByRole('list', { name: 'Dispenser actions' }))
    .getAllByRole('listitem').map((item) => item.textContent);

afterEach(() => {
    cleanup();
    copyText.mockClear();
});

describe('DispenserDetail tabs and action list', () => {
    it('gives the owner three tabs, Actions first and selected, holding one action list', async () => {
        const utils = await mount();
        expect(tabNames(utils)).toEqual(['Actions', 'Details', 'Activity']);
        expect(utils.getByRole('tab', { name: 'Actions' }).getAttribute('aria-selected')).toBe('true');
        const list = utils.getByRole('list', { name: 'Dispenser actions' });
        expect(list.tagName).toBe('UL');
        const titles = rowTitles(utils);
        expect(titles[0]).toMatch(/^Refill/);
        expect(titles[1]).toMatch(/^Change expiration/);
        expect(titles[2]).toMatch(/^Allow and block lists/);
        expect(titles[3]).toMatch(/^Close/);
        expect(titles[4]).toMatch(/^Copy action index/);
        expect(titles[5]).toMatch(/^View on the XChain explorer/);
        expect(utils.queryByRole('tab', { name: /^(Buy|Fills|Settings)$/ })).toBeNull();
    });

    it('gives a non-owner the same three tabs, opening on Actions with Buy as the first row', async () => {
        const utils = await mount({ walletAddress: STRANGER_ADDRESS });
        expect(tabNames(utils)).toEqual(['Actions', 'Details', 'Activity']);
        expect(utils.getByRole('tab', { name: 'Actions' }).getAttribute('aria-selected')).toBe('true');
        const titles = rowTitles(utils);
        expect(titles[0]).toMatch(/^Buy/);
        const list = utils.getByRole('list', { name: 'Dispenser actions' });
        expect(within(list).queryByRole('button', { name: /^(Refill|Close|Change expiration|Allow and block lists)\b/ })).toBeNull();
        expect(within(list).getByRole('button', { name: /^Copy action index/ })).toBeTruthy();
    });

    it('opens the Buy page from the Buy row, and its Back returns to the tabs', async () => {
        const utils = await mount({ walletAddress: STRANGER_ADDRESS });
        await domAct(async () => { fireEvent.click(utils.getByTestId('dispenser-buy-row')); await drain(); });
        expect(utils.getByRole('heading', { name: 'Buy from Dispenser' })).toBeTruthy();
        expect(utils.queryByRole('tablist', { name: 'Dispenser sections' })).toBeNull();
        await press(utils, 'Back to previous screen');
        expect(utils.getByRole('heading', { name: 'Dispenser Detail' })).toBeTruthy();
        expect(utils.getByRole('list', { name: 'Dispenser actions' })).toBeTruthy();
    });

    it('shows each setting row its current value', async () => {
        const utils = await mount();
        const expiration = utils.getByRole('button', { name: /^Change expiration/ });
        expect(expiration.textContent).toContain(`Expires ${formatUnixDate(EXPIRES_AT)}`);
        const lists = utils.getByRole('button', { name: /^Allow and block lists/ });
        expect(lists.textContent).toContain('Allow: #77. Block: None set.');
        const refill = utils.getByRole('button', { name: /^Refill(?! Dispenser$)/ });
        expect(refill.textContent).toContain('5 refills left');
    });

    it('opens each setting on its own page, and Back returns to the tabs', async () => {
        const utils = await mount();
        await press(utils, /^Change expiration/);
        expect(utils.getByRole('heading', { name: 'Change Expiration' })).toBeTruthy();
        expect(utils.getAllByLabelText(/New expiration/).length).toBeGreaterThan(0);
        expect(utils.queryByText('Allow list')).toBeNull();
        expect(utils.getByRole('button', { name: 'Update Dispenser' })).toBeTruthy();
        await press(utils, 'Back to previous screen');
        expect(utils.getByRole('list', { name: 'Dispenser actions' })).toBeTruthy();

        await press(utils, /^Allow and block lists/);
        expect(utils.getByRole('heading', { name: 'Allow and Block Lists' })).toBeTruthy();
        expect(utils.queryByLabelText(/New expiration/)).toBeNull();
        expect(utils.getAllByText('Allow list').length).toBeGreaterThan(0);
        expect(utils.getAllByText('Block list').length).toBeGreaterThan(0);
        await press(utils, 'Back to previous screen');
        expect(utils.getByRole('list', { name: 'Dispenser actions' })).toBeTruthy();
    });

    it('reads the bound list names for the lists page only, never for the expiration page', async () => {
        const utils = await mount();
        // The page's own load reads (the access-list checks) are counted first.
        const onLoad = utils.messaging.getListByActionIndex.mock.calls.length;
        await press(utils, /^Change expiration/);
        expect(utils.messaging.getListByActionIndex.mock.calls.length).toBe(onLoad);
        await press(utils, 'Back to previous screen');
        await press(utils, /^Allow and block lists/);
        expect(utils.messaging.getListByActionIndex.mock.calls.length).toBe(onLoad + 1);
        expect(utils.messaging.getListByActionIndex).toHaveBeenLastCalledWith({ chainId: CHAIN, actionIndex: '77' });
    });

    it('draws Close as the red danger row', async () => {
        const utils = await mount();
        expect(utils.getByRole('button', { name: /^Close(?! Dispenser$)/ }).getAttribute('data-tone')).toBe('danger');
        expect(utils.getByRole('button', { name: /^Refill(?! Dispenser$)/ }).getAttribute('data-tone')).toBe('default');
    });

    it('Refill and Close each open their own form page, and Back returns to the tabs', async () => {
        const utils = await mount();
        await press(utils, /^Refill(?! Dispenser$)/);
        expect(utils.getByRole('button', { name: 'Refill Dispenser' })).toBeTruthy();
        await press(utils, 'Back to previous screen');
        expect(utils.getByRole('list', { name: 'Dispenser actions' })).toBeTruthy();
        await press(utils, /^Close(?! Dispenser$)/);
        expect(utils.getByRole('button', { name: 'Close Dispenser' })).toBeTruthy();
        await press(utils, 'Back to previous screen');
        expect(utils.getByRole('list', { name: 'Dispenser actions' })).toBeTruthy();
    });

    it('returns from a form page to the tab the reader had chosen', async () => {
        const utils = await mount();
        await pickTab(utils, 'Details');
        await pickTab(utils, 'Actions');
        await press(utils, /^Refill(?! Dispenser$)/);
        await press(utils, 'Back to previous screen');
        expect(utils.getByRole('tab', { name: 'Actions' }).getAttribute('aria-selected')).toBe('true');
    });

    it('the copy row copies the action index, and the card\'s copy button the dispenser address', async () => {
        const utils = await mount();
        await press(utils, /^Copy action index/);
        expect(copyText).toHaveBeenLastCalledWith('3030');
        // The action list has no address row; the blue card's button copies it.
        expect(utils.queryByRole('button', { name: /^Copy dispenser address/ })).toBeNull();
        await press(utils, 'Copy Dispenser Address');
        expect(copyText).toHaveBeenLastCalledWith(DISPENSER_ADDRESS);
    });

    it('links the explorer row out in a new tab', async () => {
        const utils = await mount();
        const explorer = within(utils.getByRole('list', { name: 'Dispenser actions' }))
            .getByRole('link', { name: /^View on the XChain explorer/ });
        expect(explorer.getAttribute('href')).toMatch(/3030/);
        expect(explorer.getAttribute('target')).toBe('_blank');
        expect(explorer.getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('keeps the owner rows dimmed with their reason while the dispenser is closing', async () => {
        const utils = await mount({ dispenser: CLOSING });
        for (const name of [/^Refill(?! Dispenser$)/, /^Change expiration/, /^Allow and block lists/, /^Close(?! Dispenser$)/]) {
            const row = utils.getByRole('button', { name });
            expect(row.getAttribute('aria-disabled')).toBe('true');
            expect(row.textContent).toContain('Dispenser is not open');
        }
        await press(utils, /^Refill(?! Dispenser$)/);
        expect(utils.queryByRole('button', { name: 'Refill Dispenser' })).toBeNull();
    });

    it('states the refill count and the opening in Details', async () => {
        const utils = await mount({ edits: [REFILL] });
        await pickTab(utils, 'Details');
        expect(utils.getByTestId('refills-used').textContent).toBe('1 of 5 used');
        expect(utils.getByText('Opened')).toBeTruthy();
        expect(utils.getByText(/block 100/)).toBeTruthy();
    });
});

describe('DispenserDetail Activity tab', () => {
    it('merges fills and lifecycle events into one list, newest first, with the opening last', async () => {
        const utils = await mount({ dispenses: [FILL_OLD, FILL_NEW], edits: [REFILL] });
        await pickTab(utils, 'Activity');
        const list = utils.getByRole('list', { name: 'Dispenser activity' });
        const rows = within(list).getAllByRole('listitem').map((item) => item.textContent);
        expect(rows).toHaveLength(4);
        expect(rows[0]).toMatch(/^Dispensed 1 ALM0NDJ0Y/);
        expect(rows[0]).toContain('block 105');
        expect(rows[1]).toMatch(/^Refilled \/ edited/);
        expect(rows[2]).toMatch(/^Dispensed 1 ALM0NDJ0Y/);
        expect(rows[2]).toContain('block 101');
        expect(rows[3]).toMatch(/^Opened/);
        expect(rows[3]).toContain('100.00000000 ALM0NDJ0Y in escrow');
    });

    it('has no inner Dispenses and Lifecycle toggle', async () => {
        const utils = await mount({ dispenses: [FILL_NEW] });
        await pickTab(utils, 'Activity');
        expect(utils.queryByRole('tab', { name: /^(Dispenses|Lifecycle)$/ })).toBeNull();
    });

    it('reads the same number of times for no rows as for many, and never again per tab', async () => {
        const readsFor = async (props) => {
            const utils = await mount(props);
            await pickTab(utils, 'Activity');
            await pickTab(utils, 'Details');
            await pickTab(utils, 'Activity');
            const counts = {
                fills: utils.messaging.getDispenses.mock.calls.length,
                lifecycle: utils.messaging.getDispenserLifecycle.mock.calls.length,
                lists: utils.messaging.getListByActionIndex.mock.calls.length,
            };
            cleanup();
            return counts;
        };
        const many = Array.from({ length: 12 }, (_, i) => ({
            ...FILL_OLD, action_index: String(3200 + i), block_index: 200 + i,
        }));
        const empty = await readsFor({ dispenses: [], edits: [] });
        const full = await readsFor({ dispenses: many, edits: [REFILL, { ...REFILL, action_index: '3104', block_index: 104 }] });
        expect(empty.fills).toBe(1);
        expect(full).toEqual(empty);
    });
});
