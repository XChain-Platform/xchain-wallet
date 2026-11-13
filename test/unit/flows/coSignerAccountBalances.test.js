// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: agent account balances come from one batch read per chain, never one
// read per account. The read count is measured at two row counts and must
// not grow with the rows.

import { describe, it, expect, beforeEach } from 'vitest';
import { coSignerAccountBalances } from '../../../packages/core/src/flows/coSignerAccountBalances.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import { createCoSignerAccount } from '../../../packages/core/src/schemas/coSignerAccount.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';

function countingSdk({ batch = true } = {}) {
    const reads = { batch: 0, single: 0, addresses: [] };
    const sdk = {
        getBalances: async () => { reads.single += 1; return { data: [] }; },
        getAddress: async () => { reads.single += 1; return { balances: { confirmed: '0' } }; },
    };
    if (batch) {
        sdk.getBalancesBatch = async (addresses) => {
            reads.batch += 1;
            reads.addresses.push(addresses.length);
            return Object.fromEntries(addresses.map((address, i) => [address, {
                address: { address, balances: { confirmed: '0.48210000' } },
                balances: { data: [{ tick: 'MYTOKEN', amount: String(1000 + i), decimals: 0 }] },
                error: null,
            }]));
        };
    }
    return { sdk, reads };
}

async function seed(vault, count, walletId = 'wallet-1') {
    const ids = [];
    for (let i = 0; i < count; i += 1) {
        const hex = i.toString(16).padStart(2, '0');
        const record = createCoSignerAccount({
            walletId,
            chainId: 'bitcoin-regtest',
            name: `Agent ${i}`,
            aggregateAddress: `bcrt1pagent${hex}`,
            agentPubkey: '02' + hex.repeat(32),
            daemonPubkey: '03' + hex.repeat(32),
            daemonDerivationPath: `m/86'/1'/0'/0/${i}`,
            publicKeyOrder: ['02' + hex.repeat(32), '03' + hex.repeat(32)],
            policy: { allowedActions: ['SEND'] },
        });
        await vault.coSignerAccounts.put(record);
        ids.push(record.id);
    }
    return ids;
}

describe('coSignerAccountBalances', () => {
    let vault;
    beforeEach(async () => {
        vault = new Vault({ backend: new InMemoryBackend(), masterKey: new Uint8Array(32).fill(9) });
        await vault.open();
    });

    async function readsFor(rows) {
        const local = new Vault({ backend: new InMemoryBackend(), masterKey: new Uint8Array(32).fill(9) });
        await local.open();
        await seed(local, rows);
        const { sdk, reads } = countingSdk();
        const result = await coSignerAccountBalances({
            vault: local, sdkRegistry: { get: () => sdk }, chainRegistry: defaultRegistry(), walletId: 'wallet-1',
        });
        expect(Object.keys(result)).toHaveLength(rows);
        return reads;
    }

    it('makes the same number of explorer reads for 2 accounts as for 12', async () => {
        const small = await readsFor(2);
        const large = await readsFor(12);
        expect(small.batch).toBe(1);
        expect(large.batch).toBe(small.batch);
        expect(small.single).toBe(0);
        expect(large.single).toBe(0);
        expect(large.addresses).toEqual([12]);
    });

    it('shapes each account balance with the chain coin and its tokens', async () => {
        const ids = await seed(vault, 2);
        const { sdk } = countingSdk();
        const result = await coSignerAccountBalances({
            vault, sdkRegistry: { get: () => sdk }, chainRegistry: defaultRegistry(), walletId: 'wallet-1',
        });
        const balances = result[ids[0]].balances;
        expect(result[ids[0]].error).toBeNull();
        expect(balances.native).toMatchObject({ tick: 'BTC', quantity: '48210000', divisibility: 8 });
        expect(balances.tokens.map((row) => row.tick)).toEqual(['MYTOKEN']);
    });

    it('leaves balances unavailable instead of reading per account when the batch route is missing', async () => {
        const ids = await seed(vault, 3);
        const { sdk, reads } = countingSdk({ batch: false });
        const result = await coSignerAccountBalances({
            vault, sdkRegistry: { get: () => sdk }, chainRegistry: defaultRegistry(), walletId: 'wallet-1',
        });
        expect(reads.single).toBe(0);
        for (const id of ids) {
            expect(result[id]).toEqual({ balances: null, error: 'balance service unavailable' });
        }
    });

    it('marks every account in a failed batch with the failure, without retrying per account', async () => {
        const ids = await seed(vault, 2);
        const reads = { batch: 0, single: 0 };
        const sdk = {
            getBalancesBatch: async () => { reads.batch += 1; throw new Error('rate limited'); },
            getBalances: async () => { reads.single += 1; },
        };
        const result = await coSignerAccountBalances({
            vault, sdkRegistry: { get: () => sdk }, chainRegistry: defaultRegistry(), walletId: 'wallet-1',
        });
        expect(reads).toEqual({ batch: 1, single: 0 });
        expect(result[ids[1]]).toEqual({ balances: null, error: 'rate limited' });
    });

    it('reads only the asked wallet', async () => {
        await seed(vault, 2, 'wallet-2');
        const { sdk, reads } = countingSdk();
        const result = await coSignerAccountBalances({
            vault, sdkRegistry: { get: () => sdk }, chainRegistry: defaultRegistry(), walletId: 'wallet-1',
        });
        expect(result).toEqual({});
        expect(reads.batch).toBe(0);
    });
});
