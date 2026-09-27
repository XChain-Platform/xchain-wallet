// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A sold-out dispenser showed Close, Refill and Edit greyed out with
// a "Dispenser is not open" tooltip that phones never display. The indexer
// moves a drained dispenser straight to `empty` and refuses every owner action
// unless the status is `open`, so those buttons could never work again. They
// are now gone on terminal statuses, the page says why in words, and the
// creator is offered Open again, which hands the create form the same terms
// on the same address. On an `open` dispenser nothing changes.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act as domAct, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispenserDetail } from '../../../packages/core/src/shared/routes/DispenserDetail.jsx';

const CHAIN = 'bitcoin-mainnet';
const OWNER = 'bc1qownerownerownerownerownerownerownerown';
const DISPENSER_ADDRESS = 'bc1qdispdispdispdispdispdispdispdispdispdi';

const OWNER_ADDRESS = Object.freeze({
    id: 'addr-owner', address: OWNER, publicKey: '02aa', derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd', signerId: 'signer-1', chainId: CHAIN,
});
const STRANGER_ADDRESS = Object.freeze({
    id: 'addr-other', address: 'bc1qstrangerstrangerstrangerstrangerstran', publicKey: '02bb',
    derivationPath: "m/84'/0'/0'/0/3", source: 'hd', signerId: 'signer-1', chainId: CHAIN,
});

// The shape the by-action-index read path serves (xchain-explorer
// DISPENSER_QUERY): create columns at their ORIGINAL values, fixed-scale
// decimals, and the live terms in `state`. Modelled on TDOGE 3030, which
// drained to `empty` with give_remaining "0".
const SOLD_OUT = Object.freeze({
    action_index: '3030',
    source: OWNER,
    get_address: DISPENSER_ADDRESS,
    give_tick: 'ALM0NDJ0Y',
    give_amount: '1.00000000',
    give_escrow: '100.00000000',
    give_ownership: 0,
    get_coin: 'BTC',
    get_tick: null,
    get_amount: '0.00100000',
    fiat_code: null,
    fiat_amount: null,
    oracle_address: null,
    expiration: null,
    allow_list: null,
    block_list: null,
    status: 'valid',
    current_status: 'empty',
    state: { status: 'empty', give_remaining: '0', expiration: null, allow_list: 77, block_list: 0 },
});

const OPEN = Object.freeze({
    ...SOLD_OUT,
    current_status: 'open',
    state: { status: 'open', give_remaining: '40', expiration: null, allow_list: null, block_list: null },
});

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

async function drainMicrotasks(rounds = 16) {
    for (let i = 0; i < rounds; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
}

function stubMessaging({ dispenser, walletAddress }) {
    const target = {
        getDispenserByActionIndex: () => Promise.resolve(dispenser),
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [walletAddress] }),
        getActiveAddresses: () => Promise.resolve({}),
        getDispenses: () => Promise.resolve({ data: [] }),
        getDispenserLifecycle: () => Promise.resolve({ data: [] }),
        getWalletBalances: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        getListByActionIndex: () => Promise.resolve(null),
    };
    return new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
        },
    });
}

async function mount({ dispenser, walletAddress = OWNER_ADDRESS, onOpenAgain = vi.fn() }) {
    const messaging = stubMessaging({ dispenser, walletAddress });
    let utils;
    await domAct(async () => {
        utils = render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(DispenserDetail, {
                walletId: 'w', chainId: CHAIN, actionIndex: dispenser.action_index,
                onBack() {}, onCanceled() {}, onOpenAgain,
            }),
        ));
        await drainMicrotasks();
    });
    return { utils, onOpenAgain };
}

const ownerButtons = (utils) => ['Close', 'Refill', 'Edit']
    .map((name) => utils.queryByRole('button', { name }));

