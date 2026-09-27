// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Open again on a finished dispenser hands DispenserForm the old
// terms. What must survive into the composed DISPENSER v0:
//
//   - SOURCE is the creator, even when the wallet's active address is another
//     one. Reusing an address that already hosted a dispenser is allowed only
//     to the address that opened the first one there (origin standing), so
//     the form's usual active-address default would be refused on chain.
//   - GET_ADDRESS is the same dispenser address, whether the wallet set it
//     aside for dispensers, holds it as an ordinary address, or does not hold
//     it at all (a delegated GET_ADDRESS the creator still has standing on).
//   - Every term arrives prefilled, so pressing Create without touching
//     anything opens the same dispenser again.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act as domAct, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispenserForm } from '../../../packages/core/src/shared/routes/DispenserForm.jsx';

const CHAIN = 'bitcoin-mainnet';

// The wallet's active address: what the form would pick as SOURCE unaided.
const ACTIVE = Object.freeze({
    id: 'addr-hd-0', address: 'bc1qactiveactiveactiveactiveactiveactivea', publicKey: '02aa01',
    derivationPath: "m/84'/0'/0'/0/0", source: 'hd', signerId: 'signer-1',
});
const CREATOR = Object.freeze({
    id: 'addr-hd-1', address: 'bc1qcreatorcreatorcreatorcreatorcreatorcr', publicKey: '02aa02',
    derivationPath: "m/84'/0'/0'/0/1", source: 'hd', signerId: 'signer-1',
});
// An ordinary wallet address (no role='dispenser') that hosted the old one.
const PLAIN_HOST = Object.freeze({
    id: 'addr-hd-2', address: 'bc1qplainhostplainhostplainhostplainhostp', publicKey: '02aa03',
    derivationPath: "m/84'/0'/0'/0/2", source: 'hd', signerId: 'signer-1',
});
const FOREIGN_HOST = 'bc1qforeignforeignforeignforeignforeignfo';

// Exactly what DispenserDetail's Open again passes for TDOGE-3030-shaped data.
const TERMS = Object.freeze({
    chainId: CHAIN,
    tick: 'ALM0NDJ0Y',
    giveAmount: '1',
    escrow: '100',
    payWith: 'coin',
    triggerPrice: '0.001',
    expiration: null,
    allowList: '77',
    blockList: '',
    source: CREATOR.address,
    dispenserAddress: PLAIN_HOST.address,
});

const COMPOSED = Object.freeze({ psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 1 });

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
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [ACTIVE, CREATOR, PLAIN_HOST] }),
        getActiveAddresses: () => Promise.resolve({ [CHAIN]: { id: ACTIVE.id, address: ACTIVE.address } }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        getWalletBalances: () => Promise.resolve({ [CHAIN]: [] }),
        getListByActionIndex: () => Promise.resolve(null),
        generateDispenserAddress: (args) => {
            calls.push({ method: 'generateDispenserAddress', args });
            return Promise.resolve({ id: 'addr-new', address: 'bc1qnewnewnewnewnewnewnewnewnewnewnewnewne' });
        },
        composeForConfirm: (args) => {
            calls.push({ method: 'composeForConfirm', args });
            return Promise.resolve({ ...COMPOSED });
        },
        preflight: () => Promise.resolve({ verdict: 'pass', findings: [] }),
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

async function mountReopen(reopen) {
    const { messaging, calls } = recordingMessaging();
    let utils;
    await domAct(async () => {
        utils = render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(DispenserForm, { walletId: 'w', reopen, onBack() {} }),
        ));
        await drainMicrotasks();
    });
    // The source-balance lookup is debounced; let it settle so a late
    // auto-pick would show up if the pin did not hold.
    await domAct(async () => { vi.advanceTimersByTime(500); await drainMicrotasks(); });
    return { utils, calls };
}

/** Press Create untouched, then Approve; return what was composed and signed. */
async function createAsIs(utils, calls) {
    await domAct(async () => {
        fireEvent.click(utils.getByRole('button', { name: 'Create' }));
        await drainMicrotasks();
    });
    await domAct(async () => {
        const approve = Array.from(utils.container.querySelectorAll('button'))
            .find((b) => /approve/i.test(b.textContent || '') && !b.disabled);
        if (!approve) throw new Error(`no enabled Approve button; page reads: ${utils.container.textContent}`);
        fireEvent.click(approve);
        await drainMicrotasks();
    });
    const compose = calls.find((c) => c.method === 'composeForConfirm');
    const submit = calls.find((c) => c.method === 'dispenserAction');
    expect(compose, 'composeForConfirm was dispatched').toBeTruthy();
    expect(submit, 'dispenserAction was dispatched on Approve').toBeTruthy();
    return { compose, submit };
}

