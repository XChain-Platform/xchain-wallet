// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// M2.5, driven through the real History route rather than through the
// annotation helper. What matters here is not that a function returns a
// tuple: it is what reaches the screen next to settled amounts. A pending
// figure that reads like a confirmed one is the failure this row exists to
// prevent, and only the rendered row can show whether it does.
//
// The MINT case is the load-bearing one (I-9). A MINT carries its supply at
// the same segment offset a SEND carries its amount, so any code that reads
// the wire positionally will happily print a number that means something
// else entirely.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';

const CHAIN = 'litecoin-regtest';
const OURS = 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi';
const THEIRS = 'moV6MFm6cLkPXAhLKGRAGyPTPtFYPMYLW1';
const THIRD = 'n1BqPVJ4kD3vLzT9Zt7xYrWKGQAxSMdLmH';
const PENDING_HASH = 'aa11bb22cc33dd44ee55ff6677889900aabbccddeeff00112233445566778899';
const CONFIRMED_HASH = '99887766554433221100ffeeddccbbaa00998877665544332211ffeeddccbbaa';

function mountHistory({ mempool = [], pendingTxs = [], history = [] } = {}) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: OURS }] }),
        getAddressHistory: vi.fn().mockResolvedValue(history),
        getLinksForAddress: vi.fn().mockResolvedValue([]),
        getAddressMempool: vi.fn().mockResolvedValue(mempool),
        getPendingTxsForAddress: vi.fn().mockResolvedValue(pendingTxs),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
        getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
        getSettings: vi.fn().mockResolvedValue({}),
    };
    const view = render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(History, { walletId: 'w1', accountId: 'a1' }),
        ),
    );
    return { messaging, view };
}

/**
 * A mempool row in the explorer's own wire vocabulary. `first_seen` is
 * deliberately recent: the default 30-day window drops anything older,
 * and an invisible row proves nothing about its annotation.
 */
function mempoolRow(over = {}) {
    return {
        tx_hash: PENDING_HASH,
        source: THEIRS,
        action: 'SEND',
        // v0: six segments exactly, the layout's own strict count.
        data: `SEND|0|XCHAIN|100|${OURS}|`,
        first_seen: Math.floor(Date.now() / 1000) - 30,
        destinations: [OURS],
        ...over,
    };
}

function ownSendRecord(over = {}) {
    return {
        id: 'ptx-1',
        chain: 'LTC',
        network: 'regtest',
        fromAddress: OURS,
        toAddress: THEIRS,
        action: 'SEND',
        actionSummary: 'Send 100 XCHAIN',
        txid: PENDING_HASH,
        status: 'broadcast',
        createdAt: new Date(Date.now() - 20000).toISOString(),
        broadcastAt: new Date(Date.now() - 10000).toISOString(),
        mempoolSeenAt: null,
        rbfReplacement: null,
        tick: 'XCHAIN',
        amount: '100',
        ...over,
    };
}

function confirmedRow(over = {}) {
    return {
        action_index: '1255',
        action: 'SEND',
        block_index: 7707,
        timestamp: Math.floor(Date.now() / 1000) - 10,
        tx_hash: CONFIRMED_HASH,
        source: THEIRS,
        // Deliberately populated: a confirmed row carries exactly the fields
        // the local-record branch reads, so without a guard on BOTH sides
        // (the entry having pending metadata, and the annotation rendering
        // only where a block number would go) a settled amount would pick up
        // the pending styling and the pending caveat.
        tick: 'XCHAIN',
        amount: '100',
        ...over,
    };
}

/** The annotation node, or null when the row declined to print one. */
function annotation(view) {
    return view.container.querySelector('[data-pending-amount]');
}

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    try { window.localStorage.clear(); } catch { /* jsdom without storage */ }
});

