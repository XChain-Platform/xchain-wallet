// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit tests for the M2.1 pending-history merge.

import { describe, it, expect } from 'vitest';
import {
    compareMergedEntries,
    directionFor,
    DROPPED_GRACE_MS,
    firstSeenToMs,
    isLivePendingStatus,
    mempoolRowToEntry,
    mergePendingEntries,
    NETWORK_SEEN_WINDOW_MS,
    pendingDisplayState,
    pendingTxToEntry,
} from '../../../packages/core/src/shared/utils/pendingHistory.js';
import {
    applyHistoryFilters,
    classifyEntryStatus,
} from '../../../packages/core/src/shared/utils/historyFilter.js';
import { isEntryReplaceable } from '../../../packages/core/src/flows/rbfReplace.js';

const CHAIN = 'litecoin-regtest';
const OURS = 'mtkx2FQownAddress';
const THEIRS = 'moV6MFmTheirAddress';
const OWN = new Set([OURS.toLowerCase()]);
const NOW = 1787886764000;

function mempoolRow(over = {}) {
    return {
        tx_hash: 'AABBCC',
        source: THEIRS,
        action: 'SEND',
        data: 'SEND|2|XCHAIN|100|' + OURS,
        first_seen: 1787886764,
        destinations: [OURS],
        ...over,
    };
}

function pendingTx(over = {}) {
    return {
        id: 'ptx-1',
        chain: 'LTC',
        network: 'regtest',
        fromAddress: OURS,
        toAddress: THEIRS,
        action: 'SEND',
        actionSummary: 'Send 100 XCHAIN',
        txid: 'DDEEFF',
        status: 'broadcast',
        createdAt: '2026-08-27T00:00:00.000Z',
        broadcastAt: '2026-08-27T00:00:10.000Z',
        mempoolSeenAt: null,
        rbfReplacement: null,
        tick: 'XCHAIN',
        amount: '100',
        ...over,
    };
}

const fromMempool = (over = {}, observedAtMs = NOW) => mempoolRowToEntry({
    chainId: CHAIN, address: OURS, row: mempoolRow(over), ownAddresses: OWN, observedAtMs,
});
const fromLocal = (over = {}, observedAtMs = NOW) => pendingTxToEntry({
    chainId: CHAIN, address: OURS, pendingTx: pendingTx(over), ownAddresses: OWN, observedAtMs,
});

describe('firstSeenToMs', () => {
    it('reads unix seconds, the wire form the decoder column carries', () => {
        expect(firstSeenToMs(1787886764)).toBe(1787886764000);
    });
    it('passes a value already in milliseconds through unscaled', () => {
        expect(firstSeenToMs(1787886764000)).toBe(1787886764000);
    });
    it('treats absent / zero / non-numeric as no network sighting', () => {
        expect(firstSeenToMs(null)).toBeNull();
        expect(firstSeenToMs(0)).toBeNull();
        expect(firstSeenToMs('nope')).toBeNull();
    });
});

describe('isLivePendingStatus', () => {
    it('admits only the statuses that mean "on the network, not confirmed"', () => {
        for (const s of ['broadcasting', 'broadcast', 'rbf-replaced']) {
            expect(isLivePendingStatus(s)).toBe(true);
        }
        for (const s of ['composing', 'awaiting-signature', 'signed', 'queued', 'indexed', 'failed']) {
            expect(isLivePendingStatus(s)).toBe(false);
        }
    });
});

describe('directionFor', () => {
    it('reads out when the source is ours', () => {
        expect(directionFor({ source: OURS, destinations: [THEIRS] }, OWN)).toBe('out');
    });
    it('reads in when a destination is ours', () => {
        expect(directionFor({ source: THEIRS, destinations: [OURS] }, OWN)).toBe('in');
    });
    it('reads out for a self-send: what the user did beats what they received', () => {
        expect(directionFor({ source: OURS, destinations: [OURS] }, OWN)).toBe('out');
    });
    it('shows no badge when neither party is ours, rather than guessing', () => {
        expect(directionFor({ source: THEIRS, destinations: [THEIRS] }, OWN)).toBeNull();
    });
    it('matches case-insensitively, the way the wallet address set is keyed', () => {
        expect(directionFor({ source: OURS.toUpperCase(), destinations: [] }, OWN)).toBe('out');
    });
});

