// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: a signer derives addresses only inside an account whose key material
// it owns. A seed wallet can hold a hardware account; the pooled seed signer
// must never derive a change address into it, and a device must never derive
// into a seed account.

import { describe, it, expect } from 'vitest';
import { deriveChangeAddress, resolveChangeAddress } from '../../../packages/core/src/flows/changeAddress.js';
import { createAddress } from '../../../packages/core/src/schemas/address.js';

function memCollection(initial = []) {
    const m = new Map(initial.map((r) => [r.id, structuredClone(r)]));
    return {
        get: async (id) => (m.has(id) ? structuredClone(m.get(id)) : null),
        put: async (rec) => { m.set(rec.id, structuredClone(rec)); },
        list: async () => Array.from(m.values()).map((r) => structuredClone(r)),
        findBy: async (field, value) => Array.from(m.values())
            .filter((r) => r[field] === value).map((r) => structuredClone(r)),
    };
}

const account = (id, index) => ({
    schemaVersion: 2, id, walletId: 'w1', name: id, index, activeAddressByChainId: {},
    createdAt: '2026-01-01T00:00:00.000Z',
});
const SEED_ACCOUNT = account('acct-seed', 0);
const DEVICE_ACCOUNT = account('acct-dev', 1);

const BTC = {
    coin: 'bitcoin', networkKind: 'regtest', defaultAddressType: 'p2wpkh', addressTypes: ['p2wpkh'],
    feeStrategy: { defaultStrategy: 'normal', rbfSupported: true }, adsDonationAddress: null,
};
const LTC = { ...BTC, coin: 'litecoin' };
const DESCRIPTORS = { 'bitcoin-regtest': BTC, 'litecoin-regtest': LTC };
const chainRegistry = { get: (id) => DESCRIPTORS[id] ?? null, has: (id) => id in DESCRIPTORS };

function owned(accountId, source, signerId, over = {}) {
    return createAddress({
        accountId, chain: 'bitcoin', network: 'regtest', source, addressType: 'p2wpkh',
        derivationPath: "m/84'/1'/0'/0/0", address: `${accountId}-0`, publicKey: `${accountId}-pub-0`,
        label: 'BTC Address #1', ...(signerId ? { signerId } : {}), ...over,
    });
}

function makeSigner(kind, id) {
    const calls = [];
    return {
        id, kind, calls,
        async getAddresses(params) {
            calls.push(params);
            const { accountIndex, change, startIndex } = params;
            return [{
                index: startIndex,
                address: `${id}_${accountIndex}_${change}_${startIndex}`,
                publicKey: `${id}_pub_${accountIndex}_${change}_${startIndex}`,
                path: `m/84'/1'/${accountIndex}'/${change}/${startIndex}`,
            }];
        },
        lock() {},
    };
}

function mixedVault(extra = []) {
    return {
        wallets: memCollection([{ id: 'w1', format: 'bip39', schemaVersion: 1 }]),
        accounts: memCollection([SEED_ACCOUNT, DEVICE_ACCOUNT]),
        addresses: memCollection([
            owned('acct-seed', 'hd', 'seed-1'),
            owned('acct-dev', 'trezor', 'dev-1'),
            ...extra,
        ]),
        settings: {
            rec: { schemaVersion: 1, fees: {}, ads: { perChain: {} } },
            async get() { return structuredClone(this.rec); },
            async put(r) { this.rec = structuredClone(r); },
        },
    };
}

describe('deriveChangeAddress signer ownership', () => {
    const run = (vault, signer, sourceAddress) => deriveChangeAddress({
        vault, walletId: 'w1', signer, chainRegistry, chainId: 'bitcoin-regtest', sourceAddress,
    });

    it('never derives a hardware account change with the seed signer', async () => {
        const vault = mixedVault();
        const seed = makeSigner('software', 'seed-1');
        expect(await run(vault, seed, 'acct-dev-0')).toBeNull();
        expect(seed.calls).toHaveLength(0);
        expect(await vault.addresses.list()).toHaveLength(2);
    });

    it('falls back to the spending address through resolveChangeAddress', async () => {
        const vault = mixedVault();
        const out = await resolveChangeAddress({
            vault, walletId: 'w1', signer: makeSigner('software', 'seed-1'), chainRegistry,
            chainId: 'bitcoin-regtest', sourceAddress: 'acct-dev-0',
            settings: { privacy: { changeAddressRotation: true } },
        });
        expect(out).toEqual({ address: 'acct-dev-0', rotated: false, record: null });
    });

    it('rotates a hardware spend when the owning device is the signer', async () => {
        const vault = mixedVault();
        const rec = await run(vault, makeSigner('trezor', 'dev-1'), 'acct-dev-0');
        expect(rec.source).toBe('trezor');
        expect(rec.role).toBe('change');
        expect(rec.signerId).toBe('dev-1');
    });

    it('refuses a different device id, a different device kind and a device on a seed source', async () => {
        const vault = mixedVault();
        expect(await run(vault, makeSigner('trezor', 'dev-2'), 'acct-dev-0')).toBeNull();
        expect(await run(vault, makeSigner('ledger', 'dev-1'), 'acct-dev-0')).toBeNull();
        expect(await run(vault, makeSigner('trezor', 'dev-1'), 'acct-seed-0')).toBeNull();
        expect(await vault.addresses.list()).toHaveLength(2);
    });

    it('fails open for a device source that carries no signer id', async () => {
        const vault = mixedVault([owned('acct-dev', 'trezor', null, {
            address: 'orphan', derivationPath: "m/84'/1'/1'/0/5", publicKey: 'orphan-pub',
        })]);
        expect(await run(vault, makeSigner('trezor', 'dev-1'), 'orphan')).toBeNull();
    });

    it('still rotates a seed account with the seed signer', async () => {
        const vault = mixedVault();
        const rec = await run(vault, makeSigner('software', 'seed-1'), 'acct-seed-0');
        expect(rec.source).toBe('hd');
        expect(rec.role).toBe('change');
    });
});
