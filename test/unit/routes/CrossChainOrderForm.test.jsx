// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// CrossChainOrderForm: the ORDER surface whose GIVE_COIN and GET_COIN
// differ. The order is signed on the give chain, the GET_ADDRESS names the
// wallet's own address on the get chain, and the whole thing rides the
// same single-encode confirm lane as CreateOrderForm.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act as domAct, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CrossChainOrderForm } from '../../../packages/core/src/shared/routes/CrossChainOrderForm.jsx';

const DOGE = 'dogecoin-mainnet';
const BTC = 'bitcoin-mainnet';

const DOGE_ADDRESS = Object.freeze({
    id: 'addr-doge-0',
    address: 'DExampleDogeAddressxxxxxxxxxxxxxxxx',
    publicKey: '02aabbcc',
    derivationPath: "m/44'/3'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
const BTC_ADDRESS = Object.freeze({
    id: 'addr-btc-0',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02ddeeff',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
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

// Recording messaging mock: a wallet with one address on DOGE and one on
// BTC, whose newest address on any chain is that chain's only address.
function recordingMessaging(overrides = {}) {
    const calls = [];
    const target = {
        getAddressesByChain: () => Promise.resolve({ [DOGE]: [DOGE_ADDRESS], [BTC]: [BTC_ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({}),
        getNewestAddress: (walletId, chainId) => {
            calls.push({ method: 'getNewestAddress', args: { walletId, chainId } });
            return Promise.resolve(chainId === BTC ? BTC_ADDRESS : DOGE_ADDRESS);
        },
        signerReady: () => Promise.resolve({ ready: true }),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        getWalletBalances: () => Promise.resolve({}),
        composeForConfirm: (args) => {
            calls.push({ method: 'composeForConfirm', args });
            return Promise.resolve({ ...COMPOSED });
        },
        preflight: (args) => {
            calls.push({ method: 'preflight', args });
            return Promise.resolve({ verdict: 'pass', findings: [] });
        },
    };
    Object.assign(target, overrides);
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

async function mount(props = {}, overrides = {}) {
    const { messaging, calls } = recordingMessaging(overrides);
    let utils;
    await domAct(async () => {
        utils = render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(CrossChainOrderForm, { walletId: 'w', onBack() {}, ...props }),
            ),
        );
        await drainMicrotasks();
    });
    return { utils, calls };
}

const setValue = (utils, label, value) => {
    fireEvent.change(utils.getByLabelText(label), { target: { value } });
};

// ChainPicker is a trigger button (named "<label>: <selection>") over a
// listbox of option rows, so a pick is two clicks with a render between.
const pickerName = (utils, label) => utils.getByRole('button', { name: new RegExp(`^${label}:`) })
    .getAttribute('aria-label');
async function pickChain(utils, label, optionLabel) {
    await domAct(async () => {
        fireEvent.click(utils.getByRole('button', { name: new RegExp(`^${label}:`) }));
        await drainMicrotasks();
    });
    await domAct(async () => {
        const row = utils.getAllByRole('option').find((o) => (o.textContent || '').startsWith(optionLabel));
        if (!row) throw new Error(`no ${optionLabel} row in the ${label} picker`);
        fireEvent.click(row);
        await drainMicrotasks();
    });
}

async function fillPair(utils) {
    await domAct(async () => {
        setValue(utils, 'Give token', 'JDOG');
        setValue(utils, /^Give amount/, '10');
        setValue(utils, 'Get token', 'XCHAIN');
        setValue(utils, /^Get amount/, '20');
        await drainMicrotasks();
    });
}

async function placeAndApprove(utils) {
    const button = utils.getByRole('button', { name: 'Place order' });
    expect(button.disabled, '"Place order" button is enabled').toBe(false);
    await domAct(async () => {
        fireEvent.click(button);
        await drainMicrotasks();
    });
    await domAct(async () => {
        const approve = Array.from(utils.container.querySelectorAll('button'))
            .find((b) => /approve/i.test(b.textContent || '') && !b.disabled);
        if (!approve) throw new Error('no enabled Approve button on the confirm page');
        fireEvent.click(approve);
        await drainMicrotasks();
    });
}

describe('CrossChainOrderForm', () => {
    it('gives on DOGE, gets on BTC, and names the wallet\'s BTC address as GET_ADDRESS', async () => {
        const { utils, calls } = await mount({ initialChainId: DOGE });
        // The get chain defaulted to the other coin, and the receiver was
        // resolved on THAT chain, not on the chain being signed.
        expect(pickerName(utils, 'Give chain')).toBe('Give chain: Dogecoin');
        expect(pickerName(utils, 'Get chain')).toBe('Get chain: Bitcoin');
        expect(utils.getByLabelText('Receive at').value).toBe(BTC_ADDRESS.address);
        expect(calls.filter((c) => c.method === 'getNewestAddress').map((c) => c.args.chainId)).toEqual([BTC]);

        await fillPair(utils);
        await placeAndApprove(utils);

        const compose = calls.find((c) => c.method === 'composeForConfirm');
        expect(compose, 'composeForConfirm was dispatched').toBeTruthy();
        expect(compose.args.chainId).toBe(DOGE);
        expect(compose.args.actionData.action).toBe('ORDER');
        expect(compose.args.actionData.params).toMatchObject({
            VERSION: '0',
            GIVE_COIN: 'DOGE', GIVE_TICK: 'JDOG', GIVE_AMOUNT: '10',
            GET_COIN: 'BTC', GET_TICK: 'XCHAIN', GET_AMOUNT: '20',
            GET_ADDRESS: BTC_ADDRESS.address,
        });
        expect(compose.args.actionData.params.GIVE_COIN).not.toBe(compose.args.actionData.params.GET_COIN);
        expect(calls.some((c) => c.method === 'preflight'), 'preflight streamed').toBe(true);

        // Approve signs on the GIVE chain through orderAction, with the
        // previewed PSBT and the same cross-chain params.
        const submit = calls.find((c) => c.method === 'orderAction');
        expect(submit, 'orderAction was dispatched on Approve').toBeTruthy();
        expect(submit.args.chainId).toBe(DOGE);
        expect(submit.args.from.address).toBe(DOGE_ADDRESS.address);
        expect(submit.args.params).toMatchObject({ GIVE_COIN: 'DOGE', GET_COIN: 'BTC', GET_ADDRESS: BTC_ADDRESS.address });
        expect(submit.args.prebuiltPsbt).toMatchObject({ psbtHex: 'aa00', encoding: 'psbt' });
        expect(calls.some((c) => c.method === 'swapAction')).toBe(false);
    });

    it('re-resolves the receiver when the get chain changes, and keeps a typed one', async () => {
        const { utils } = await mount({ initialChainId: DOGE }, {
            getAddressesByChain: () => Promise.resolve({
                [DOGE]: [DOGE_ADDRESS], [BTC]: [BTC_ADDRESS], 'litecoin-mainnet': [{ ...BTC_ADDRESS, id: 'addr-ltc-0', address: 'ltc1qexample' }],
            }),
            getNewestAddress: (walletId, chainId) => Promise.resolve({ address: `newest-on-${chainId}` }),
        });
        expect(utils.getByLabelText('Receive at').value).toBe(`newest-on-${BTC}`);
        // Typed override survives; a chain switch re-arms the default.
        await domAct(async () => {
            setValue(utils, 'Receive at', 'typed-by-user');
            await drainMicrotasks();
        });
        expect(utils.getByLabelText('Receive at').value).toBe('typed-by-user');
        await pickChain(utils, 'Get chain', 'Litecoin');
        expect(pickerName(utils, 'Get chain')).toBe('Get chain: Litecoin');
        expect(utils.getByLabelText('Receive at').value).toBe('newest-on-litecoin-mainnet');
    });

    it('refuses a same-coin pair and points at Create order', async () => {
        const { utils, calls } = await mount({ initialChainId: DOGE });
        await pickChain(utils, 'Get chain', 'Dogecoin');
        await fillPair(utils);
        expect(utils.container.textContent).toMatch(/Give and get chains must differ/);
        expect(utils.getByRole('button', { name: 'Place order' }).disabled).toBe(true);
        expect(calls.some((c) => c.method === 'composeForConfirm')).toBe(false);
    });

    it('refuses a native-coin side: only a token can be escrowed for the federation', async () => {
        const { utils, calls } = await mount({ initialChainId: DOGE });
        await domAct(async () => {
            setValue(utils, 'Give token', 'DOGE');
            await drainMicrotasks();
        });
        expect(utils.container.textContent).toMatch(/cannot give native DOGE/);
        expect(utils.getByRole('button', { name: 'Place order' }).disabled).toBe(true);
        expect(calls.some((c) => c.method === 'composeForConfirm')).toBe(false);
    });

    it('will not compose without a receive address on the get chain', async () => {
        const { utils, calls } = await mount({ initialChainId: DOGE }, {
            getNewestAddress: () => Promise.resolve(null),
        });
        await fillPair(utils);
        expect(utils.getByLabelText('Receive at').value).toBe('');
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Place order' }));
            await drainMicrotasks();
        });
        expect(utils.container.textContent).toMatch(/Receive address on .* is required/);
        expect(calls.some((c) => c.method === 'composeForConfirm')).toBe(false);
    });

    it('explains itself on a wallet with addresses on one chain only', async () => {
        const { utils } = await mount({}, {
            getAddressesByChain: () => Promise.resolve({ [DOGE]: [DOGE_ADDRESS] }),
        });
        expect(utils.container.textContent).toMatch(/addresses on two different chains/);
        expect(utils.queryByRole('button', { name: 'Place order' })).toBeNull();
    });
});
