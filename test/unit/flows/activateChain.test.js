// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: §48.3 activateChain. Adds a chain to an existing wallet by
// deriving the first address per account. Covers software activation,
// idempotent skip, and hardware activation (a connected RemoteSigner
// derives 'trezor'/'ledger' addresses tied to its signerId, same as
// createAccount), against an in-memory vault + a fake signer.

import { describe, it, expect, beforeEach } from 'vitest';
import { activateChain } from '../../../packages/core/src/flows/activateChain.js';
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

// settings.get returns a minimal record; seedSettingsForChains mutates a
// copy, so an object with empty fees/ads is enough for the flow to run.
function makeVault({ accounts = [], addresses = [] } = {}) {
    return {
        wallets: memCollection([{ id: 'w1', schemaVersion: 1 }]),
        accounts: memCollection(accounts),
        addresses: memCollection(addresses),
        settings: {
            _rec: { schemaVersion: 1, fees: {}, ads: { perChain: {} } },
            async get() { return JSON.parse(JSON.stringify(this._rec)); },
            async put(r) { this._rec = JSON.parse(JSON.stringify(r)); },
        },
    };
}

const LTC_DESCRIPTOR = {
    coin: 'litecoin',
    networkKind: 'mainnet',
    defaultAddressType: 'p2wpkh',
    addressTypes: ['p2wpkh', 'p2pkh'],
    feeStrategy: { defaultStrategy: 'normal', rbfSupported: true },
    adsDonationAddress: null,
};
const chainRegistry = {
    has: (id) => id === 'litecoin-mainnet',
    get: (id) => (id === 'litecoin-mainnet' ? LTC_DESCRIPTOR : null),
};
const sdkRegistry = { get: () => ({}) };

function makeSigner(kind = 'software') {
    const calls = [];
    return {
        id: `signer-${kind}`,
        kind,
        calls,
        async getAddresses(params) {
            calls.push(params);
            const { accountIndex, change, startIndex } = params;
            return [{
                index: startIndex,
                address: `addr_${accountIndex}_${change}_${startIndex}`,
                publicKey: `pub_${accountIndex}_${change}_${startIndex}`,
                path: `m/84'/2'/${accountIndex}'/${change}/${startIndex}`,
            }];
        },
        lock() {},
    };
}

const ACCOUNT_A = { schemaVersion: 1, id: 'acct-a', walletId: 'w1', name: 'A', index: 0, createdAt: '2026-01-01T00:00:00.000Z' };
const ACCOUNT_B = { schemaVersion: 1, id: 'acct-b', walletId: 'w1', name: 'B', index: 1, createdAt: '2026-01-01T00:00:00.000Z' };

function base(vault, signer, overrides = {}) {
    return {
        walletId: 'w1',
        chainId: 'litecoin-mainnet',
        signer,
        vault,
        chainRegistry,
        sdkRegistry,
        ...overrides,
    };
}

