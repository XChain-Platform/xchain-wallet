// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Proof checks cover the rows the screen shows, not every filtered row. Each
// check is two explorer reads, so a 250-row history checks the first page of
// 100 and no more.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';

const CHAIN = 'litecoin-regtest';
const OURS = 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi';
const NOW_S = Math.floor(Date.now() / 1000);

function explorerRow(action, actionIndex, details, secondsAgo) {
    return {
        action,
        action_index: String(actionIndex),
        block_index: 7800 + Number(actionIndex),
        timestamp: NOW_S - secondsAgo,
        tx_hash: `deadbeef${actionIndex}`,
        status: 'valid',
        details: { action_index: String(actionIndex), source: OURS, ...details },
    };
}

function mountHistory(history, extra = {}) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: OURS }] }),
        getAddressHistory: vi.fn().mockResolvedValue(history),
        getLinksForAddress: vi.fn().mockResolvedValue([]),
        getAddressMempool: vi.fn().mockResolvedValue([]),
        getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
        getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
        getSettings: vi.fn().mockResolvedValue({}),
        ...extra,
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

afterEach(() => { cleanup(); });

describe('History proof checks follow the rendered window', () => {
    it('checks the first page of a 250-row history and no more', async () => {
        const rows = [];
        for (let i = 0; i < 250; i += 1) {
            rows.push(explorerRow('SEND', 6000 + i, { tick: 'XCP', amount: '1', destination: 'rltc1qdest0000' }, 60 + i));
        }
        const verifyAction = vi.fn().mockResolvedValue({ status: 'verified', reason: null, trust: 'explorer' });
        const { view } = mountHistory(rows, { verifyAction });
        await waitFor(() => expect(view.container.querySelectorAll('[data-history-row]')).toHaveLength(100),
            { timeout: 10_000 });
        await waitFor(() => expect(verifyAction).toHaveBeenCalled(), { timeout: 10_000 });
        // Let any queued checks drain before counting.
        await new Promise((resolve) => { setTimeout(resolve, 300); });
        // Only this test's rows count: an earlier mount's checks can still land.
        const checked = verifyAction.mock.calls
            .map((call) => Number(call[0].actionIndex))
            .filter((index) => index >= 6000);
        expect(checked, 'proof checks ran for rows beyond the rendered page').toHaveLength(100);
    });
});
