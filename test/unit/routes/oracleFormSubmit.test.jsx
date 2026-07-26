// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-30 OracleForm: what it SENDS, and what it refuses to send.
//
// routes-render.test.jsx already proves this form mounts, flushes effects
// and survives interaction, and oracleFlows.test.js pins the flow layer.
// Neither covers the mapping in between: form fields -> PRICE v1 params,
// and the deviation gate that stands between a fat-fingered decimal and a
// price nobody can retract for 24 hours. That mapping is what breaks
// silently, because a wrong-cased ticker or a dropped FEE still renders
// perfectly.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act as domAct, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
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

const EMPTY = Object.freeze({});

const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

async function drainMicrotasks(rounds = 8) {
    for (let i = 0; i < rounds; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
}

// A live feed for BTC:PEPECASH/USD at 0.05, matured long ago, so the
// deviation check has a basis to compare against.
function liveFeed(value = '0.05') {
    const now = Math.floor(Date.now() / 1000);
    return [{
        key: 'BTC/PEPECASH/USD',
        coin: 'BTC', tick: 'PEPECASH', fiat: 'USD',
        live: {
            key: 'BTC/PEPECASH/USD', coin: 'BTC', tick: 'PEPECASH', fiat: 'USD',
            value, fee: '0.01',
            blockTime: now - 2 * ORACLE_ACTIVATION_DELAY_S,
            effectiveAt: now - ORACLE_ACTIVATION_DELAY_S,
            effective: true, secondsUntilEffective: null,
            memo: null, actionIndex: 100,
        },
        pending: null,
        history: [],
    }];
}

function recordingMessaging({ feeds = [], consumers = { supported: true, dispensers: [] } } = {}) {
    const calls = [];
    const record = (method) => (args) => {
        calls.push({ method, args });
        return Promise.resolve({ txid: `tx-${method}` });
    };
    const target = {
        getAddressesByChain: () => Promise.resolve({ 'bitcoin-mainnet': [HD_ADDRESS] }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        oracleFeeds: (args) => { calls.push({ method: 'oracleFeeds', args }); return Promise.resolve(feeds); },
        oracleConsumers: (args) => { calls.push({ method: 'oracleConsumers', args }); return Promise.resolve(consumers); },
        oraclePriceAction: record('oraclePriceAction'),
        oraclePriceActionHw: record('oraclePriceActionHw'),
        buildActionPsbtRequest: record('buildActionPsbtRequest'),
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve(EMPTY);
        },
    });
    return { messaging, calls };
}

async function mountForm(opts = {}) {
    const { messaging, calls } = recordingMessaging(opts);
    let utils;
    await domAct(async () => {
        utils = render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(OracleForm, {
                    walletId: 'w',
                    onBack() {},
                    initialChainId: 'bitcoin-mainnet',
                }),
            ),
        );
        await drainMicrotasks();
    });
    return { utils, calls };
}

async function fill(utils, { tick = 'pepecash', value = '0.05', fee } = {}) {
    await domAct(async () => {
        fireEvent.change(utils.getByLabelText(/^Token ticker/), { target: { value: tick } });
        await drainMicrotasks();
    });
    await domAct(async () => {
        fireEvent.change(utils.getByLabelText(/^Price of one/), { target: { value } });
        await drainMicrotasks();
    });
    if (fee !== undefined) {
        await domAct(async () => {
            fireEvent.change(utils.getByLabelText(/^Usage fee/), { target: { value: fee } });
            await drainMicrotasks();
        });
    }
}

async function preview(utils) {
    await domAct(async () => {
        fireEvent.click(utils.getByRole('button', { name: 'Preview' }));
        await drainMicrotasks();
    });
}

async function clickSubmit(utils) {
    await domAct(async () => {
        const btn = Array.from(utils.container.querySelectorAll('button'))
            .filter((b) => b.type === 'submit' && !b.disabled)
            .pop();
        if (btn) fireEvent.click(btn);
        await drainMicrotasks();
    });
}