describe('activateChain (§48.3)', () => {
    let signer;
    beforeEach(() => { signer = makeSigner('software'); });

    it('derives the new chain address for every account (software)', async () => {
        const vault = makeVault({ accounts: [ACCOUNT_A, ACCOUNT_B] });
        const res = await activateChain(base(vault, signer));
        expect(res.addresses).toHaveLength(2);
        expect(res.skippedAccounts).toBe(0);
        const stored = await vault.addresses.list();
        expect(stored.every((a) => a.chain === 'litecoin' && a.source === 'hd')).toBe(true);
    });

    it('is idempotent: skips accounts that already have an address on the chain', async () => {
        const existing = createAddress({
            accountId: 'acct-a',
            chain: 'litecoin',
            network: 'mainnet',
            source: 'hd',
            addressType: 'p2wpkh',
            derivationPath: "m/84'/2'/0'/0/0",
            address: 'ltc_existing',
            publicKey: 'ltcpub_existing',
            role: 'receive',
        });
        const vault = makeVault({ accounts: [ACCOUNT_A], addresses: [existing] });
        const res = await activateChain(base(vault, signer));
        expect(res.addresses).toHaveLength(0);
        expect(res.skippedAccounts).toBe(1);
        expect(res.skippedAccountDetails).toEqual([{ accountId: 'acct-a', name: 'A' }]);
    });

    it('hardware: a connected trezor signer derives source=trezor addresses tied to its id', async () => {
        const hwSigner = makeSigner('trezor');
        const vault = makeVault({ accounts: [ACCOUNT_A] });
        const res = await activateChain(base(vault, hwSigner));
        expect(res.addresses).toHaveLength(1);
        const rec = res.addresses[0].address;
        expect(rec.source).toBe('trezor');
        expect(rec.signerId).toBe('signer-trezor');
        // The device was asked to derive the chain's first external address.
        expect(hwSigner.calls[0]).toMatchObject({ change: 0, startIndex: 0, accountIndex: 0 });
    });

    it('does not lock a caller-supplied (pool / hardware) signer', async () => {
        let locked = false;
        const hwSigner = makeSigner('ledger');
        hwSigner.lock = () => { locked = true; };
        const vault = makeVault({ accounts: [ACCOUNT_A] });
        await activateChain(base(vault, hwSigner));
        expect(locked).toBe(false);
    });

    it('skips a device-owned account when activation receives the software signer', async () => {
        const owned = createAddress({
            accountId: 'acct-a', chain: 'bitcoin', network: 'mainnet', source: 'trezor',
            addressType: 'p2wpkh', derivationPath: "m/84'/0'/0'/0/0",
            address: 'btc_device', publicKey: 'btc_device_pub', signerId: 'signer-trezor',
        });
        const vault = makeVault({ accounts: [ACCOUNT_A], addresses: [owned] });
        const res = await activateChain(base(vault, signer));

        expect(res.addresses).toHaveLength(0);
        expect(res.skippedAccountDetails).toEqual([{
            accountId: 'acct-a', name: 'A', reason: 'custody-mismatch',
        }]);
        expect(signer.calls).toHaveLength(0);
    });

    it('lets the owning device activate a new chain for its account', async () => {
        const owned = createAddress({
            accountId: 'acct-a', chain: 'bitcoin', network: 'mainnet', source: 'trezor',
            addressType: 'p2wpkh', derivationPath: "m/84'/0'/0'/0/0",
            address: 'btc_device', publicKey: 'btc_device_pub', signerId: 'signer-trezor',
        });
        const hwSigner = makeSigner('trezor');
        const vault = makeVault({ accounts: [ACCOUNT_A], addresses: [owned] });
        const res = await activateChain(base(vault, hwSigner));

        expect(res.addresses).toHaveLength(1);
        expect(res.skippedAccounts).toBe(0);
        expect(hwSigner.calls).toHaveLength(1);
    });

    it('fills the seed account and skips the unlinked device account with the software signer', async () => {
        const vault = makeVault({
            accounts: [ACCOUNT_A, ACCOUNT_B],
            addresses: [btcRecord('acct-a', 'hd', null), btcRecord('acct-b', 'trezor', null)],
        });
        const res = await activateChain(base(vault, signer));

        expect(res.addresses.map((entry) => entry.accountId)).toEqual(['acct-a']);
        expect(res.skippedAccountDetails).toEqual([{
            accountId: 'acct-b', name: 'B', reason: 'custody-mismatch',
        }]);
        expect(signer.calls).toHaveLength(1);
    });

    it('lets a device extend an account whose device records are unlinked', async () => {
        const hwSigner = makeSigner('trezor');
        const vault = makeVault({ accounts: [ACCOUNT_A], addresses: [btcRecord('acct-a', 'trezor', null)] });
        const res = await activateChain(base(vault, hwSigner));

        expect(res.addresses).toHaveLength(1);
        expect(res.addresses[0].address.source).toBe('trezor');
    });

    it('skips accounts a device signer does not own: seed-only or linked to another device', async () => {
        const hwSigner = makeSigner('trezor');
        const vault = makeVault({
            accounts: [ACCOUNT_A, ACCOUNT_B],
            addresses: [btcRecord('acct-a', 'hd', null), btcRecord('acct-b', 'trezor', 'other-device')],
        });
        const res = await activateChain(base(vault, hwSigner));

        expect(res.addresses).toHaveLength(0);
        expect(res.skippedAccountDetails.map((entry) => entry.reason)).toEqual([
            'custody-mismatch', 'custody-mismatch',
        ]);
        expect(hwSigner.calls).toHaveLength(0);
    });
});

function btcRecord(accountId, source, signerId) {
    return createAddress({
        accountId, chain: 'bitcoin', network: 'mainnet', source, addressType: 'p2wpkh',
        derivationPath: "m/84'/0'/0'/0/0", address: `btc_${accountId}_${source}`,
        publicKey: `btc_pub_${accountId}_${source}`, ...(signerId ? { signerId } : {}),
    });
}
