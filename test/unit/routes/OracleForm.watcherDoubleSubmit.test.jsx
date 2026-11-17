// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A watcher-mode PRICE review builds one unsigned transaction per submit. Two
// submits in one turn (a double press of Enter or the button) build two
// unsigned publishes of the same price, and a Signer-mode wallet that signs
// both pays for both; the second is inert for 24 hours anyway.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act as domAct, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';

afterEach(() => { resetWalletModes(); });
import { OracleForm } from '../../../packages/core/src/shared/routes/OracleForm.jsx';
import { ORACLE_ACTIVATION_DELAY_S } from '../../../packages/core/src/flows/oracleQueries.js';
beforeEach(() => {
    vi.useFakeTimers({
        toFake: [
            'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
            'setImmediate', 'clearImmediate', 'requestAnimationFrame',
            'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
        ],
    });
});

const BTC_ADDRESS = Object.freeze({
    id: 'addr-btc-0',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
const LTC_ADDRESS = Object.freeze({ ...BTC_ADDRESS, id: 'addr-ltc-0', address: 'ltc1qexampleexampleexampleexampleexampleex' });
const DOGE_ADDRESS = Object.freeze({ ...BTC_ADDRESS, id: 'addr-doge-0', address: 'DExampleExampleExampleExampleExamp' });
const HW_ADDRESS = Object.freeze({ ...BTC_ADDRESS, id: 'addr-hw-0', source: 'trezor', signerId: 'signer-hw' });

const COMPOSED = Object.freeze({ psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 1 });
const PASS = Object.freeze({ verdict: 'pass', findings: [] });

async function drainMicrotasks(rounds = 12) {
    for (let i = 0; i < rounds; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
}
function recordingMessaging({
    byChain = { 'bitcoin-mainnet': [BTC_ADDRESS] },
    walletMode = 'full',
    feeds = [],
    consumers = { supported: true, dispensers: [] },
    preflight = PASS,
    describe = false,
    composed = COMPOSED,
    composeError = null,
    signerStatus = 'unlocked',
} = {}) {
    const calls = [];
    // The wallet's mode is read from the wallet list, not from settings.
    publishWalletModes({ wallets: [{ id: 'w', walletMode }], activeWalletId: 'w' });
    const log = (method, value) => (args) => { calls.push({ method, args }); return Promise.resolve(value); };
    const target = {
        getAddressesByChain: () => Promise.resolve(byChain),
        getActiveAddresses: () => Promise.resolve({}),
        signerReady: () => Promise.resolve({ ready: true }),
        getSettings: () => Promise.resolve({}),
        listWallets: () => Promise.resolve([{ id: 'w', name: 'W', walletMode }]),
        getSignerStatus: () => Promise.resolve({ status: signerStatus }),
        oracleFeeds: log('oracleFeeds', feeds),
        oracleConsumers: log('oracleConsumers', consumers),
        // `describe` stands in for the host's sdk describer of the composed bytes.
        composeForConfirm: (args) => {
            calls.push({ method: 'composeForConfirm', args });
            if (composeError) return Promise.reject(composeError);
            return Promise.resolve({
                ...composed,
                ...(describe ? { decoded: decodeAction({ ...args.actionData, chainId: args.chainId }) } : {}),
            });
        },
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

// The Token field takes no typed text (G122), so the ticker arrives at mount.
async function mountForm({ formProps = { initialChainId: 'bitcoin-mainnet' }, tick = 'PEPECASH', ...opts } = {}) {
    const { messaging, calls } = recordingMessaging(opts);
    let utils;
    await domAct(async () => {
        utils = render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(OracleForm, { walletId: 'w', onBack() {}, initialTick: tick, ...formProps }),
        ));
        await drainMicrotasks();
    });
    return { utils, calls };
}

async function step(fn) {
    await domAct(async () => { fn(); await drainMicrotasks(); });
}

async function fill(utils, { tick = 'PEPECASH', value = '0.05', fee, memo, coin } = {}) {
    if (coin) {
        // The priced token's network is the standard network field: open its
        // picker screen and take the row for that coin's chain.
        const chainName = { BTC: 'Bitcoin', LTC: 'Litecoin', DOGE: 'Dogecoin' }[coin];
        await step(() => fireEvent.click(utils.getByRole('button', { name: /^Priced token network:/ })));
        await step(() => fireEvent.click(utils.getByRole('button', { name: new RegExp(`^Select ${chainName}\\b`) })));
    }
    // The ticker came in at mount; the Token field shows it.
    expect(utils.getByRole('button', { name: new RegExp(`^Token: ${tick} on `) })).toBeTruthy();
    await step(() => fireEvent.change(utils.getByLabelText(/^Price of one/), { target: { value } }));
    if (fee) await step(() => fireEvent.change(utils.getByLabelText(/^Usage fee/), { target: { value: fee } }));
    if (memo) await step(() => fireEvent.change(utils.getByLabelText(/^Memo/), { target: { value: memo } }));
}

describe('OracleForm watcher review', () => {
    it('builds one unsigned publish for two submits in one turn', async () => {
        const { utils, calls } = await mountForm({ walletMode: 'watcher' });
        await fill(utils);
        expect(utils.getByRole('button', { name: /^Publish price$/i })).toBeTruthy();
        await step(() => fireEvent.click(utils.getByRole('button', { name: /^Publish price$/i })));
        expect(utils.getByText(
            'Another phone signs for this wallet: this prepares the transaction for it. Sign it there, then bring the signed transaction to a wallet that can broadcast it.',
        )).toBeTruthy();
        expect(utils.getByTestId('confirm-facts').textContent).toContain('Affected dispensers');
        expect(utils.getByRole('button', { name: 'Reject' })).toBeTruthy();
        expect(utils.queryByText(/Estimate unavailable/)).toBeNull();
        const build = utils.getByRole('button', { name: 'Approve' });
        await step(() => {
            fireEvent.click(build);
            fireEvent.click(build);
        });

        expect(calls.filter((c) => c.method === 'buildActionPsbtRequest')).toHaveLength(1);
    });
});