describe('History annotates what a pending transaction moves', () => {
    it('names the amount on an incoming pending SEND', async () => {
        const { view } = mountHistory({ mempool: [mempoolRow()] });
        await waitFor(() => expect(annotation(view)).toBeTruthy());
        expect(annotation(view).textContent).toBe('receiving 100 XCHAIN');
        expect(annotation(view).getAttribute('data-pending-amount')).toBe('in');
    });

    it('names the amount on our own outgoing pending SEND', async () => {
        // No mempool row at all: the 85s hole, where our own record is the
        // only thing that knows what was sent.
        const { view } = mountHistory({ pendingTxs: [ownSendRecord()] });
        await waitFor(() => expect(annotation(view)).toBeTruthy());
        expect(annotation(view).textContent).toBe('sending 100 XCHAIN');
        expect(annotation(view).getAttribute('data-pending-amount')).toBe('out');
    });

    it('invents no amount for a MINT, whose supply sits where a SEND amount does', async () => {
        // I-9. Six segments, so a decoder that skipped the action-name check
        // would match SEND v0 and print "100 XCHAIN" off a supply figure.
        const { view } = mountHistory({
            mempool: [mempoolRow({
                action: 'MINT',
                data: `MINT|0|XCHAIN|100|${OURS}|`,
            })],
        });
        await waitFor(() => expect(view.container.textContent).toContain('pending'));
        expect(annotation(view)).toBeNull();
        expect(view.container.textContent).not.toContain('100 XCHAIN');
    });

    it('puts no side on a transaction where neither party is ours', async () => {
        // The segment scan that produces `destinations` has a known
        // false-positive class, so an unattributable transaction gets the
        // neutral verb rather than a guessed "receiving".
        const { view } = mountHistory({
            mempool: [mempoolRow({
                data: `SEND|0|XCHAIN|100|${THIRD}|`,
                destinations: [],
            })],
        });
        await waitFor(() => expect(annotation(view)).toBeTruthy());
        expect(annotation(view).textContent).toBe('moves 100 XCHAIN');
        expect(annotation(view).getAttribute('data-pending-amount')).toBe('unknown');
    });

    it('passes the wire amount through verbatim, with no float rounding', async () => {
        // Round-trips to 1.0000000000000001e-8 through a JS number, which is
        // both a wrong figure and an unreadable one.
        const exact = '0.000000010000000001';
        const { view } = mountHistory({
            mempool: [mempoolRow({ data: `SEND|0|XCHAIN|${exact}|${OURS}|` })],
        });
        await waitFor(() => expect(annotation(view)).toBeTruthy());
        expect(annotation(view).textContent).toBe(`receiving ${exact} XCHAIN`);
    });

    it('names every output of a multi-output SEND, not just the first', async () => {
        // v3: ten segments, two independently-ticked outputs. Showing one
        // understates what the transaction moves.
        const { view } = mountHistory({
            mempool: [mempoolRow({
                data: `SEND|3|XCHAIN|100|${OURS}|m1|PEPE|7|${OURS}|m2`,
            })],
        });
        await waitFor(() => expect(annotation(view)).toBeTruthy());
        expect(annotation(view).textContent).toBe('receiving 100 XCHAIN, 7 PEPE');
    });

    it('carries the pre-validation caveat as the figure accessible name', async () => {
        const { view } = mountHistory({ mempool: [mempoolRow()] });
        await waitFor(() => expect(annotation(view)).toBeTruthy());
        const caveat = 'Pending, not yet validated by the indexer: receiving 100 XCHAIN';
        expect(annotation(view).getAttribute('aria-label')).toBe(caveat);
        expect(annotation(view).getAttribute('title')).toBe(caveat);
    });

    it('masks the figure when balances are hidden', async () => {
        window.localStorage.setItem('xc:balancesHidden', '1');
        const { view } = mountHistory({ mempool: [mempoolRow()] });
        await waitFor(() => expect(annotation(view)).toBeTruthy());
        expect(annotation(view).textContent).toBe('receiving ••••• XCHAIN');
        expect(view.container.textContent).not.toContain('100 XCHAIN');
    });

    it('annotates nothing on a confirmed row', async () => {
        const { view } = mountHistory({ history: [confirmedRow()] });
        await waitFor(() => expect(view.container.textContent).toContain('Confirmed'));
        expect(annotation(view)).toBeNull();
    });
});
