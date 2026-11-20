// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: §11.3.2 active (operating) address per chain. Resolution defaults to
// the lowest-index HD receive address, honors a stored override, and falls
// back when the override points at a deleted address. setActiveAddress writes
// the override and validates account ownership.

import { describe, it, expect } from 'vitest';
import { resolveActiveAddresses, setActiveAddress } from '../../../packages/core/src/flows/activeAddress.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import { createWallet } from '../../../packages/core/src/schemas/wallet.js';
import { createAddress } from '../../../packages/core/src/schemas/address.js';

function memCollection(initial = []) {
    const m = new Map(initial.map((r) => [r.id, JSON.parse(JSON.stringify(r))]));
    return {
        get: async (id) => (m.has(id) ? JSON.parse(JSON.stringify(m.get(id))) : null),
        put: async (rec) => { m.set(rec.id, JSON.parse(JSON.stringify(rec))); },
        update: async (id, decide) => {
            const next = decide(m.has(id) ? JSON.parse(JSON.stringify(m.get(id))) : null);
            if (next == null) return false;
            m.set(id, JSON.parse(JSON.stringify(next)));
            return true;
        },
        list: async () => Array.from(m.values()).map((r) => JSON.parse(JSON.stringify(r))),
        delete: async (id) => m.delete(id),
        findBy: async (field, value) =>
            Array.from(m.values()).filter((r) => r[field] === value).map((r) => JSON.parse(JSON.stringify(r))),
        _map: m,
    };
}

const chainRegistry = {
    chainIdFor: (coin, network) => (
        coin === 'bitcoin' && network === 'regtest' ? 'bitcoin-regtest' : null
    ),
};

function mkAddr(id, idx, over = {}) {
    return {
        schemaVersion: 4,
        id,
        accountId: 'acct-a',
        chain: 'bitcoin',
        network: 'regtest',
        source: 'hd',
        addressType: 'p2wpkh',
        derivationPath: `m/84'/0'/0'/0/${idx}`,
        address: `addr_${id}`,
        publicKey: `pub_${id}`,
        label: '',
        role: 'receive',
        ...over,
    };
}

function makeVault({ account, addresses, wallets }) {
    return {
        accounts: memCollection(account ? [account] : []),
        addresses: memCollection(addresses),
        ...(wallets ? { wallets: memCollection(wallets) } : {}),
    };
}

// An imported-WIF address: wallet-scoped, so accountId is null and there
// is no derivation path (§11.3.3).
function mkImported(id, over = {}) {
    return {
        schemaVersion: 4,
        id,
        accountId: null,
        chain: 'bitcoin',
        network: 'regtest',
        source: 'imported-wif',
        addressType: 'p2pkh',
        derivationPath: null,
        address: `addr_${id}`,
        publicKey: `pub_${id}`,
        label: '',
        role: 'receive',
        ...over,
    };
}

const baseAccount = {
    schemaVersion: 2, id: 'acct-a', walletId: 'w1', name: 'A', index: 0,
    activeAddressByChainId: {}, createdAt: '2026-01-01T00:00:00.000Z',
};

