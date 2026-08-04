// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Shared vault/registry fixture for the two `addresses.byChain` unit files.
// They have to stay on the SAME wallet shape to mean anything together: one
// asserts the behaviour (imported keys are listed), the other asserts where
// that behaviour comes from (the shared resolver, not a local copy of the
// rule). A fixture that drifted between them would let the second file pass
// against a wallet the first never exercises.
//
// Not named `*.test.js`, so the unit runner does not collect it.

import { expect } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';

export function memCollection(initial = []) {
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

export const chainRegistry = {
    has: (id) => DESCRIPTORS.some((d) => d.id === id),
    get: (id) => DESCRIPTORS.find((d) => d.id === id),
    descriptorFor: (id) => DESCRIPTORS.find((d) => d.id === id) || null,
    byNetworkKind: (kind) => DESCRIPTORS.filter((d) => d.networkKind === kind),
    chainIdFor: (coin, networkKind) => (
        DESCRIPTORS.find((d) => d.coin === coin && d.networkKind === networkKind)?.id ?? null
    ),
    supportedChains: () => DESCRIPTORS,
};

export const HD_ADDRESS = {
    id: 'addr-hd', accountId: 'acct-1', chain: 'bitcoin', network: 'regtest',
    source: 'hd', addressType: 'p2pkh', derivationPath: "m/0'/0/0", address: 'n2XDwu',
};
export const IMPORTED_ADDRESS = {
    id: 'addr-wif', accountId: null, chain: 'bitcoin', network: 'regtest',
    source: 'imported-wif', addressType: 'p2pkh', derivationPath: null, address: 'mq1XCn',
};
// Belongs to a DIFFERENT wallet's importedKeys; must never leak into w1.
export const OTHER_IMPORTED = {
    id: 'addr-wif-other', accountId: null, chain: 'bitcoin', network: 'regtest',
    source: 'imported-wif', addressType: 'p2pkh', derivationPath: null, address: 'mOTHER',
};

export function makeHost({ importedKeys = [{ addressId: 'addr-wif' }], omitImportedKeys = false } = {}) {
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

export async function byChain(host, request) {
    const res = await host.handle({ type: 'addresses.byChain', request });
    expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
    return res.result;
}

export function addressesOn(map, chainId = 'bitcoin-regtest') {
    return (map[chainId] || []).map((a) => a.address);
}
