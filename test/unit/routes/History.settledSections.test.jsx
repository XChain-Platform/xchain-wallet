// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A row goes in the section its status pill names. A send this wallet proved
// into a block before any explorer indexed it reads Confirmed, so it sits
// among the confirmed rows by its block time; a send the wallet gave up on, or
// one the network dropped, reads Failed and sits by its own time in its day,
// where an indexer-rejected action sits. Only rows still in flight stay in
// Pending activity.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';
import { resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';

const CHAIN = 'litecoin-regtest';
const OURS = 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi';
const THEIRS = 'moV6MFm6cLkPXAhLKGRAGyPTPtFYPMYLW1';
const SEEN_HASH = 'aa11bb22cc33dd44ee55ff6677889900aabbccddeeff00112233445566778899';
const PROVED_HASH = '1122334455667788990011223344556677889900aabbccddeeff001122334455';
const NEWER_HASH = '3333333333333333333333333333333333333333333333333333333333333333';
const OLDER_HASH = '4444444444444444444444444444444444444444444444444444444444444444';

const agoIso = (ms) => new Date(Date.now() - ms).toISOString();
const agoSeconds = (ms) => Math.floor((Date.now() - ms) / 1000);

function mountHistory({ mempool = [], pendingTxs = [], history = [] }) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: OURS }] }),
        getAddressHistory: vi.fn().mockResolvedValue(history),
        getLinksForAddress: vi.fn().mockResolvedValue([]),
        getAddressMempool: vi.fn().mockResolvedValue(mempool),
        getPendingTxsForAddress: vi.fn().mockResolvedValue(pendingTxs),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
        getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
        getSettings: vi.fn().mockResolvedValue({}),
        listContacts: vi.fn().mockResolvedValue([]),
        getActionByIndex: vi.fn().mockResolvedValue(null),
    };
    return render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(History, { walletId: 'w1', accountId: 'a1' }),
        ),
    );
}

function localSend(over = {}) {
    return {
        id: 'ptx-local',
        chain: 'LTC',
        network: 'regtest',
        fromAddress: OURS,
        toAddress: THEIRS,
        action: 'SEND',
        actionSummary: 'Send 100 XCHAIN',
        txid: PROVED_HASH,
        status: 'broadcast',
        createdAt: agoIso(700_000),
        broadcastAt: agoIso(600_000),
        mempoolSeenAt: null,
        rbfReplacement: null,
        rbf: true,
        tick: 'XCHAIN',
        amount: '100',
        ...over,
    };
}

function confirmedRow(actionIndex, txHash, ageMs) {
    return {
        action_index: actionIndex,
        action: 'SEND',
        block_index: 7700 + Number(actionIndex),
        timestamp: agoSeconds(ageMs),
        tx_hash: txHash,
        source: OURS,
        destination: THEIRS,
        tick: 'XCHAIN',
        amount: '1',
    };
}

/**
 * Every rendered row in screen order, each with the day heading it sits under
 * and the status its pill shows.
 */
function rowsWithSections(container) {
    const out = [];
    let heading = null;
    const timeline = container.querySelector('ul[aria-label]');
    for (const li of timeline.children) {
        const h2 = li.querySelector('h2');
        if (h2) {
            heading = h2.textContent.trim();
            continue;
        }
        for (const row of li.querySelectorAll('[data-history-key]')) {
            const status = [...row.querySelectorAll('button [title]')]
                .map((el) => el.getAttribute('title'))
                .find((title) => ['Confirmed', 'Failed', 'Pending'].includes(title)) || '';
            out.push({ key: row.getAttribute('data-history-key'), heading, status });
        }
    }
    return out;
}

afterEach(() => {
    cleanup();
    resetBackStackForTests();
    localStorage.clear();
});