describe('resolveActiveAddresses', () => {
    it('defaults to the lowest-index receive address when no override', async () => {
        const vault = makeVault({
            account: baseAccount,
            addresses: [mkAddr('a1', 1), mkAddr('a0', 0), mkAddr('a2', 2)],
        });
        const out = await resolveActiveAddresses({ vault, accountId: 'acct-a', chainRegistry });
        expect(out['bitcoin-regtest']).toEqual({ id: 'a0', address: 'addr_a0' });
    });

    it('honors a stored override', async () => {
        const vault = makeVault({
            account: { ...baseAccount, activeAddressByChainId: { 'bitcoin-regtest': 'a2' } },
            addresses: [mkAddr('a0', 0), mkAddr('a2', 2)],
        });
        const out = await resolveActiveAddresses({ vault, accountId: 'acct-a', chainRegistry });
        expect(out['bitcoin-regtest'].id).toBe('a2');
    });

    it('falls back to the default when the override points at a deleted address', async () => {
        const vault = makeVault({
            account: { ...baseAccount, activeAddressByChainId: { 'bitcoin-regtest': 'gone' } },
            addresses: [mkAddr('a0', 0), mkAddr('a1', 1)],
        });
        const out = await resolveActiveAddresses({ vault, accountId: 'acct-a', chainRegistry });
        expect(out['bitcoin-regtest'].id).toBe('a0');
    });

    it('ignores dispenser-role addresses for the default', async () => {
        const vault = makeVault({
            account: baseAccount,
            addresses: [mkAddr('disp', 0, { role: 'dispenser' }), mkAddr('recv', 1, { role: 'receive' })],
        });
        const out = await resolveActiveAddresses({ vault, accountId: 'acct-a', chainRegistry });
        expect(out['bitcoin-regtest'].id).toBe('recv');
    });

    it.each(['trezor', 'ledger'])('defaults a %s account to its lowest external address', async (source) => {
        const vault = makeVault({
            account: baseAccount,
            addresses: [
                mkAddr('hw2', 2, { source }),
                mkAddr('hw0', 0, { source }),
                mkAddr('change', 0, { source, derivationPath: "m/84'/0'/0'/1/0" }),
                mkAddr('disp', 0, { source, role: 'dispenser' }),
            ],
        });
        const out = await resolveActiveAddresses({ vault, accountId: 'acct-a', chainRegistry });
        expect(out['bitcoin-regtest']).toEqual({ id: 'hw0', address: 'addr_hw0' });
    });

    it('keeps the software default when hardware and software addresses are mixed', async () => {
        const vault = makeVault({
            account: baseAccount,
            addresses: [mkAddr('hw0', 0, { source: 'trezor' }), mkAddr('hd1', 1)],
        });
        const out = await resolveActiveAddresses({ vault, accountId: 'acct-a', chainRegistry });
        expect(out['bitcoin-regtest'].id).toBe('hd1');
    });
});

describe('setActiveAddress', () => {
    it('writes the override on the account', async () => {
        const vault = makeVault({ account: baseAccount, addresses: [mkAddr('a0', 0), mkAddr('a1', 1)] });
        const res = await setActiveAddress({ vault, accountId: 'acct-a', chainId: 'bitcoin-regtest', addressId: 'a1' });
        expect(res).toEqual({ ok: true });
        const stored = await vault.accounts.get('acct-a');
        expect(stored.activeAddressByChainId['bitcoin-regtest']).toBe('a1');
    });

    it('rejects an address that belongs to another account', async () => {
        const vault = makeVault({
            account: baseAccount,
            addresses: [mkAddr('a0', 0), mkAddr('other', 0, { accountId: 'acct-b' })],
        });
        await expect(
            setActiveAddress({ vault, accountId: 'acct-a', chainId: 'bitcoin-regtest', addressId: 'other' }),
        ).rejects.toThrow(/does not belong/);
    });

    // Wallet E2E session 16 / D-65. An imported key has accountId=null, so
    // the account check refused it and "Use" always failed - and because
    // Send spends the ACTIVE address and has no source picker, that made
    // an imported key unspendable through the UI entirely.
    it('activates an imported key linked through the wallet importedKeys', async () => {
        const vault = makeVault({
            account: baseAccount,
            addresses: [mkAddr('a0', 0), mkImported('wif1')],
            wallets: [{ id: 'w1', importedKeys: [{ addressId: 'wif1' }] }],
        });
        const res = await setActiveAddress({ vault, accountId: 'acct-a', chainId: 'bitcoin-regtest', addressId: 'wif1' });
        expect(res).toEqual({ ok: true });
        const stored = await vault.accounts.get('acct-a');
        expect(stored.activeAddressByChainId['bitcoin-regtest']).toBe('wif1');
    });

    it('rejects an imported key belonging to a DIFFERENT wallet', async () => {
        const vault = makeVault({
            account: baseAccount,
            addresses: [mkAddr('a0', 0), mkImported('wif-other')],
            wallets: [
                { id: 'w1', importedKeys: [] },
                { id: 'w2', importedKeys: [{ addressId: 'wif-other' }] },
            ],
        });
        await expect(
            setActiveAddress({ vault, accountId: 'acct-a', chainId: 'bitcoin-regtest', addressId: 'wif-other' }),
        ).rejects.toThrow(/does not belong/);
    });

    it('fails closed when the wallet record cannot be read', async () => {
        const vault = makeVault({
            account: baseAccount,
            addresses: [mkAddr('a0', 0), mkImported('wif1')],
        });
        await expect(
            setActiveAddress({ vault, accountId: 'acct-a', chainId: 'bitcoin-regtest', addressId: 'wif1' }),
        ).rejects.toThrow(/does not belong/);
    });
});

