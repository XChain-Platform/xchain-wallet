// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Home's request count per open and per open hour, against two wallet sizes.
// A few assets and many assets must cost the same reads: every balance row
// arrives in the one wallet read, never one read per row.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, act, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';
import { ChainRegistry } from '../../../packages/core/src/registry/index.js';
import {
    BALANCE_CHECK_INTERVAL_MS,
    BALANCE_MAX_AGE_MS,
    _resetBatchSupportMemo,
    walletBalances,
} from '../../../packages/core/src/flows/balances.js';

const WALLET = { id: 'wallet-count', name: 'Count Wallet' };
const CHAIN_ID = 'bitcoin-mainnet';
const ADDRESSES = ['bc1qcountone', 'bc1qcounttwo', 'bc1qcountthree'];

function tokenRows(address, count) {
    return Array.from({ length: count }, (_, i) => ({
        tick: `TOK${i}`, quantity: String(1000 + i), divisibility: 0,
    }));
}

function memCollection(rows) {
    const m = new Map(rows.map((r) => [r.id, r]));
    return {
        get: async (id) => m.get(id) || null,
        list: async () => [...m.values()],
        findBy: async (f, v) => [...m.values()].filter((r) => r[f] === v),
    };
}

// A vault with one account, three addresses on one chain, and no pending sends.
function fakeVault() {
    return {
        wallets: memCollection([{ id: WALLET.id, schemaVersion: 1, name: WALLET.name, importedKeys: [] }]),
        accounts: memCollection([{ id: 'acct-1', walletId: WALLET.id, index: 0, name: 'Main' }]),
        addresses: memCollection(ADDRESSES.map((address, i) => ({
            id: `addr-${i}`, accountId: 'acct-1', chain: 'bitcoin', network: 'mainnet', source: 'hd',
            addressType: 'p2wpkh', derivationPath: `m/84'/0'/0/0/${i}`, label: 'A', address,
        }))),
        pendingTxs: memCollection([]),
    };
}

// Counts every explorer request the real balance aggregator makes.
function countingSdk(tokensPerAddress) {
    const calls = [];
    const sdk = {
        getBalancesBatch: async (addresses) => {
            calls.push('getBalancesBatch');
            const out = {};
            for (const address of addresses) {
                out[address] = {
                    address: { balances: { confirmed: '0.5', pending: '0' } },
                    balances: { data: tokenRows(address, tokensPerAddress), total: tokensPerAddress },
                    error: null,
                };
            }
            return out;
        },
        getAddress: async () => { calls.push('getAddress'); return { balances: { confirmed: '0.5' } }; },
        getBalances: async () => { calls.push('getBalances'); return { data: [], total: 0 }; },
    };
    return { sdk, calls };
}

function mountHome(tokensPerAddress) {
    _resetBatchSupportMemo();
    const chainRegistry = new ChainRegistry();
    const { sdk, calls: sdkCalls } = countingSdk(tokensPerAddress);
    const vault = fakeVault();
    const messagingCalls = [];
    const base = {
        listWallets: async () => [WALLET],
        listAccounts: async () => [],
        getSettings: async () => ({ activeNetwork: 'mainnet' }),
        getActiveAddresses: async () => ({}),
        getAddressesByChain: async () => ({ [CHAIN_ID]: ADDRESSES.map((address) => ({ address })) }),
        getWalletBalances: (walletId, accountId) => walletBalances({
            vault, chainRegistry, sdkRegistry: { get: () => sdk }, walletId, accountId, activeNetwork: 'mainnet',
        }),
    };
    // Every member the screen asks for is counted; one the stub lacks answers empty.
    const messaging = new Proxy(base, {
        get(target, prop) {
            if (typeof prop !== 'string' || prop === 'then') return Reflect.get(target, prop);
            const own = Reflect.get(target, prop);
            const fn = typeof own === 'function' ? own : async () => [];
            return (...args) => { messagingCalls.push(prop); return fn(...args); };
        },
        has: () => true,
    });
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(Home, { activeWalletId: WALLET.id }),
        ),
    );
    return { sdkCalls, messagingCalls };
}

const settle = async () => {
    for (let i = 0; i < 5; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await act(async () => { await Promise.resolve(); });
    }
};

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    try { localStorage.clear(); } catch { /* no DOM storage */ }
});

// Local reads (the wallet list and settings) re-run on renders and are left
// out; every other member counts, explorer-backed or not.
const LOCAL_READS = new Set(['listWallets', 'getSettings']);

function byMethod(calls) {
    const out = {};
    for (const name of calls) {
        if (!LOCAL_READS.has(name)) out[name] = (out[name] ?? 0) + 1;
    }
    return out;
}

async function openCounts(tokensPerAddress) {
    const counts = mountHome(tokensPerAddress);
    await waitFor(() => expect(counts.sdkCalls.length).toBeGreaterThan(0));
    await settle();
    const result = { sdk: counts.sdkCalls.length, calls: byMethod(counts.messagingCalls) };
    cleanup();
    localStorage.clear();
    return result;
}

describe('Home request count', () => {
    it('one open costs the same reads for 2 assets as for 60', async () => {
        const few = await openCounts(2);
        const many = await openCounts(60);
        expect(few.calls.getWalletBalances).toBe(1);
        // One batch read covers the three addresses on the chain.
        expect(few.sdk).toBe(1);
        expect(many.sdk).toBe(few.sdk);
        expect(many.calls).toEqual(few.calls);
    });

    it('ten open minutes cost two balance refreshes, not one per beat', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
        const counts = mountHome(2);
        await waitFor(() => expect(counts.sdkCalls.length).toBe(1));
        await settle();
        // Steps finer than the check, so every check and focus window is crossed.
        const STEP_MS = 10_000;
        for (let i = 0; i < (10 * 60_000) / STEP_MS; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await act(async () => { vi.advanceTimersByTime(STEP_MS); });
            // eslint-disable-next-line no-await-in-loop
            await settle();
        }
        const refreshes = byMethod(counts.messagingCalls).getWalletBalances - 1;
        expect(refreshes).toBe(Math.floor((10 * 60_000) / BALANCE_MAX_AGE_MS));
        expect(counts.sdkCalls.length).toBe(1 + refreshes);
        expect(BALANCE_CHECK_INTERVAL_MS).toBeLessThan(BALANCE_MAX_AGE_MS);
    });
});
