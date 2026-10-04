// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act as domAct, fireEvent, render } from '@testing-library/react';
import React from 'react';
import {
    myOracleFeeds,
    ORACLE_SETTLEMENT_WINDOW_S,
} from '../../../packages/core/src/flows/oracleQueries.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { OracleForm } from '../../../packages/core/src/shared/routes/OracleForm.jsx';

const NOW = 1_800_000_000;

function row(effectiveAt) {
    return {
        coin: 'BTC',
        tick: 'PEPECASH',
        fiat: 'USD',
        value: '0.05',
        fee: '0.01',
        block_time: effectiveAt - 86400,
        effective_at: effectiveAt,
        action_index: 100,
        memo: null,
    };
}

async function feedAt(effectiveAt) {
    const sdk = { getOraclePrices: vi.fn(async () => ({ data: [row(effectiveAt)] })) };
    const [feed] = await myOracleFeeds({
        sdkRegistry: { get: () => sdk },
        chainId: 'bitcoin-regtest',
        address: 'oracle-addr',
        nowSec: NOW,
    });
    return feed;
}

async function drainMicrotasks(rounds = 12) {
    for (let i = 0; i < rounds; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
}

beforeEach(() => {
    vi.useFakeTimers({
        toFake: [
            'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
            'setImmediate', 'clearImmediate', 'requestAnimationFrame',
            'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
        ],
    });
});

afterEach(() => vi.useRealTimers());

describe('Mode B oracle settlement staleness', () => {
    it('returns a newly effective quote as live', async () => {
        const feed = await feedAt(NOW);

        expect(feed.live?.value).toBe('0.05');
        expect(feed.live?.secondsSinceEffective).toBe(0);
        expect(feed.stale).toBeNull();
    });

    it('returns a quote just inside the 24-hour window as live', async () => {
        const age = ORACLE_SETTLEMENT_WINDOW_S - 1;
        const feed = await feedAt(NOW - age);
        const boundaryFeed = await feedAt(NOW - ORACLE_SETTLEMENT_WINDOW_S);

        expect(feed.live?.secondsSinceEffective).toBe(age);
        expect(feed.stale).toBeNull();
        expect(boundaryFeed.live?.secondsSinceEffective).toBe(ORACLE_SETTLEMENT_WINDOW_S);
        expect(boundaryFeed.stale).toBeNull();
    });

    it('returns a quote just past the 24-hour window as stale', async () => {
        const age = ORACLE_SETTLEMENT_WINDOW_S + 1;
        const feed = await feedAt(NOW - age);

        expect(feed.live).toBeNull();
        expect(feed.stale?.value).toBe('0.05');
        expect(feed.stale?.secondsSinceEffective).toBe(age);
    });

    it('shows a stale quote with its age and never says it keeps selling', async () => {
        const feed = await feedAt(NOW - ORACLE_SETTLEMENT_WINDOW_S - 1);
        const address = {
            id: 'addr-btc-0',
            address: 'bc1qexampleexampleexampleexampleexampleex',
            publicKey: '02aabbcc',
            derivationPath: "m/84'/0'/0'/0/0",
            source: 'hd',
            signerId: 'signer-1',
        };
        const values = {
            getAddressesByChain: { 'bitcoin-mainnet': [address] },
            getActiveAddresses: {},
            signerReady: { ready: true },
            getSettings: { walletMode: 'full' },
            getSignerStatus: { status: 'unlocked' },
            oracleFeeds: [feed],
            oracleConsumers: { supported: true, dispensers: [] },
            preflight: { verdict: 'pass', findings: [] },
        };
        const messaging = new Proxy({
            composeForConfirm: vi.fn(async () => ({
                psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 1,
            })),
        }, {
            get(target, prop) {
                if (prop in target) return target[prop];
                return vi.fn(async () => values[prop] ?? { txid: `tx-${String(prop)}` });
            },
        });
        let utils;
        await domAct(async () => {
            utils = render(React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(OracleForm, {
                    walletId: 'w',
                    onBack() {},
                    initialChainId: 'bitcoin-mainnet',
                }),
            ));
            await drainMicrotasks();
        });

        expect(utils.getByText(/0\.05 USD stale \(24h 0m old\)/)).toBeTruthy();
        expect(utils.queryByText(/0\.05 USD live/)).toBeNull();

        await domAct(async () => {
            fireEvent.change(utils.getByLabelText(/^Token ticker/), { target: { value: 'PEPECASH' } });
            fireEvent.change(utils.getByLabelText(/^Price of one/), { target: { value: '0.055' } });
            await drainMicrotasks();
        });
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Publish price' }));
            await drainMicrotasks();
        });

        expect(utils.getByText('Stale price')).toBeTruthy();
        expect(utils.getByText(/24h 0m old/)).toBeTruthy();
        expect(utils.getByText(/previous effective price is stale/i)).toBeTruthy();
        expect(utils.queryByText(/current price keeps selling/i)).toBeNull();
    });
});
