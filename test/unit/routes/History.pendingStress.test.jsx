// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The real History route under a heavy and partly malformed pending load:
// fifty local sends, mempool rows missing fields, a hash carried by several
// sources at once and absurd amounts. The screen must show one row per
// transaction and stay up.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';

const CHAIN = 'litecoin-regtest';
const OURS = 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi';
const THEIRS = 'moV6MFm6cLkPXAhLKGRAGyPTPtFYPMYLW1';

const hash = (n) => n.toString(16).padStart(64, '0');

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

function localSend(n, over = {}) {
    return {
        id: `ptx-${n}`,
        chain: 'LTC',
        network: 'regtest',
        fromAddress: OURS,
        toAddress: THEIRS,
        action: 'SEND',
        actionSummary: 'Send 1 XCHAIN',
        txid: hash(n),
        status: 'broadcast',
        createdAt: new Date(Date.now() - 20000).toISOString(),
        broadcastAt: new Date(Date.now() - 10000).toISOString(),
        mempoolSeenAt: null,
        rbfReplacement: null,
        tick: 'XCHAIN',
        amount: '1',
        ...over,
    };
}

function mempoolRow(n, over = {}) {
    return {
        tx_hash: hash(n),
        source: OURS,
        action: 'SEND',
        data: `SEND|2|XCHAIN|1|${THEIRS}`,
        first_seen: Math.floor(Date.now() / 1000) - 30,
        destinations: [THEIRS],
        ...over,
    };
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); });

describe('History under a heavy pending load', () => {
    it('shows one row per transaction for fifty sends that two sources both describe', async () => {
        const ids = Array.from({ length: 50 }, (_, i) => i + 1);
        const { view } = mountHistory({
            pendingTxs: ids.map((n) => localSend(n)),
            mempool: ids.map((n) => mempoolRow(n)),
        });
        await waitFor(() => expect(view.container.querySelectorAll('[data-history-row]').length).toBeGreaterThan(0));
        await waitFor(() => expect(view.container.querySelectorAll('[data-history-row]')).toHaveLength(50));
    });

    it('lists a send once when its confirmed row, mempool row and local record all exist', async () => {
        const { view } = mountHistory({
            pendingTxs: [localSend(7)],
            mempool: [mempoolRow(7)],
            history: [{
                action_index: '900', action: 'SEND', block_index: 5, source: OURS,
                timestamp: Math.floor(Date.now() / 1000) - 5, tx_hash: hash(7).toUpperCase(),
            }],
        });
        await waitFor(() => expect(screen.getByText('Confirmed')).toBeTruthy());
        expect(screen.queryByText('Pending')).toBeNull();
        expect(view.container.querySelectorAll('[data-history-row]')).toHaveLength(1);
    });

    it('survives malformed mempool rows and absurd pending amounts', async () => {
        const { view } = mountHistory({
            mempool: [
                null,
                {},
                { tx_hash: null },
                { tx_hash: {}, source: {}, action: [] },
                mempoolRow(1, { first_seen: 1e30, destinations: 'not-a-list' }),
                mempoolRow(2, { data: null, source: null, action: null }),
            ],
            pendingTxs: [
                localSend(3, { amount: '9'.repeat(400), tick: 'T'.repeat(300) }),
                localSend(4, { amount: '1e999', tick: '' }),
                localSend(5, { amount: null, tick: null, toAddress: null }),
            ],
        });
        await waitFor(() => expect(view.container.querySelectorAll('[data-history-row]').length).toBeGreaterThanOrEqual(3));
        expect(view.container.textContent).not.toMatch(/Invalid Date|undefined|NaN/);
    });
});