describe('DispenserDetail on a sold-out (empty) dispenser', () => {
    it('drops Close, Refill and Edit instead of showing them disabled', async () => {
        const { utils } = await mount({ dispenser: SOLD_OUT });
        expect(ownerButtons(utils)).toEqual([null, null, null]);
        expect(utils.container.textContent).not.toContain('Dispenser is not open');
    });

    it('explains in words why, and tells the owner the address can be reused', async () => {
        const { utils } = await mount({ dispenser: SOLD_OUT });
        const notice = utils.getAllByRole('status')
            .find((el) => /sold out/.test(el.textContent || ''));
        expect(notice, 'a status notice names the sold-out state').toBeTruthy();
        expect(notice.textContent).toBe(
            "This dispenser sold out. Sold-out dispensers can't be refilled, but you can open a new one on the same address.",
        );
    });

    it('offers Open again to the creator', async () => {
        const { utils } = await mount({ dispenser: SOLD_OUT });
        expect(utils.getByRole('button', { name: 'Open again' })).toBeTruthy();
    });

    it('offers nothing to a wallet that does not hold the creator address, and does not promise reuse', async () => {
        const { utils } = await mount({ dispenser: SOLD_OUT, walletAddress: STRANGER_ADDRESS });
        expect(utils.queryByRole('button', { name: 'Open again' })).toBeNull();
        expect(ownerButtons(utils)).toEqual([null, null, null]);
        const notice = utils.getAllByRole('status')
            .find((el) => /sold out/.test(el.textContent || ''));
        expect(notice.textContent).toBe("This dispenser sold out. Sold-out dispensers can't be refilled.");
    });

    it('Open again hands the form the same terms, the creator as source and the same address', async () => {
        const { utils, onOpenAgain } = await mount({ dispenser: SOLD_OUT });
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Open again' }));
            await drainMicrotasks();
        });
        expect(onOpenAgain).toHaveBeenCalledTimes(1);
        expect(onOpenAgain.mock.calls[0][0]).toEqual({
            chainId: CHAIN,
            tick: 'ALM0NDJ0Y',
            giveAmount: '1',
            escrow: '100',
            payWith: 'coin',
            triggerPrice: '0.001',
            expiration: null,
            // The LIVE lists, not the create columns: an edit may have moved them.
            allowList: '77',
            blockList: '',
            source: OWNER,
            dispenserAddress: DISPENSER_ADDRESS,
        });
    });
});

describe('DispenserDetail on the other terminal statuses', () => {
    const cases = [
        ['max_dispenses_reached', /1,000-dispense limit/],
        ['cancelled', /was closed/],
        ['expired', /expired/],
    ];
    for (const [status, copy] of cases) {
        it(`${status}: no owner actions, an explanation, and Open again`, async () => {
            const dispenser = { ...SOLD_OUT, current_status: status, state: { ...SOLD_OUT.state, status } };
            const { utils } = await mount({ dispenser });
            expect(ownerButtons(utils)).toEqual([null, null, null]);
            expect(utils.getAllByRole('status').some((el) => copy.test(el.textContent || ''))).toBe(true);
            expect(utils.getByRole('button', { name: 'Open again' })).toBeTruthy();
        });
    }

    it('an ownership dispenser gets the explanation but no Open again (the form has no ownership lane)', async () => {
        const { utils } = await mount({ dispenser: { ...SOLD_OUT, give_ownership: 1 } });
        expect(utils.queryByRole('button', { name: 'Open again' })).toBeNull();
        expect(ownerButtons(utils)).toEqual([null, null, null]);
    });
});

describe('DispenserDetail on an open dispenser is unchanged', () => {
    it('keeps Close, Refill and Edit enabled for the owner, with no terminal notice or Open again', async () => {
        const { utils } = await mount({ dispenser: OPEN });
        const [close, refill, edit] = ownerButtons(utils);
        expect(close && refill && edit, 'all three owner buttons render').toBeTruthy();
        expect([close.disabled, refill.disabled, edit.disabled]).toEqual([false, false, false]);
        expect(close.getAttribute('title')).toBe('Close this dispenser');
        expect(refill.getAttribute('title')).toBe('Add escrow to this dispenser');
        expect(edit.getAttribute('title')).toBe('Change expiration or allow/block lists');
        expect(utils.queryByRole('button', { name: 'Open again' })).toBeNull();
        expect(utils.container.textContent).not.toMatch(/sold out|open a new one/);
    });

    it('still renders them disabled for a non-owner, as before', async () => {
        const { utils } = await mount({ dispenser: OPEN, walletAddress: STRANGER_ADDRESS });
        const [close, refill, edit] = ownerButtons(utils);
        expect([close.disabled, refill.disabled, edit.disabled]).toEqual([true, true, true]);
        expect(close.getAttribute('title')).toBe('Only the owner can close');
    });
});
