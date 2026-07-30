// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// D-145: "My oracle" published on whichever chain the wallet listed first.
//
// A PRICE v1 quote is scoped to one chain three times over - the COIN it
// carries, the tick it prices, and the dispensers allowed to read it - and
// the publishing-address picker under the field is itself chain-scoped, so
// there was no way to cross chains from inside the form. On a wallet holding
// more than one chain that makes the oracle's chain an accident of ordering,
// and the mistake is invisible: a quote published on the wrong chain renders
// perfectly and prices nothing, for 24 hours, un-retractably.
//
// This is D-133's fault in a second place (the order form), so the pin is
// deliberately the same shape as that one: prove the field is mounted, and
// prove the composed action follows it.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act as domAct, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { OracleForm } from '../../../packages/core/src/shared/routes/OracleForm.jsx';

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

const BTC_ADDRESS = Object.freeze({
    id: 'addr-btc-0',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

const LTC_ADDRESS = Object.freeze({
    id: 'addr-ltc-0',
    address: 'ltc1qexampleexampleexampleexampleexampleex',
    publicKey: '02ddeeff',
    derivationPath: "m/84'/2'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

async function drainMicrotasks(rounds = 8) {
    for (let i = 0; i < rounds; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
}

function recordingMessaging() {
    const calls = [];
    const record = (method) => (args) => {
        calls.push({ method, args });
        return Promise.resolve({ txid: `tx-${method}` });
    };
    const target = {
        // Bitcoin first, which is what made the old form publish there.
        getAddressesByChain: () => Promise.resolve({
            'bitcoin-mainnet': [BTC_ADDRESS],
            'litecoin-mainnet': [LTC_ADDRESS],
        }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        oracleFeeds: (args) => { calls.push({ method: 'oracleFeeds', args }); return Promise.resolve([]); },
        oracleConsumers: (args) => {
            calls.push({ method: 'oracleConsumers', args });
            return Promise.resolve({ supported: true, dispensers: [] });
        },
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

async function mountForm() {
    const { messaging, calls } = recordingMessaging();
    let utils;
    await domAct(async () => {
        utils = render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                // No initialChainId: this is the palette's entry, the one that
                // has to fall back to a choice the user can see and change.
                React.createElement(OracleForm, { walletId: 'w', onBack() {} }),
            ),
        );
        await drainMicrotasks();
    });
    return { utils, calls };
}

async function pickChain(utils, label) {
    await domAct(async () => {
        fireEvent.click(utils.getByRole('button', { name: /^Network:/ }));
        await drainMicrotasks();
    });
    await domAct(async () => {
        fireEvent.click(utils.getByRole('option', { name: new RegExp(`^${label}\\b`) }));
        await drainMicrotasks();
    });
}

async function publish(utils, { tick, value }) {
    await domAct(async () => {
        fireEvent.change(utils.getByLabelText(/^Token ticker/), { target: { value: tick } });
        await drainMicrotasks();
    });
    await domAct(async () => {
        fireEvent.change(utils.getByLabelText(/^Price of one/), { target: { value } });
        await drainMicrotasks();
    });
    await domAct(async () => {
        fireEvent.click(utils.getByRole('button', { name: 'Preview' }));
        await drainMicrotasks();
    });
    await domAct(async () => {
        const btn = Array.from(utils.container.querySelectorAll('button'))
            .filter((b) => b.type === 'submit' && !b.disabled)
            .pop();
        if (btn) fireEvent.click(btn);
        await drainMicrotasks();
    });
}

describe('D-145: OracleForm chain picker', () => {
    it('renders a Network field listing every chain the wallet holds addresses on', async () => {
        const { utils } = await mountForm();
        const field = utils.getByRole('button', { name: /^Network:/ });
        expect(field, 'the oracle form mounts no chain picker at all, so the publishing '
            + 'chain is whichever one the wallet lists first').toBeTruthy();

        await domAct(async () => {
            fireEvent.click(field);
            await drainMicrotasks();
        });
        expect(utils.getByRole('option', { name: /^Litecoin\b/ }),
            'a chain the wallet holds addresses on is not offered as a publishing chain')
            .toBeTruthy();
    });

    it('publishes on the picked chain, with that chain\'s coin and address', async () => {
        const { utils, calls } = await mountForm();
        await pickChain(utils, 'Litecoin');
        await publish(utils, { tick: 'pepecash', value: '0.05' });

        const pub = calls.find((c) => c.method === 'oraclePriceAction');
        expect(pub, 'nothing was dispatched').toBeTruthy();
        expect(pub.args.chainId,
            'the publish went to a chain other than the one picked').toBe('litecoin-mainnet');
        // COIN is the half that decides which dispensers can ever read this
        // quote, so it is asserted separately from chainId: a publish routed
        // to the right chain carrying BTC prices nothing on it.
        expect(pub.args.params.COIN,
            'the PRICE carries the wrong chain coin, so no dispenser on the picked chain '
            + 'can read it').toBe('LTC');
        expect(pub.args.from.address,
            'the publish signed with an address from the wrong chain').toBe(LTC_ADDRESS.address);
    });

    it('re-reads the feed and consumer lists for the newly picked chain', async () => {
        // The lists under the field are the operator's only view of what they
        // already publish. Left on the old chain they would show another
        // chain's feeds beside this chain's form, which is worse than empty.
        const { utils, calls } = await mountForm();
        await pickChain(utils, 'Litecoin');

        const feeds = calls.filter((c) => c.method === 'oracleFeeds').pop();
        expect(feeds.args).toEqual({ chainId: 'litecoin-mainnet', address: LTC_ADDRESS.address });
        const consumers = calls.filter((c) => c.method === 'oracleConsumers').pop();
        expect(consumers.args).toEqual({ chainId: 'litecoin-mainnet', address: LTC_ADDRESS.address });
    });
});