// D-65 (session 16): "Use" on an imported key wrote an override that
// resolveActiveAddresses could never find, because the same account
// filter skipped the address - so the UI silently kept the old active
// address and the key stayed unspendable.
describe('resolveActiveAddresses with imported keys', () => {
    it('resolves an override that points at an imported key', async () => {
        const vault = makeVault({
            account: { ...baseAccount, activeAddressByChainId: { 'bitcoin-regtest': 'wif1' } },
            addresses: [mkAddr('a0', 0), mkImported('wif1')],
            wallets: [{ id: 'w1', importedKeys: [{ addressId: 'wif1' }] }],
        });
        const out = await resolveActiveAddresses({ vault, accountId: 'acct-a', chainRegistry });
        expect(out['bitcoin-regtest']).toEqual({ id: 'wif1', address: 'addr_wif1' });
    });

    it('never makes an imported key the DEFAULT active address', async () => {
        const vault = makeVault({
            account: baseAccount,
            addresses: [mkAddr('a0', 0), mkImported('wif1')],
            wallets: [{ id: 'w1', importedKeys: [{ addressId: 'wif1' }] }],
        });
        const out = await resolveActiveAddresses({ vault, accountId: 'acct-a', chainRegistry });
        expect(out['bitcoin-regtest'].id).toBe('a0');
    });

    it('ignores an imported key belonging to another wallet', async () => {
        const vault = makeVault({
            account: { ...baseAccount, activeAddressByChainId: { 'bitcoin-regtest': 'wif-other' } },
            addresses: [mkAddr('a0', 0), mkImported('wif-other')],
            wallets: [{ id: 'w1', importedKeys: [] }, { id: 'w2', importedKeys: [{ addressId: 'wif-other' }] }],
        });
        const out = await resolveActiveAddresses({ vault, accountId: 'acct-a', chainRegistry });
        expect(out['bitcoin-regtest'].id).toBe('a0');
    });
});

