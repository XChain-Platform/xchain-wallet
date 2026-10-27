// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';
import { BALANCE_POLL_INTERVAL_MS } from '../../../packages/core/src/flows/balances.js';
import { readAllListPages } from '../../../packages/core/src/shared/utils/historyPages.js';

const CHAIN = 'litecoin-regtest';
const ADDRESS = 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi';
const PAGE = 100;
const NOW_S = Math.floor(Date.now() / 1000);

function makeRows(count) {
    return Array.from({ length: count }, (_, i) => ({
        action: 'SEND',
        action_index: String(count - i),
        block_index: 100_000 - i,
        timestamp: NOW_S - i,
        tx_hash: `pages-${count - i}`,
        status: 'valid',
        details: {
            action_format: 0,
            source: ADDRESS,
            destination: `rltc1qdestination${i}`,
            tick: 'LTC',
            amount: '1',
        },
    }));
}

// The explorer's envelope: one page of at most 100 rows plus the total held.
function pagedRead(getRows) {
    return vi.fn(({ opts } = {}) => {
        const rows = getRows();
        const page = Number(opts?.page || 1);
        return Promise.resolve({ data: rows.slice((page - 1) * PAGE, page * PAGE), total: rows.length });
    });
}

function mountHistory(getAddressHistory) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: ADDRESS }] }),
        getAddressHistory,
        getLinksForAddress: vi.fn().mockResolvedValue([]),
        getAddressMempool: vi.fn().mockResolvedValue([]),
        getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
        listContacts: vi.fn().mockResolvedValue([]),
        getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
        getSettings: vi.fn().mockResolvedValue({ verifyProofs: false }),
    };
    const view = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <History walletId="pages-wallet" accountId="account-1" />
        </MessagingProvider>,
    );
    return { messaging, view };
}

beforeEach(() => {
    globalThis.localStorage?.setItem('xc:historyGroupingMode', 'flat');
});

afterEach(() => {
    cleanup();
    globalThis.localStorage?.removeItem('xc:historyGroupingMode');
    vi.useRealTimers();
});

describe('History follows every page of an address', () => {
    it('lists all 250 actions of an address whose explorer pages hold 100', async () => {
        const rows = makeRows(250);
        const { view } = mountHistory(pagedRead(() => rows));

        await waitFor(() => {
            expect(screen.getByText('100 of 250 history items shown')).toBeInTheDocument();
        });
        fireEvent.click(screen.getByRole('button', { name: 'Export…' }));
        expect(screen.getByText('250 history items will be exported.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        fireEvent.click(screen.getByRole('button', { name: 'Show more history' }));
        fireEvent.click(screen.getByRole('button', { name: 'Show more history' }));
        await waitFor(() => {
            expect(view.container.querySelectorAll('[data-history-key]')).toHaveLength(250);
        });
        const keys = [...view.container.querySelectorAll('[data-history-key]')]
            .map((node) => node.getAttribute('data-history-key'));
        expect(new Set(keys).size).toBe(250);
        expect(keys).toContain(`${CHAIN}:1:${ADDRESS}`);
    });

    it('re-reads only the first page while the total and the head are unchanged', async () => {
        const rows = makeRows(250);
        const read = pagedRead(() => rows);
        const { view } = mountHistory(read);
        await waitFor(() => {
            expect(screen.getByText('100 of 250 history items shown')).toBeInTheDocument();
        });
        expect(read).toHaveBeenCalledTimes(3);

        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.now() + BALANCE_POLL_INTERVAL_MS);
        act(() => { window.dispatchEvent(new Event('focus')); });
        await waitFor(() => expect(read).toHaveBeenCalledTimes(4));
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(read).toHaveBeenCalledTimes(4);
        expect(view.container.querySelectorAll('[data-history-key]')).toHaveLength(100);
        expect(screen.getByText('100 of 250 history items shown')).toBeInTheDocument();
    });

    it('re-reads every page after a row drops out of the list', async () => {
        let rows = makeRows(250);
        const read = pagedRead(() => rows);
        mountHistory(read);
        await waitFor(() => {
            expect(screen.getByText('100 of 250 history items shown')).toBeInTheDocument();
        });

        rows = rows.filter((row) => row.action_index !== '200');
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.now() + BALANCE_POLL_INTERVAL_MS);
        act(() => { window.dispatchEvent(new Event('focus')); });
        await waitFor(() => {
            expect(screen.getByText('100 of 249 history items shown')).toBeInTheDocument();
        });
    });
});

describe('readAllListPages', () => {
    it('drops an action that two pages both carry', async () => {
        const rows = makeRows(150);
        const read = vi.fn((page) => Promise.resolve({
            data: page ? [rows[99], ...rows.slice(100)] : rows.slice(0, 100),
            total: 150,
        }));
        const { rows: merged } = await readAllListPages(read);
        expect(merged).toHaveLength(150);
    });

    it('returns a bare array unchanged', async () => {
        const rows = makeRows(5);
        const { rows: out, snapshot } = await readAllListPages(() => Promise.resolve(rows));
        expect(out).toBe(rows);
        expect(snapshot).toBeNull();
    });
});
