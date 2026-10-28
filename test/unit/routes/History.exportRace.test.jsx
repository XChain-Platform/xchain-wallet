// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// History export under a double trigger and under an explorer that fails
// while the full history is read.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Blob as NodeBlob } from 'node:buffer';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';

const CHAIN = 'litecoin-regtest';
const ADDRESS = 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi';

function historyRow(index) {
    return {
        action: 'SEND',
        action_index: index,
        block_index: 1000 - index,
        timestamp: Math.floor(Date.now() / 1000) - index,
        tx_hash: `tx-${index}`,
        details: { source: ADDRESS, destination: 'mrecipient', tick: 'LTC', amount: '1.25' },
    };
}

function mountHistory(getAddressHistory) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: ADDRESS }] }),
        getAddressHistory: vi.fn(getAddressHistory),
        getLinksForAddress: vi.fn().mockResolvedValue([]),
        getAddressMempool: vi.fn().mockResolvedValue([]),
        getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
        getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
        getSettings: vi.fn().mockResolvedValue({ fiatCurrency: 'USD' }),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <History walletId="w1" accountId="a1" />
        </MessagingProvider>,
    );
    return messaging;
}

function captureDownloads() {
    const blobs = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
        blobs.push(blob);
        return `blob:history-${blobs.length}`;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clicks = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.stubGlobal('Blob', NodeBlob);
    return { blobs, clicks };
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

async function openExport() {
    const open = await screen.findByRole('button', { name: 'Export…' });
    await waitFor(() => expect(open).toBeEnabled());
    fireEvent.click(open);
    return screen.findByRole('dialog', { name: 'Export history' });
}

describe('History export double trigger', () => {
    it('writes one CSV for two clicks in separate tasks', async () => {
        const rows = [historyRow(1), historyRow(2), historyRow(3)];
        mountHistory(async () => rows);
        const { blobs, clicks } = captureDownloads();
        await openExport();

        const confirm = screen.getByRole('button', { name: 'Export' });
        fireEvent.click(confirm);
        await act(async () => {});
        fireEvent.click(confirm);

        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Export history' })).toBeNull());
        expect(clicks).toHaveBeenCalledTimes(1);
        expect(blobs).toHaveLength(1);
        expect((await blobs[0].text()).trim().split('\n')).toHaveLength(4);
    });

    it('writes one CSV for two clicks dispatched in the same task', async () => {
        mountHistory(async () => [historyRow(1), historyRow(2)]);
        const { blobs, clicks } = captureDownloads();
        await openExport();

        const confirm = screen.getByRole('button', { name: 'Export' });
        fireEvent.click(confirm);
        fireEvent.click(confirm);

        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Export history' })).toBeNull());
        expect(clicks).toHaveBeenCalledTimes(1);
        expect(blobs).toHaveLength(1);
    });
});

describe('History export with a failing explorer', () => {
    it('labels the saved history when the only chain is offline on load', async () => {
        mountHistory(async () => { throw new Error('HTTP 500'); });
        expect(await screen.findByText(/didn't refresh\. Showing the last saved history/)).toBeInTheDocument();
    });

    // Page 2 comes back empty below the stated total; the export is labelled
    // or refused, never a CSV of page 1 alone.
    it('labels or refuses an export when a later history page comes back short', async () => {
        const first = Array.from({ length: 100 }, (_, i) => historyRow(i + 1));
        mountHistory(async ({ opts } = {}) => (
            opts?.page ? { data: [], total: 150 } : { data: first, total: 150 }
        ));
        const { blobs } = captureDownloads();
        await openExport();
        fireEvent.click(screen.getByRole('button', { name: 'Export' }));
        await waitFor(() => expect(blobs.length + document.querySelectorAll('[role="alert"]').length).toBeGreaterThan(0));
        const lines = blobs.length ? (await blobs[0].text()).trim().split('\n').length - 1 : 0;
        // A short page on the only chain refuses the whole load, so the page
        // falls back to the saved history under its didn't-refresh notice.
        const labelled = Boolean(document.getElementById('history-unread-chains'))
            || Boolean(document.getElementById('history-offline-action-reason'))
            || screen.queryAllByText(/partial|incomplete|not every/i).length > 0;
        expect(lines === 150 || labelled || blobs.length === 0).toBe(true);
    });
});
