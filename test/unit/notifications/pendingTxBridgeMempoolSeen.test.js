// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// markPendingTxMempoolSeen: the writer behind the NotificationService's
// mempool-sighting hook (§4 M2.2).
//
// Idempotence is the property under test, and it is not a nicety. One
// transaction that pays two of our own addresses is delivered once per address
// channel BY DESIGN (measured during M1: two sockets, one frame each), so the
// writer is called more than once for a single sighting. A writer that
// re-stamped would keep moving the timestamp the "dropped or replaced?"
// reading is measured against, and the warning would never arrive.

import { describe, it, expect } from 'vitest';
import {
    markPendingTxIndexed,
    markPendingTxMempoolSeen,
} from '../../../packages/core/src/notifications/pendingTxBridge.js';

const FIRST = '2026-08-27T12:01:20.000Z';
const LATER = '2026-08-27T12:09:00.000Z';

// Minimal in-memory stand-in for vault.pendingTxs (findBy / put), matching the
// shape the sibling bridge tests use.
function makeVault(rows) {
    const store = rows.slice();
    return {
        pendingTxs: {
            async findBy(field, value) {
                return store.filter((r) => r[field] === value).map((r) => ({ ...r }));
            },
            async put(record) {
                const i = store.findIndex((r) => r.id === record.id);
                if (i >= 0) store[i] = record; else store.push(record);
            },
        },
        _store: store,
    };
}

