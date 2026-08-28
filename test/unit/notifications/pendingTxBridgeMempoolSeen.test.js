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
});
