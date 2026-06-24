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

function memCollection(initial = []) {
    const m = new Map(initial.map((r) => [r.id, JSON.parse(JSON.stringify(r))]));
    return {
        get: async (id) => (m.has(id) ? JSON.parse(JSON.stringify(m.get(id))) : null),
        put: async (rec) => { m.set(rec.id, JSON.parse(JSON.stringify(rec))); },
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

function makeVault({ account, addresses }) {
    return {
        accounts: memCollection([account]),
        addresses: memCollection(addresses),
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
});
