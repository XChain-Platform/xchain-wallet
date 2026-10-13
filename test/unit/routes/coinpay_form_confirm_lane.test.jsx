// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Manual COINPAY composes its action and native payment output through the
// shared confirm lane. Watcher mode retains the specialized builder that
// re-verifies the obligation before it creates an unsigned transaction.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act as domAct, cleanup, fireEvent, render } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CoinpayForm } from '../../../packages/core/src/shared/routes/CoinpayForm.jsx';

const CHAIN = 'dogecoin-testnet';
const PAYER = 'nPayerAddressFixture00000000000000';
const PAYEE = 'nPayeeAddressFixture00000000000000';
const OWNER = Object.freeze({
    id: 'address-1',
    address: PAYER,
    publicKey: '02aabbcc',
    derivationPath: "m/44'/1'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
const OBLIGATION = Object.freeze({
    coinpay_status: 'pending_coinpay',
    payer_address: PAYER,
    payee_address: PAYEE,
    action_index: '648',
    coin_amount: '10',
    expiration: String(Math.floor(Date.now() / 1000) + 3600),
});
const COMPOSED = Object.freeze({ psbt: 'bb00', encoding: 'psbt', actionString: 'COINPAY|0|648', version: 1 });
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

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

async function drain(rounds = 20) {
    for (let i = 0; i < rounds; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
}

function makeMessaging(settings = { walletMode: 'full' }, overrides = {}) {
    const calls = [];
    const log = (method, value) => (args) => {
        calls.push({ method, args });
        return Promise.resolve(value);
    };
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [OWNER] }),
        getCoinpayObligationsForAddress: () => Promise.resolve([OBLIGATION]),
        getAddressBalances: () => Promise.resolve({
            native: { tick: 'DOGE', quantity: '2000000000', divisibility: 8 },
            tokens: [],
        }),
        getSettings: () => Promise.resolve(settings),
        signerReady: () => Promise.resolve({ ready: true }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        composeForConfirm: log('composeForConfirm', COMPOSED),
        preflight: log('preflight', PASS),
        ...overrides,
    };
    return {
        calls,
        messaging: new Proxy(target, {
            get(value, prop) {
                if (prop in value) return value[prop];
                return log(String(prop), { txid: `tx-${String(prop)}`, psbtHex: 'cc00' });
            },
        }),
    };
}

async function mount(settings, overrides) {
    const { messaging, calls } = makeMessaging(settings, overrides);
    let utils;
    await domAct(async () => {
        utils = render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(CoinpayForm, {
                walletId: 'wallet-1',
                chainId: CHAIN,
                address: PAYER,
                orderMatchActionIndex: '648',
                onBack() {},
            }),
        ));
        await drain();
    });
    return { utils, calls, messaging };
}

async function step(fn) {
    await domAct(async () => {
        fn();
        await drain();
    });
}

describe('CoinpayForm shared confirmation', () => {
    it('shows the payer, recipient, amount, timestamp deadline, and expiry loss warning', async () => {
        const { utils } = await mount();
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Review' })));

        expect(utils.getByText('From').nextElementSibling.textContent).toContain(PAYER.slice(0, 6));
        expect(utils.getByText('Paying to').nextElementSibling.textContent).toContain(PAYEE.slice(0, 6));
        expect(utils.getByText('Amount').nextElementSibling.textContent).toBe('10 DOGE');
        expect(utils.getByText('Payment deadline').nextElementSibling.textContent).toMatch(/\d/);
        expect(utils.queryByText(/deadline.*block/i)).toBeNull();
        expect(utils.getByText(/coin is still sent but you do not receive the tokens/i)).toBeTruthy();
    });

    it('blocks review and explains when the source cannot cover the payment and fee', async () => {
        const { utils, calls } = await mount(undefined, {
            getAddressBalances: () => Promise.resolve({
                native: { tick: 'DOGE', quantity: '500000000', divisibility: 8 },
                tokens: [],
            }),
        });

        expect(utils.getByText(/Insufficient DOGE balance/).textContent)
            .toContain('This address has 5 DOGE');
        expect(utils.getByText(/Insufficient DOGE balance/).textContent)
            .toContain('payment and estimated network fee require 10.25 DOGE');
        expect(utils.getByRole('button', { name: 'Review' }).disabled).toBe(true);
        expect(calls.some((call) => call.method === 'composeForConfirm')).toBe(false);
    });

    it('dry-runs the action and payment output before signing the composed PSBT', async () => {
        const { utils, calls } = await mount();
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Review' })));
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Continue to confirmation' })));

        const compose = calls.find((call) => call.method === 'composeForConfirm');
        expect(compose.args.actionData).toEqual({
            action: 'COINPAY',
            params: { VERSION: '0', ORDER_MATCH_ACTION_INDEX: '648' },
        });
        expect(compose.args.encoderOpts.customOutputs).toEqual([{ address: PAYEE, value: 1_000_000_000 }]);
        expect(calls.some((call) => call.method === 'coinpayAction')).toBe(false);
        expect(utils.getByTestId('confirm-source').textContent).toContain(PAYER.slice(0, 6));

        await step(() => fireEvent.click(utils.container.querySelector('[data-testid="confirm-approve"]')));

        const preflightIndex = calls.findIndex((call) => call.method === 'preflight');
        const signIndex = calls.findIndex((call) => call.method === 'coinpayAction');
        expect(preflightIndex).toBeGreaterThan(-1);
        expect(signIndex).toBeGreaterThan(preflightIndex);
        expect(calls[signIndex].args).toMatchObject({
            orderMatchActionIndex: '648',
            payeeAddress: PAYEE,
            coinAmount: 1_000_000_000,
            prebuiltPsbt: { psbtHex: 'bb00', encoding: 'psbt' },
        });
    });

    it('keeps watcher mode on the obligation-verifying unsigned builder', async () => {
        const { utils, calls } = await mount({ walletMode: 'watcher' });
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Review' })));
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Create unsigned transaction' })));

        const build = calls.find((call) => call.method === 'buildCoinpayPsbtRequest');
        expect(build.args).toMatchObject({
            chainId: CHAIN,
            orderMatchActionIndex: '648',
            payeeAddress: PAYEE,
            coinAmount: 1_000_000_000,
        });
        expect(calls.some((call) => call.method === 'buildActionPsbtRequest')).toBe(false);
        expect(calls.some((call) => call.method === 'coinpayAction')).toBe(false);
    });

    it('announces a busy state and a successful broadcast', async () => {
        let finishCompose;
        const composeForConfirm = vi.fn(() => new Promise((resolve) => {
            finishCompose = resolve;
        }));
        const { utils } = await mount(undefined, { composeForConfirm });
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Review' })));

        fireEvent.click(utils.getByRole('button', { name: 'Continue to confirmation' }));
        expect(utils.getByRole('button', { name: 'Continue to confirmation' }).getAttribute('aria-busy'))
            .toBe('true');
        expect(utils.getByText('Preparing payment for confirmation…')).toBeTruthy();

        await domAct(async () => {
            finishCompose(COMPOSED);
            await drain();
        });
        await step(() => fireEvent.click(utils.getByTestId('confirm-approve')));

        expect(utils.getByText('Payment broadcast successfully.').closest('[role="status"]')).toBeTruthy();
        expect(utils.getByText(/Transaction:/).textContent).toContain('tx-coinpayAction');
    });
});
