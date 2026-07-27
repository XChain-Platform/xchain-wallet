// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: §16 dispenser address derivation. Dispensers are standard
// external (change=0) addresses tagged role 'dispenser', drawing from the
// account's single external index space shared with receive addresses.
// Asserts the change=0 branch, contiguous allocation that does NOT
// collide with receive indices, per-account isolation, the role tag /
// path shape, and the dispenser-counted label, against an in-memory vault
// + a fake signer.

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

    it('derives index 0 on the change=0 branch when the account is empty', async () => {
        const vault = makeVault({ accounts: [ACCOUNT_A] });
        const rec = await dispenserAddress(base(vault, signer));
        expect(rec.role).toBe('dispenser');
        expect(rec.derivationPath).toBe("m/84'/0'/0'/0/0");
        expect(signer.calls[0]).toMatchObject({ change: 0, startIndex: 0, accountIndex: 0 });
    });

    it('allocates contiguously: second call returns index 1', async () => {
        const vault = makeVault({ accounts: [ACCOUNT_A] });
        const first = await dispenserAddress(base(vault, signer));
        const second = await dispenserAddress(base(vault, signer));
        expect(first.derivationPath).toBe("m/84'/0'/0'/0/0");
        expect(second.derivationPath).toBe("m/84'/0'/0'/0/1");
    });

    it('continues from the highest existing external index', async () => {
        const seeded = [0, 1, 2].map((i) => createAddress({
            accountId: 'acct-a',
            chain: 'bitcoin',
            network: 'regtest',
            source: 'hd',
            addressType: 'p2wpkh',
            derivationPath: `m/84'/0'/0'/0/${i}`,
            address: `seed_${i}`,
            publicKey: `seedpub_${i}`,
            role: 'dispenser',
        }));
        const vault = makeVault({ accounts: [ACCOUNT_A], addresses: seeded });
        const rec = await dispenserAddress(base(vault, signer));
        expect(rec.derivationPath).toBe("m/84'/0'/0'/0/3");
    });

    it('does not let another account pollute this account index', async () => {
        // Account B already has external addresses 0,1; account A has none.
        const bAddrs = [0, 1].map((i) => createAddress({
            accountId: 'acct-b',
            chain: 'bitcoin',
            network: 'regtest',
            source: 'hd',
            addressType: 'p2wpkh',
            derivationPath: `m/84'/0'/1'/0/${i}`,
            address: `b_${i}`,
            publicKey: `bpub_${i}`,
            role: 'dispenser',
        }));
        const vault = makeVault({ accounts: [ACCOUNT_A, ACCOUNT_B], addresses: bAddrs });
        const rec = await dispenserAddress(base(vault, signer, { accountId: 'acct-a' }));
        expect(rec.derivationPath).toBe("m/84'/0'/0'/0/0");
    });

    it('shares the external index space: continues past receive (change=0) addresses', async () => {
        // Receive addresses occupy change=0 indices 0..3, so the next
        // dispenser must take index 4, never reusing a receive index.
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
        expect(rec.derivationPath).toBe("m/84'/0'/0'/0/4");
    });

    it('shares the index space across signer kinds: continues past a hardware (trezor) address', async () => {
        // A Trezor-derived address occupies external index 0 with source
        // 'trezor' (not 'hd'). The next dispenser must take index 1, never
        // colliding at 0 just because the existing address is hardware.
        const hwAddrs = [createAddress({
            accountId: 'acct-a',
            chain: 'bitcoin',
            network: 'regtest',
            source: 'trezor',
            addressType: 'p2wpkh',
            derivationPath: "m/84'/0'/0'/0/0",
            address: 'tz_0',
            publicKey: 'tzpub_0',
            role: 'receive',
        })];
        const vault = makeVault({ accounts: [ACCOUNT_A], addresses: hwAddrs });
        const rec = await dispenserAddress(base(vault, signer));
        expect(rec.derivationPath).toBe("m/84'/0'/0'/0/1");
    });

    it('persists the record so it is retrievable from the vault', async () => {
        const vault = makeVault({ accounts: [ACCOUNT_A] });
        const rec = await dispenserAddress(base(vault, signer));
        const stored = await vault.addresses.get(rec.id);
        expect(stored).not.toBeNull();
        expect(stored.role).toBe('dispenser');
    });

    it('labels by dispenser count, not by external index', async () => {
        // Four receive addresses but zero dispensers: the next dispenser
        // derives at external index 4 yet is still labeled "BTC Dispenser
        // #1" (coin-prefixed like receive labels, so multi-chain lists
        // don't show colliding "Dispenser #1" rows).
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
        const first = await dispenserAddress(base(vault, signer));
        expect(first.derivationPath).toBe("m/84'/0'/0'/0/4");
        expect(first.label).toBe('BTC Dispenser #1');
        // Second dispenser: index 5, label increments to #2.
        const second = await dispenserAddress(base(vault, signer));
        expect(second.derivationPath).toBe("m/84'/0'/0'/0/5");
        expect(second.label).toBe('BTC Dispenser #2');
    });
});

// Same index-space rule as receiveAddress : a counterwallet-legacy
// wallet derives m/0'/C/I for every address type, so a dispenser allocated
// per type would land on the key already serving as a personal receive
// address - defeating the isolation this flow exists to provide.
describe('dispenserAddress index space by wallet format ', () => {
    const LEGACY_RECEIVE = createAddress({
        accountId: 'acct-a',
        chain: 'bitcoin',
        network: 'regtest',
        source: 'hd',
        addressType: 'p2pkh',
        derivationPath: "m/0'/0/0",
        address: 'n2XDwu_legacy_0',
        publicKey: 'pub0',
        label: 'BTC Address #1',
        signerId: 'signer-software',
    });

    function vaultWithFormat(format) {
        const vault = makeVault({ accounts: [ACCOUNT_A], addresses: [LEGACY_RECEIVE] });
        vault.wallets = memCollection([{ id: 'w1', format }]);
        return vault;
    }

    it('does not reuse the legacy receive index for a p2wpkh dispenser', async () => {
        const vault = vaultWithFormat('counterwallet-legacy');
        const rec = await dispenserAddress(
            base(vault, makeSigner(), { addressType: 'p2wpkh' }),
        );
        expect(rec.derivationPath.endsWith('/1')).toBe(true);
        expect(rec.address).not.toBe(LEGACY_RECEIVE.address);
    });

    it('keeps per-type index spaces for a BIP39 wallet', async () => {
        const vault = vaultWithFormat('bip39');
        const rec = await dispenserAddress(
            base(vault, makeSigner(), { addressType: 'p2wpkh' }),
        );
        expect(rec.derivationPath.endsWith('/0')).toBe(true);
    });
});
