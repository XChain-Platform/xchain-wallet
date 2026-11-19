// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The `addresses.byWallet` host route answers My Wallets search for every wallet
// in one call. The vault read count is fixed, so it is the same at 2 wallets as
// at 20, and only public address strings leave the host.

import { describe, it, expect } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';

const CHAIN = 'bitcoin-regtest';

function memCollection(seed, counter, name) {
    const m = new Map();
    for (const r of seed) m.set(r.id, JSON.parse(JSON.stringify(r)));
    const hit = (op) => { counter.reads.push(`${name}.${op}`); };
    return {
        get: async (id) => { hit('get'); return m.has(id) ? { ...m.get(id) } : null; },
        put: async (rec) => { m.set(rec.id, rec); },
        list: async () => { hit('list'); return Array.from(m.values()); },
        delete: async (id) => m.delete(id),
        find: async (id) => { hit('find'); return m.get(id) ?? null; },
        findBy: async (k, v) => { hit('findBy'); return Array.from(m.values()).filter((r) => r[k] === v); },
    };
}

function build(walletCount) {
    const counter = { reads: [] };
    const wallets = [];
    const accounts = [];
    const addresses = [];
    for (let i = 0; i < walletCount; i += 1) {
        const importedId = `imp-${i}`;
        wallets.push({ id: `w${i}`, name: `Wallet ${i}`, importedKeys: i === 0 ? [{ addressId: importedId }] : [] });
        accounts.push({ id: `acct-${i}`, walletId: `w${i}` });
        addresses.push({
            id: `a-${i}`, accountId: `acct-${i}`, chain: 'bitcoin', network: 'regtest',
            address: `bcrt1qADDR${i}`, label: 'secret label', publicKey: '02aa', derivationPath: "m/84'/1'/0'/0/0",
        });
    }
    // An imported key has no account; the wallet's importedKeys link it.
    addresses.push({
        id: 'imp-0', accountId: null, chain: 'bitcoin', network: 'regtest', address: 'bcrt1qIMPORTED', label: 'x',
    });
    const vault = {
        wallets: memCollection(wallets, counter, 'wallets'),
        accounts: memCollection(accounts, counter, 'accounts'),
        addresses: memCollection(addresses, counter, 'addresses'),
        settings: {
            get: async () => { counter.reads.push('settings.get'); return { schemaVersion: 2, activeNetwork: 'regtest' }; },
            put: async () => {},
        },
    };
    const host = createBackgroundHost({
        vault,
        chainRegistry: {
            get: () => ({ id: CHAIN, coin: 'bitcoin', networkKind: 'regtest' }),
            list: () => [],
            chainIdFor: () => CHAIN,
            descriptorFor: () => ({ id: CHAIN, networkKind: 'regtest' }),
        },
        sdkRegistry: { get: () => ({}), for: () => ({}) },
        signerPool: { get: () => null, has: () => false },
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        broadcastQueueStorage: { load: async () => ({}), save: async () => {}, clear: async () => {} },
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    return { counter, call: async (type, request) => host.handle({ type, request }) };
}

describe('addresses.byWallet', () => {
    /** @type {number[]} */
    const readCounts = [];
    for (const count of [2, 20]) {
        it(`reads the vault a fixed number of times at ${count} wallets`, async () => {
            const h = build(count);
            const res = await h.call('addresses.byWallet', {});
            expect(res.ok).toBe(true);
            expect(Object.keys(res.result)).toHaveLength(count);
            expect(res.result.w0).toEqual(['bcrt1qADDR0', 'bcrt1qIMPORTED']);
            expect(res.result[`w${count - 1}`]).toContain(`bcrt1qADDR${count - 1}`);
            // One bulk read per table, never a get or findBy per wallet.
            const tally = (name) => h.counter.reads.filter((r) => r === name).length;
            expect(tally('wallets.list')).toBe(1);
            expect(tally('accounts.list')).toBe(1);
            expect(tally('addresses.list')).toBe(1);
            expect(h.counter.reads.filter((r) => /\.(get|find|findBy)$/.test(r) && !r.startsWith('settings'))).toEqual([]);
            readCounts.push(h.counter.reads.length);
        });
    }

    it('makes the same number of reads at 2 and at 20 wallets', () => {
        expect(readCounts).toHaveLength(2);
        expect(readCounts[1]).toBe(readCounts[0]);
    });

    it('returns public address strings only', async () => {
        const h = build(2);
        const res = await h.call('addresses.byWallet', {});
        const text = JSON.stringify(res.result);
        expect(text).not.toContain('secret label');
        expect(text).not.toContain('02aa');
        expect(text).not.toContain("m/84'");
    });
});
