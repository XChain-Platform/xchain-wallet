// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Send done card follows its transaction from the local PendingTx record
// and confirmed history only; it reads no mempool. These pin that a send still
// waiting for its block reads pending there, however long the block takes,
// while real failures still read failed.

import { describe, it, expect } from 'vitest';
import { pendingTxToEntry, DROPPED_GRACE_MS } from '../../../packages/core/src/shared/utils/pendingHistory.js';
import {
    classifyEntryStatus,
    classifyEntryStatusWithoutMempool,
} from '../../../packages/core/src/shared/utils/historyFilter.js';

const CHAIN = 'bitcoin-regtest';
const SOURCE = 'bcrt1q8nhaqaeuaq9usplgeh9d6f0unvp5rdvnrwdgua';
const TXID = 'f227f248da645036c7c65ba3f6c5188aca7d8429bddd61a89ae4cdfd27b22e35';
const BROADCAST_AT = Date.parse('2026-10-17T02:29:45.000Z');
const SEEN_AT = BROADCAST_AT + 30_000;

function localEntry(overrides = {}) {
    return pendingTxToEntry({
        chainId: CHAIN,
        address: SOURCE,
        pendingTx: {
            id: 'ptx-1',
            txid: TXID,
            status: 'broadcast',
            action: 'SEND',
            fromAddress: SOURCE,
            toAddress: 'bcrt1qu8kx64vqhd2wu7mullat087u8dkveygfnefdk0',
            tick: 'CBH080956',
            amount: '4',
            broadcastAt: new Date(BROADCAST_AT).toISOString(),
            mempoolSeenAt: new Date(SEEN_AT).toISOString(),
            ...overrides,
        },
        ownAddresses: new Set([SOURCE]),
        observedAtMs: BROADCAST_AT,
    });
}

describe('classifyEntryStatusWithoutMempool', () => {
    const longAfterSighting = SEEN_AT + DROPPED_GRACE_MS + 60_000;

    it('keeps a sighted, unconfirmed send pending past the dropped grace', () => {
        const entry = localEntry();
        // The mempool-aware reading calls it failed: the case the done card hit.
        expect(classifyEntryStatus(entry, longAfterSighting)).toBe('failed');
        expect(classifyEntryStatusWithoutMempool(entry, longAfterSighting)).toBe('pending');
    });

    it('still reads a failed local record as failed', () => {
        const entry = localEntry({ status: 'failed', error: 'broadcast refused' });
        expect(classifyEntryStatusWithoutMempool(entry, longAfterSighting)).toBe('failed');
    });

    it('reads a record the wallet proved into a block as confirmed', () => {
        const entry = localEntry({ status: 'indexed', chainConfirmed: true, confirmedBlockIndex: 1161 });
        expect(entry).not.toBeNull();
        expect(classifyEntryStatusWithoutMempool(entry, longAfterSighting)).toBe('confirmed');
    });

    it('follows the explorer for confirmed and invalid history rows', () => {
        const confirmed = { blockIndex: 1161, raw: { status: 'valid' } };
        const invalid = { blockIndex: 1161, raw: { status: 'invalid' } };
        expect(classifyEntryStatusWithoutMempool(confirmed, longAfterSighting)).toBe('confirmed');
        expect(classifyEntryStatusWithoutMempool(invalid, longAfterSighting)).toBe('failed');
    });
});
