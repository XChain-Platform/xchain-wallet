// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect } from 'vitest';
import {
    getBroadcastTxids,
    markPendingTxIndexed,
} from '../../../packages/core/src/notifications/pendingTxBridge.js';

// Minimal in-memory stand-in for vault.pendingTxs (list / findBy / put).
function makeVault(rows) {
    const store = rows.slice();
    return {
        pendingTxs: {
            async list() { return store.map((r) => ({ ...r })); },
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

describe('getBroadcastTxids', () => {
    it('returns only txids of broadcast-status records', async () => {
        const vault = makeVault([
            { id: '1', txid: 'a', status: 'broadcast' },
            { id: '2', txid: 'b', status: 'indexed' },
            { id: '3', txid: 'c', status: 'broadcast' },
            { id: '4', txid: null, status: 'broadcast' },
        ]);
        const set = await getBroadcastTxids(vault);
        expect(set).toBeInstanceOf(Set);
        expect([...set].sort()).toEqual(['a', 'c']);
    });

    it('empty for a null vault', async () => {
        expect((await getBroadcastTxids(null)).size).toBe(0);
    });
});

describe('markPendingTxIndexed', () => {
    it('flips a broadcast record to indexed and stamps confirmedAt', async () => {
        const vault = makeVault([
            { id: '1', txid: 'a', status: 'broadcast', confirmedAt: null },
        ]);
        const changed = await markPendingTxIndexed(vault, 'a', { now: () => '2026-06-15T00:00:00.000Z' });
        expect(changed).toBe(true);
        expect(vault._store[0].status).toBe('indexed');
        expect(vault._store[0].confirmedAt).toBe('2026-06-15T00:00:00.000Z');
    });

    it('no-ops when already indexed or no match', async () => {
        const vault = makeVault([{ id: '1', txid: 'a', status: 'indexed', confirmedAt: 'x' }]);
        expect(await markPendingTxIndexed(vault, 'a')).toBe(false);
        expect(await markPendingTxIndexed(vault, 'nope')).toBe(false);
    });
});