describe('DispenserForm opened again from a finished dispenser', () => {
    it('shows the prefilled terms and the old dispenser address', async () => {
        const { utils } = await mountReopen(TERMS);
        expect(utils.getByLabelText(/^Give amount/).value).toBe('1');
        expect(utils.getByLabelText(/^Escrow amount/).value).toBe('100');
        expect(utils.getByLabelText(/^Trigger price/).value).toBe('0.001');
        expect(utils.getByLabelText('Dispenser address').value).toBe(PLAIN_HOST.address);
        expect(utils.getByLabelText('Source').value).toBe(CREATOR.address);
        expect(utils.getByRole('button', { name: 'Allow-list #77' })).toBeTruthy();
    });

    it('composes the same dispenser from the creator onto the same (non-dispenser-role) address', async () => {
        const { utils, calls } = await mountReopen(TERMS);
        const { compose, submit } = await createAsIs(utils, calls);
        const expected = {
            VERSION: '0',
            GIVE_COIN: 'BTC',
            GIVE_TICK: 'ALM0NDJ0Y',
            GIVE_AMOUNT: '1',
            GIVE_ESCROW: '100',
            GET_COIN: 'BTC',
            GET_AMOUNT: '0.001',
            GET_ADDRESS: PLAIN_HOST.address,
            ALLOW_LIST: '77',
        };
        expect(compose.args.actionData.params).toEqual(expected);
        expect(submit.args.params).toEqual(expected);
        expect(compose.args.from.address, 'SOURCE is the creator, not the active address').toBe(CREATOR.address);
        expect(calls.some((c) => c.method === 'generateDispenserAddress'), 'no fresh address derived').toBe(false);
    });

    it('keeps an address the wallet does not hold, instead of falling back to a new one', async () => {
        const { utils, calls } = await mountReopen({ ...TERMS, dispenserAddress: FOREIGN_HOST });
        expect(utils.getByLabelText('Dispenser address').value).toBe(FOREIGN_HOST);
        const { compose } = await createAsIs(utils, calls);
        expect(compose.args.actionData.params.GET_ADDRESS).toBe(FOREIGN_HOST);
        expect(calls.some((c) => c.method === 'generateDispenserAddress')).toBe(false);
    });

    it('omits GET_ADDRESS when the old dispenser lived on the creator itself', async () => {
        const { utils, calls } = await mountReopen({ ...TERMS, dispenserAddress: CREATOR.address });
        const { compose } = await createAsIs(utils, calls);
        expect(compose.args.actionData.params).not.toHaveProperty('GET_ADDRESS');
        expect(compose.args.from.address).toBe(CREATOR.address);
    });

    it('carries oracle pricing and a future expiration', async () => {
        // A whole minute, since the Expires input has minute resolution.
        const expiration = 4102444800;
        const { utils, calls } = await mountReopen({
            ...TERMS,
            triggerPrice: undefined,
            fiatCode: 'USD',
            fiatAmount: '',
            oracleAddress: 'bc1qoracleoracleoracleoracleoracleoracle',
            expiration,
        });
        expect(utils.queryByLabelText(/^Trigger price/), 'oracle pricing hides the coin trigger').toBeNull();
        expect(utils.getByLabelText(/^Oracle address/).value).toBe('bc1qoracleoracleoracleoracleoracleoracle');
        const { compose } = await createAsIs(utils, calls);
        expect(compose.args.actionData.params).toMatchObject({
            GET_AMOUNT: '0',
            ORACLE_ADDRESS: 'bc1qoracleoracleoracleoracleoracleoracle',
            FIAT_CODE: 'USD',
            EXPIRATION: String(expiration),
        });
    });

    it('carries token pricing', async () => {
        const { utils, calls } = await mountReopen({
            ...TERMS, payWith: 'token', triggerPrice: undefined, getTick: 'PEPECASH', getTokenAmount: '250',
        });
        const { compose } = await createAsIs(utils, calls);
        expect(compose.args.actionData.params).toMatchObject({ GET_TICK: 'PEPECASH', GET_AMOUNT: '250' });
    });
});
