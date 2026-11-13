// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// History lists every pending (mempool) row first, newest first, then the
// confirmed rows by confirmation time, newest first, across chains. Block
// heights are per-chain counters (Dogecoin's run millions above Bitcoin's),
// so they never order rows from two chains.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';

const BTC = 'bitcoin-regtest';
const DOGE = 'dogecoin-regtest';
const BTC_ADDR = 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi';
const DOGE_ADDR = 'nXr2oNnJ3bfLb4Hc8yWQfyqzXgQXyF7Npb';
const PEER = 'moV6MFm6cLkPXAhLKGRAGyPTPtFYPMYLW1';
const MIN = 60;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function hash(seed) {
    return seed.repeat(64).slice(0, 64);
}

function confirmed(actionIndex, blockIndex, agoSeconds, own) {
    return {
        action_index: actionIndex,
        action: 'SEND',
        block_index: blockIndex,
        timestamp: Math.floor(Date.now() / 1000) - agoSeconds,
        tx_hash: hash(actionIndex.slice(-1)),
        source: PEER,
        destination: own,
        amount: '1',
        tick: 'XCHAIN',
    };
}

function mempool(txSeed, agoSeconds, own) {
    return {
        tx_hash: hash(txSeed),
        source: PEER,
        action: 'SEND',
        data: `SEND|2|XCHAIN|100|${own}`,
        first_seen: Math.floor(Date.now() / 1000) - agoSeconds,
        destinations: [own],
    };
}

function mountHistory({ history, pending }) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [BTC]: [{ address: BTC_ADDR }],
            [DOGE]: [{ address: DOGE_ADDR }],
        }),
        getAddressHistory: vi.fn(async ({ chainId }) => history[chainId] || []),
        getLinksForAddress: vi.fn().mockResolvedValue([]),
        getAddressMempool: vi.fn(async ({ chainId }) => pending[chainId] || []),
        getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
        getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
        getSettings: vi.fn().mockResolvedValue({}),
    };
    const view = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <History walletId="w1" accountId="a1" />
        </MessagingProvider>,
    );
    return { messaging, view };
}

function renderedKeys(container) {
    return [...container.querySelectorAll('[data-history-key]')].map((li) => li.getAttribute('data-history-key'));
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); });

describe('History activity order', () => {
    it('lists pending rows first, newest first, then confirmed rows by confirmation time across chains', async () => {
        const { view } = mountHistory({
            history: {
                // Dogecoin heights run far above Bitcoin's; the old DOGE row
                // must still sort below the newer BTC rows.
                [DOGE]: [
                    confirmed('5900000', 5_900_000, 3 * DAY, DOGE_ADDR),
                    confirmed('5900100', 5_900_100, 2 * HOUR, DOGE_ADDR),
                ],
                [BTC]: [
                    confirmed('901', 901, 10 * MIN, BTC_ADDR),
                    confirmed('900', 900, 26 * HOUR, BTC_ADDR),
                ],
            },
            pending: {
                // An older pending row whose clock is still newer than every
                // confirmed row, and one older than some confirmed rows: both
                // stay above every confirmed row.
                [BTC]: [mempool('b', 5 * HOUR, BTC_ADDR)],
                [DOGE]: [mempool('d', 1 * MIN, DOGE_ADDR)],
            },
        });

        await waitFor(() => expect(renderedKeys(view.container)).toHaveLength(6));
        const keys = renderedKeys(view.container);
        const order = keys.map((key) => {
            const chain = key.toLowerCase().includes('doge') ? 'doge' : 'btc';
            if (key.toLowerCase().includes(hash('b')) || key.toLowerCase().includes(hash('d'))) return `${chain}:pending`;
            const index = /:(\d+):/.exec(key)?.[1];
            return `${chain}:${index}`;
        });
        expect(order).toEqual([
            'doge:pending',
            'btc:pending',
            'btc:901',
            'doge:5900100',
            'btc:900',
            'doge:5900000',
        ]);

        // The pending rows sit under the pending heading, above every day.
        const headings = [...view.container.querySelectorAll('h2, h3, [role="heading"]')].map((h) => h.textContent);
        const firstDay = headings.findIndex((text) => /Today|Yesterday|\d/.test(text));
        const pendingHeading = headings.findIndex((text) => /Pending/i.test(text));
        expect(pendingHeading).toBeGreaterThanOrEqual(0);
        expect(firstDay === -1 || pendingHeading < firstDay).toBe(true);
    });
});
