// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The dispenser owner actions (Close, Refill, Edit) on the shared confirm
// lane. They used to sign straight from their own forms, so a list edit that
// can never be removed was signed with no decoded review and no dry run.
// These pin that the pre-flight runs before any signature and can stop it,
// that the device lane signs the same composed bytes, that watcher mode still
// builds unsigned, and that the edit form checks the NEW allow-list and
// refuses one list in both slots.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act as domAct, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispenserDetail } from '../../../packages/core/src/shared/routes/DispenserDetail.jsx';

const CHAIN = 'bitcoin-mainnet';
const OWNER = 'bc1qownerownerownerownerownerownerownerown';
const BUYER = 'bc1qbuyerbuyerbuyerbuyerbuyerbuyerbuyerbu';

const OWNER_ADDRESS = Object.freeze({
    id: 'addr-owner', address: OWNER, publicKey: '02aa', derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd', signerId: 'signer-1', chainId: CHAIN,
});
const HW_OWNER = Object.freeze({ ...OWNER_ADDRESS, id: 'addr-hw', source: 'trezor', signerId: 'signer-hw' });

const DISPENSER = Object.freeze({
    action_index: '2868',
    source: OWNER,
    address: OWNER,
    give_tick: 'XCHAIN',
    give_amount: '25',
    get_coin: 'BTC',
    get_amount: '0.001',
    allow_list: null,
    block_list: null,
    escrow_remaining: '100',
    status: 'open',
    current_status: 'open',
});

const COMPOSED = Object.freeze({ psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 1 });
const PASS = Object.freeze({ verdict: 'pass', findings: [] });
const REFUSED = Object.freeze({
    verdict: 'fail',
    findings: [{ severity: 'error', overridable: false, code: 'INVALID_FIELD_VALUE', message: 'The network would refuse this action.' }],
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

/** Every host call in order, so a test can prove the dry run came first. */
function recordingMessaging({ owner = OWNER_ADDRESS, dispenser = DISPENSER, settings = { walletMode: 'full' }, preflight = PASS, lists = {} } = {}) {
    const calls = [];
    const log = (method, value) => (args) => { calls.push({ method, args }); return Promise.resolve(value); };
    const target = {
        getDispenserByActionIndex: () => Promise.resolve(dispenser),
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [owner] }),
        getActiveAddresses: () => Promise.resolve({}),
        getDispenses: () => Promise.resolve({ data: [] }),
        getDispenserLifecycle: () => Promise.resolve({ data: [] }),
        getWalletBalances: () => Promise.resolve({}),
        getSettings: () => Promise.resolve(settings),
        signerReady: () => Promise.resolve({ ready: true }),
        getSignerStatus: () => Promise.resolve({ status: owner.source === 'hd' ? 'unlocked' : 'available' }),
        getListByActionIndex: ({ actionIndex }) => Promise.resolve(lists[actionIndex] ?? null),
        composeForConfirm: log('composeForConfirm', COMPOSED),
        preflight: log('preflight', preflight),
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return log(String(prop), { txid: `tx-${String(prop)}`, psbtHex: 'bb00' });
        },
    });
    return { messaging, calls };
}

async function mount(opts) {
    const { messaging, calls } = recordingMessaging(opts);
    let utils;
    await domAct(async () => {
        utils = render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(DispenserDetail, {
                walletId: 'w', chainId: CHAIN, actionIndex: DISPENSER.action_index, onBack() {}, onCanceled() {},
            }),
        ));
        await drainMicrotasks();
    });
    return { utils, calls };
}

async function step(fn) {
    await domAct(async () => { fn(); await drainMicrotasks(); });
}

const approveButton = (utils) => utils.container.querySelector('[data-testid="confirm-approve"]');
const indexOf = (calls, method) => calls.findIndex((c) => c.method === method);
const signCalls = (calls) => calls.filter((c) => c.method === 'dispenserAction' || c.method === 'dispenserActionHw');

async function approve(utils) {
    const btn = approveButton(utils);
    if (btn && !btn.disabled) await step(() => fireEvent.click(btn));
}