describe('OracleForm submit payload', () => {
    it('composes PRICE v1 with the chain coin and an upper-cased ticker', async () => {
        const { utils, calls } = await mountForm();
        await fill(utils, { tick: 'pepecash', value: '0.05', fee: '0.01' });
        await preview(utils);
        await clickSubmit(utils);

        const pub = calls.find((c) => c.method === 'oraclePriceAction');
        expect(pub, 'oraclePriceAction was dispatched').toBeTruthy();
        expect(pub.args.chainId).toBe('bitcoin-mainnet');
        expect(pub.args.params).toEqual({
            VERSION: '1', COIN: 'BTC', TICK: 'PEPECASH', FIAT: 'USD', VALUE: '0.05', FEE: '0.01',
        });
        expect(pub.args.from).toMatchObject({
            address: HD_ADDRESS.address,
            addressId: 'addr-hd-0',
            derivationPath: HD_ADDRESS.derivationPath,
        });
    });

    // An omitted fee must be OMITTED, not sent empty: the oracle charges
    // nothing, and an empty field in a pipe-delimited action is a
    // different thing from an absent one.
    it('omits FEE and MEMO entirely when they are left blank', async () => {
        const { utils, calls } = await mountForm();
        await fill(utils, { tick: 'PEPECASH', value: '0.05' });
        await preview(utils);
        await clickSubmit(utils);

        const pub = calls.find((c) => c.method === 'oraclePriceAction');
        expect(Object.keys(pub.args.params).sort()).toEqual(['COIN', 'FIAT', 'TICK', 'VALUE', 'VERSION']);
    });

    it('reads the publisher feeds and consumers for the signing address', async () => {
        const { calls } = await mountForm();
        expect(calls.find((c) => c.method === 'oracleFeeds').args).toEqual({
            chainId: 'bitcoin-mainnet', address: HD_ADDRESS.address,
        });
        expect(calls.find((c) => c.method === 'oracleConsumers').args).toEqual({
            chainId: 'bitcoin-mainnet', address: HD_ADDRESS.address,
        });
    });
});

describe('OracleForm deviation gate', () => {
    // 0.05 -> 0.5 is the slipped decimal. It must not be signable on one
    // click, because the result is a price no one can withdraw for a day.
    it('blocks a slipped decimal behind a typed confirm', async () => {
        const { utils, calls } = await mountForm({ feeds: liveFeed('0.05') });
        await fill(utils, { tick: 'PEPECASH', value: '0.5' });
        await preview(utils);
        await clickSubmit(utils);
        expect(calls.some((c) => c.method === 'oraclePriceAction')).toBe(false);

        const field = utils.getByLabelText(/type publish to confirm/i);
        await domAct(async () => {
            fireEvent.change(field, { target: { value: 'PUBLISH' } });
            await drainMicrotasks();
        });
        await clickSubmit(utils);
        expect(calls.some((c) => c.method === 'oraclePriceAction')).toBe(true);
    });

    it('lets an ordinary repricing through with no typed confirm', async () => {
        const { utils, calls } = await mountForm({ feeds: liveFeed('0.05') });
        await fill(utils, { tick: 'PEPECASH', value: '0.055' });
        await preview(utils);
        expect(utils.queryByLabelText(/type publish to confirm/i)).toBeNull();
        await clickSubmit(utils);
        expect(calls.some((c) => c.method === 'oraclePriceAction')).toBe(true);
    });

    // No prior price means nothing to deviate FROM, so the gate must not
    // fire on a first publish; the 24h statement is what carries that case.
    it('does not gate a first publish, and says it prices nothing for a day', async () => {
        const { utils, calls } = await mountForm({ feeds: [] });
        await fill(utils, { tick: 'PEPECASH', value: '999' });
        await preview(utils);
        expect(utils.queryByLabelText(/type publish to confirm/i)).toBeNull();
        expect(utils.getByText(/will not price anything for 24 hours/i)).toBeTruthy();
        await clickSubmit(utils);
        expect(calls.some((c) => c.method === 'oraclePriceAction')).toBe(true);
    });
});

describe('OracleForm consumer disclosure', () => {
    it('names the dispensers that will reprice on this pair', async () => {
        const { utils } = await mountForm({
            feeds: liveFeed('0.05'),
            consumers: {
                supported: true,
                dispensers: [
                    { action_index: 1, give_tick: 'PEPECASH', give_amount: '100', address: 'bc1qdisp' },
                    { action_index: 2, give_tick: 'OTHERTOKEN', give_amount: '5', address: 'bc1qother' },
                ],
            },
        });
        await fill(utils, { tick: 'PEPECASH', value: '0.06' });
        await preview(utils);
        // Only the PEPECASH dispenser reprices; the other feed's is noise.
        expect(utils.getByText(/1 open dispenser price/i)).toBeTruthy();
    });

    // "Could not check" and "nobody is using it" must not render the same,
    // or an operator republishes on an all-clear the wallet never earned.
    it('says the check failed rather than showing an empty all-clear', async () => {
        const { utils } = await mountForm({
            feeds: liveFeed('0.05'),
            consumers: { supported: false, dispensers: [] },
        });
        await fill(utils, { tick: 'PEPECASH', value: '0.06' });
        await preview(utils);
        expect(utils.getByText(/Could not check which dispensers use this oracle/i)).toBeTruthy();
    });
});
