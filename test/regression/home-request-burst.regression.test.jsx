// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: Home explorer request bursts.
//
//   [P0] 2026-10-13: A cold Home load fanned five addresses and ten token
//        holdings into repeated explorer reads, then concurrent callers
//        amplified a 429 retry into a second request burst.

import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    _resetBatchSupportMemo,
    walletBalances,
} from '../../packages/core/src/flows/balances.js';
import {
    HostRateLimiter,
    installExplorerRateLimit,
} from '../../packages/core/src/sdk/explorerRateLimit.js';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';
import { Home } from '../../packages/core/src/shared/routes/Home.jsx';

const WALLET_ID = 'request-budget-wallet';
const ACCOUNT_ID = 'request-budget-account';
const CHAIN_ID = 'bitcoin-regtest';
const COLD_HOME_EXPLORER_REQUEST_CEILING = 1;
const ADDRESSES = Array.from({ length: 5 }, (_, index) => `bcrt1qrequestbudget${index}`);
const TOKENS = Array.from({ length: 10 }, (_, index) => `BURST${index}`);

function memCollection(initial = []) {
    const records = new Map(initial.map((record) => [record.id, structuredClone(record)]));
    return {
        get: async (id) => (records.has(id) ? structuredClone(records.get(id)) : null),
        list: async () => [...records.values()].map((record) => structuredClone(record)),
        findBy: async (field, value) => [...records.values()]
            .filter((record) => record[field] === value)
            .map((record) => structuredClone(record)),
    };
}

function makeVault() {
    return {
        wallets: memCollection([{
            id: WALLET_ID,
            name: 'Request Budget Wallet',
            schemaVersion: 1,
            importedKeys: [],
        }]),
        accounts: memCollection([{
            id: ACCOUNT_ID,
            walletId: WALLET_ID,
            name: 'Main',
            index: 0,
        }]),
        addresses: memCollection(ADDRESSES.map((address, index) => ({
            id: `address-${index}`,
            accountId: ACCOUNT_ID,
            chain: 'bitcoin',
            network: 'regtest',
            source: 'hd',
            addressType: 'p2wpkh',
            derivationPath: `m/84'/1'/0'/0/${index}`,
            label: `Address ${index + 1}`,
            address,
        }))),
    };
}

const chainRegistry = {
    chainIdFor: (coin, networkKind) => (
        coin === 'bitcoin' && networkKind === 'regtest' ? CHAIN_ID : null
    ),
    descriptorFor: (chainId) => (chainId === CHAIN_ID
        ? { id: CHAIN_ID, coin: 'bitcoin', networkKind: 'regtest' }
        : null),
};

function batchBody(addresses) {
    return Object.fromEntries(addresses.map((address, addressIndex) => [address, {
        address: { balances: { confirmed: '1.00000000', pending: '0.00000000' } },
        balances: {
            total: 2,
            data: TOKENS.slice(addressIndex * 2, addressIndex * 2 + 2).map((tick) => ({
                tick,
                amount: '1',
                decimals: 0,
            })),
        },
        error: null,
    }]));
}

function ok(data) {
    return { status: 200, headers: {}, data };
}

function rateLimited(retryAfter) {
    const error = new Error('Request failed with status code 429');
    error.response = {
        status: 429,
        headers: { 'retry-after': String(retryAfter) },
        data: null,
    };
    return error;
}

function explorerSdk({ limiter, get = async () => ok({}), post = async () => ok({}) }) {
    const networkGet = vi.fn(get);
    const networkPost = vi.fn(post);
    const explorer = {
        client: {
            defaults: { baseURL: 'https://explorer.test/BTC/api' },
            get: networkGet,
            post: networkPost,
        },
        async get(path, config) {
            return (await this.client.get(path, config)).data;
        },
        async post(path, body, config) {
            return (await this.client.post(path, body, config)).data;
        },
    };
    const sdk = {
        explorer,
        getBalancesBatch(addresses, opts) {
            return this.explorer.post('/balances', { addresses }, opts);
        },
    };
    installExplorerRateLimit(sdk, limiter);
    return { sdk, networkGet, networkPost };
}

function fakeClockLimiter() {
    let now = 1_760_000_000_000;
    const sleeps = [];
    const limiter = new HostRateLimiter({
        now: () => now,
        sleep: async (ms) => {
            sleeps.push(ms);
            now += ms;
        },
        random: () => 0,
    });
    return { limiter, sleeps };
}

