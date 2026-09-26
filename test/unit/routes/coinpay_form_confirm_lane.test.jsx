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

function makeMessaging(settings = { walletMode: 'full' }) {
    const calls = [];
    const log = (method, value) => (args) => {
        calls.push({ method, args });
        return Promise.resolve(value);
    };
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [OWNER] }),
        getCoinpayObligationsForAddress: () => Promise.resolve([OBLIGATION]),
        getSettings: () => Promise.resolve(settings),
        signerReady: () => Promise.resolve({ ready: true }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        composeForConfirm: log('composeForConfirm', COMPOSED),
        preflight: log('preflight', PASS),
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

async function mount(settings) {
    const { messaging, calls } = makeMessaging(settings);
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
    return { utils, calls };
}

async function step(fn) {
    await domAct(async () => {
        fn();
        await drain();
    });
}

describe('CoinpayForm shared confirmation', () => {
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
});
