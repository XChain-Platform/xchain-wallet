// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// M2.1 driven through the real History route rather than through the merge
// helper alone. The helper being right proves nothing about the thing the
// operator sees: History has a 30-day date filter switched ON by default that
// drops any row without a timestamp, it had no poll of its own, and it used to
// discard every row that arrived without an action index. A pending row has no
// action index by definition, so all three had to change together.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';

const CHAIN = 'litecoin-regtest';
const OURS = 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi';
const THEIRS = 'moV6MFm6cLkPXAhLKGRAGyPTPtFYPMYLW1';
const PENDING_HASH = 'aa11bb22cc33dd44ee55ff6677889900aabbccddeeff00112233445566778899';
const CONFIRMED_HASH = '99887766554433221100ffeeddccbbaa00998877665544332211ffeeddccbbaa';

function mountHistory({ mempool = [], pendingTxs = [], history = [] } = {}) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{ address: OURS }],
        }),
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

/** A mempool row in the explorer's own wire vocabulary. */
function mempoolRow(over = {}) {
    return {
        tx_hash: PENDING_HASH,
        source: THEIRS,
        action: 'SEND',
        data: `SEND|2|XCHAIN|100|${OURS}`,
        // Seconds, and deliberately RECENT: the assertion is that the row
        // survives the default 30-day window, which needs a real timestamp.
        first_seen: Math.floor(Date.now() / 1000) - 30,
        destinations: [OURS],
        ...over,
    };
}

function confirmedRow(txHash, over = {}) {
    return {
        action_index: '1255',
        action: 'SEND',
        block_index: 7707,
        timestamp: Math.floor(Date.now() / 1000) - 10,
        tx_hash: txHash,
        source: THEIRS,
        ...over,
    };
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('History shows unconfirmed transactions', () => {
    it('asks for both pending sources for every wallet address', async () => {
        const { messaging } = mountHistory();
        await waitFor(() => expect(messaging.getAddressMempool).toHaveBeenCalledWith({
            chainId: CHAIN, address: OURS,
        }));
        expect(messaging.getPendingTxsForAddress).toHaveBeenCalledWith({
            chainId: CHAIN, address: OURS,
        });
    });

    it('renders an incoming mempool row under the DEFAULT date filter', async () => {
        // The default filter is a live 30-day window that drops any row
        // without a timestamp, so a row that reached the screen carried a
        // real one through it.
        const { view } = mountHistory({ mempool: [mempoolRow()] });
        await waitFor(() => expect(screen.getByText('Pending')).toBeTruthy());
        expect(view.container.textContent).toContain(THEIRS);
    });

    it('does not drop the row for lacking an action index, which no pending row has', async () => {
        mountHistory({ mempool: [mempoolRow()] });
        await waitFor(() => expect(screen.getByText('Pending')).toBeTruthy());
    });

    it('renders our own broadcast send before the network has seen anything', async () => {
        // The 85s hole this milestone exists to close: no mempool row yet,
        // only our own record.
        const { view } = mountHistory({
            pendingTxs: [{
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
            }],
        });
        await waitFor(() => expect(screen.getByText('Pending')).toBeTruthy());
        // The row identifies a transaction by its source, the same way it
        // does for a confirmed one; on our own send that source is us.
        expect(view.container.textContent).toContain(OURS);
    });

    it('upgrades in place rather than showing the transaction twice once it confirms', async () => {
        // Same hash on both feeds: one transaction, mid-upgrade.
        const { view } = mountHistory({
            mempool: [mempoolRow()],
            history: [confirmedRow(PENDING_HASH)],
        });
        await waitFor(() => expect(screen.getByText('Confirmed')).toBeTruthy());
        expect(screen.queryByText('Pending')).toBeNull();
        expect(view.container.textContent.match(/Send/g) || []).toHaveLength(1);
    });

    it('sorts the pending row above a confirmed one', async () => {
        const { view } = mountHistory({
            mempool: [mempoolRow()],
            history: [confirmedRow(CONFIRMED_HASH)],
        });
        await waitFor(() => expect(screen.getByText('Pending')).toBeTruthy());
        const text = view.container.textContent;
        expect(text.indexOf('Pending')).toBeLessThan(text.indexOf('Confirmed'));
    });

    it('still renders confirmed history when the shell has no pending channels', async () => {
        // An older shell whose messaging predates M2.1: History must lose the
        // pending rows and nothing else.
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: OURS }] }),
            getAddressHistory: vi.fn().mockResolvedValue([confirmedRow(CONFIRMED_HASH)]),
            getLinksForAddress: vi.fn().mockResolvedValue([]),
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
        await waitFor(() => expect(screen.getByText('Confirmed')).toBeTruthy());
        expect(screen.queryByText('Pending')).toBeNull();
    });

    it('survives a pending read that rejects, showing the confirmed side', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: OURS }] }),
            getAddressHistory: vi.fn().mockResolvedValue([confirmedRow(CONFIRMED_HASH)]),
            getLinksForAddress: vi.fn().mockResolvedValue([]),
            getAddressMempool: vi.fn().mockRejectedValue(new Error('explorer down')),
            getPendingTxsForAddress: vi.fn().mockRejectedValue(new Error('vault locked')),
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
        await waitFor(() => expect(screen.getByText('Confirmed')).toBeTruthy());
    });

    it('re-reads on window focus, so a pending row appears without a remount', async () => {
        const { messaging } = mountHistory({ mempool: [] });
        await waitFor(() => expect(messaging.getAddressMempool).toHaveBeenCalledTimes(1));
        messaging.getAddressMempool.mockResolvedValue([mempoolRow()]);
        window.dispatchEvent(new Event('focus'));
        await waitFor(() => expect(messaging.getAddressMempool).toHaveBeenCalledTimes(2));
    });
});