describe('mempoolRowToEntry', () => {
    it('carries the network sighting as the entry timestamp', () => {
        expect(fromMempool().timestamp).toBe(1787886764000);
    });
    it('falls back to our own first sighting when first_seen is absent', () => {
        const e = fromMempool({ first_seen: null });
        expect(e.timestamp).toBe(NOW);
        expect(e.pending.firstSeenMs).toBeNull();
    });
    it('lowercases the hash so the merge key is stable across sources', () => {
        expect(fromMempool().txHash).toBe('aabbcc');
    });
    it('rejects a row with no transaction hash', () => {
        expect(fromMempool({ tx_hash: '' })).toBeNull();
    });
    it('keeps the raw action string for the pending detail branch', () => {
        expect(fromMempool().pending.data).toBe('SEND|2|XCHAIN|100|' + OURS);
    });
});

describe('pendingTxToEntry', () => {
    it('times the entry from our broadcast until the network sees it', () => {
        expect(fromLocal().timestamp).toBe(Date.parse('2026-08-27T00:00:10.000Z'));
        expect(fromLocal().pending.firstSeenMs).toBeNull();
    });
    it('prefers a recorded network sighting over our broadcast time', () => {
        const e = fromLocal({ mempoolSeenAt: '2026-08-27T00:01:00.000Z' });
        expect(e.timestamp).toBe(Date.parse('2026-08-27T00:01:00.000Z'));
        expect(e.pending.firstSeenMs).toBe(Date.parse('2026-08-27T00:01:00.000Z'));
    });
    it('drops a record that never reached the network', () => {
        expect(fromLocal({ status: 'queued' })).toBeNull();
        expect(fromLocal({ status: 'failed' })).toBeNull();
        expect(fromLocal({ status: 'indexed' })).toBeNull();
    });
    it('drops a record with no txid: there is nothing to merge on', () => {
        expect(fromLocal({ txid: null })).toBeNull();
    });
    it('marks an RBF-replaced record and names its replacement', () => {
        const e = fromLocal({ status: 'rbf-replaced', rbfReplacement: 'FFEEDD' });
        expect(e.pending.replaced).toBe(true);
        expect(e.pending.replacementTxHash).toBe('ffeedd');
    });
});

