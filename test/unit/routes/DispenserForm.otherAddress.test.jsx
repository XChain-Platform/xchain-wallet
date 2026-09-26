// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The "Another address" dispenser-address mode: any address on the chain,
// typed by the user, used as GET_ADDRESS while the wallet's own SOURCE signs
// and escrows. The chain accepts such a create only when the address set
// DISPENSER_PREFERENCE 2, is fresh, or SOURCE is its established origin
// (protocol/actions/dispenser.md, Rules), and a refused create still costs
// the fee. So the form must:
//
//   - reject a malformed or wrong-chain address the way Send does,
//   - show the pre-flight verdict inline for each rule, and refuse when none holds,
//   - keep Create off while the verdict loads and on a refusal,
//   - compose GET_ADDRESS = the outside address with SOURCE = the wallet's address,
//   - say on the confirm screen where payments go and who gets the escrow back.

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

// Real, checksum-valid mainnet addresses, since the format check decodes them.
const OUTSIDE = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const SOMEONE_ELSE = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';
const LITECOIN = 'LVg2kJoFNg45Nbpy53h7Fe1wKyeXVRhMH9';

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

/**
 * @param {{ prefs?: any, dispensers?: any[], history?: any[] }} chainState
 *   what the three standing reads answer for OUTSIDE; a value of Error rejects
 */
function recordingMessaging(chainState) {
    const calls = [];
    const answer = (method, value) => (args) => {
        calls.push({ method, args });
        return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    };
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: () => Promise.resolve({ [CHAIN]: { id: SOURCE.id, address: SOURCE.address } }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        getWalletBalances: () => Promise.resolve({ [CHAIN]: [] }),
        getListByActionIndex: () => Promise.resolve(null),
        getAddressPreferences: answer('getAddressPreferences', chainState.prefs),
        getDispensersForAddress: answer('getDispensersForAddress', chainState.dispensers instanceof Error
            ? chainState.dispensers : { data: chainState.dispensers }),
        getAddressHistory: answer('getAddressHistory', chainState.history instanceof Error
            ? chainState.history : { data: chainState.history, total: chainState.history.length }),
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

// Chain states, one per verdict branch.
const SEEN_ROW = { action_index: 5, action: 'SEND', source: SOMEONE_ELSE };
const STATE = {
    preference: { prefs: { dispenserPreference: 2, onChain: true }, dispensers: [], history: [SEEN_ROW] },
    fresh: { prefs: { dispenserPreference: 1, onChain: false }, dispensers: [], history: [] },
    origin: {
        prefs: { dispenserPreference: 1, onChain: false },
        dispensers: [{ action_index: 9, source: SOURCE.address, address: OUTSIDE, status: 'valid' }],
        history: [SEEN_ROW],
    },
    refused: {
        prefs: { dispenserPreference: 1, onChain: false },
        dispensers: [{ action_index: 9, source: SOMEONE_ELSE, address: OUTSIDE, status: 'valid' }],
        history: [SEEN_ROW],
    },
    // SOURCE's only create here is invalid, and an invalid create confers no standing.
    refusedAfterInvalidAttempt: {
        prefs: { dispenserPreference: 1, onChain: false },
        dispensers: [{ action_index: 9, source: SOURCE.address, address: OUTSIDE, status: 'invalid: GET_ADDRESS' }],
        history: [SEEN_ROW],
    },
    unknown: { prefs: new Error('explorer down'), dispensers: [], history: [SEEN_ROW] },
};

async function drainMicrotasks(rounds = 12) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

const setValue = (utils, label, value) => {
    fireEvent.change(utils.getByLabelText(label), { target: { value } });
};

/** Mount, switch to "Another address", type `address`, fill the terms; verdict not yet read. */
async function mountWithOutsideAddress(chainState, address) {
    const { messaging, calls } = recordingMessaging(chainState);
    let utils;
    await domAct(async () => {
        utils = render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(DispenserForm, {
                walletId: 'w', initialChainId: CHAIN, initialTick: 'JDOG', onBack() {},
            }),
        ));
        await drainMicrotasks();
    });
    await domAct(async () => {
        fireEvent.click(utils.getByRole('button', { name: 'Change dispenser address' }));
        await drainMicrotasks();
    });
    await domAct(async () => {
        fireEvent.click(utils.getByRole('button', { name: /^Another address/ }));
        await drainMicrotasks();
    });
    await domAct(async () => {
        setValue(utils, 'Dispenser address', address);
        setValue(utils, /^Give amount/, '10');
        setValue(utils, /^Escrow amount/, '100');
        setValue(utils, /^Trigger price/, '0.001');
        await drainMicrotasks();
    });
    return { utils, calls };
}

/** Let the debounced standing reads run and settle. */
async function settle() {
    await domAct(async () => { vi.advanceTimersByTime(500); await drainMicrotasks(); });
}

const verdictOf = (utils) => utils.queryByTestId('outside-address-verdict');
const createButton = (utils) => utils.getByRole('button', { name: 'Create' });

