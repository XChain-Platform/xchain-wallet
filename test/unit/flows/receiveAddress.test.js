// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: §29.7 receive-address derivation. Asserts external (change=0)
// allocation, per-account isolation, and that the next-index scan shares
// one index space across signer kinds (software 'hd' + hardware
// 'trezor'/'ledger') so hardware accounts allocate index+1 instead of
// colliding at 0. Runs against an in-memory vault + a fake signer.

import { describe, it, expect, beforeEach } from 'vitest';
import { receiveAddress } from '../../../packages/core/src/flows/receiveAddress.js';
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

// Fake signer: derives a deterministic address per path and records the
// `kind` so a test can assert software vs hardware provenance. The flow
// stamps Address.source from signer.kind ('hd' for software, else kind).
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
                path: `m/84'/0'/${accountIndex}'/${change}/${startIndex}`,
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

describe('receiveAddress (§29.7)', () => {
    let signer;
    beforeEach(() => { signer = makeSigner('software'); });

    it('derives index 0 on the external (change=0) branch when empty', async () => {
        const vault = makeVault({ accounts: [ACCOUNT_A] });
        const rec = await receiveAddress(base(vault, signer));
        expect(rec.role).toBe('receive');
        expect(rec.derivationPath).toBe("m/84'/0'/0'/0/0");
        expect(signer.calls[0]).toMatchObject({ change: 0, startIndex: 0, accountIndex: 0 });
    });

    it('defaults the label to the coin-prefixed "<TICKER> Address #N"', async () => {
        const vault = makeVault({ accounts: [ACCOUNT_A] });
        const rec = await receiveAddress(base(vault, signer));
        expect(rec.label).toBe('BTC Address #1');
    });

    it('allocates contiguously across calls', async () => {
        const vault = makeVault({ accounts: [ACCOUNT_A] });
        const first = await receiveAddress(base(vault, signer));
        const second = await receiveAddress(base(vault, signer));
        expect(first.derivationPath).toBe("m/84'/0'/0'/0/0");
        expect(second.derivationPath).toBe("m/84'/0'/0'/0/1");
    });

    it('does not let another account pollute this account index', async () => {
        const bAddrs = [0, 1].map((i) => createAddress({
            accountId: 'acct-b',
            chain: 'bitcoin',
            network: 'regtest',
            source: 'hd',
            addressType: 'p2wpkh',
            derivationPath: `m/84'/0'/1'/0/${i}`,
            address: `b_${i}`,
            publicKey: `bpub_${i}`,
            role: 'receive',
        }));
        const vault = makeVault({ accounts: [ACCOUNT_A, ACCOUNT_B], addresses: bAddrs });
        const rec = await receiveAddress(base(vault, signer, { accountId: 'acct-a' }));
        expect(rec.derivationPath).toBe("m/84'/0'/0'/0/0");
    });

    it('hardware parity: continues past existing trezor/ledger addresses instead of colliding at 0', async () => {
        // The account's first three external addresses came from a Trezor
        // (source 'trezor'). A subsequent generate, even via software,
        // must continue at index 3, not re-derive index 0.
        const hwAddrs = [0, 1, 2].map((i) => createAddress({
            accountId: 'acct-a',
            chain: 'bitcoin',
            network: 'regtest',
            source: i === 2 ? 'ledger' : 'trezor',
            addressType: 'p2wpkh',
            derivationPath: `m/84'/0'/0'/0/${i}`,
            address: `hw_${i}`,
            publicKey: `hwpub_${i}`,
            role: 'receive',
        }));
        const vault = makeVault({ accounts: [ACCOUNT_A], addresses: hwAddrs });
        const hwSigner = makeSigner('trezor');
        const rec = await receiveAddress(base(vault, hwSigner));
        expect(rec.derivationPath).toBe("m/84'/0'/0'/0/3");
        expect(rec.source).toBe('trezor');
    });

    it('ignores imported-wif / watch-only (null derivationPath) when computing the next index', async () => {
        const imported = createAddress({
            accountId: 'acct-a',
            chain: 'bitcoin',
            network: 'regtest',
            source: 'imported-wif',
            addressType: 'p2wpkh',
            derivationPath: null,
            address: 'imp_0',
            publicKey: 'imppub_0',
            role: 'receive',
        });
        const vault = makeVault({ accounts: [ACCOUNT_A], addresses: [imported] });
        const rec = await receiveAddress(base(vault, signer));
        expect(rec.derivationPath).toBe("m/84'/0'/0'/0/0");
    });
});

