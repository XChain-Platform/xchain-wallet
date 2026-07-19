// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: flows/pendingAirdrops (§40.9). CRUD over the vault's
// pendingAirdrops collection. updatePendingAirdrop re-reads before
// writing and preserves id + schemaVersion across a patch; every entry
// point guards its required args.

import { describe, it, expect } from 'vitest';
import {
    savePendingAirdrop,
    listPendingAirdropsForWallet,
    updatePendingAirdrop,
    clearPendingAirdrop,
} from '../../../packages/core/src/flows/pendingAirdrops.js';

function memCollection(initial = []) {
    const m = new Map(initial.map((r) => [r.id, r]));
    return {
        get: async (id) => (m.has(id) ? m.get(id) : null),
        put: async (rec) => { m.set(rec.id, rec); },
        delete: async (id) => m.delete(id),
        findBy: async (field, value) => Array.from(m.values()).filter((r) => r[field] === value),
        _map: m,
    };
}

function makeVault(initial = []) {
    return { pendingAirdrops: memCollection(initial) };
}

const baseRecord = {
    schemaVersion: 1, id: 'ad1', walletId: 'w1', tick: 'MYTOKEN', stage: 'save',
};

describe('flows/pendingAirdrops save + list', () => {
    it('persists a record and scopes the list to a wallet', async () => {
        const vault = makeVault();
        await savePendingAirdrop({ vault, record: baseRecord });
        await savePendingAirdrop({ vault, record: { ...baseRecord, id: 'ad2', walletId: 'w2' } });
        expect(await listPendingAirdropsForWallet({ vault, walletId: 'w1' })).toEqual([baseRecord]);
        expect(await listPendingAirdropsForWallet({ vault, walletId: 'w2' })).toHaveLength(1);
    });

    it('guards required args on save + list', async () => {
        const vault = makeVault();
        await expect(savePendingAirdrop({ record: baseRecord })).rejects.toThrow(/vault is required/);
        await expect(savePendingAirdrop({ vault })).rejects.toThrow(/record is required/);
        await expect(listPendingAirdropsForWallet({ walletId: 'w1' })).rejects.toThrow(/vault is required/);
        await expect(listPendingAirdropsForWallet({ vault })).rejects.toThrow(/walletId is required/);
    });
});

describe('flows/pendingAirdrops update', () => {
    it('merges a patch while preserving id and schemaVersion', async () => {
        const vault = makeVault([baseRecord]);
        const next = await updatePendingAirdrop({
            vault, id: 'ad1', patch: { stage: 'done', airdropTxid: 'abc', id: 'HIJACK', schemaVersion: 99 },
        });
        expect(next).toMatchObject({ id: 'ad1', schemaVersion: 1, stage: 'done', airdropTxid: 'abc', tick: 'MYTOKEN' });
        const stored = await vault.pendingAirdrops.get('ad1');
        expect(stored.stage).toBe('done');
    });

    it('throws for an unknown id', async () => {
        const vault = makeVault([baseRecord]);
        await expect(updatePendingAirdrop({ vault, id: 'nope', patch: { stage: 'x' } }))
            .rejects.toThrow(/no record for id "nope"/);
    });

    it('guards required args', async () => {
        const vault = makeVault([baseRecord]);
        await expect(updatePendingAirdrop({ id: 'ad1', patch: {} })).rejects.toThrow(/vault is required/);
        await expect(updatePendingAirdrop({ vault, patch: {} })).rejects.toThrow(/id is required/);
        await expect(updatePendingAirdrop({ vault, id: 'ad1' })).rejects.toThrow(/patch is required/);
        await expect(updatePendingAirdrop({ vault, id: 'ad1', patch: 'nope' })).rejects.toThrow(/patch is required/);
    });
});

describe('flows/pendingAirdrops clear', () => {
    it('removes a record by id', async () => {
        const vault = makeVault([baseRecord]);
        await clearPendingAirdrop({ vault, id: 'ad1' });
        expect(await listPendingAirdropsForWallet({ vault, walletId: 'w1' })).toHaveLength(0);
    });

    it('guards required args', async () => {
        const vault = makeVault();
        await expect(clearPendingAirdrop({ id: 'ad1' })).rejects.toThrow(/vault is required/);
        await expect(clearPendingAirdrop({ vault })).rejects.toThrow(/id is required/);
    });
});
