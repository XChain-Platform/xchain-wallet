// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// : Settings > Privacy offered "Use a fresh change address for every
// send. Improves chain-analysis resistance." and drove nothing. The string
// `changeAddress` did not appear in the send path at all, so no rotation
// mechanism existed for the flag to switch on. Proven on BTC regtest: with
// the toggle ON, 0.05 BTC left mq1XCn2HAN... and 0.54996808 came back to
// mq1XCn2HAN... - precisely the reuse the setting claims to prevent.
//
// These are the assertions that make the claim true: change lands on a fresh
// INTERNAL (change=1) address that the wallet has written down, indices
// advance instead of colliding, and every "cannot rotate" case degrades to
// the old behaviour rather than blocking a send.

import { describe, it, expect, beforeEach } from 'vitest';
import {
    resolveChangeAddress,
    deriveChangeAddress,
    changeRotationEnabled,
    nextChangeIndex,
    branchOf,
} from '../../../packages/core/src/flows/changeAddress.js';
import { createAddress } from '../../../packages/core/src/schemas/address.js';

function memCollection(initial = []) {
    const m = new Map(initial.map((r) => [r.id, JSON.parse(JSON.stringify(r))]));
    return {
        get: async (id) => (m.has(id) ? JSON.parse(JSON.stringify(m.get(id))) : null),
        put: async (rec) => { m.set(rec.id, JSON.parse(JSON.stringify(rec))); },
        list: async () => Array.from(m.values()).map((r) => JSON.parse(JSON.stringify(r))),
        delete: async (id) => { m.delete(id); },
        findBy: async (field, value) =>
            Array.from(m.values()).filter((r) => r[field] === value)
                .map((r) => JSON.parse(JSON.stringify(r))),
        _map: m,
    };
}

const BTC = {
    coin: 'bitcoin',
    networkKind: 'regtest',
    defaultAddressType: 'p2wpkh',
    addressTypes: ['p2wpkh', 'p2pkh'],
};
const chainRegistry = { get: (id) => (id === 'bitcoin-regtest' ? BTC : null) };

const ACCOUNT = {
    schemaVersion: 2, id: 'acct-a', walletId: 'w1', name: 'A', index: 0,
    activeAddressByChainId: {}, createdAt: '2026-01-01T00:00:00.000Z',
};
const WALLET_BIP39 = { id: 'w1', format: 'bip39' };

/** Fake unlocked signer: one deterministic address per (account, branch, index). */
function makeSigner(kind = 'software') {
    const calls = [];
    return {
        id: 'signer-1',
        kind,
        calls,
        async getAddresses(params) {
            calls.push(params);
            const { accountIndex, change, startIndex } = params;
            return [{
                index: startIndex,
                address: `addr_${accountIndex}_${change}_${startIndex}`,
                publicKey: `pub_${accountIndex}_${change}_${startIndex}`,
                path: `m/84'/1'/${accountIndex}'/${change}/${startIndex}`,
            }];
        },
    };
}

/** The spending address: HD, external branch, index 0. */
function sourceRecord(overrides = {}) {
    return createAddress({
        accountId: 'acct-a',
        chain: 'bitcoin',
        network: 'regtest',
        source: 'hd',
        addressType: 'p2wpkh',
        derivationPath: "m/84'/1'/0'/0/0",
        address: 'addr_0_0_0',
        publicKey: 'pub_0_0_0',
        label: 'BTC Address #1',
        ...overrides,
    });
}

function makeVault({ addresses = [], wallet = WALLET_BIP39, settings = {} } = {}) {
    return {
        accounts: memCollection([ACCOUNT]),
        addresses: memCollection(addresses),
        wallets: memCollection([wallet]),
        settings: { get: async () => settings, put: async () => {} },
    };
}

const ROTATION_ON = { privacy: { changeAddressRotation: true } };
const ROTATION_OFF = { privacy: { changeAddressRotation: false } };

function opts(vault, signer, extra = {}) {
    return {
        vault,
        walletId: 'w1',
        signer,
        chainRegistry,
        chainId: 'bitcoin-regtest',
        sourceAddress: 'addr_0_0_0',
        ...extra,
    };
}

describe('changeRotationEnabled', () => {
    it('is off unless the flag is literally true', () => {
        expect(changeRotationEnabled(ROTATION_ON)).toBe(true);
        expect(changeRotationEnabled(ROTATION_OFF)).toBe(false);
        expect(changeRotationEnabled({})).toBe(false);
        expect(changeRotationEnabled(null)).toBe(false);
        // A truthy non-boolean must not silently start moving funds.
        expect(changeRotationEnabled({ privacy: { changeAddressRotation: 'yes' } })).toBe(false);
    });
});

