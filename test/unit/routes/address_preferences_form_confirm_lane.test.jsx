// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ADDRESS keeps its fresh-baseline preference review, then composes through
// the shared confirm lane. This pins the network dry run, From disclosure,
// and exact-PSBT handoff that the former direct-sign review omitted.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act as domAct, cleanup, fireEvent, render } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AddressPreferencesForm } from '../../../packages/core/src/shared/routes/AddressPreferencesForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qpreferenceowner0000000000000000000';
const OWNER = Object.freeze({
    id: 'address-1',
    address: ADDRESS,
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
const PREFERENCES = Object.freeze({
    feePreference: 2,
    requireMemo: 0,
    dispenserPreference: 1,
    onChain: true,
});
const COMPOSED = Object.freeze({ psbt: 'aa00', encoding: 'psbt', actionString: 'ADDRESS|0', version: 1 });
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

function makeMessaging() {
    const calls = [];
    const log = (method, value) => (args) => {
        calls.push({ method, args });
        return Promise.resolve(value);
    };
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [OWNER] }),
        getActiveAddresses: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        getAddressPreferences: () => Promise.resolve(PREFERENCES),
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
                return log(String(prop), { txid: `tx-${String(prop)}` });
            },
        }),
    };
}

async function step(fn) {
    await domAct(async () => {
        fn();
        await drain();
    });
}

describe('AddressPreferencesForm shared confirmation', () => {
    it('dry-runs and identifies the signer before signing the composed PSBT', async () => {
        const { messaging, calls } = makeMessaging();
        let utils;
        await domAct(async () => {
            utils = render(React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(AddressPreferencesForm, {
                    walletId: 'wallet-1', chainId: CHAIN, address: ADDRESS, onBack() {},
                }),
            ));
            await drain();
        });

        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Review' })));
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Continue to confirmation' })));

        const compose = calls.find((call) => call.method === 'composeForConfirm');
        expect(compose.args.actionData).toEqual({
            action: 'ADDRESS',
            params: { FEE_PREFERENCE: '2', REQUIRE_MEMO: '0', DISPENSER_PREFERENCE: '1' },
        });
        expect(calls.some((call) => call.method === 'addressPreferencesAction')).toBe(false);
        expect(utils.getByTestId('confirm-source').textContent).toContain(ADDRESS.slice(0, 6));

        await step(() => fireEvent.click(utils.container.querySelector('[data-testid="confirm-approve"]')));

        const preflightIndex = calls.findIndex((call) => call.method === 'preflight');
        const signIndex = calls.findIndex((call) => call.method === 'addressPreferencesAction');
        expect(preflightIndex).toBeGreaterThan(-1);
        expect(signIndex).toBeGreaterThan(preflightIndex);
        expect(calls[signIndex].args.prebuiltPsbt).toMatchObject({ psbtHex: 'aa00', encoding: 'psbt' });
    });
});