// §17.6: a fresh HARDWARE receive address is confirmed on the device's
// trusted screen (verify:true) before it is persisted, so a compromised
// host cannot silently substitute a deposit address.
function makeHwSigner(kind, { verifyReturns } = {}) {
    const calls = [];
    return {
        id: `signer-${kind}`,
        kind,
        calls,
        async getAddresses(params) {
            calls.push(params);
            const { accountIndex, change, startIndex, verify } = params;
            const address = verify && verifyReturns
                ? verifyReturns
                : `addr_${accountIndex}_${change}_${startIndex}`;
            return [{
                index: startIndex,
                address,
                publicKey: `pub_${accountIndex}_${change}_${startIndex}`,
                path: `m/84'/0'/${accountIndex}'/${change}/${startIndex}`,
            }];
        },
        lock() {},
    };
}

describe('receiveAddress hardware confirmation (§17.6)', () => {
    it('confirms the fresh HW address on the device (verify:true) before persisting', async () => {
        const vault = makeVault({ accounts: [ACCOUNT_A] });
        const hw = makeHwSigner('trezor');
        const rec = await receiveAddress(base(vault, hw));
        expect(rec.source).toBe('trezor');
        // Two derivations: a silent one, then a device-confirmed one.
        expect(hw.calls.length).toBe(2);
        expect(hw.calls[0].verify).toBeFalsy();
        expect(hw.calls[1].verify).toBe(true);
        // The device-confirmed address is persisted.
        expect(await vault.addresses.get(rec.id)).toBeTruthy();
    });

    it('aborts without persisting when the device shows a different address', async () => {
        const vault = makeVault({ accounts: [ACCOUNT_A] });
        const hw = makeHwSigner('ledger', { verifyReturns: 'addr_ATTACKER' });
        await expect(receiveAddress(base(vault, hw))).rejects.toThrow(/different address/i);
        expect((await vault.addresses.list()).length).toBe(0);
    });

    it('software addresses never trigger an on-device verify', async () => {
        const vault = makeVault({ accounts: [ACCOUNT_A] });
        const sw = makeSigner('software');
        await receiveAddress(base(vault, sw));
        expect(sw.calls.length).toBe(1);
        expect(sw.calls[0].verify).toBeFalsy();
    });
});

// A counterwallet-legacy wallet derives m/0'/C/I for EVERY address type,
// so its types share ONE index space. Allocating per type there re-issued
// the key already held at that index under a different encoding, and
// disagreed with the wallet the user migrated from, whose "first segwit"
// address is index 1 (see crypto/counterwallet-interop.test.js).
describe('receiveAddress index space by wallet format', () => {
    const LEGACY_ADDR = createAddress({
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
        const vault = makeVault({ accounts: [ACCOUNT_A], addresses: [LEGACY_ADDR] });
        vault.wallets = memCollection([{ id: 'w1', format }]);
        return vault;
    }

    it('continues past a p2pkh address when deriving p2wpkh for a legacy wallet', async () => {
        const vault = vaultWithFormat('counterwallet-legacy');
        const rec = await receiveAddress(
            base(vault, makeSigner('software'), { addressType: 'p2wpkh' }),
        );
        // Index 1, NOT a second copy of the key at index 0.
        expect(rec.derivationPath.endsWith('/1')).toBe(true);
        expect(rec.address).not.toBe(LEGACY_ADDR.address);
        expect(rec.label).toBe('BTC Address #2');
    });

    it('keeps per-type index spaces for a BIP39 wallet', async () => {
        const vault = vaultWithFormat('bip39');
        const rec = await receiveAddress(
            base(vault, makeSigner('software'), { addressType: 'p2wpkh' }),
        );
        // p2wpkh lives on its own BIP44 branch, so index 0 is unused there.
        expect(rec.derivationPath.endsWith('/0')).toBe(true);
    });

    it('falls back to per-type spaces when the wallet record is unreadable', async () => {
        const vault = makeVault({ accounts: [ACCOUNT_A], addresses: [LEGACY_ADDR] });
        const rec = await receiveAddress(
            base(vault, makeSigner('software'), { addressType: 'p2wpkh' }),
        );
        expect(rec.derivationPath.endsWith('/0')).toBe(true);
    });
});