describe('branchOf reads the BIP44 tail end-relative', () => {
    it('parses a BIP39 path', () => {
        expect(branchOf("m/84'/1'/0'/1/7")).toEqual({ branch: '1', index: 7 });
    });
    it('parses a counterwallet-legacy path, which has no purpose/coin/account triple', () => {
        expect(branchOf("m/0'/1/3")).toEqual({ branch: '1', index: 3 });
    });
    it('rejects what it cannot read', () => {
        expect(branchOf(null)).toBeNull();
        expect(branchOf('m/0')).toBeNull();
        expect(branchOf("m/84'/1'/0'/1/notanumber")).toBeNull();
    });
});

describe('nextChangeIndex', () => {
    const scope = {
        accountId: 'acct-a', coin: 'bitcoin', network: 'regtest',
        addressType: 'p2wpkh', sharedIndexSpace: false,
    };

    it('starts at 0 when the internal branch is empty', () => {
        expect(nextChangeIndex([sourceRecord()], scope)).toEqual({ nextIndex: 0, changeCount: 0 });
    });

    it('ignores the external branch entirely, so receive indices never shift it', () => {
        const many = [0, 1, 2, 3].map((i) => sourceRecord({
            derivationPath: `m/84'/1'/0'/0/${i}`, address: `addr_0_0_${i}`,
        }));
        expect(nextChangeIndex(many, scope).nextIndex).toBe(0);
    });

    it('advances past the highest internal index, not the count', () => {
        const rows = [
            sourceRecord({ derivationPath: "m/84'/1'/0'/1/0", address: 'c0', role: 'change' }),
            sourceRecord({ derivationPath: "m/84'/1'/0'/1/4", address: 'c4', role: 'change' }),
        ];
        expect(nextChangeIndex(rows, scope)).toEqual({ nextIndex: 5, changeCount: 2 });
    });

    it('partitions by address type for a BIP39 wallet', () => {
        const rows = [
            sourceRecord({ derivationPath: "m/44'/1'/0'/1/9", address: 'legacy9', addressType: 'p2pkh' }),
        ];
        expect(nextChangeIndex(rows, scope).nextIndex).toBe(0);
    });

    it('shares ONE index space when the wallet is counterwallet-legacy', () => {
        const rows = [
            sourceRecord({ derivationPath: "m/0'/1/9", address: 'legacy9', addressType: 'p2pkh' }),
        ];
        expect(nextChangeIndex(rows, { ...scope, sharedIndexSpace: true }).nextIndex).toBe(10);
    });

    it('skips other accounts and other chains', () => {
        const rows = [
            sourceRecord({ accountId: 'acct-b', derivationPath: "m/84'/1'/1'/1/9", address: 'x' }),
            sourceRecord({ chain: 'litecoin', derivationPath: "m/84'/1'/0'/1/9", address: 'y' }),
            sourceRecord({ network: 'mainnet', derivationPath: "m/84'/1'/0'/1/9", address: 'z' }),
        ];
        expect(nextChangeIndex(rows, scope).nextIndex).toBe(0);
    });

    it('skips imported-WIF and watch-only rows, which have no branch', () => {
        const rows = [
            sourceRecord({ source: 'imported-wif', derivationPath: null, address: 'imported' }),
            sourceRecord({ source: 'watch-only', derivationPath: null, address: 'watched' }),
        ];
        expect(nextChangeIndex(rows, scope).nextIndex).toBe(0);
    });
});

