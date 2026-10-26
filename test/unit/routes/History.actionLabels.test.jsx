// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A row whose action sits outside the filter buckets (a stake, a contract
// call, a cancelled order) is named by its own verb. The bucket fallback
// "Other" never replaces a curated label.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
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

describe('History row labels for actions outside the filter buckets', () => {
    it('names a stake, a contract call and a cancelled order by their own verbs', async () => {
        const { view } = mountHistory([
            explorerRow('STAKE', 5001, { tick: 'XCP', amount: '10' }, 100),
            explorerRow('EXECUTE', 5002, {}, 200),
            explorerRow('ORDER_CANCEL', 5003, {}, 300),
        ]);
        await waitFor(() => expect(view.container.querySelectorAll('[data-history-row]')).toHaveLength(3),
            { timeout: 10_000 });
        const text = view.container.textContent;
        expect(text).toContain('Stake');
        expect(text).toContain('Contract call');
        expect(text).toContain('Order cancelled');
        expect(screen.queryByText('Other'), 'a curated action rendered as the bare "Other" bucket').toBeNull();
    });
});
