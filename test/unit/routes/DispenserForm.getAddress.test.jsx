// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A dispenser created in the default "New dispenser address" mode derives
// its GET_ADDRESS at the moment Create is pressed, then composes in the
// same tick. `actionParams` is a memo of the render that handler came from,
// so reading it after the derivation composed the action WITHOUT the fresh
// address: every first submit opened the dispenser self-open and orphaned a
// role='dispenser' address in the vault. The handler now threads the derived
// address into the params it hands the confirm path.
//
// Teeth: the first case reads the params that reached `composeForConfirm`
// and the Approve dispatch, on a fresh form, on the first submit.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act as domAct, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispenserForm } from '../../../packages/core/src/shared/routes/DispenserForm.jsx';

const CHAIN = 'bitcoin-mainnet';

const SOURCE = Object.freeze({
    id: 'addr-hd-0',
    address: 'bc1qsourcesourcesourcesourcesourcesources',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

// A previously derived dispenser address, present in the wallet before the
// form opens (the 'existing' mode picks it from the address list).
const REUSABLE = Object.freeze({
    id: 'addr-disp-1',
    address: 'bc1qreusablereusablereusablereusablereusab',
    publicKey: '02ddeeff',
    derivationPath: "m/84'/0'/0'/0/1",
    source: 'hd',
    role: 'dispenser',
    signerId: 'signer-1',
});

// What generateDispenserAddress hands back at review time.
const DERIVED = Object.freeze({
    id: 'addr-disp-2',
    address: 'bc1qderivedderivedderivedderivedderivedde',
    publicKey: '02001122',
    derivationPath: "m/84'/0'/0'/0/2",
    source: 'hd',
    role: 'dispenser',
});

const COMPOSED = Object.freeze({
    psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 1,
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

function recordingMessaging() {
    const calls = [];
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [SOURCE, REUSABLE] }),
        getActiveAddresses: () => Promise.resolve({ [CHAIN]: { id: SOURCE.id, address: SOURCE.address } }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        getWalletBalances: () => Promise.resolve({ [CHAIN]: [] }),
        generateDispenserAddress: (args) => {
            calls.push({ method: 'generateDispenserAddress', args });
            return Promise.resolve({ ...DERIVED });
        },
        composeForConfirm: (args) => {
            calls.push({ method: 'composeForConfirm', args });
            return Promise.resolve({ ...COMPOSED });
        },
        preflight: (args) => {
            calls.push({ method: 'preflight', args });
            return Promise.resolve({ verdict: 'pass', findings: [] });
        },
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return (args) => {
                calls.push({ method: String(prop), args });
                return Promise.resolve({ txid: `tx-${String(prop)}`, rows: [] });
            };
        },
    });
    return { messaging, calls };
}

async function drainMicrotasks(rounds = 12) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

const setValue = (utils, label, value) => {
    fireEvent.change(utils.getByLabelText(label), { target: { value } });
};

/**
 * Mount a locked-token DispenserForm, run the optional picker steps, fill
 * the amounts, press Create, then Approve on the confirm page.
 */
async function driveCreate({ steps = [] } = {}) {
    const { messaging, calls } = recordingMessaging();
    let utils;
    await domAct(async () => {
        utils = render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(DispenserForm, {
                    walletId: 'w', initialChainId: CHAIN, initialTick: 'JDOG', onBack() {},
                }),
            ),
        );
        await drainMicrotasks();
    });
    for (const step of steps) {
        // eslint-disable-next-line no-await-in-loop
        await domAct(async () => { step(utils); await drainMicrotasks(); });
    }
    await domAct(async () => {
        setValue(utils, /^Give amount/, '10');
        setValue(utils, /^Escrow amount/, '100');
        setValue(utils, /^Trigger price/, '0.001');
        await drainMicrotasks();
    });
    const create = utils.getByRole('button', { name: 'Create' });
    expect(create.disabled).toBe(false);
    await domAct(async () => {
        fireEvent.click(create);
        await drainMicrotasks();
    });
    await domAct(async () => {
        const approve = Array.from(utils.container.querySelectorAll('button'))
            .find((b) => /approve/i.test(b.textContent || '') && !b.disabled);
        if (!approve) throw new Error('no enabled Approve button on the confirm page');
        fireEvent.click(approve);
        await drainMicrotasks();
    });
    return { calls, utils };
}

const openDispenserAddressPicker = (utils) => {
    fireEvent.click(utils.getByRole('button', { name: 'Change dispenser address' }));
};
const pickAddress = (address) => (utils) => {
    fireEvent.click(utils.getByRole('button', { name: `View address ${address}` }));
};

function composeAndSubmitParams(calls) {
    const compose = calls.find((c) => c.method === 'composeForConfirm');
    expect(compose, 'composeForConfirm was dispatched').toBeTruthy();
    const submit = calls.find((c) => c.method === 'dispenserAction');
    expect(submit, 'dispenserAction was dispatched on Approve').toBeTruthy();
    return { composed: compose.args.actionData.params, submitted: submit.args.params };
}

describe('DispenserForm GET_ADDRESS by address mode', () => {
    it('mode new: the FIRST submit composes and signs with the freshly derived address', async () => {
        const { calls } = await driveCreate();

        const derive = calls.find((c) => c.method === 'generateDispenserAddress');
        expect(derive, 'a dispenser address was derived at review').toBeTruthy();
        expect(derive.args).toMatchObject({ walletId: 'w', chainId: CHAIN });

        const { composed, submitted } = composeAndSubmitParams(calls);
        expect(composed.GET_ADDRESS).toBe(DERIVED.address);
        expect(submitted.GET_ADDRESS).toBe(DERIVED.address);
        // The rest of the action is intact around it.
        expect(composed).toMatchObject({ VERSION: '0', GIVE_TICK: 'JDOG', GIVE_AMOUNT: '10', GIVE_ESCROW: '100' });
    });

    it('mode existing: a reused dispenser address rides as GET_ADDRESS, and nothing is derived', async () => {
        const { calls } = await driveCreate({
            steps: [openDispenserAddressPicker, pickAddress(REUSABLE.address)],
        });
        expect(calls.some((c) => c.method === 'generateDispenserAddress')).toBe(false);
        const { composed, submitted } = composeAndSubmitParams(calls);
        expect(composed.GET_ADDRESS).toBe(REUSABLE.address);
        expect(submitted.GET_ADDRESS).toBe(REUSABLE.address);
    });

    it('mode current: picking the source itself omits GET_ADDRESS so the protocol defaults to SOURCE', async () => {
        const { calls } = await driveCreate({
            steps: [openDispenserAddressPicker, pickAddress(SOURCE.address)],
        });
        expect(calls.some((c) => c.method === 'generateDispenserAddress')).toBe(false);
        const { composed, submitted } = composeAndSubmitParams(calls);
        expect(composed).not.toHaveProperty('GET_ADDRESS');
        expect(submitted).not.toHaveProperty('GET_ADDRESS');
    });
});