describe('deriveChangeAddress', () => {
    let vault;
    let signer;
    beforeEach(() => {
        vault = makeVault({ addresses: [sourceRecord()] });
        signer = makeSigner();
    });

    it('derives on the INTERNAL branch and persists the record', async () => {
        const record = await deriveChangeAddress(opts(vault, signer));
        expect(signer.calls[0]).toMatchObject({
            chainId: 'bitcoin-regtest', accountIndex: 0, change: 1, startIndex: 0, count: 1,
            addressType: 'p2wpkh',
        });
        expect(record.address).toBe('addr_0_1_0');
        expect(record.role).toBe('change');
        expect(record.derivationPath).toBe("m/84'/1'/0'/1/0");
        expect(record.signerId).toBe('signer-1');
        // Persisted BEFORE the PSBT exists: change must never land at a key
        // the wallet has not written down.
        const stored = await vault.addresses.list();
        expect(stored.some((a) => a.address === 'addr_0_1_0')).toBe(true);
    });

    it('labels it so the balance that moves there is findable', async () => {
        const record = await deriveChangeAddress(opts(vault, signer));
        expect(record.label).toBe('BTC Change #1');
        expect(record.hidden).toBe(false);
    });

    it('never reuses an index across two sends', async () => {
        const first = await deriveChangeAddress(opts(vault, signer));
        const second = await deriveChangeAddress(opts(vault, signer));
        expect(first.address).toBe('addr_0_1_0');
        expect(second.address).toBe('addr_0_1_1');
    });

    it('keeps the spender script type, so change is not a louder signal than reuse', async () => {
        const legacyVault = makeVault({
            addresses: [sourceRecord({
                addressType: 'p2pkh', derivationPath: "m/44'/1'/0'/0/0", address: 'legacy-src',
            })],
        });
        await deriveChangeAddress(opts(legacyVault, signer, { sourceAddress: 'legacy-src' }));
        expect(signer.calls[0].addressType).toBe('p2pkh');
    });

    it('tags a hardware-derived change address with the device kind', async () => {
        const hw = makeSigner('trezor');
        const hwVault = makeVault({ addresses: [sourceRecord({ source: 'trezor' })] });
        const record = await deriveChangeAddress(opts(hwVault, hw));
        expect(record.source).toBe('trezor');
    });

    it('returns null for an imported-WIF source, which has no branch to rotate onto', async () => {
        const wifVault = makeVault({
            addresses: [sourceRecord({ source: 'imported-wif', derivationPath: null, address: 'wif-addr' })],
        });
        expect(await deriveChangeAddress(opts(wifVault, signer, { sourceAddress: 'wif-addr' }))).toBeNull();
    });

    it('returns null when the spending address is not one the wallet knows', async () => {
        expect(await deriveChangeAddress(opts(vault, signer, { sourceAddress: 'someone-else' }))).toBeNull();
    });

    it('returns null for an unknown chain', async () => {
        expect(await deriveChangeAddress(opts(vault, signer, { chainId: 'nope' }))).toBeNull();
    });

    it('refuses a signer that ignored `change` and handed back an external address', async () => {
        const liar = {
            id: 'liar', kind: 'software',
            async getAddresses({ startIndex }) {
                return [{
                    index: startIndex,
                    address: `addr_0_0_${startIndex}`,
                    publicKey: 'pub',
                    path: `m/84'/1'/0'/0/${startIndex}`,
                }];
            },
        };
        expect(await deriveChangeAddress(opts(vault, liar))).toBeNull();
        expect((await vault.addresses.list()).length).toBe(1);
    });
});

describe('resolveChangeAddress', () => {
    let vault;
    let signer;
    beforeEach(() => {
        vault = makeVault({ addresses: [sourceRecord()] });
        signer = makeSigner();
    });

    it('rotates when the toggle is on', async () => {
        const out = await resolveChangeAddress(opts(vault, signer, { settings: ROTATION_ON }));
        expect(out).toMatchObject({ address: 'addr_0_1_0', rotated: true });
        expect(out.record.role).toBe('change');
    });

    it('[REGRESSION] leaves change on the spending address when the toggle is OFF', async () => {
        const out = await resolveChangeAddress(opts(vault, signer, { settings: ROTATION_OFF }));
        expect(out).toEqual({ address: 'addr_0_0_0', rotated: false, record: null });
        expect(signer.calls.length).toBe(0);
        // No address burned for a rotation nobody asked for.
        expect((await vault.addresses.list()).length).toBe(1);
    });

    it('fails OPEN when derivation throws: the send still composes', async () => {
        const broken = {
            id: 'broken', kind: 'software',
            async getAddresses() { throw new Error('device unplugged'); },
        };
        const out = await resolveChangeAddress(opts(vault, broken, { settings: ROTATION_ON }));
        expect(out).toEqual({ address: 'addr_0_0_0', rotated: false, record: null });
    });

    it('fails open when no signer is in hand (locked wallet)', async () => {
        const out = await resolveChangeAddress(opts(vault, null, { settings: ROTATION_ON }));
        expect(out.rotated).toBe(false);
        expect(out.address).toBe('addr_0_0_0');
    });
});