describe('zero-account key-only wallet', () => {
    const importedKeys = [
        { addressId: 'wif-first' },
        { addressId: 'wif-second' },
    ];

    it('defaults by importedKeys order and honors a live wallet override', async () => {
        const wallet = { id: 'w1', importedKeys, activeAddressByChainId: {} };
        const vault = makeVault({
            addresses: [mkImported('wif-second'), mkImported('wif-first')],
            wallets: [wallet],
        });
        const first = await resolveActiveAddresses({ vault, walletId: 'w1', chainRegistry });
        expect(first['bitcoin-regtest'].id).toBe('wif-first');

        await vault.wallets.put({
            ...wallet,
            activeAddressByChainId: { 'bitcoin-regtest': 'wif-second' },
        });
        const selected = await resolveActiveAddresses({ vault, walletId: 'w1', chainRegistry });
        expect(selected['bitcoin-regtest'].id).toBe('wif-second');
    });

    it('falls back from a stale override and excludes another wallet key', async () => {
        const vault = makeVault({
            addresses: [mkImported('wif-first'), mkImported('foreign')],
            wallets: [
                { id: 'w1', importedKeys, activeAddressByChainId: { 'bitcoin-regtest': 'gone' } },
                { id: 'w2', importedKeys: [{ addressId: 'foreign' }] },
            ],
        });
        const out = await resolveActiveAddresses({ vault, walletId: 'w1', chainRegistry });
        expect(out['bitcoin-regtest']).toEqual({ id: 'wif-first', address: 'addr_wif-first' });
    });

    it('stores an override on the wallet and resolves it', async () => {
        const vault = makeVault({
            addresses: [mkImported('wif-first'), mkImported('wif-second')],
            wallets: [{ id: 'w1', importedKeys }],
        });
        await setActiveAddress({
            vault, walletId: 'w1', chainId: 'bitcoin-regtest', addressId: 'wif-second',
        });
        expect((await vault.wallets.get('w1')).activeAddressByChainId['bitcoin-regtest'])
            .toBe('wif-second');
        const out = await resolveActiveAddresses({ vault, walletId: 'w1', chainRegistry });
        expect(out['bitcoin-regtest'].id).toBe('wif-second');
    });

    it('rejects a foreign key, wrong chain, missing wallet, and wallets with accounts', async () => {
        const vault = makeVault({
            account: baseAccount,
            addresses: [mkImported('foreign'), mkImported('wrong', { network: 'mainnet' })],
            wallets: [
                { id: 'w1', importedKeys: [] },
                { id: 'w2', importedKeys: [{ addressId: 'foreign' }, { addressId: 'wrong' }] },
                { id: 'w3', importedKeys: [] },
            ],
        });
        const activate = (walletId, addressId) => setActiveAddress({
            vault, walletId, chainId: 'bitcoin-regtest', addressId,
        });
        await expect(activate('w1', 'foreign')).rejects.toThrow(/accountId is required/);
        await expect(activate('w3', 'foreign')).rejects.toThrow(/does not belong/);
        await expect(activate('w2', 'foreign')).resolves.toEqual({ ok: true });
        await expect(activate('w2', 'wrong')).rejects.toThrow(/chain/);
        await expect(activate('missing', 'foreign')).rejects.toThrow(/wallet/);
    });

    it('keeps a second key imported while the wallet override is being written', async () => {
        const vault = new Vault({ backend: new InMemoryBackend(), masterKey: new Uint8Array(32).fill(7) });
        await vault.open();
        const keyAddress = (address) => createAddress({
            accountId: null, chain: 'bitcoin', network: 'regtest', source: 'imported-wif',
            addressType: 'p2wpkh', derivationPath: null, address, publicKey: `02${'ab'.repeat(32)}`, label: 'k',
        });
        const first = keyAddress('bcrt1qfirstkey');
        const second = keyAddress('bcrt1qsecondkey');
        const wallet = {
            ...createWallet({
                name: 'Key', origin: 'imported-wif', format: 'wif-only', passphraseEnabled: false,
                encryptedSeed: '',
                kdfParams: { algorithm: 'argon2id', salt: 'c2FsdHZhbHVl', iterations: 3, memory: 65536, parallelism: 1 },
            }),
            importedKeys: [{ addressId: first.id, encryptedWif: 'd2lmMQ==', importedAt: '2026-01-01T00:00:00.000Z' }],
        };
        await vault.putMany([{ store: vault.wallets, record: wallet }, { store: vault.addresses, record: first }]);

        const activating = setActiveAddress({
            vault, walletId: wallet.id, chainId: 'bitcoin-regtest', addressId: first.id, chainRegistry,
        });
        // The same guarded write importWif uses to append a key.
        const importing = vault.putManyGuarded((document) => {
            const current = document.wallets.find((record) => record.id === wallet.id);
            const importedKeys = [...current.importedKeys, {
                addressId: second.id, encryptedWif: 'd2lmMg==', importedAt: '2026-01-02T00:00:00.000Z',
            }];
            return [
                { store: vault.addresses, record: second },
                { store: vault.wallets, record: { ...current, importedKeys } },
            ];
        });
        await Promise.all([activating, importing]);

        const stored = await vault.wallets.get(wallet.id);
        expect(stored.importedKeys.map((k) => k.encryptedWif)).toEqual(['d2lmMQ==', 'd2lmMg==']);
        expect(stored.activeAddressByChainId).toEqual({ 'bitcoin-regtest': first.id });
    });
});
