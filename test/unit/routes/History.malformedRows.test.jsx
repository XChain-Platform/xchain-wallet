// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// One malformed entry in an address's history feed (a null or a bare scalar)
// is skipped; the rest of the feed still renders instead of the whole page
// failing to load.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';

const CHAIN = 'litecoin-regtest';
const OURS = 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi';
const NOW_S = Math.floor(Date.now() / 1000);

function sendRow(actionIndex, secondsAgo) {
    return {
        action: 'SEND',
        action_index: String(actionIndex),
        block_index: 7800 + actionIndex,
        timestamp: NOW_S - secondsAgo,
        tx_hash: `deadbeef${actionIndex}`,
        status: 'valid',
        details: { source: OURS, destination: 'rltc1qdest0000', tick: 'XCP', amount: '2' },
    };
}

afterEach(() => { cleanup(); });

describe('History with a malformed entry in the feed', () => {
    it('renders the good rows around a null and a scalar', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: OURS }] }),
            getAddressHistory: vi.fn().mockResolvedValue([sendRow(7001, 60), null, 'junk', sendRow(7002, 120)]),
            getLinksForAddress: vi.fn().mockResolvedValue([]),
            getAddressMempool: vi.fn().mockResolvedValue([]),
            getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
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
        await waitFor(() => expect(view.container.querySelectorAll('[data-history-row]')).toHaveLength(2),
            { timeout: 10_000 });
        expect(screen.queryByText(/Could not load history/)).toBeNull();
    });
});
