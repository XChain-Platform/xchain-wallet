// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The History list shows no proof verdict and runs no proof checks (each is
// two explorer reads); the detail page owns them.

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

// Operator ruling 2026-11-14: a History row shows the action, its details,
// the time and the status pill only. The proof verdict and the counterparty
// address live on the action's detail page (ActionDetail), which owns the
// proof check and its test pin (spv-verified-mode smoke), so the list runs no
// proof checks at all.
describe('History rows carry no verification or address pill', () => {
    it('renders no verified badge and no address text, and runs no proof checks', async () => {
        const rows = [];
        for (let i = 0; i < 12; i += 1) {
            rows.push(explorerRow('SEND', 6000 + i, { tick: 'XCP', amount: '1', destination: 'rltc1qdest0000abcdefghijklmnop' }, 60 + i));
        }
        const verifyAction = vi.fn().mockResolvedValue({ status: 'verified', reason: null, trust: 'explorer' });
        const { view } = mountHistory(rows, { verifyAction });
        await waitFor(() => expect(view.container.querySelectorAll('[data-history-row]').length).toBeGreaterThan(0),
            { timeout: 10_000 });
        await new Promise((resolve) => { setTimeout(resolve, 300); });
        const rowEls = [...view.container.querySelectorAll('[data-history-row]')];
        for (const row of rowEls) {
            expect(row.querySelector('[data-testid="verified-badge"]')).toBeNull();
            expect(row.textContent).not.toMatch(/unverified/i);
            expect(row.textContent).not.toContain('rltc1qdest');
            expect(row.textContent).not.toContain(OURS.slice(0, 8));
        }
        expect(verifyAction.mock.calls.filter((call) => Number(call[0].actionIndex) >= 6000)).toHaveLength(0);
    });
});