beforeEach(() => {
    localStorage.clear();
    _resetBatchSupportMemo();
});

afterEach(() => {
    cleanup();
    localStorage.clear();
});

describe('regression/home-request-burst', () => {
    it('[REGRESSION P0] keeps a five-address, ten-token cold Home load under its explorer ceiling', async () => {
        const limiter = new HostRateLimiter();
        const { sdk, networkGet, networkPost } = explorerSdk({
            limiter,
            post: async (_path, body) => ok(batchBody(body.addresses)),
        });
        const getWalletBalances = vi.fn((walletId, accountId) => walletBalances({
            vault: makeVault(),
            walletId,
            accountId,
            chainRegistry,
            sdkRegistry: { get: () => sdk },
        }));
        const messaging = {
            listWallets: vi.fn(async () => [{ id: WALLET_ID, name: 'Request Budget Wallet' }]),
            listAccounts: vi.fn(async () => [{
                id: ACCOUNT_ID,
                walletId: WALLET_ID,
                name: 'Main',
                index: 0,
            }]),
            getWalletBalances,
            getAddressesByChain: vi.fn(async () => ({
                [CHAIN_ID]: ADDRESSES.map((address) => ({ address })),
            })),
            getActiveAddresses: vi.fn(async () => ({})),
            getSettings: vi.fn(async () => ({
                activeNetwork: 'regtest',
                fiatCurrency: 'USD',
                privacy: { metadataFetchEnabled: false, priceDataEnabled: false },
            })),
        };

        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <Home activeWalletId={WALLET_ID} activeAccountId={ACCOUNT_ID} />
            </MessagingProvider>,
        );

        await waitFor(() => expect(getWalletBalances).toHaveBeenCalledTimes(1));
        const balances = await getWalletBalances.mock.results[0].value;
        const entries = balances[CHAIN_ID];
        const tokenTicks = entries.flatMap((entry) => entry.balances.tokens.map((token) => token.tick));
        const explorerRequests = networkGet.mock.calls.length + networkPost.mock.calls.length;

        expect(entries).toHaveLength(5);
        expect(new Set(tokenTicks)).toEqual(new Set(TOKENS));
        expect(networkPost.mock.calls[0][1]).toEqual({ addresses: ADDRESSES });
        expect(explorerRequests).toBeLessThanOrEqual(COLD_HOME_EXPLORER_REQUEST_CEILING);
    });

    it('[REGRESSION P0] shares one physical request between duplicate in-flight explorer reads', async () => {
        let release;
        let started;
        const requestStarted = new Promise((resolve) => { started = resolve; });
        const responseGate = new Promise((resolve) => { release = resolve; });
        const { sdk, networkGet } = explorerSdk({
            limiter: new HostRateLimiter(),
            get: async () => {
                started();
                await responseGate;
                return ok({ height: 42 });
            },
        });

        const first = sdk.explorer.get('/status');
        const second = sdk.explorer.get('/status');
        await requestStarted;

        expect(networkGet).toHaveBeenCalledTimes(1);
        release();
        await expect(Promise.all([first, second])).resolves.toEqual([
            { height: 42 },
            { height: 42 },
        ]);
        expect(networkGet).toHaveBeenCalledTimes(1);
    });

    it('[REGRESSION P0] honours Retry-After once for a concurrent duplicate burst', async () => {
        const { limiter, sleeps } = fakeClockLimiter();
        let sends = 0;
        const { sdk, networkGet } = explorerSdk({
            limiter,
            get: async () => {
                sends += 1;
                if (sends === 1) throw rateLimited(3);
                return ok({ rows: ['landed'] });
            },
        });

        // The burst coalesces into one send; a 429 is surfaced, not retried,
        // and the host pause it names is honoured once by the next request.
        const results = await Promise.allSettled(Array.from(
            { length: 8 },
            () => sdk.explorer.get('/balances/bcrt1qduplicate'),
        ));

        expect(results.map((result) => result.status)).toEqual(Array(8).fill('rejected'));
        for (const result of results) {
            expect(result.reason).toMatchObject({ response: { status: 429 } });
        }
        expect(networkGet).toHaveBeenCalledTimes(1);

        await expect(sdk.explorer.get('/balances/bcrt1qduplicate')).resolves.toEqual({ rows: ['landed'] });
        expect(networkGet).toHaveBeenCalledTimes(2);
        expect(sleeps).toEqual([3_000]);
    });
});