describe('History sections follow each row\'s status', () => {
    it('lists a wallet-proved Confirmed row among the confirmed rows by its block time, not under Pending', async () => {
        const provedAt = agoIso(60_000);
        const view = mountHistory({
            mempool: [{
                tx_hash: SEEN_HASH,
                source: THEIRS,
                action: 'SEND',
                data: `SEND|2|XCHAIN|100|${OURS}`,
                first_seen: agoSeconds(30_000),
                destinations: [OURS],
            }],
            pendingTxs: [localSend({
                id: 'ptx-proved',
                status: 'indexed',
                chainConfirmed: true,
                confirmedBlockIndex: 7703,
                // Learned of its block between the two indexed rows.
                confirmedAt: provedAt,
            })],
            history: [
                confirmedRow('1', NEWER_HASH, 10_000),
                confirmedRow('2', OLDER_HASH, 120_000),
            ],
        });

        await waitFor(() => expect(rowsWithSections(view.container)).toHaveLength(4));
        const rows = rowsWithSections(view.container);
        const proved = rows.find((row) => row.key.includes(PROVED_HASH));
        expect(proved.status).toBe('Confirmed');
        expect(proved.heading).not.toBe('Pending activity');

        // Only the mempool row is still in flight.
        expect(rows.filter((row) => row.heading === 'Pending activity').map((row) => row.key))
            .toEqual([expect.stringContaining(SEEN_HASH)]);
        // Newest first among the settled rows: the newer indexed row, the
        // proved row at the time its block was learned, the older indexed row.
        const settled = rows.filter((row) => row.heading !== 'Pending activity');
        expect(settled.map((row) => (row.key.includes(PROVED_HASH) ? 'proved' : row.key.split(':')[1])))
            .toEqual(['1', 'proved', '2']);
        // The row shows the time it is ordered by, not its broadcast time.
        const provedRow = view.container.querySelector(`[data-history-key*="${PROVED_HASH}"]`);
        expect(provedRow.querySelector('time').getAttribute('dateTime')).toBe(provedAt);
    });

    it('lists a Failed local send by its own time among the dated rows, not under Pending', async () => {
        const view = mountHistory({
            pendingTxs: [localSend({
                id: 'ptx-failed',
                status: 'failed',
                txid: null,
                error: 'Insufficient funds',
                updatedAt: agoIso(60_000),
            })],
            history: [
                confirmedRow('1', NEWER_HASH, 10_000),
                confirmedRow('2', OLDER_HASH, 120_000),
            ],
        });

        await waitFor(() => expect(rowsWithSections(view.container)).toHaveLength(3));
        const rows = rowsWithSections(view.container);
        expect(rows.some((row) => row.heading === 'Pending activity')).toBe(false);
        const failed = rows.find((row) => row.key.includes('ptx-failed'));
        expect(failed.status).toBe('Failed');
        expect(rows.map((row) => (row.key.includes('ptx-failed') ? 'failed' : row.key.split(':')[1])))
            .toEqual(['1', 'failed', '2']);
    });

    it('moves a send the network dropped out of Pending once its pill reads Failed', async () => {
        const view = mountHistory({
            pendingTxs: [localSend({
                id: 'ptx-dropped',
                // Seen by the network long ago and listed by no mempool since,
                // past the grace: the pill reads Failed.
                mempoolSeenAt: agoIso(500_000),
            })],
            history: [
                confirmedRow('1', NEWER_HASH, 10_000),
                confirmedRow('2', OLDER_HASH, 1_000_000),
            ],
        });

        await waitFor(() => expect(rowsWithSections(view.container)).toHaveLength(3));
        const rows = rowsWithSections(view.container);
        const dropped = rows.find((row) => row.key.includes(PROVED_HASH));
        expect(dropped.status).toBe('Failed');
        expect(dropped.heading).not.toBe('Pending activity');
        expect(rows.map((row) => (row.key.includes(PROVED_HASH) ? 'dropped' : row.key.split(':')[1])))
            .toEqual(['1', 'dropped', '2']);
    });
});
