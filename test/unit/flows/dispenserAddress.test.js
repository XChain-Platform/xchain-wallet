// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: §16 dispenser sub-address derivation. Asserts the change=2
// branch, contiguous index allocation, per-account isolation, and the
// role tag / path shape, against an in-memory vault + a fake signer.

import { describe, it, expect, beforeEach } from 'vitest';
import { dispenserAddress } from '../../../packages/core/src/flows/dispenserAddress.js';
import { createAddress } from '../../../packages/core/src/schemas/address.js';

function memCollection(initial = []) {
    const m = new Map(initial.map((r) => [r.id, JSON.parse(JSON.stringify(r))]));
    return {
        get: async (id) => (m.has(id) ? JSON.parse(JSON.stringify(m.get(id))) : null),
        put: async (rec) => { m.set(rec.id, JSON.parse(JSON.stringify(rec))); },
        list: async () => Array.from(m.values()).map((r) => JSON.parse(JSON.stringify(r))),
        delete: async (id) => { m.delete(id); },
        findBy: async (field, value) =>
            Array.from(m.values())
                .filter((r) => r[field] === value)
                .map((r) => JSON.parse(JSON.stringify(r))),
        _map: m,
    };
}

function makeVault({ accounts = [], addresses = [] } = {}) {
    return {
        accounts: memCollection(accounts),
        addresses: memCollection(addresses),
    };
}

// Minimal chain registry exposing the one descriptor dispenserAddress reads.
const BTC_DESCRIPTOR = {
    coin: 'bitcoin',
    networkKind: 'regtest',
    defaultAddressType: 'p2wpkh',
    addressTypes: ['p2wpkh', 'p2pkh'],
};
const chainRegistry = {
    get: (id) => (id === 'bitcoin' ? BTC_DESCRIPTOR : null),
};
const sdkRegistry = { get: () => ({}) };

// Fake software signer: derives a deterministic address per path so the
// flow can persist a record. Records every getAddresses call.
function makeSigner() {
    const calls = [];
    return {
        id: 'software-test',
        kind: 'software',
        calls,
        async getAddresses(params) {
            calls.push(params);
            const { accountIndex, change, startIndex, addressType } = params;
            const path = `m/84'/0'/${accountIndex}'/${change}/${startIndex}`;
            return [{
                index: startIndex,
                address: `addr_${accountIndex}_${change}_${startIndex}`,
                publicKey: `pub_${accountIndex}_${change}_${startIndex}`,
                path,
            }];
        },
        lock() {},
    };
}

const ACCOUNT_A = { schemaVersion: 1, id: 'acct-a', walletId: 'w1', name: 'A', index: 0, createdAt: '2026-01-01T00:00:00.000Z' };
const ACCOUNT_B = { schemaVersion: 1, id: 'acct-b', walletId: 'w1', name: 'B', index: 1, createdAt: '2026-01-01T00:00:00.000Z' };

function base(vault, signer, overrides = {}) {
    return {
        vault,
        walletId: 'w1',
        signer,
        chainRegistry,
        sdkRegistry,
        chainId: 'bitcoin',
        accountId: 'acct-a',
        ...overrides,
    };
}

describe('dispenserAddress (§16)', () => {
    let signer;
    beforeEach(() => { signer = makeSigner(); });

    it('derives index 0 on the change=2 branch when no dispensers exist', async () => {
        const vault = makeVault({ accounts: [ACCOUNT_A] });
        const rec = await dispenserAddress(base(vault, signer));
        expect(rec.role).toBe('dispenser');
        expect(rec.derivationPath).toBe("m/84'/0'/0'/2/0");
        expect(signer.calls[0]).toMatchObject({ change: 2, startIndex: 0, accountIndex: 0 });
    });

    it('allocates contiguously: second call returns index 1', async () => {
        const vault = makeVault({ accounts: [ACCOUNT_A] });
        const first = await dispenserAddress(base(vault, signer));
        const second = await dispenserAddress(base(vault, signer));
        expect(first.derivationPath).toBe("m/84'/0'/0'/2/0");
        expect(second.derivationPath).toBe("m/84'/0'/0'/2/1");
    });

    it('continues from the highest existing dispenser index', async () => {
        const seeded = [0, 1, 2].map((i) => createAddress({
            accountId: 'acct-a',
            chain: 'bitcoin',
            network: 'regtest',
            source: 'hd',
            addressType: 'p2wpkh',
            derivationPath: `m/84'/0'/0'/2/${i}`,
            address: `seed_${i}`,
            publicKey: `seedpub_${i}`,
            role: 'dispenser',
        }));
        const vault = makeVault({ accounts: [ACCOUNT_A], addresses: seeded });
        const rec = await dispenserAddress(base(vault, signer));
        expect(rec.derivationPath).toBe("m/84'/0'/0'/2/3");
    });

    it('does not let another account pollute this account index', async () => {
        // Account B already has dispensers 0,1; account A has none.
        const bAddrs = [0, 1].map((i) => createAddress({
            accountId: 'acct-b',
            chain: 'bitcoin',
            network: 'regtest',
            source: 'hd',
            addressType: 'p2wpkh',
            derivationPath: `m/84'/0'/1'/2/${i}`,
            address: `b_${i}`,
            publicKey: `bpub_${i}`,
            role: 'dispenser',
        }));
        const vault = makeVault({ accounts: [ACCOUNT_A, ACCOUNT_B], addresses: bAddrs });
        const rec = await dispenserAddress(base(vault, signer, { accountId: 'acct-a' }));
        expect(rec.derivationPath).toBe("m/84'/0'/0'/2/0");
    });

    it('ignores receive (change=0) addresses when computing the next dispenser index', async () => {
        const receiveAddrs = [0, 1, 2, 3].map((i) => createAddress({
            accountId: 'acct-a',
            chain: 'bitcoin',
            network: 'regtest',
            source: 'hd',
            addressType: 'p2wpkh',
            derivationPath: `m/84'/0'/0'/0/${i}`,
            address: `r_${i}`,
            publicKey: `rpub_${i}`,
            role: 'receive',
        }));
        const vault = makeVault({ accounts: [ACCOUNT_A], addresses: receiveAddrs });
        const rec = await dispenserAddress(base(vault, signer));
        expect(rec.derivationPath).toBe("m/84'/0'/0'/2/0");
    });

    it('persists the record so it is retrievable from the vault', async () => {
        const vault = makeVault({ accounts: [ACCOUNT_A] });
        const rec = await dispenserAddress(base(vault, signer));
        const stored = await vault.addresses.get(rec.id);
        expect(stored).not.toBeNull();
        expect(stored.role).toBe('dispenser');
    });

    it('defaults the label to "Dispenser #N+1"', async () => {
        const vault = makeVault({ accounts: [ACCOUNT_A] });
        const rec = await dispenserAddress(base(vault, signer));
        expect(rec.label).toBe('Dispenser #1');
    });
});
