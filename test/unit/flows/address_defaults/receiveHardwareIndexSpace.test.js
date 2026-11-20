// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A hardware account inside a counterwallet-legacy wallet derives each
// address type on its own BIP44/84 branch, so its receive addresses keep one
// index space per type and never need the legacy cross-type history probe.

import { describe, expect, it } from 'vitest';
import { receiveAddress } from '../../../../packages/core/src/flows/receiveAddress.js';
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
    coin: 'bitcoin', networkKind: 'regtest', defaultAddressType: 'p2wpkh', addressTypes: ['p2pkh', 'p2wpkh'],
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

function trezorP2pkh() {
    return [0, 1, 2].map((i) => createAddress({
        accountId: 'acct-b', chain: 'bitcoin', network: 'regtest', source: 'trezor', addressType: 'p2pkh',
        derivationPath: `m/44'/0'/1'/0/${i}`, address: `trezor-p2pkh-${i}`, publicKey: `trezor-pub-${i}`,
    }));
}

describe('receiveAddress index space for a hardware account in a legacy wallet', () => {
    it('keeps a hardware account in a legacy wallet on per-type branches', async () => {
        const vault = {
            wallets: memCollection([{ id: 'w1', format: 'counterwallet-legacy' }]),
            accounts: memCollection(ACCOUNTS),
            addresses: memCollection(trezorP2pkh()),
        };

        const rec = await receiveAddress({
            vault, walletId: 'w1', signer: makeSigner('trezor'), chainRegistry, sdkRegistry: offlineSdk,
            chainId: 'bitcoin', accountId: 'acct-b', addressType: 'p2wpkh',
        });

        expect(rec.derivationPath).toBe("m/84'/0'/1'/0/0");
        expect(rec.source).toBe('trezor');
    });

    it('refuses a software signer for the hardware-owned account before derivation', async () => {
        const signer = makeSigner('software');
        let derivations = 0;
        const derive = signer.getAddresses;
        signer.getAddresses = async (params) => { derivations += 1; return derive(params); };
        const vault = {
            wallets: memCollection([{ id: 'w1', format: 'counterwallet-legacy' }]),
            accounts: memCollection(ACCOUNTS),
            addresses: memCollection(trezorP2pkh()),
        };

        await expect(receiveAddress({
            vault, walletId: 'w1', signer, chainRegistry, sdkRegistry: offlineSdk,
            chainId: 'bitcoin', accountId: 'acct-b', addressType: 'p2wpkh',
        })).rejects.toThrow(/does not own account/i);
        expect(derivations).toBe(0);
    });
});