describe('dispenser owner actions sign through the confirm page', () => {
    it('closes only after the pre-flight, signing the composed bytes', async () => {
        const { utils, calls } = await mount();
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Close' })));
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Close dispenser' })));

        expect(signCalls(calls), 'nothing signs before Approve').toHaveLength(0);
        const compose = calls.find((c) => c.method === 'composeForConfirm');
        expect(compose.args.actionData).toEqual({
            action: 'DISPENSER', params: { VERSION: '1', DISPENSER_ACTION_INDEX: '2868' },
        });
        const from = utils.getByTestId('confirm-source').textContent;
        expect(from, 'the confirm page names the signer').toContain(OWNER.slice(0, 6));
        expect(from).toContain(OWNER.slice(-6));

        await approve(utils);
        expect(indexOf(calls, 'dispenserAction')).toBeGreaterThan(indexOf(calls, 'preflight'));
        const sign = calls.find((c) => c.method === 'dispenserAction');
        expect(sign.args.prebuiltPsbt).toMatchObject({ psbtHex: 'aa00', encoding: 'psbt' });
        expect(sign.args.params).toEqual({ VERSION: '1', DISPENSER_ACTION_INDEX: '2868' });
    });

    it('blocks an edit the pre-flight says the network would refuse', async () => {
        const { utils, calls } = await mount({ preflight: REFUSED });
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Edit' })));
        await step(() => fireEvent.change(utils.getByLabelText(/^Block list/), { target: { value: '2702' } }));
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Edit dispenser' })));
        await approve(utils);

        expect(calls.some((c) => c.method === 'preflight')).toBe(true);
        expect(approveButton(utils)?.disabled, 'Approve stays disabled on a hard refusal').toBe(true);
        expect(signCalls(calls)).toHaveLength(0);
    });

    it('refills a hardware owner on the device lane with the same composed bytes', async () => {
        const { utils, calls } = await mount({ owner: HW_OWNER, dispenser: { ...DISPENSER, source: HW_OWNER.address } });
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Refill' })));
        await step(() => fireEvent.change(utils.getByLabelText(/^Refill amount/), { target: { value: '50' } }));
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Refill dispenser' })));
        await approve(utils);

        const sign = calls.find((c) => c.method === 'dispenserActionHw');
        expect(sign, 'signed on the device lane').toBeTruthy();
        expect(indexOf(calls, 'dispenserActionHw')).toBeGreaterThan(indexOf(calls, 'preflight'));
        expect(sign.args.signerId).toBe('signer-hw');
        expect(sign.args.password, 'no password rides the device lane').toBeUndefined();
        expect(sign.args.prebuiltPsbt).toMatchObject({ psbtHex: 'aa00' });
        expect(sign.args.params.GIVE_ESCROW).toBe('50');
    });

    it('keeps watcher mode on its unsigned build, with no signature to pre-flight', async () => {
        const { utils, calls } = await mount({ settings: { walletMode: 'watcher' } });
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Close' })));
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Create unsigned transaction' })));

        const build = calls.find((c) => c.method === 'buildActionPsbtRequest');
        expect(build.args.actionData.action).toBe('DISPENSER');
        expect(calls.some((c) => c.method === 'composeForConfirm')).toBe(false);
        expect(signCalls(calls)).toHaveLength(0);
    });
});

describe('dispenser edit checks the lists it is about to bind', () => {
    it('warns when the NEW allow-list leaves out the dispenser\'s own address', async () => {
        const { utils } = await mount({ lists: { 2701: { list: [{ address: BUYER }] } } });
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Edit' })));
        await step(() => fireEvent.change(utils.getByLabelText(/^Allow list/), { target: { value: '2701' } }));
        await step(() => { vi.advanceTimersByTime(500); });

        expect(utils.getByText(/is not on the allow-list/)).toBeTruthy();
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Edit dispenser' })));
        expect(approveButton(utils), 'the confirm page is open').toBeTruthy();
        expect(utils.getByText(/is not on the allow-list/), 'the warning rides to the confirm page').toBeTruthy();
    });

    it('stays quiet when the new allow-list holds the dispenser\'s address', async () => {
        const { utils } = await mount({ lists: { 2701: { list: [{ address: BUYER }, { address: OWNER }] } } });
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Edit' })));
        await step(() => fireEvent.change(utils.getByLabelText(/^Allow list/), { target: { value: '2701' } }));
        await step(() => { vi.advanceTimersByTime(500); });
        expect(utils.queryByText(/is not on the allow-list/)).toBeNull();
    });

    it('refuses the same list typed as both allow-list and block-list', async () => {
        const { utils, calls } = await mount();
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Edit' })));
        await step(() => fireEvent.change(utils.getByLabelText(/^Allow list/), { target: { value: '2701' } }));
        await step(() => fireEvent.change(utils.getByLabelText(/^Block list/), { target: { value: '2701' } }));

        expect(utils.getByText(/both the allow-list and the block-list/)).toBeTruthy();
        expect(utils.getByRole('button', { name: 'Edit dispenser' }).disabled).toBe(true);
        fireEvent.submit(utils.getByRole('button', { name: 'Edit dispenser' }).closest('form'));
        await step(() => {});
        expect(calls.some((c) => c.method === 'composeForConfirm')).toBe(false);
    });

    it('refuses an allow-list that matches the block-list already bound', async () => {
        const { utils, calls } = await mount({ dispenser: { ...DISPENSER, block_list: '2701' } });
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Edit' })));
        await step(() => fireEvent.change(utils.getByLabelText(/^Allow list/), { target: { value: '2701' } }));

        expect(utils.getByText(/List #2701 is set as both/)).toBeTruthy();
        fireEvent.submit(utils.getByRole('button', { name: 'Edit dispenser' }).closest('form'));
        await step(() => {});
        expect(calls.some((c) => c.method === 'composeForConfirm')).toBe(false);
    });
});
