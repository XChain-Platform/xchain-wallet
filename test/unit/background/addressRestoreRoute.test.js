// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §37.2 / Cluster D FOLLOWUP 2: the `addresses.restore` host route that
// backs the delete-address Undo toast, driven through the real host.
//
// The route exists because deleting an imported-WIF address is
// destructive from the user's seat, and the toast that offers to take
// it back leaves an 8 s window in which the vault can move underneath
// the snapshot the renderer is holding. Every case below is a way the
// vault can move; a route that only ever calls `addresses.put(snapshot)`
// passes none of them.

import { describe, it, expect } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';

const CHAIN = 'bitcoin-regtest';

function memCollection(seed = []) {
    const m = new Map();
    const copy = (v) => JSON.parse(JSON.stringify(v));
    for (const r of seed) m.set(r.id, copy(r));
    return {
        get: async (id) => (m.has(id) ? copy(m.get(id)) : null),
        put: async (rec) => { m.set(rec.id, copy(rec)); },
        list: async () => Array.from(m.values()).map(copy),
        delete: async (id) => m.delete(id),
        find: async (id) => (m.has(id) ? copy(m.get(id)) : null),
        findBy: async (k, v) => Array.from(m.values()).filter((r) => r[k] === v).map(copy),
    };
}

const addressRecord = (over = {}) => ({
    schemaVersion: 4,
    id: 'addr-1',
    accountId: null,
    chain: 'bitcoin',
    network: 'regtest',
    source: 'imported-wif',
    addressType: 'p2wpkh',
    derivationPath: null,
    address: 'bcrt1qexampleaddressone',
    publicKey: '02aa',
    label: 'Imported Address',
    pinned: false,
    hidden: false,
    signerId: 'w1',
    role: 'receive',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
});

function makeHost({ addresses = [], accounts } = {}) {
    const vault = {
        addresses: memCollection(addresses),
        ...(accounts ? { accounts: memCollection(accounts) } : {}),
        wallets: memCollection([{ id: 'w1', name: 'Main', importedKeys: [] }]),
        settings: { get: async () => ({ schemaVersion: 2 }), put: async () => {} },
    };
    const host = createBackgroundHost({
        vault,
        chainRegistry: {
            get: () => ({ id: CHAIN, coin: 'bitcoin', networkKind: 'regtest' }),
            list: () => [],
            chainIdFor: () => CHAIN,
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
    const call = async (type, request) => host.handle({ type, request });
    return { vault, call };
}

describe('addresses.restore puts a deleted address record back', () => {
    it('round-trips a delete: the record is gone, then it is back byte-for-byte', async () => {
        const rec = addressRecord();
        const h = makeHost({ addresses: [rec] });

        const del = await h.call('addresses.delete', { id: rec.id });
        expect(del.ok, JSON.stringify(del.error ?? {})).toBe(true);
        expect(await h.vault.addresses.get(rec.id)).toBe(null);

        const res = await h.call('addresses.restore', { address: rec });
        expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
        expect(res.result).toEqual({ ok: true, restored: true });
        expect(await h.vault.addresses.get(rec.id)).toEqual(rec);
    });

    it('carries unknown fields through verbatim so a schema addition survives the round-trip', async () => {
        const rec = addressRecord({ someFutureField: { nested: [1, 2] } });
        const h = makeHost({ addresses: [rec] });
        await h.call('addresses.delete', { id: rec.id });
        await h.call('addresses.restore', { address: rec });
        expect(await h.vault.addresses.get(rec.id)).toEqual(rec);
    });
});

describe('addresses.restore fails closed when the vault moved under the snapshot', () => {
    it('a second Undo press is a no-op success, not a re-put over the live record', async () => {
        const rec = addressRecord();
        const h = makeHost({ addresses: [rec] });
        await h.call('addresses.delete', { id: rec.id });
        await h.call('addresses.restore', { address: rec });

        // Between the two presses the user renamed the restored address.
        // A blind re-put would silently roll that rename back.
        const live = { ...rec, label: 'Renamed after restore' };
        await h.vault.addresses.put(live);

        const second = await h.call('addresses.restore', { address: rec });
        expect(second.result).toEqual({ ok: true, restored: false, reason: 'already-restored' });
        expect((await h.vault.addresses.get(rec.id)).label).toBe('Renamed after restore');
    });

    it('refuses when the same key was re-imported while the toast was up', async () => {
        const rec = addressRecord();
        const h = makeHost({ addresses: [rec] });
        await h.call('addresses.delete', { id: rec.id });
        // Re-import: same address string, brand-new record id.
        const reimported = addressRecord({ id: 'addr-2', label: 'Re-imported' });
        await h.vault.addresses.put(reimported);

        const res = await h.call('addresses.restore', { address: rec });
        expect(res.result).toEqual({ ok: false, restored: false, reason: 'address-already-present' });
        // One row for that address, not two.
        const rows = await h.vault.addresses.list();
        expect(rows.filter((r) => r.address === rec.address).map((r) => r.id)).toEqual(['addr-2']);
    });

    it('allows the same address string on a different network', async () => {
        const rec = addressRecord();
        const h = makeHost({ addresses: [rec] });
        await h.call('addresses.delete', { id: rec.id });
        await h.vault.addresses.put(addressRecord({ id: 'addr-other', network: 'testnet' }));

        const res = await h.call('addresses.restore', { address: rec });
        expect(res.result).toEqual({ ok: true, restored: true });
    });

    it('refuses to resurrect an address whose owning account was deleted', async () => {
        const rec = addressRecord({ id: 'addr-hd', accountId: 'acct-1', derivationPath: "m/84'/1'/0'/0/0", source: 'derived' });
        const h = makeHost({ addresses: [rec], accounts: [{ id: 'acct-1', walletId: 'w1' }] });
        await h.call('addresses.delete', { id: rec.id });
        // The wallet (and with it the account) was removed while the toast was up.
        await h.vault.accounts.delete('acct-1');

        const res = await h.call('addresses.restore', { address: rec });
        expect(res.result).toEqual({ ok: false, restored: false, reason: 'account-missing' });
        expect(await h.vault.addresses.get(rec.id)).toBe(null);
    });

    it('restores an account-bound address while its account still exists', async () => {
        const rec = addressRecord({ id: 'addr-hd', accountId: 'acct-1', derivationPath: "m/84'/1'/0'/0/0", source: 'derived' });
        const h = makeHost({ addresses: [rec], accounts: [{ id: 'acct-1', walletId: 'w1' }] });
        await h.call('addresses.delete', { id: rec.id });

        const res = await h.call('addresses.restore', { address: rec });
        expect(res.result).toEqual({ ok: true, restored: true });
    });
});

describe('addresses.restore rejects malformed requests', () => {
    it.each([
        ['no address', {}],
        ['non-object address', { address: 'bcrt1q…' }],
        ['no id', { address: { address: 'bcrt1q…' } }],
        ['no address string', { address: { id: 'addr-1' } }],
    ])('%s', async (_name, request) => {
        const h = makeHost();
        const res = await h.call('addresses.restore', request);
        expect(res.ok).toBe(false);
        expect(res.error.message).toMatch(/addresses\.restore/);
        expect(await h.vault.addresses.list()).toEqual([]);
    });
});
