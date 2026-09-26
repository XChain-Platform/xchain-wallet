// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The protocol lets either the address that opened a dispenser or the
// dispenser's own address close, refill or edit it, and a close returns the
// escrow to whichever of the two signs. These pin that a wallet holding only
// the dispenser address can manage it, signs from that address, is told the
// escrow comes back to it, and is not offered Open again, which needs the
// creator's origin standing.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act as domAct, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispenserDetail } from '../../../packages/core/src/shared/routes/DispenserDetail.jsx';

const CHAIN = 'bitcoin-mainnet';
const CREATOR = 'bc1qownerownerownerownerownerownerownerown';
const HOST = 'bc1qdispdispdispdispdispdispdispdispdispdi';

const CREATOR_ADDRESS = Object.freeze({
    id: 'addr-creator', address: CREATOR, publicKey: '02aa', derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd', signerId: 'signer-1', chainId: CHAIN,
});
const HOST_ADDRESS = Object.freeze({
    id: 'addr-host', address: HOST, publicKey: '02cc', derivationPath: "m/84'/0'/0'/0/5",
    source: 'hd', signerId: 'signer-1', chainId: CHAIN,
});
const HW_HOST_ADDRESS = Object.freeze({ ...HOST_ADDRESS, id: 'addr-hw-host', source: 'trezor', signerId: 'signer-hw' });
const STRANGER_ADDRESS = Object.freeze({
    id: 'addr-other', address: 'bc1qstrangerstrangerstrangerstrangerstran', publicKey: '02bb',
    derivationPath: "m/84'/0'/0'/0/3", source: 'hd', signerId: 'signer-1', chainId: CHAIN,
});

// Opened by CREATOR on HOST, in the by-action-index row shape (the dispenser
// address is `get_address`, the live terms sit in `state`).
const OPEN = Object.freeze({
    action_index: '4100',
    source: CREATOR,
    get_address: HOST,
    give_tick: 'XCHAIN',
    give_amount: '25',
    give_escrow: '100',
    give_ownership: 0,
    get_coin: 'BTC',
    get_tick: null,
    get_amount: '0.001',
    allow_list: null,
    block_list: null,
    status: 'valid',
    current_status: 'open',
    state: { status: 'open', give_remaining: '100', expiration: null, allow_list: null, block_list: null },
});
const SOLD_OUT = Object.freeze({
    ...OPEN,
    current_status: 'empty',
    state: { ...OPEN.state, status: 'empty', give_remaining: '0' },
});

const COMPOSED = Object.freeze({ psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 1 });
const PASS = Object.freeze({ verdict: 'pass', findings: [] });

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

/** Every host call in order, so a test can read what signed and from where. */
function recordingMessaging({ addresses, dispenser }) {
    const calls = [];
    const log = (method, value) => (args) => { calls.push({ method, args }); return Promise.resolve(value); };
    const target = {
        getDispenserByActionIndex: () => Promise.resolve(dispenser),
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: addresses }),
        getActiveAddresses: () => Promise.resolve({}),
        getDispenses: () => Promise.resolve({ data: [] }),
        getDispenserLifecycle: () => Promise.resolve({ data: [] }),
        getWalletBalances: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSignerStatus: () => Promise.resolve({ status: 'available' }),
        getListByActionIndex: () => Promise.resolve(null),
        composeForConfirm: log('composeForConfirm', COMPOSED),
        preflight: log('preflight', PASS),
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return log(String(prop), { txid: `tx-${String(prop)}` });
        },
    });
    return { messaging, calls };
}

async function mount({ addresses, dispenser = OPEN, onOpenAgain = vi.fn() }) {
    const { messaging, calls } = recordingMessaging({ addresses, dispenser });
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
    return { utils, calls };
}

async function step(fn) {
    await domAct(async () => { fn(); await drainMicrotasks(); });
}

const ownerButtons = (utils) => ['Close', 'Refill', 'Edit']
    .map((name) => utils.queryByRole('button', { name }));
const approveButton = (utils) => utils.container.querySelector('[data-testid="confirm-approve"]');
const signCalls = (calls) => calls.filter((c) => c.method === 'dispenserAction' || c.method === 'dispenserActionHw');

async function closeThroughConfirm(utils) {
    await step(() => fireEvent.click(utils.getByRole('button', { name: 'Close' })));
    const formNote = utils.getByTestId('close-escrow-destination').textContent;
    await step(() => fireEvent.click(utils.getByRole('button', { name: 'Close dispenser' })));
    const confirmNote = utils.getByTestId('close-escrow-destination').textContent;
    const btn = approveButton(utils);
    if (btn && !btn.disabled) await step(() => fireEvent.click(btn));
    return { formNote, confirmNote };
}

