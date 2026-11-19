// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A hardware account inside a counterwallet-legacy wallet derives each
// address type on its own BIP44/49/84 branch, so its dispenser addresses
// keep one index space per type. The legacy wallet's own seed account still
// shares one index space across types.

import { describe, expect, it } from 'vitest';
import { dispenserAddress } from '../../../../packages/core/src/flows/dispenserAddress.js';
import { createAddress } from '../../../../packages/core/src/schemas/address.js';

function memCollection(initial = []) {
    const m = new Map(initial.map((r) => [r.id, structuredClone(r)]));
    return {
        get: async (id) => (m.has(id) ? structuredClone(m.get(id)) : null),
        put: async (rec) => { m.set(rec.id, structuredClone(rec)); },
        list: async () => Array.from(m.values()).map((r) => structuredClone(r)),
        findBy: async (field, value) =>
            Array.from(m.values()).filter((r) => r[field] === value).map((r) => structuredClone(r)),
    };
}

const PURPOSE_BY_TYPE = { p2pkh: 44, p2wpkh: 84 };
const DESCRIPTOR = {
    coin: 'bitcoin', networkKind: 'regtest', defaultAddressType: 'p2wpkh', addressTypes: ['p2wpkh', 'p2pkh'],
};
const chainRegistry = { get: (id) => (id === 'bitcoin' ? DESCRIPTOR : null) };
const offlineSdk = {
    get: () => ({ explorer: { getHistory: async () => { throw new Error('offline'); } } }),
};
const ACCOUNTS = [
    { schemaVersion: 1, id: 'acct-a', walletId: 'w1', name: 'A', index: 0, createdAt: '2026-01-01T00:00:00.000Z' },
    { schemaVersion: 1, id: 'acct-b', walletId: 'w1', name: 'B', index: 1, createdAt: '2026-01-01T00:00:00.000Z' },
];

function makeSigner(kind) {
    return {
        id: `${kind}-test`,
        kind,
        async getAddresses({ accountIndex, change, startIndex, addressType }) {
            const path = `m/${PURPOSE_BY_TYPE[addressType]}'/0'/${accountIndex}'/${change}/${startIndex}`;
            return [{ index: startIndex, address: `addr-${path}`, publicKey: `pub-${path}`, path }];
        },
        lock() {},
    };
}

function heldP2pkh(accountId, accountIndex, source) {
    return [0, 1, 2].map((i) => createAddress({
        accountId, chain: 'bitcoin', network: 'regtest', source, addressType: 'p2pkh',
        derivationPath: `m/44'/0'/${accountIndex}'/0/${i}`,
        address: `${source}-p2pkh-${i}`, publicKey: `${source}-pub-${i}`,
    }));
}

function legacyVault(addresses) {
    return {
        wallets: memCollection([{ id: 'w1', format: 'counterwallet-legacy' }]),
        accounts: memCollection(ACCOUNTS),
        addresses: memCollection(addresses),
    };
}

describe('dispenserAddress index space for a hardware account in a legacy wallet', () => {
    it('starts the p2wpkh branch at index 0 past held p2pkh indices, with the explorer offline', async () => {
        const vault = legacyVault(heldP2pkh('acct-b', 1, 'trezor'));

        const rec = await dispenserAddress({
            vault, walletId: 'w1', signer: makeSigner('trezor'), chainRegistry, sdkRegistry: offlineSdk,
            chainId: 'bitcoin', accountId: 'acct-b', addressType: 'p2wpkh',
        });

        expect(rec.derivationPath).toBe("m/84'/0'/1'/0/0");
        expect(rec.source).toBe('trezor');
    });

    it('keeps the legacy seed account on one shared index space', async () => {
        const vault = legacyVault(heldP2pkh('acct-a', 0, 'hd'));

        await expect(dispenserAddress({
            vault, walletId: 'w1', signer: makeSigner('software'), chainRegistry, sdkRegistry: offlineSdk,
            chainId: 'bitcoin', accountId: 'acct-a', addressType: 'p2wpkh',
        })).rejects.toThrow('Dispenser address history is unavailable for this legacy wallet.');
    });
});
