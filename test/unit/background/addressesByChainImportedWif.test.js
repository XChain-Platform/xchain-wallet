// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Wallet E2E session 16 / D-63, at the host boundary: `importWif` writes
// its Address record with accountId=null (§11.3.3's carve-out for
// imported keys), while `addresses.byChain` kept only addresses whose
// accountId matched an account of the wallet. The two halves of one
// convention disagreed, so every WIF-imported key was invisible on every
// surface that reads this map - the function's own comment lists Home,
// History, AddressList, Send and every action form's chain picker. The
// import reported success and named the right address, and the address
// then appeared nowhere.
//
// Same shape as : the allocating side and the selecting side have
// to agree, so both directions are pinned here.

import { describe, it, expect } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';

function memCollection(initial = []) {
    const m = new Map(initial.map((r) => [r.id, JSON.parse(JSON.stringify(r))]));
    return {
        get: async (id) => (m.has(id) ? JSON.parse(JSON.stringify(m.get(id))) : null),
        put: async (rec) => { m.set(rec.id, JSON.parse(JSON.stringify(rec))); },
        list: async () => Array.from(m.values()).map((r) => JSON.parse(JSON.stringify(r))),
        delete: async (id) => { m.delete(id); },
        find: async (id) => (m.has(id) ? JSON.parse(JSON.stringify(m.get(id))) : null),
        findBy: async (field, value) => Array.from(m.values())
            .filter((r) => r[field] === value)
            .map((r) => JSON.parse(JSON.stringify(r))),
    };
}

const DESCRIPTORS = [
    { id: 'bitcoin-regtest', coin: 'bitcoin', networkKind: 'regtest', defaultAddressType: 'p2wpkh', addressTypes: ['p2wpkh', 'p2pkh'] },
];

const chainRegistry = {
    has: (id) => DESCRIPTORS.some((d) => d.id === id),
    get: (id) => DESCRIPTORS.find((d) => d.id === id),
    descriptorFor: (id) => DESCRIPTORS.find((d) => d.id === id) || null,
    byNetworkKind: (kind) => DESCRIPTORS.filter((d) => d.networkKind === kind),
    chainIdFor: (coin, networkKind) => (
        DESCRIPTORS.find((d) => d.coin === coin && d.networkKind === networkKind)?.id ?? null
    ),
    supportedChains: () => DESCRIPTORS,
};

const HD_ADDRESS = {
    id: 'addr-hd', accountId: 'acct-1', chain: 'bitcoin', network: 'regtest',
    source: 'hd', addressType: 'p2pkh', derivationPath: "m/0'/0/0", address: 'n2XDwu',
};
const IMPORTED_ADDRESS = {
    id: 'addr-wif', accountId: null, chain: 'bitcoin', network: 'regtest',
    source: 'imported-wif', addressType: 'p2pkh', derivationPath: null, address: 'mq1XCn',
};
// Belongs to a DIFFERENT wallet's importedKeys; must never leak into w1.
const OTHER_IMPORTED = {
    id: 'addr-wif-other', accountId: null, chain: 'bitcoin', network: 'regtest',
    source: 'imported-wif', addressType: 'p2pkh', derivationPath: null, address: 'mOTHER',
};

function makeHost({ importedKeys = [{ addressId: 'addr-wif' }], omitImportedKeys = false } = {}) {
    const w1 = { id: 'w1', schemaVersion: 1, name: 'Legacy Wallet', importedKeys };
    if (omitImportedKeys) delete w1.importedKeys;
    const vault = {
        wallets: memCollection([
            w1,
            { id: 'w2', schemaVersion: 1, name: 'Other Wallet', importedKeys: [{ addressId: 'addr-wif-other' }] },
        ]),
        accounts: memCollection([{ id: 'acct-1', walletId: 'w1', index: 0, name: 'Main' }]),
        addresses: memCollection([HD_ADDRESS, IMPORTED_ADDRESS, OTHER_IMPORTED]),
        signers: memCollection(),
        settings: {
            _rec: { schemaVersion: 1, activeNetwork: 'regtest', fees: {}, ads: { perChain: {} } },
            async get() { return JSON.parse(JSON.stringify(this._rec)); },
            async put(r) { this._rec = JSON.parse(JSON.stringify(r)); },
        },
    };
    const host = createBackgroundHost({
        vault,
        chainRegistry,
        sdkRegistry: { get: () => ({}) },
        signerPool: { get: () => null, has: () => false },
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    return host;
}

async function byChain(host, request) {
    const res = await host.handle({ type: 'addresses.byChain', request });
    expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
    return res.result;
}

describe('D-63: addresses.byChain surfaces imported-WIF addresses', () => {
    it('includes the imported key alongside the HD addresses', async () => {
        const map = await byChain(makeHost(), { walletId: 'w1' });
        const addresses = (map['bitcoin-regtest'] || []).map((a) => a.address);
        expect(addresses).toContain('n2XDwu');
        expect(addresses).toContain('mq1XCn');
    });

    it('never leaks another wallet\'s imported key', async () => {
        const map = await byChain(makeHost(), { walletId: 'w1' });
        const addresses = (map['bitcoin-regtest'] || []).map((a) => a.address);
        expect(addresses).not.toContain('mOTHER');
    });

    it('still includes the imported key when one account is requested', async () => {
        // Imported keys are wallet-scoped, not account-scoped, and
        // AddressList always passes the active account id - excluding them
        // here was the first, wrong version of this fix: it left the only
        // consumer that matters exactly as broken as before.
        const map = await byChain(makeHost(), { walletId: 'w1', accountId: 'acct-1' });
        const addresses = (map['bitcoin-regtest'] || []).map((a) => a.address);
        expect(addresses).toContain('n2XDwu');
        expect(addresses).toContain('mq1XCn');
    });

    it('still returns the HD addresses when the wallet has no imported keys', async () => {
        const map = await byChain(makeHost({ importedKeys: [] }), { walletId: 'w1' });
        const addresses = (map['bitcoin-regtest'] || []).map((a) => a.address);
        expect(addresses).toEqual(['n2XDwu']);
    });

    it('tolerates a wallet record with no importedKeys array at all', async () => {
        const map = await byChain(makeHost({ omitImportedKeys: true }), { walletId: 'w1' });
        expect((map['bitcoin-regtest'] || []).map((a) => a.address)).toEqual(['n2XDwu']);
    });
});