describe('mergePendingEntries', () => {
    const confirmed = (txHash, over = {}) => ({
        key: 'k', chainId: CHAIN, address: OURS, actionIndex: '10', action: 'SEND',
        blockIndex: 5, timestamp: NOW, txHash, source: THEIRS, raw: {}, link: null, ...over,
    });

    it('drops a pending entry the confirmed feed already carries', () => {
        const out = mergePendingEntries({
            confirmed: [confirmed('aabbcc')],
            pending: [fromMempool()],
        });
        expect(out.pending).toHaveLength(0);
        expect(out.entries).toHaveLength(1);
        expect(out.entries[0].blockIndex).toBe(5);
    });

    it('matches the confirmed hash case-insensitively', () => {
        const out = mergePendingEntries({
            confirmed: [confirmed('AABBCC')],
            pending: [fromMempool()],
        });
        expect(out.pending).toHaveLength(0);
    });

    it('keeps a pending entry whose hash confirmed on a DIFFERENT chain', () => {
        const out = mergePendingEntries({
            confirmed: [confirmed('aabbcc', { chainId: 'dogecoin-regtest' })],
            pending: [fromMempool()],
        });
        expect(out.pending).toHaveLength(1);
    });

    it('folds our local record into the network row, keeping both halves', () => {
        const local = fromLocal({ txid: 'AABBCC' }, NOW - 5000);
        const out = mergePendingEntries({ confirmed: [], pending: [local, fromMempool()] });
        expect(out.pending).toHaveLength(1);
        const e = out.pending[0];
        expect(e.pending.origin).toBe('both');
        // Network facts win.
        expect(e.pending.firstSeenMs).toBe(1787886764000);
        expect(e.pending.data).toBe('SEND|2|XCHAIN|100|' + OURS);
        // Local facts the network cannot know survive.
        expect(e.pending.pendingTxId).toBe('ptx-1');
        expect(e.pending.broadcastAtMs).toBe(Date.parse('2026-08-27T00:00:10.000Z'));
        expect(e.pending.direction).toBe('out');
        expect(e.pending.observedAtMs).toBe(NOW - 5000);
        // The local record's own fields stay reachable for the amount annotation.
        expect(e.raw.tick).toBe('XCHAIN');
        expect(e.raw.amount).toBe('100');
    });

    it('folds the same way whichever order the two sources arrive in', () => {
        const local = fromLocal({ txid: 'AABBCC' }, NOW - 5000);
        const a = mergePendingEntries({ confirmed: [], pending: [local, fromMempool()] });
        const b = mergePendingEntries({ confirmed: [], pending: [fromMempool(), local] });
        expect(a.pending[0]).toEqual(b.pending[0]);
    });

    it('collapses one transaction seen from two of our own addresses', () => {
        const first = mempoolRowToEntry({
            chainId: CHAIN, address: OURS, row: mempoolRow(), ownAddresses: OWN, observedAtMs: NOW,
        });
        const second = mempoolRowToEntry({
            chainId: CHAIN, address: 'otherOwnAddr', row: mempoolRow(), ownAddresses: OWN, observedAtMs: NOW + 9000,
        });
        const out = mergePendingEntries({ confirmed: [], pending: [first, second] });
        expect(out.pending).toHaveLength(1);
        // The earlier sighting wins, so the row does not jump between polls.
        expect(out.pending[0].address).toBe(OURS);
    });

    it('ignores null candidates rather than throwing on them', () => {
        const out = mergePendingEntries({ confirmed: [], pending: [null, fromMempool()] });
        expect(out.pending).toHaveLength(1);
    });
});

describe('a merged pending entry satisfies the contracts History already has', () => {
    it('classifies as pending', () => {
        expect(classifyEntryStatus(fromMempool())).toBe('pending');
    });

    it('survives the default 30-day date filter, which drops null timestamps', () => {
        const e = fromMempool();
        const kept = applyHistoryFilters([e], {
            dateFromMs: e.timestamp - 30 * 24 * 3600 * 1000,
            dateToMs: e.timestamp + 24 * 3600 * 1000,
        });
        expect(kept).toHaveLength(1);
    });

    it('survives the date filter on the local-observed fallback too', () => {
        const e = fromMempool({ first_seen: null });
        const kept = applyHistoryFilters([e], { dateFromMs: NOW - 1000, dateToMs: NOW + 1000 });
        expect(kept).toHaveLength(1);
    });

    it('is offered for RBF replacement', () => {
        expect(isEntryReplaceable(fromMempool()).ok).toBe(true);
    });

    it('is not offered for RBF when the action is not coin-moving', () => {
        expect(isEntryReplaceable(fromMempool({ action: 'MINT' })).ok).toBe(false);
    });
});

