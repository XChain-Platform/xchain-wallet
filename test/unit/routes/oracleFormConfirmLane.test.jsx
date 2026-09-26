// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// OracleForm on the shared confirm lane. A PRICE publish cannot be withdrawn
// for 24 hours, so these pin that the network pre-flight runs before signing
// and can stop it, that the review shows what the decoder shows (memo, fee as
// a percent), that a pending quote is never called current, that COIN may
// name another chain, and that the form opens on the last-used chain.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act as domAct, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { OracleForm } from '../../../packages/core/src/shared/routes/OracleForm.jsx';
import { ORACLE_ACTIVATION_DELAY_S } from '../../../packages/core/src/flows/oracleQueries.js';
import { decodeAction } from '../../../packages/core/src/decoder/actionDecoder.js';

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
const REFUSED = Object.freeze({
    verdict: 'fail',
    findings: [{ severity: 'error', overridable: false, code: 'INVALID_FIELD_VALUE', message: 'The network would refuse this action.' }],
});

async function drainMicrotasks(rounds = 12) {
    for (let i = 0; i < rounds; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
}

function feedWith({ live = null, pending = null }) {
    const now = Math.floor(Date.now() / 1000);
    const quote = (value, effective) => ({
        key: 'BTC/PEPECASH/USD', coin: 'BTC', tick: 'PEPECASH', fiat: 'USD', value, fee: null,
        blockTime: effective ? now - 2 * ORACLE_ACTIVATION_DELAY_S : now - 3600,
        effectiveAt: effective ? now - ORACLE_ACTIVATION_DELAY_S : now + ORACLE_ACTIVATION_DELAY_S - 3600,
        effective, secondsUntilEffective: effective ? null : ORACLE_ACTIVATION_DELAY_S - 3600,
        memo: null, actionIndex: 100,
    });
    return [{
        key: 'BTC/PEPECASH/USD', coin: 'BTC', tick: 'PEPECASH', fiat: 'USD',
        live: live ? quote(live, true) : null,
        pending: pending ? quote(pending, false) : null,
        history: [],
    }];
}

/**
 * Every host call is recorded in order, so a test can prove the pre-flight
 * ran before the sign dispatch rather than merely at some point.
 */
function recordingMessaging({
    byChain = { 'bitcoin-mainnet': [BTC_ADDRESS] },
    settings = { walletMode: 'full' },
    feeds = [],
    consumers = { supported: true, dispensers: [] },
    preflight = PASS,
    describe = false,
    signerStatus = 'unlocked',
} = {}) {
    const calls = [];
    const log = (method, value) => (args) => { calls.push({ method, args }); return Promise.resolve(value); };
    const target = {
        getAddressesByChain: () => Promise.resolve(byChain),
        getActiveAddresses: () => Promise.resolve({}),
        signerReady: () => Promise.resolve({ ready: true }),
        getSettings: () => Promise.resolve(settings),
        getSignerStatus: () => Promise.resolve({ status: signerStatus }),
        oracleFeeds: log('oracleFeeds', feeds),
        oracleConsumers: log('oracleConsumers', consumers),
        // `describe` stands in for the host's sdk describer of the composed bytes.
        composeForConfirm: (args) => {
            calls.push({ method: 'composeForConfirm', args });
            return Promise.resolve({
                ...COMPOSED,
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

async function mountForm({ formProps = { initialChainId: 'bitcoin-mainnet' }, ...opts } = {}) {
    const { messaging, calls } = recordingMessaging(opts);
    let utils;
    await domAct(async () => {
        utils = render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(OracleForm, { walletId: 'w', onBack() {}, ...formProps }),
        ));
        await drainMicrotasks();
    });
    return { utils, calls };
}

async function step(fn) {
    await domAct(async () => { fn(); await drainMicrotasks(); });
}

async function fill(utils, { tick = 'PEPECASH', value = '0.05', fee, memo, coin } = {}) {
    if (coin) await step(() => fireEvent.change(utils.getByLabelText(/^Token's chain/), { target: { value: coin } }));
    await step(() => fireEvent.change(utils.getByLabelText(/^Token ticker/), { target: { value: tick } }));
    await step(() => fireEvent.change(utils.getByLabelText(/^Price of one/), { target: { value } }));
    if (fee) await step(() => fireEvent.change(utils.getByLabelText(/^Usage fee/), { target: { value: fee } }));
    if (memo) await step(() => fireEvent.change(utils.getByLabelText(/^Memo/), { target: { value: memo } }));
}

const approveButton = (utils) => utils.container.querySelector('[data-testid="confirm-approve"]');

async function publishAndApprove(utils, label = 'Publish price') {
    await step(() => fireEvent.click(utils.getByRole('button', { name: label })));
    const approve = approveButton(utils);
    if (approve && !approve.disabled) await step(() => fireEvent.click(approve));
}

const indexOf = (calls, method) => calls.findIndex((c) => c.method === method);

describe('OracleForm publishes through the confirm lane', () => {
    it('runs the network pre-flight before it signs, and signs the composed bytes', async () => {
        const { utils, calls } = await mountForm();
        await fill(utils, { fee: '0.01' });
        await publishAndApprove(utils);

        const compose = calls.find((c) => c.method === 'composeForConfirm');
        expect(compose, 'the publish was composed for the confirm page').toBeTruthy();
        expect(compose.args.actionData).toEqual({
            action: 'PRICE',
            params: { VERSION: '1', COIN: 'BTC', TICK: 'PEPECASH', FIAT: 'USD', VALUE: '0.05', FEE: '0.01' },
        });
        expect(indexOf(calls, 'preflight'), 'pre-flight ran').toBeGreaterThanOrEqual(0);
        expect(indexOf(calls, 'oraclePriceAction'), 'signed on Approve').toBeGreaterThan(indexOf(calls, 'preflight'));
        const sign = calls.find((c) => c.method === 'oraclePriceAction');
        expect(sign.args.prebuiltPsbt).toMatchObject({ psbtHex: 'aa00', encoding: 'psbt' });
    });

    it('blocks the signature when the pre-flight says the network would refuse it', async () => {
        const { utils, calls } = await mountForm({ preflight: REFUSED });
        await fill(utils);
        await publishAndApprove(utils);

        expect(calls.some((c) => c.method === 'preflight')).toBe(true);
        expect(approveButton(utils)?.disabled, 'Approve stays disabled on a hard refusal').toBe(true);
        expect(calls.some((c) => c.method === 'oraclePriceAction' || c.method === 'oraclePriceActionHw')).toBe(false);
    });

    it('signs a hardware source on the device lane with the same composed bytes', async () => {
        const { utils, calls } = await mountForm({
            byChain: { 'bitcoin-mainnet': [HW_ADDRESS] },
            signerStatus: 'available',
            formProps: { initialChainId: 'bitcoin-mainnet', initialFromAddress: HW_ADDRESS.address },
        });
        await fill(utils);
        await publishAndApprove(utils);

        expect(indexOf(calls, 'oraclePriceActionHw')).toBeGreaterThan(indexOf(calls, 'preflight'));
        const sign = calls.find((c) => c.method === 'oraclePriceActionHw');
        expect(sign.args.signerId).toBe('signer-hw');
        expect(sign.args.prebuiltPsbt).toMatchObject({ psbtHex: 'aa00' });
        expect(sign.args.password, 'no password rides the device lane').toBeUndefined();
        expect(calls.some((c) => c.method === 'oraclePriceAction')).toBe(false);
    });

    it('keeps watcher mode on its unsigned build, with no signature to pre-flight', async () => {
        const { utils, calls } = await mountForm({ settings: { walletMode: 'watcher' } });
        await fill(utils);
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Preview' })));
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Create unsigned transaction' })));

        expect(calls.find((c) => c.method === 'buildActionPsbtRequest').args.actionData.action).toBe('PRICE');
        expect(calls.some((c) => c.method === 'composeForConfirm')).toBe(false);
    });
});

describe('OracleForm review shows the decoder rows', () => {
    it('lists the memo and the fee as a percent on the watcher review', async () => {
        const { utils } = await mountForm({ settings: { walletMode: 'watcher' } });
        await fill(utils, { fee: '0.01', memo: 'wallet QA oracle test' });
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Preview' })));

        expect(utils.getByText('Memo')).toBeTruthy();
        expect(utils.getByText('wallet QA oracle test')).toBeTruthy();
        expect(utils.getByText(/0\.01 \(1% of a dispenser's projected proceeds\)/)).toBeTruthy();
    });

    it('lists the memo and the fee as a percent on the confirm page', async () => {
        const { utils } = await mountForm({ describe: true });
        await fill(utils, { fee: '0.01', memo: 'wallet QA oracle test' });
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Publish price' })));

        expect(utils.getByText('wallet QA oracle test')).toBeTruthy();
        expect(utils.getByText(/1% of a dispenser's projected proceeds/)).toBeTruthy();
    });
});

describe('OracleForm wording for a quote still maturing', () => {
    it('calls a pending-only prior quote pending, and never says it is selling', async () => {
        const { utils } = await mountForm({ feeds: feedWith({ pending: '0.05' }) });
        await fill(utils, { value: '0.055' });
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Publish price' })));

        expect(utils.getByText('Pending price')).toBeTruthy();
        expect(utils.queryByText('Current price')).toBeNull();
        expect(utils.queryByText(/current price keeps selling/i)).toBeNull();
        expect(utils.getByText(/Nothing sells on this pair yet/)).toBeTruthy();
    });

    it('keeps the current-price wording when a quote is live', async () => {
        const { utils } = await mountForm({ feeds: feedWith({ live: '0.05' }) });
        await fill(utils, { value: '0.055' });
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Publish price' })));

        expect(utils.getByText('Current price')).toBeTruthy();
        expect(utils.getByText(/current price keeps selling/i)).toBeTruthy();
    });
});

describe('OracleForm cross-chain COIN', () => {
    const DOGE = { byChain: { 'dogecoin-mainnet': [DOGE_ADDRESS] }, formProps: { initialChainId: 'dogecoin-mainnet' } };

    it('defaults COIN to the publishing chain', async () => {
        const { utils, calls } = await mountForm(DOGE);
        await fill(utils);
        await publishAndApprove(utils);
        expect(calls.find((c) => c.method === 'oraclePriceAction').args.params.COIN).toBe('DOGE');
    });

    it('publishes a BTC token price from a DOGE address when BTC is picked', async () => {
        const { utils, calls } = await mountForm(DOGE);
        await fill(utils, { coin: 'BTC' });
        await publishAndApprove(utils);

        const sign = calls.find((c) => c.method === 'oraclePriceAction');
        expect(sign.args.chainId, 'still published on the DOGE chain').toBe('dogecoin-mainnet');
        expect(sign.args.params.COIN, 'the quote prices the BTC token').toBe('BTC');
        expect(calls.find((c) => c.method === 'composeForConfirm').args.actionData.params.COIN).toBe('BTC');
    });

    it('does not show an all-clear it could not check for another chain\'s dispensers', async () => {
        const { utils } = await mountForm(DOGE);
        await fill(utils, { coin: 'BTC' });
        await step(() => fireEvent.click(utils.getByRole('button', { name: 'Publish price' })));
        expect(utils.queryByText(/No open dispensers price/)).toBeNull();
        expect(utils.getByText(/Could not check which dispensers use this oracle/)).toBeTruthy();
    });
});

describe('OracleForm chain default', () => {
    it('opens on the last-used chain when no chain is passed in', async () => {
        const { calls } = await mountForm({
            byChain: { 'bitcoin-mainnet': [BTC_ADDRESS], 'litecoin-mainnet': [LTC_ADDRESS] },
            settings: { walletMode: 'full', activeNetwork: 'mainnet', lastUsedChain: { mainnet: 'litecoin-mainnet' } },
            formProps: {},
        });
        const firstFeeds = calls.find((c) => c.method === 'oracleFeeds');
        expect(firstFeeds.args).toEqual({ chainId: 'litecoin-mainnet', address: LTC_ADDRESS.address });
    });
});
