// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Issue #82: the balance reads behind the action forms must not hand a demo
// wallet's addresses to an explorer. A demo wallet now lands on mainnet, so a
// read that reaches the SDK sends them to the public mainnet explorer.
//
// The guard keys on the vault record's `origin`, not on `isDemoWallet()`,
// because these flows run in the host and the extension's background worker
// has no localStorage. These tests set NO localStorage on purpose: the guard
// must hold without it.
//
// Every SDK read method is a spy, the per-address pair AND the batch route,
// so "no request" is proven on both read paths.

import { describe, it, expect, vi } from 'vitest';
import { walletBalances, addressBalances } from '../../../packages/core/src/flows/balances.js';
import { synthesizeDemoBalances } from '../../../packages/core/src/flows/demoFixtures.js';

const MAIN = 'bitcoin-mainnet';
const LTC = 'litecoin-mainnet';
const DESCRIPTORS = [
    { id: MAIN, coin: 'bitcoin', networkKind: 'mainnet' },
    { id: LTC, coin: 'litecoin', networkKind: 'mainnet' },
];

const chainRegistry = {
    descriptorFor: (id) => DESCRIPTORS.find((d) => d.id === id) || null,
    chainIdFor: (coin, networkKind) => (
        DESCRIPTORS.find((d) => d.coin === coin && d.networkKind === networkKind)?.id ?? null
    ),
};

function memCollection(initial = []) {
    const m = new Map(initial.map((r) => [r.id, JSON.parse(JSON.stringify(r))]));
    return {
        get: async (id) => (m.has(id) ? JSON.parse(JSON.stringify(m.get(id))) : null),
        put: async (rec) => { m.set(rec.id, JSON.parse(JSON.stringify(rec))); },
        list: async () => Array.from(m.values()).map((r) => JSON.parse(JSON.stringify(r))),
        delete: async (id) => { m.delete(id); },
        findBy: async (field, value) => Array.from(m.values())
            .filter((r) => r[field] === value)
            .map((r) => JSON.parse(JSON.stringify(r))),
    };
}

function addr(id, accountId, chain, address, i) {
    return {
        id,
        accountId,
        chain,
        network: 'mainnet',
        source: 'hd',
        addressType: 'p2wpkh',
        derivationPath: `m/84'/0'/0'/0/${i}`,
        label: `Address ${i}`,
        address,
    };
}

/** Two wallets: `demo` (origin demo) and `real` (origin created). */
function makeVault() {
    return {
        wallets: memCollection([
            { id: 'demo', schemaVersion: 1, name: 'Demo', origin: 'demo', importedKeys: [] },
            { id: 'real', schemaVersion: 1, name: 'Real', origin: 'created', importedKeys: [] },
        ]),
        accounts: memCollection([
            { id: 'acct-demo', walletId: 'demo', index: 0, name: 'Main' },
            { id: 'acct-real', walletId: 'real', index: 0, name: 'Main' },
        ]),
        addresses: memCollection([
            addr('d0', 'acct-demo', 'bitcoin', 'bc1demo0', 0),
            addr('d1', 'acct-demo', 'bitcoin', 'bc1demo1', 1),
            addr('d2', 'acct-demo', 'litecoin', 'ltc1demo0', 0),
            addr('r0', 'acct-real', 'bitcoin', 'bc1real0', 0),
        ]),
        pendingTxs: memCollection([]),
    };
}

function spySdk() {
    return {
        getBalances: vi.fn(async () => ({ total: 1, data: [{ tick: 'XCHAIN', amount: '7', decimals: 0 }] })),
        getAddress: vi.fn(async () => ({ balances: { confirmed: '0.50000000' } })),
        getBalancesBatch: vi.fn(async (addresses) => Object.fromEntries(addresses.map((a) => [a, {
            balances: { total: 1, data: [{ tick: 'XCHAIN', amount: '7', decimals: 0 }] },
            address: { balances: { confirmed: '0.50000000' } },
            error: null,
        }]))),
    };
}

function expectNoRequest(sdk, registryGet) {
    expect(sdk.getBalances).not.toHaveBeenCalled();
    expect(sdk.getAddress).not.toHaveBeenCalled();
    expect(sdk.getBalancesBatch).not.toHaveBeenCalled();
    expect(registryGet).not.toHaveBeenCalled();
}