describe('pendingDisplayState', () => {
    const local = (meta = {}) => ({
        pending: {
            origin: 'local',
            firstSeenMs: null,
            observedAtMs: NOW,
            broadcastAtMs: NOW,
            lastMempoolSeenMs: null,
            direction: 'out',
            destinations: [],
            data: null,
            localStatus: 'broadcast',
            pendingTxId: 'ptx-1',
            replaced: false,
            replacementTxHash: null,
            ...meta,
        },
    });

    it('calls a live mempool row healthy, whatever else is true of it', () => {
        expect(pendingDisplayState(fromMempool(), NOW)).toBe('seen');
        expect(pendingDisplayState(fromMempool({ first_seen: null }), NOW)).toBe('seen');
    });

    it('does not cry wolf inside the window: the decoder polls once a minute', () => {
        // 85s is the measured worst case with nothing at all wrong.
        expect(pendingDisplayState(local(), NOW + 85000)).toBe('awaiting-network');
        expect(pendingDisplayState(local(), NOW + NETWORK_SEEN_WINDOW_MS)).toBe('awaiting-network');
    });

    it('warns once the window has passed with no sighting', () => {
        expect(pendingDisplayState(local(), NOW + NETWORK_SEEN_WINDOW_MS + 1)).toBe('not-seen');
    });

    it('times the window from our broadcast, not from when the view opened', () => {
        // A wallet reopened long after a broadcast must warn immediately
        // rather than restart the clock and look healthy.
        const stale = local({ broadcastAtMs: NOW - 10 * 60 * 1000, observedAtMs: NOW });
        expect(pendingDisplayState(stale, NOW)).toBe('not-seen');
    });

    it('falls back to our own first sighting when there is no broadcast time', () => {
        const noBroadcast = local({ broadcastAtMs: null, observedAtMs: NOW });
        expect(pendingDisplayState(noBroadcast, NOW + NETWORK_SEEN_WINDOW_MS + 1)).toBe('not-seen');
    });

    it('holds a vanished row at healthy through the grace window', () => {
        const gone = local({ lastMempoolSeenMs: NOW });
        expect(pendingDisplayState(gone, NOW + DROPPED_GRACE_MS)).toBe('seen');
    });

    it('reports a vanished row as dropped once the grace window passes', () => {
        const gone = local({ lastMempoolSeenMs: NOW });
        expect(pendingDisplayState(gone, NOW + DROPPED_GRACE_MS + 1)).toBe('dropped');
    });

    it('never reports "not seen" for something that WAS seen', () => {
        // The distinction the two windows exist to make.
        const gone = local({ lastMempoolSeenMs: NOW, broadcastAtMs: NOW - 3600000 });
        expect(pendingDisplayState(gone, NOW + DROPPED_GRACE_MS + 1)).toBe('dropped');
    });

    it('uses a recorded sighting on our own record when no row is live', () => {
        const seenThenGone = local({ firstSeenMs: NOW });
        expect(pendingDisplayState(seenThenGone, NOW + 1000)).toBe('seen');
        expect(pendingDisplayState(seenThenGone, NOW + DROPPED_GRACE_MS + 1)).toBe('dropped');
    });

    it('lets replaced outrank every other reading', () => {
        expect(pendingDisplayState(local({ replaced: true, lastMempoolSeenMs: null }), NOW + 1e9))
            .toBe('replaced');
    });

    it('honours a per-venue window override', () => {
        expect(pendingDisplayState(local(), NOW + 6000, { seenWindowMs: 5000 })).toBe('not-seen');
        expect(pendingDisplayState(local({ lastMempoolSeenMs: NOW }), NOW + 6000, { droppedGraceMs: 5000 }))
            .toBe('dropped');
    });

    it('does not throw on an entry with no pending metadata', () => {
        expect(pendingDisplayState({}, NOW)).toBe('awaiting-network');
        expect(pendingDisplayState(null, NOW)).toBe('awaiting-network');
    });
});

describe('compareMergedEntries', () => {
    const conf = (blockIndex, actionIndex) => ({
        blockIndex, actionIndex: String(actionIndex), timestamp: NOW,
    });

    it('sorts every pending entry above every confirmed one', () => {
        const list = [conf(9, 90), fromMempool(), conf(3, 30)].sort(compareMergedEntries);
        expect(list[0].blockIndex).toBe(0);
    });

    it('sorts pending entries newest first', () => {
        const older = fromMempool({ tx_hash: '11', first_seen: 1787886000 });
        const newer = fromMempool({ tx_hash: '22', first_seen: 1787887000 });
        const list = [older, newer].sort(compareMergedEntries);
        expect(list[0].txHash).toBe('22');
    });

    it('leaves the confirmed order exactly as History has always had it', () => {
        const list = [conf(3, 30), conf(9, 91), conf(9, 92)].sort(compareMergedEntries);
        expect(list.map((e) => e.actionIndex)).toEqual(['92', '91', '30']);
    });
});
