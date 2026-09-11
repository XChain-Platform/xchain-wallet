// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// TxStatusTimeline mempool-stage demotion (§4 M2.2).
//
// THE DEFECT THIS PINS is a lie the timeline told confidently. The mempool
// stage was computed as `blockIndex === 0 && txHash.length > 0`, so ANY
// blockless entry carrying a hash rendered a completed "Waiting to confirm"
// stage. A broadcast that never reached a single node looked exactly like one
// half the network was already holding, and the user's only signal that
// something was wrong was that the row eventually stopped changing.
//
// So every assertion below is about the DIFFERENCE between the four readings.
// A test that only checks the healthy case would have passed against the bug.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

import { TxStatusTimeline } from '../../../packages/core/src/shared/components/TxStatusTimeline.jsx';
import {
    NETWORK_SEEN_WINDOW_MS,
    DROPPED_GRACE_MS,
} from '../../../packages/core/src/shared/utils/pendingHistory.js';

const NOW = Date.UTC(2026, 7, 27, 12, 10, 0);
const TX = 'aa11bb22cc33dd44ee55ff6600771122334455667788990011223344556677889';

// A blockless entry shaped like the merged pending entries History builds.
function pendingEntry(pending, over = {}) {
    return {
        txHash: TX,
        blockIndex: 0,
        actionIndex: '',
        action: 'SEND',
        timestamp: NOW,
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
            pendingTxId: 'p1',
            replaced: false,
            replacementTxHash: null,
            ...pending,
        },
        ...over,
    };
}

/** The mempool stage's rendered <li>, found by its position in the list. */
function mempoolRow() {
    const rows = screen.getByRole('list', { name: 'Transaction status' }).querySelectorAll('li');
    return rows[2];
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
});

afterEach(() => {
    vi.useRealTimers();
    cleanup();
});

describe('TxStatusTimeline: the mempool stage only claims what it knows', () => {
    it('says "Broadcast, awaiting network" for a fresh send no node has reported', () => {
        render(<TxStatusTimeline entry={pendingEntry({ broadcastAtMs: NOW - 1000 })} />);
        const row = mempoolRow();
        expect(row.textContent).toContain('Broadcast, awaiting network');
        // The demotion itself: the stage is NOT done, so the dot is hollow and
        // the row reads as not-yet-reached.
        expect(row.querySelector('span[aria-hidden="true"]').textContent).toBe('○');
        expect(row.className).toContain('rowPending');
    });

    it('never claims the network has it before a sighting', () => {
        render(<TxStatusTimeline entry={pendingEntry({ broadcastAtMs: NOW - 1000 })} />);
        expect(mempoolRow().textContent).not.toContain('In mempool');
    });

    it('says "In mempool" once a node has actually reported holding it', () => {
        render(<TxStatusTimeline entry={pendingEntry({ origin: 'mempool', firstSeenMs: NOW - 5000, lastMempoolSeenMs: NOW - 5000 })} />);
        const row = mempoolRow();
        expect(row.textContent).toContain('In mempool');
        expect(row.querySelector('span[aria-hidden="true"]').textContent).toBe('●');
        expect(row.className).toContain('rowDone');
    });

    it('warns "Not seen by the network" past the window, visibly distinct from healthy pending', () => {
        const stale = pendingEntry({ broadcastAtMs: NOW - (NETWORK_SEEN_WINDOW_MS + 1000) });
        render(<TxStatusTimeline entry={stale} />);
        const row = mempoolRow();
        expect(row.textContent).toContain('Not seen by the network');
        // Distinct in three ways at once, because color alone is not a signal.
        expect(row.className).toContain('rowWarn');
        expect(row.querySelector('span[aria-hidden="true"]').textContent).toBe('!');
        expect(row.className).not.toContain('rowDone');
    });

    it('holds "Broadcast, awaiting network" right up to the window edge', () => {
        // One millisecond inside: a window that trips on a healthy send is the
        // thing I-17 doubled the measured worst case to avoid.
        const edge = pendingEntry({ broadcastAtMs: NOW - (NETWORK_SEEN_WINDOW_MS - 1) });
        render(<TxStatusTimeline entry={edge} />);
        expect(mempoolRow().textContent).toContain('Broadcast, awaiting network');
    });

    it('asks "Dropped or replaced?" when a node stopped reporting it past the grace window', () => {
        const gone = pendingEntry({
            origin: 'local',
            lastMempoolSeenMs: NOW - (DROPPED_GRACE_MS + 1000),
        });
        render(<TxStatusTimeline entry={gone} />);
        const row = mempoolRow();
        expect(row.textContent).toContain('Dropped or replaced?');
        expect(row.className).toContain('rowWarn');
    });

    it('stays quiet inside the dropped grace window', () => {
        const recentlyGone = pendingEntry({
            origin: 'local',
            lastMempoolSeenMs: NOW - (DROPPED_GRACE_MS - 1000),
        });
        render(<TxStatusTimeline entry={recentlyGone} />);
        const row = mempoolRow();
        expect(row.textContent).toContain('In mempool');
        expect(row.className).not.toContain('rowWarn');
    });

    it('labels an RBF replacement as replaced, not as a warning', () => {
        render(<TxStatusTimeline entry={pendingEntry({ replaced: true, localStatus: 'rbf-replaced' })} />);
        const row = mempoolRow();
        expect(row.textContent).toContain('Replaced');
        expect(row.className).not.toContain('rowWarn');
    });

    it('says nothing about the network for an entry that was never broadcast', () => {
        render(<TxStatusTimeline entry={{ txHash: '', blockIndex: 0, timestamp: 0, signedAt: NOW - 1000 }} />);
        const row = mempoolRow();
        expect(row.textContent).toContain('Pending broadcast');
        expect(row.textContent).not.toContain('awaiting network');
    });
});