describe('markPendingTxMempoolSeen', () => {
    it('stamps mempoolSeenAt on a broadcast record', async () => {
        const vault = makeVault([
            { id: '1', txid: 'a', status: 'broadcast', mempoolSeenAt: null },
        ]);
        const changed = await markPendingTxMempoolSeen(vault, 'a', { now: () => FIRST });
        expect(changed).toBe(true);
        expect(vault._store[0].mempoolSeenAt).toBe(FIRST);
    });

    it('keeps the FIRST sighting when the same frame arrives again', async () => {
        const vault = makeVault([
            { id: '1', txid: 'a', status: 'broadcast', mempoolSeenAt: null },
        ]);
        await markPendingTxMempoolSeen(vault, 'a', { now: () => FIRST });
        const changed = await markPendingTxMempoolSeen(vault, 'a', { now: () => LATER });
        expect(changed).toBe(false);
        expect(vault._store[0].mempoolSeenAt).toBe(FIRST);
    });

    it('leaves the rest of the record alone: status is not a display state', async () => {
        const vault = makeVault([
            {
                id: '1',
                txid: 'a',
                status: 'broadcast',
                mempoolSeenAt: null,
                confirmedAt: null,
                tick: 'PEPECREATURE',
                amount: '1',
            },
        ]);
        await markPendingTxMempoolSeen(vault, 'a', { now: () => FIRST });
        const rec = vault._store[0];
        expect(rec.status).toBe('broadcast');
        expect(rec.confirmedAt).toBe(null);
        expect(rec.tick).toBe('PEPECREATURE');
        expect(rec.amount).toBe('1');
    });

    it('skips a record the indexer already confirmed', async () => {
        // A mempool sighting is pre-validation and adds nothing to a
        // transaction that is already in a block.
        const vault = makeVault([
            { id: '1', txid: 'a', status: 'indexed', mempoolSeenAt: null },
        ]);
        const changed = await markPendingTxMempoolSeen(vault, 'a', { now: () => FIRST });
        expect(changed).toBe(false);
        expect(vault._store[0].mempoolSeenAt).toBe(null);
    });

    it('stamps every record sharing the txid, and only those', async () => {
        const vault = makeVault([
            { id: '1', txid: 'a', status: 'broadcast', mempoolSeenAt: null },
            { id: '2', txid: 'a', status: 'broadcast', mempoolSeenAt: null },
            { id: '3', txid: 'b', status: 'broadcast', mempoolSeenAt: null },
        ]);
        await markPendingTxMempoolSeen(vault, 'a', { now: () => FIRST });
        expect(vault._store[0].mempoolSeenAt).toBe(FIRST);
        expect(vault._store[1].mempoolSeenAt).toBe(FIRST);
        expect(vault._store[2].mempoolSeenAt).toBe(null);
    });

    it('is a no-op without a vault or a txid', async () => {
        expect(await markPendingTxMempoolSeen(null, 'a')).toBe(false);
        expect(await markPendingTxMempoolSeen(makeVault([]), '')).toBe(false);
    });

    it('writes a real ISO timestamp with no clock injected', async () => {
        const vault = makeVault([
            { id: '1', txid: 'a', status: 'broadcast', mempoolSeenAt: null },
        ]);
        await markPendingTxMempoolSeen(vault, 'a');
        const stamped = vault._store[0].mempoolSeenAt;
        expect(typeof stamped).toBe('string');
        expect(Number.isFinite(Date.parse(stamped))).toBe(true);
    });

    it('keeps indexed confirmation fields when indexed and mempool writes race in both orders', async () => {
        const CONFIRMED = '2026-08-27T12:10:00.000Z';
        const orders = [
            ['indexed', 'mempool'],
            ['mempool', 'indexed'],
        ];

        for (const order of orders) {
            const vault = makeVault([
                {
                    id: '1',
                    txid: 'a',
                    status: 'broadcast',
                    mempoolSeenAt: null,
                    confirmedAt: null,
                    chainConfirmed: false,
                },
            ]);
            const findBy = vault.pendingTxs.findBy.bind(vault.pendingTxs);
            let releaseFirstRead;
            let signalFirstRead;
            const firstRead = new Promise((resolve) => { signalFirstRead = resolve; });
            const firstReadGate = new Promise((resolve) => { releaseFirstRead = resolve; });
            let reads = 0;
            vault.pendingTxs.findBy = async (...args) => {
                const rows = await findBy(...args);
                reads += 1;
                if (reads === 1) {
                    signalFirstRead();
                    await firstReadGate;
                }
                return rows;
            };
            const writes = {
                indexed: () => markPendingTxIndexed(vault, 'a', {
                    now: () => CONFIRMED,
                    inclusion: { blockIndex: 42 },
                }),
                mempool: () => markPendingTxMempoolSeen(vault, 'a', { now: () => FIRST }),
            };

            const first = writes[order[0]]();
            await firstRead;
            const second = writes[order[1]]();
            releaseFirstRead();
            await Promise.all([first, second]);

            expect(vault._store[0], order.join(' then ')).toMatchObject({
                status: 'indexed',
                confirmedAt: CONFIRMED,
                chainConfirmed: true,
                confirmedBlockIndex: 42,
            });
        }
    });

    it('runs a later ledger write after an earlier write rejects', async () => {
        const vault = makeVault([
            { id: '1', txid: 'a', status: 'broadcast', mempoolSeenAt: null },
            { id: '2', txid: 'b', status: 'broadcast', confirmedAt: null },
        ]);
        const put = vault.pendingTxs.put.bind(vault.pendingTxs);
        let puts = 0;
        vault.pendingTxs.put = async (record) => {
            puts += 1;
            if (puts === 1) throw new Error('injected write failure');
            return put(record);
        };

        const rejected = markPendingTxMempoolSeen(vault, 'a', { now: () => FIRST });
        const succeeded = markPendingTxIndexed(vault, 'b', { now: () => LATER });

        await expect(rejected).rejects.toThrow('injected write failure');
        await expect(succeeded).resolves.toBe(true);
        expect(vault._store.find((r) => r.id === '2')).toMatchObject({
            status: 'indexed',
            confirmedAt: LATER,
        });
    });

    it('does not write when either ledger writer receives an unknown txid', async () => {
        const vault = makeVault([
            { id: '1', txid: 'a', status: 'broadcast', mempoolSeenAt: null },
        ]);
        const put = vault.pendingTxs.put.bind(vault.pendingTxs);
        let puts = 0;
        vault.pendingTxs.put = async (record) => {
            puts += 1;
            return put(record);
        };

        await expect(markPendingTxIndexed(vault, 'missing')).resolves.toBe(false);
        await expect(markPendingTxMempoolSeen(vault, 'missing')).resolves.toBe(false);
        expect(puts).toBe(0);
        expect(vault._store).toHaveLength(1);
    });
});
