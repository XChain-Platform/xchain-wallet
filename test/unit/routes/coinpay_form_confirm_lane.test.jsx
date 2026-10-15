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
const PAYER = 'ndevmockaaaaaaaaaaaaaaaaaaaaaaaa';
const PAYEE = 'ndevmockbbbbbbbbbbbbbbbbbbbbbbbb';
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

async function mount(settings, overrides, formProps = {}) {
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
                ...formProps,
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
    it.each([
        {
            name: 'unknown network',
            row: OBLIGATION,
            owner: OWNER,
            chainId: 'unknown-testnet',
            message: 'This payment uses a network the wallet does not recognize. Return to Payments due and refresh.',
        },
        {
            name: 'paying address',
            row: { ...OBLIGATION, payer_address: 'not-an-address' },
            owner: { ...OWNER, address: 'not-an-address' },
            message: 'The paying address is not valid for this network. Return to Payments due and refresh.',
        },
        {
            name: 'matched order number',
            row: { ...OBLIGATION, action_index: '   ' },
            owner: OWNER,
            actionIndex: '   ',
            message: 'This payment has no matched order number. Return to Payments due and refresh.',
        },
        {
            name: 'recipient address',
            row: { ...OBLIGATION, payee_address: '' },
            owner: OWNER,
            message: 'This payment has no recipient address. Return to Payments due and refresh.',
        },
        {
            name: 'malformed recipient address',
            row: { ...OBLIGATION, payee_address: 'not-an-address' },
            owner: OWNER,
            message: 'This address has a typo. Check it and try again.',
        },
        {
            name: 'amount',
            row: { ...OBLIGATION, coin_amount: '1e3' },
            owner: OWNER,
            message: 'This payment amount is missing, invalid, or too large to pay safely. Return to Payments due and refresh.',
        },
        {
            name: 'deadline',
            row: { ...OBLIGATION, expiration: null },
            owner: OWNER,
            message: 'This payment has no valid deadline. Return to Payments due and refresh.',
        },
    ])('validates the $name before review with plain guidance', async ({
        row, owner, chainId = CHAIN, actionIndex = '648', message,
    }) => {
        const { utils, calls } = await mount(undefined, {
            getAddressesByChain: () => Promise.resolve({ [chainId]: [owner] }),
            getCoinpayObligationsForAddress: () => Promise.resolve([row]),
        }, {
            chainId,
            address: owner.address,
            orderMatchActionIndex: actionIndex,
        });

        expect(utils.getByText(message)).toBeTruthy();
        expect(utils.getByRole('button', { name: 'Review' }).disabled).toBe(true);
        expect(calls.some((call) => call.method === 'composeForConfirm')).toBe(false);
    });

    it('blocks an invalid custom fee, then keeps the valid fee and selection across Back', async () => {
        const { utils, calls } = await mount();
        await step(() => fireEvent.change(
            utils.getByRole('slider', { name: 'Network fee' }),
            { target: { value: '3' } },
        ));
        const customRate = utils.getByRole('textbox', { name: 'Custom fee rate (DOGE/kB)' });

        await step(() => fireEvent.change(customRate, { target: { value: '' } }));
        expect(utils.getByText('Choose a valid network fee before continuing.')).toBeTruthy();
        expect(utils.getByRole('button', { name: 'Review' }).disabled).toBe(true);

        await step(() => fireEvent.change(customRate, { target: { value: '2' } }));
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Review' })));
        expect(utils.getByText('Network fee rate').nextElementSibling.textContent)
            .toBe('2 DOGE/kB');

        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Back to previous screen' })));
        expect(utils.getByRole('textbox', { name: 'Custom fee rate (DOGE/kB)' }).value).toBe('2');
        expect(utils.getByRole('button', { name: 'Review' }).disabled).toBe(false);
        expect(utils.getByText('Amount').nextElementSibling.textContent).toBe('10 DOGE');

        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Review' })));
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Continue to confirmation' })));
        const compose = calls.find((call) => call.method === 'composeForConfirm');
        expect(compose.args.encoderOpts.feePerKb).toBe(200_000_000);
    });

    it('shows loading and empty scan states without technical detail', async () => {
        let finishScan;
        const heldScan = new Promise((resolve) => { finishScan = resolve; });
        const { utils } = await mount(undefined, {
            getCoinpayObligationsForAddress: () => heldScan,
        });

        expect(utils.getByText('Scanning for payments due…')).toBeTruthy();
        expect(utils.queryByText('No payments due')).toBeNull();

        await domAct(async () => {
            finishScan([]);
            await drain();
        });
        expect(utils.getByText('No payments due')).toBeTruthy();
        expect(utils.queryByText('Scanning for payments due…')).toBeNull();
    });

    it('turns a failed obligation scan into plain copy instead of an empty result', async () => {
        const { utils } = await mount(undefined, {
            getCoinpayObligationsForAddress: () => Promise.reject(
                new Error('Explorer returned HTTP 502 for /private/wire/path'),
            ),
        });

        expect(utils.getByText(/temporarily unavailable \(error 502\)/i)).toBeTruthy();
        expect(utils.queryByText(/private\/wire\/path/)).toBeNull();
        expect(utils.queryByText('No payments due')).toBeNull();
    });

    it('turns a failed wallet-address load into plain copy', async () => {
        const { utils } = await mount(undefined, {
            getAddressesByChain: () => Promise.reject(
                new Error('database adapter failed at /private/wire/path'),
            ),
        });

        expect(utils.getByText(
            "Couldn't load this wallet's addresses. Check your connection and try again.",
        )).toBeTruthy();
        expect(utils.queryByText(/database adapter|private\/wire\/path/i)).toBeNull();
    });

    it('turns an unclassified compose failure into plain copy', async () => {
        const { utils } = await mount(undefined, {
            composeForConfirm: () => Promise.reject(
                new Error('internal encoder failure at /private/wire/path'),
            ),
        });
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Review' })));
        await step(() => fireEvent.click(
            utils.getByRole('button', { name: 'Continue to confirmation' }),
        ));

        expect(utils.getByText(
            "Couldn't prepare this payment. Check your connection and try again.",
        )).toBeTruthy();
        expect(utils.queryByText(/internal encoder|private\/wire\/path/i)).toBeNull();
    });

    it('removes the previous wallet selection while the next wallet loads', async () => {
        let finishWalletTwo;
        const walletTwoAddresses = new Promise((resolve) => { finishWalletTwo = resolve; });
        const payerTwo = 'ndevmockcccccccccccccccccccccccc';
        const { utils, messaging } = await mount(undefined, {
            getAddressesByChain: (walletId) => (walletId === 'wallet-2'
                ? walletTwoAddresses
                : Promise.resolve({ [CHAIN]: [OWNER] })),
        });
        expect(utils.getByText('Amount').nextElementSibling.textContent).toBe('10 DOGE');

        await domAct(async () => {
            utils.rerender(React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(CoinpayForm, {
                    walletId: 'wallet-2',
                    chainId: CHAIN,
                    address: payerTwo,
                    orderMatchActionIndex: '999',
                    onBack() {},
                }),
            ));
            await drain();
        });

        expect(utils.getByText('Loading addresses…')).toBeTruthy();
        expect(utils.queryByText('10 DOGE')).toBeNull();
        expect(utils.queryByText(PAYEE.slice(0, 6))).toBeNull();

        await domAct(async () => {
            finishWalletTwo({ [CHAIN]: [{ ...OWNER, address: payerTwo }] });
            await drain();
        });
    });

    it('shows the payer, recipient, amount, timestamp deadline, and expiry loss warning', async () => {
        const { utils } = await mount();
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Review' })));

        expect(utils.getByText('From').nextElementSibling.textContent).toContain(PAYER.slice(0, 6));
        expect(utils.getByText('Paying to').nextElementSibling.textContent).toContain(PAYEE.slice(0, 6));
        expect(utils.getByText('Amount').nextElementSibling.textContent).toBe('10 DOGE');
        expect(utils.queryByText(/Pay 10 DOGE to complete matched order/)).toBeNull();
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