describe('DispenserForm "Another address": format', () => {
    it('refuses a mistyped address with the Send wording and reads nothing', async () => {
        const { utils, calls } = await mountWithOutsideAddress(STATE.fresh, 'bc1qnotanaddress');
        await settle();
        expect(utils.container.textContent).toContain('This is not a valid Bitcoin address. Check it for typos.');
        expect(verdictOf(utils)).toBeNull();
        expect(calls.some((c) => c.method === 'getAddressPreferences')).toBe(false);
        await domAct(async () => { fireEvent.click(createButton(utils)); await drainMicrotasks(); });
        expect(calls.some((c) => c.method === 'composeForConfirm')).toBe(false);
    });

    it('names the coin a wrong-chain address belongs to', async () => {
        const { utils } = await mountWithOutsideAddress(STATE.fresh, LITECOIN);
        await settle();
        expect(utils.container.textContent).toContain('This looks like a Litecoin address, not a Bitcoin address.');
    });

    it('keeps the three wallet-address modes in the picker beside the new one', async () => {
        const { messaging } = recordingMessaging(STATE.fresh);
        let utils;
        await domAct(async () => {
            utils = render(React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(DispenserForm, { walletId: 'w', initialChainId: CHAIN, initialTick: 'JDOG', onBack() {} }),
            ));
            await drainMicrotasks();
        });
        expect(utils.getByLabelText('Dispenser address').value).toBe('New dispenser address (generated at preview)');
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Change dispenser address' }));
            await drainMicrotasks();
        });
        expect(utils.getByRole('button', { name: /^New dispenser address/ })).toBeTruthy();
        expect(utils.getByRole('button', { name: /^Another address/ })).toBeTruthy();
    });
});

describe('DispenserForm "Another address": pre-flight verdict', () => {
    it('keeps Create off while the verdict loads', async () => {
        const { utils } = await mountWithOutsideAddress(STATE.fresh, OUTSIDE);
        expect(utils.container.textContent).toContain('Checking whether this address accepts your dispenser');
        expect(createButton(utils).disabled).toBe(true);
    });

    it.each([
        ['preference', STATE.preference, 'lets anyone open a dispenser'],
        ['fresh', STATE.fresh, 'no on-chain history'],
        ['origin', STATE.origin, 'opened a dispenser here before'],
    ])('allows on %s and enables Create', async (kind, chainState, wording) => {
        const { utils, calls } = await mountWithOutsideAddress(chainState, OUTSIDE);
        await settle();
        const verdict = verdictOf(utils);
        expect(verdict?.getAttribute('data-verdict')).toBe(kind);
        expect(verdict?.textContent).toContain(wording);
        expect(createButton(utils).disabled).toBe(false);
        const read = calls.find((c) => c.method === 'getAddressPreferences');
        expect(read.args).toEqual({ chainId: CHAIN, address: OUTSIDE });
    });

    it.each([
        ['another address opened there', STATE.refused],
        ['only an invalid attempt by this source', STATE.refusedAfterInvalidAttempt],
    ])('refuses when the address is owner-only, seen, and %s', async (_label, chainState) => {
        const { utils, calls } = await mountWithOutsideAddress(chainState, OUTSIDE);
        await settle();
        const verdict = verdictOf(utils);
        expect(verdict?.getAttribute('data-verdict')).toBe('refused');
        expect(verdict?.textContent).toBe('This address only lets its owner open dispensers.');
        expect(createButton(utils).disabled).toBe(true);
        await domAct(async () => { fireEvent.click(createButton(utils)); await drainMicrotasks(); });
        expect(calls.some((c) => c.method === 'composeForConfirm')).toBe(false);
    });

    it('warns but allows when the preference cannot be read', async () => {
        const { utils } = await mountWithOutsideAddress(STATE.unknown, OUTSIDE);
        await settle();
        const verdict = verdictOf(utils);
        expect(verdict?.getAttribute('data-verdict')).toBe('unknown');
        expect(verdict?.textContent).toContain('the network will decide');
        expect(createButton(utils).disabled).toBe(false);
    });
});

describe('DispenserForm "Another address": payload and confirm screen', () => {
    it('composes the outside GET_ADDRESS with the wallet as SOURCE, and names it on confirm', async () => {
        const { utils, calls } = await mountWithOutsideAddress(STATE.fresh, OUTSIDE);
        await settle();
        await domAct(async () => { fireEvent.click(createButton(utils)); await drainMicrotasks(); });

        const note = utils.getByTestId('outside-address-note');
        expect(note.textContent).toContain(OUTSIDE);
        expect(note.textContent).toContain('payments go to this address');
        expect(note.textContent).toContain('returns to whichever one closes it');

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
        expect(compose.args.actionData.params.GET_ADDRESS).toBe(OUTSIDE);
        expect(submit.args.params.GET_ADDRESS).toBe(OUTSIDE);
        expect(compose.args.from.address).toBe(SOURCE.address);
        expect(submit.args.from.address).toBe(SOURCE.address);
        expect(calls.some((c) => c.method === 'generateDispenserAddress'), 'no wallet address derived').toBe(false);
    });
});