describe('a wallet holding only the dispenser address', () => {
    it('gets Close, Refill and Edit enabled on an open dispenser', async () => {
        const { utils } = await mount({ addresses: [HOST_ADDRESS] });
        const [close, refill, edit] = ownerButtons(utils);
        expect([close.disabled, refill.disabled, edit.disabled]).toEqual([false, false, false]);
        expect(close.getAttribute('title')).toBe('Close this dispenser');
    });

    it('closes signing from the dispenser address and says the escrow returns here, not to the creator', async () => {
        const { utils, calls } = await mount({ addresses: [HOST_ADDRESS] });
        const { formNote, confirmNote } = await closeThroughConfirm(utils);

        for (const note of [formNote, confirmNote]) {
            expect(note).toContain('Escrow returns to');
            expect(note).toContain(HOST.slice(0, 6));
            expect(note).toContain(HOST.slice(-6));
            expect(note).toContain('(this wallet)');
            expect(note).toContain('not to the creator');
        }
        const compose = calls.find((c) => c.method === 'composeForConfirm');
        expect(compose.args.from.address).toBe(HOST);
        expect(compose.args.actionData.params).toEqual({ VERSION: '1', DISPENSER_ACTION_INDEX: '4100' });
        const sign = calls.find((c) => c.method === 'dispenserAction');
        expect(sign, 'the close signed').toBeTruthy();
        expect(sign.args.from).toMatchObject({ address: HOST, addressId: 'addr-host', derivationPath: "m/84'/0'/0'/0/5" });
    });

    it('refills from the dispenser address', async () => {
        const { utils, calls } = await mount({ addresses: [HOST_ADDRESS] });
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Refill' })));
        await step(() => fireEvent.change(utils.getByLabelText(/^Refill amount/), { target: { value: '50' } }));
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Refill dispenser' })));
        const btn = approveButton(utils);
        if (btn && !btn.disabled) await step(() => fireEvent.click(btn));

        const sign = calls.find((c) => c.method === 'dispenserAction');
        expect(sign.args.from.address).toBe(HOST);
        expect(sign.args.params).toEqual({ VERSION: '2', DISPENSER_ACTION_INDEX: '4100', GIVE_ESCROW: '50' });
    });

    it('edits from the dispenser address', async () => {
        const { utils, calls } = await mount({ addresses: [HOST_ADDRESS] });
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Edit' })));
        await step(() => fireEvent.change(utils.getByLabelText(/^Block list/), { target: { value: '2702' } }));
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Edit dispenser' })));
        const btn = approveButton(utils);
        if (btn && !btn.disabled) await step(() => fireEvent.click(btn));

        const sign = calls.find((c) => c.method === 'dispenserAction');
        expect(sign.args.from.address).toBe(HOST);
        expect(sign.args.params).toEqual({ VERSION: '2', DISPENSER_ACTION_INDEX: '4100', BLOCK_LIST: '2702' });
    });

    it('keys the hardware signer on the dispenser address record', async () => {
        const { utils, calls } = await mount({ addresses: [HW_HOST_ADDRESS] });
        await closeThroughConfirm(utils);
        const sign = calls.find((c) => c.method === 'dispenserActionHw');
        expect(sign, 'signed on the device lane').toBeTruthy();
        expect(sign.args.signerId).toBe('signer-hw');
        expect(sign.args.from.address).toBe(HOST);
    });

    it('on a terminal status gets no Open again, and a note says why', async () => {
        const { utils } = await mount({ addresses: [HOST_ADDRESS], dispenser: SOLD_OUT });
        expect(utils.queryByRole('button', { name: 'Open again' })).toBeNull();
        expect(ownerButtons(utils)).toEqual([null, null, null]);
        expect(utils.getByTestId('reopen-origin-note').textContent)
            .toBe('Only the address that opened this dispenser can open it again.');
        const notice = utils.getAllByRole('status').find((el) => /sold out/.test(el.textContent || ''));
        expect(notice.textContent, 'no promise of reuse').toBe("This dispenser sold out. Sold-out dispensers can't be refilled.");
    });
});

describe('a wallet holding the creator address', () => {
    it('signs from the creator even when it also holds the dispenser address', async () => {
        const { utils, calls } = await mount({ addresses: [HOST_ADDRESS, CREATOR_ADDRESS] });
        const { confirmNote } = await closeThroughConfirm(utils);

        expect(confirmNote).toContain(CREATOR.slice(0, 6));
        expect(confirmNote).toContain('(this wallet)');
        expect(confirmNote).not.toContain('not to the creator');
        const sign = calls.find((c) => c.method === 'dispenserAction');
        expect(sign.args.from).toMatchObject({ address: CREATOR, addressId: 'addr-creator' });
    });

    it('keeps Open again on a terminal status, with no origin note', async () => {
        const { utils } = await mount({ addresses: [CREATOR_ADDRESS], dispenser: SOLD_OUT });
        expect(utils.getByRole('button', { name: 'Open again' })).toBeTruthy();
        expect(utils.queryByTestId('reopen-origin-note')).toBeNull();
    });
});

describe('a wallet holding neither address', () => {
    it('keeps Close, Refill and Edit disabled and never signs', async () => {
        const { utils, calls } = await mount({ addresses: [STRANGER_ADDRESS] });
        const [close, refill, edit] = ownerButtons(utils);
        expect([close.disabled, refill.disabled, edit.disabled]).toEqual([true, true, true]);
        expect(close.getAttribute('title')).toBe('Only the owner can close');
        expect(signCalls(calls)).toHaveLength(0);
    });

    it('on a terminal status shows neither Open again nor the origin note', async () => {
        const { utils } = await mount({ addresses: [STRANGER_ADDRESS], dispenser: SOLD_OUT });
        expect(utils.queryByRole('button', { name: 'Open again' })).toBeNull();
        expect(utils.queryByTestId('reopen-origin-note')).toBeNull();
    });
});
