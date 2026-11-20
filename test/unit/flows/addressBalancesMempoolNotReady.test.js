// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The tracker's `mempool_ready` is a routine, short-lived state: it drops
// while each mempool pass stages new transactions and while the tracker trails
// a new block. The wallet therefore keeps reading the confirmed balance when
// the flag is false instead of withholding it, on both read paths (per address
// and the batch route), and a body without the field reads as before. This pins
// that a transient flag never turns Home into Unavailable.

import { beforeEach, describe, expect, it } from 'vitest';
import {
    addressBalances,
    walletBalances,
    _resetBatchSupportMemo,
} from '../../../packages/core/src/flows/balances.js';

const CHAIN_ID = 'bitcoin-regtest';
const SOURCE = 'bcrt1q4neq4jcky263n30yg42ypehfapef6zycf7qefy';
const DESCRIPTOR = { id: CHAIN_ID, coin: 'bitcoin', networkKind: 'regtest' };
const chainRegistry = {
    descriptorFor: (id) => (id === CHAIN_ID ? DESCRIPTOR : null),
    chainIdFor: (coin, network) => (coin === 'bitcoin' && network === 'regtest' ? CHAIN_ID : null),
    get(id) { return this.descriptorFor(id); },
};
const tokens = { total: 0, data: [] };

const body = (extra) => ({
    address: SOURCE,
    balances: { confirmed: '0.00150000', pending: '0.00000000' },
    tracker_available: true,
    ...extra,
});

const readOne = (addrBody) => addressBalances({
    sdkRegistry: { get: () => ({ getBalances: async () => tokens, getAddress: async () => addrBody }) },
    chainRegistry,
    chainId: CHAIN_ID,
    address: SOURCE,
});

function memCollection(rows) {
    const m = new Map(rows.map((r) => [r.id, r]));
    return {
        get: async (id) => m.get(id) || null,
        put: async (r) => { m.set(r.id, r); },
        list: async () => [...m.values()],
        delete: async (id) => { m.delete(id); },
        findBy: async (f, v) => [...m.values()].filter((r) => r[f] === v),
    };
}
const vault = {
    wallets: memCollection([{ id: 'w1', schemaVersion: 1, name: 'W', importedKeys: [] }]),
    accounts: memCollection([{ id: 'acct-1', walletId: 'w1', index: 0, name: 'Main' }]),
    addresses: memCollection([{
        id: 'addr-0', accountId: 'acct-1', chain: 'bitcoin', network: 'regtest', source: 'hd',
        addressType: 'p2wpkh', derivationPath: "m/84'/1'/0'/0/0", label: 'A', address: SOURCE,
    }]),
};

beforeEach(() => { _resetBatchSupportMemo(); });

describe('a coin balance while the tracker reports an unconverged mempool', () => {
    it('per address: mempool_ready false still reads the confirmed balance', async () => {
        const shape = await readOne(body({ mempool_ready: false }));
        expect(shape.native).toMatchObject({ quantity: '150000' });
        expect(shape.unavailable).toBeUndefined();
    });

    it('batch route: the same body reads the confirmed balance', async () => {
        const unconverged = body({
            mempool_ready: false,
            balances: { confirmed: '0.00150000', pending: '-0.00050000' },
        });
        const sdk = {
            getBalances: async () => tokens,
            getAddress: async () => unconverged,
            getBalancesBatch: async () => ({
                [SOURCE]: { balances: tokens, address: unconverged, error: null },
            }),
        };
        const res = await walletBalances({ vault, walletId: 'w1', chainRegistry, sdkRegistry: { get: () => sdk } });
        const entry = res[CHAIN_ID].find((e) => e.address === SOURCE);
        expect(entry.balances.native).toMatchObject({ quantity: '150000', pendingUnknown: true });
        expect(entry.balances.unavailable).toBeUndefined();
    });

    it.each([['true', { mempool_ready: true }], ['absent', {}], ['null', { mempool_ready: null }]])(
        'reads the balance when mempool_ready is %s',
        async (_label, extra) => {
            const shape = await readOne(body(extra));
            expect(shape.native).toMatchObject({ quantity: '150000' });
            expect(shape.unavailable).toBeUndefined();
        },
    );

    it('a tracker that is not answering is still unavailable whatever mempool_ready says', async () => {
        const shape = await readOne(body({ tracker_available: false, mempool_ready: true, balances: { confirmed: null } }));
        expect(shape.native).toBeNull();
        expect(shape.unavailable).toContain('native');
    });
});

describe('the pendingUnknown marker on the coin balance', () => {
    it('marks false as unknown without trusting or netting the pending figure', async () => {
        const shape = await readOne(body({
            mempool_ready: false,
            balances: { confirmed: '0.00150000', pending: '-0.00050000' },
        }));
        expect(shape.native).toMatchObject({ quantity: '150000', pendingUnknown: true });
        expect(shape.native).not.toHaveProperty('pendingQuantity');
        expect(shape.native).not.toHaveProperty('pendingOutgoingQuantity');
    });

    it.each([['true', { mempool_ready: true }], ['absent', {}], ['null', { mempool_ready: null }]])(
        'mempool_ready %s leaves the marker off',
        async (_label, extra) => {
            const shape = await readOne(body(extra));
            expect(shape.native).not.toHaveProperty('pendingUnknown');
        },
    );
});