describe('walletBalances: demo wallet (issue #82)', () => {
    it('answers a demo wallet from its fixture with no network request', async () => {
        const vault = makeVault();
        const sdk = spySdk();
        const get = vi.fn(() => sdk);
        const out = await walletBalances({
            vault, walletId: 'demo', chainRegistry, sdkRegistry: { get },
        });
        expectNoRequest(sdk, get);

        // The same entries Home shows: synthesizeDemoBalances over the
        // wallet's own address records, grouped by chain in vault order.
        const records = await vault.addresses.list();
        const expected = synthesizeDemoBalances({
            [MAIN]: records.filter((r) => r.id === 'd0' || r.id === 'd1'),
            [LTC]: records.filter((r) => r.id === 'd2'),
        });
        expect(out).toEqual(expected);
        expect(out[MAIN][0].balances.native.tick).toBe('BTC');
        expect(Number(out[MAIN][0].balances.native.quantity)).toBeGreaterThan(0);
        expect(out[MAIN][1].balances.native.quantity).toBe('0');
        // The success shape: no `unavailable` flag, typed failure fields null.
        expect(out[MAIN][0].balances.unavailable).toBeUndefined();
        expect(out[MAIN][0].error).toBeNull();
        expect(out[MAIN][0].errorCode).toBeNull();
    });

    it('keeps the chain filter on the demo path', async () => {
        const sdk = spySdk();
        const get = vi.fn(() => sdk);
        const out = await walletBalances({
            vault: makeVault(), walletId: 'demo', chainRegistry, sdkRegistry: { get }, chainId: LTC,
        });
        expectNoRequest(sdk, get);
        expect(Object.keys(out)).toEqual([LTC]);
    });

    it('leaves a real wallet on the explorer read, unchanged', async () => {
        const sdk = spySdk();
        const get = vi.fn(() => sdk);
        const out = await walletBalances({
            vault: makeVault(), walletId: 'real', chainRegistry, sdkRegistry: { get },
        });
        expect(sdk.getBalancesBatch).toHaveBeenCalledTimes(1);
        expect(sdk.getBalancesBatch.mock.calls[0][0]).toEqual(['bc1real0']);
        expect(out[MAIN]).toHaveLength(1);
        expect(out[MAIN][0].balances).toEqual({
            native: { tick: 'BTC', quantity: '50000000', divisibility: 8 },
            tokens: [{ tick: 'XCHAIN', quantity: '7', divisibility: 0, displayName: 'XCHAIN', imageUrl: null }],
        });
    });
});

describe('addressBalances: demo wallet address (issue #82)', () => {
    it('answers the first demo address from the fixture with no network request', async () => {
        const vault = makeVault();
        const sdk = spySdk();
        const get = vi.fn(() => sdk);
        const shape = await addressBalances({
            vault, sdkRegistry: { get }, chainRegistry, chainId: MAIN, address: 'bc1demo0',
        });
        expectNoRequest(sdk, get);
        const home = await walletBalances({ vault, walletId: 'demo', chainRegistry, sdkRegistry: { get } });
        expect(shape).toEqual(home[MAIN][0].balances);
        expect(Number(shape.native.quantity)).toBeGreaterThan(0);
    });

    it('answers a later demo address with the zero row Home shows for it', async () => {
        const vault = makeVault();
        const sdk = spySdk();
        const get = vi.fn(() => sdk);
        const shape = await addressBalances({
            vault, sdkRegistry: { get }, chainRegistry, chainId: MAIN, address: 'bc1demo1',
        });
        expectNoRequest(sdk, get);
        expect(shape.native.quantity).toBe('0');
        expect(shape.tokens).toEqual([]);
    });

    it('reads a real wallet address from the explorer, unchanged', async () => {
        const sdk = spySdk();
        const get = vi.fn(() => sdk);
        const shape = await addressBalances({
            vault: makeVault(), sdkRegistry: { get }, chainRegistry, chainId: MAIN, address: 'bc1real0',
        });
        expect(sdk.getBalances).toHaveBeenCalledWith('bc1real0', undefined);
        expect(sdk.getAddress).toHaveBeenCalledWith('bc1real0');
        expect(shape.native).toEqual({ tick: 'BTC', quantity: '50000000', divisibility: 8 });
    });

    it('reads the explorer as before when the caller passes no vault', async () => {
        const sdk = spySdk();
        const get = vi.fn(() => sdk);
        await addressBalances({
            sdkRegistry: { get }, chainRegistry, chainId: MAIN, address: 'bc1demo0',
        });
        expect(sdk.getAddress).toHaveBeenCalledWith('bc1demo0');
    });
});