describe('TxStatusTimeline: per-network window overrides (I-17)', () => {
    it('a widened window keeps a slow venue out of the warning state', () => {
        const stale = pendingEntry({ broadcastAtMs: NOW - (NETWORK_SEEN_WINDOW_MS + 1000) });
        render(<TxStatusTimeline entry={stale} seenWindowMs={NETWORK_SEEN_WINDOW_MS * 4} />);
        expect(mempoolRow().textContent).toContain('Broadcast, awaiting network');
    });

    it('a narrowed window warns sooner', () => {
        const young = pendingEntry({ broadcastAtMs: NOW - 5000 });
        render(<TxStatusTimeline entry={young} seenWindowMs={1000} />);
        expect(mempoolRow().textContent).toContain('Not seen by the network');
    });

    it('a widened grace window defers the dropped reading', () => {
        const gone = pendingEntry({ lastMempoolSeenMs: NOW - (DROPPED_GRACE_MS + 1000) });
        render(<TxStatusTimeline entry={gone} droppedGraceMs={DROPPED_GRACE_MS * 4} />);
        expect(mempoolRow().textContent).toContain('In mempool');
    });
});

describe('TxStatusTimeline: confirmed rows are untouched', () => {
    // Every historical row in the wallet reaches this component with no
    // pending metadata at all. `pendingDisplayState` answers 'awaiting-network'
    // for those, which is true of nothing that is already in a block, so the
    // blockIndex guard has to come first.
    it('a confirmed entry with NO pending metadata still reads Accepted', () => {
        render(<TxStatusTimeline
            entry={{ txHash: TX, blockIndex: 812345, timestamp: NOW - 60000, action: 'SEND' }}
            chainTip={812347}
            indexerWatermark={812347}
        />);
        const row = mempoolRow();
        expect(row.textContent).toContain('Accepted');
        expect(row.className).toContain('rowDone');
        expect(row.className).not.toContain('rowWarn');
    });

    it('a confirmed entry keeps its confirmation count and indexed stage', () => {
        render(<TxStatusTimeline
            entry={{ txHash: TX, blockIndex: 812345, timestamp: NOW - 60000, action: 'SEND' }}
            chainTip={812347}
            indexerWatermark={812347}
        />);
        expect(screen.getByText('Confirmed at block 812,345')).toBeTruthy();
        expect(screen.getByText(/3 confirmations/)).toBeTruthy();
        expect(screen.getByText(/the service has reached block 812,347/)).toBeTruthy();
    });

    it('a confirmed entry that STILL carries stale pending metadata reads as confirmed', () => {
        // The merge drops a pending entry the moment a confirmed one exists,
        // but a caller that hands over both must not be told the transaction
        // was never seen.
        const entry = pendingEntry(
            { broadcastAtMs: NOW - (NETWORK_SEEN_WINDOW_MS + 60000) },
            { blockIndex: 812345 },
        );
        render(<TxStatusTimeline entry={entry} />);
        const row = mempoolRow();
        expect(row.textContent).toContain('Accepted');
        expect(row.className).not.toContain('rowWarn');
    });
});
