// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';
import { resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';

const LTC = 'litecoin-regtest';
const DOGE = 'dogecoin-regtest';
const LTC_ADDRESS = 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi';
const DOGE_ADDRESS = 'nZ1TestDogecoinAddress11111111111111';

function historyRow(actionIndex, tick, source, secondsAgo) {
    return {
        action: 'SEND',
        action_index: String(actionIndex),
        block_index: 100 + actionIndex,
        timestamp: Math.floor(Date.now() / 1000) - secondsAgo,
        tx_hash: `deadbeef${actionIndex}`,
        status: 'valid',
        details: { tick, source, amount: String(actionIndex) },
    };
}

function mountHistory() {
    const rows = {
        [LTC]: [
            historyRow(1, 'ALPHA', LTC_ADDRESS, 30),
            historyRow(2, 'BETA', LTC_ADDRESS, 60),
        ],
        [DOGE]: [historyRow(3, 'GAMMA', DOGE_ADDRESS, 90)],
    };
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [LTC]: [{ address: LTC_ADDRESS }],
            [DOGE]: [{ address: DOGE_ADDRESS }],
        }),
        getAddressHistory: vi.fn(({ chainId }) => Promise.resolve(rows[chainId])),
        getLinksForAddress: vi.fn().mockResolvedValue([]),
        getAddressMempool: vi.fn().mockResolvedValue([]),
        getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
        getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
        listContacts: vi.fn().mockResolvedValue([]),
        getSettings: vi.fn().mockResolvedValue({ verifyProofs: false }),
    };
    const view = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ToastHost>
                <History walletId="keyboard-wallet" accountId="a1" onBack={vi.fn()} />
            </ToastHost>
        </MessagingProvider>,
    );
    return view;
}

async function rowButtons(view) {
    await waitFor(() => {
        expect(view.container.querySelectorAll('button[data-history-row]')).toHaveLength(3);
    });
    return [...view.container.querySelectorAll('button[data-history-row]')];
}

beforeEach(() => {
    resetBackStackForTests();
    globalThis.localStorage?.removeItem('xc:chainFilter:history:keyboard-wallet');
    globalThis.localStorage?.removeItem('xc:historyGroupingMode:keyboard-wallet');
});

afterEach(() => {
    cleanup();
    resetBackStackForTests();
});

describe('History keyboard operation', () => {
    it('exposes a reachable list and moves between rows with arrow keys', async () => {
        const view = mountHistory();
        const rows = await rowButtons(view);

        expect(screen.getByRole('list', { name: 'History' })).toBeInTheDocument();
        expect(rows.every((row) => row.tabIndex === 0)).toBe(true);

        rows[0].focus();
        fireEvent.keyDown(rows[0], { key: 'ArrowDown' });
        expect(rows[1]).toHaveFocus();
        fireEvent.keyDown(rows[1], { key: 'ArrowDown' });
        expect(rows[2]).toHaveFocus();
        fireEvent.keyDown(rows[2], { key: 'ArrowUp' });
        expect(rows[1]).toHaveFocus();
    });

    it.each(['Escape', 'Back'])('%s closes detail and restores focus to its row', async (method) => {
        const view = mountHistory();
        const rows = await rowButtons(view);
        const row = rows[1];
        row.focus();

        // jsdom needs the click that a browser synthesizes after Enter.
        fireEvent.keyDown(row, { key: 'Enter' });
        fireEvent.click(row);
        expect(await screen.findByRole('region', { name: 'Action detail' }))
            .toBeInTheDocument();
        expect(row).toHaveAttribute('aria-expanded', 'true');

        screen.getByRole('tab', { name: 'Details' }).focus();
        if (method === 'Escape') {
            fireEvent.keyDown(window, { key: 'Escape' });
        } else {
            await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
            fireEvent.popState(window);
        }

        await waitFor(() => {
            expect(screen.queryByRole('region', { name: 'Action detail' })).toBeNull();
            expect(row).toHaveFocus();
        });
    });

    it('opens and changes advanced filters using only keyboard activation', async () => {
        const view = mountHistory();
        await rowButtons(view);

        const disclosure = screen.getByRole('button', { name: 'Additional details' });
        disclosure.focus();
        fireEvent.keyDown(disclosure, { key: 'Enter' });
        fireEvent.click(disclosure);

        const chainTrigger = screen.getByRole('button', { name: 'All chains' });
        chainTrigger.focus();
        fireEvent.keyDown(chainTrigger, { key: 'ArrowDown' });
        const chainOptions = await screen.findAllByRole('option');
        await waitFor(() => expect(chainOptions[0]).toHaveFocus());
        fireEvent.keyDown(chainOptions[0], { key: 'ArrowDown' });
        expect(chainOptions[1]).toHaveFocus();
        fireEvent.keyDown(chainOptions[1], { key: 'Enter' });
        fireEvent.click(chainOptions[1]);
        expect(chainTrigger).toHaveFocus();
        await waitFor(() => {
            expect(view.container.querySelectorAll('button[data-history-row]')).toHaveLength(2);
        });

        const actionTrigger = screen.getByRole('button', { name: 'All action types' });
        fireEvent.keyDown(actionTrigger, { key: 'ArrowDown' });
        const sendOption = await screen.findByRole('option', { name: /Send/ });
        await waitFor(() => expect(sendOption).toHaveFocus());
        fireEvent.keyDown(sendOption, { key: 'Enter' });
        fireEvent.click(sendOption);
        expect(sendOption).toHaveAttribute('aria-selected', 'true');
        fireEvent.keyDown(sendOption, { key: 'Escape' });
        expect(actionTrigger).toHaveFocus();
        expect(screen.queryByRole('option', { name: /Send/ })).toBeNull();
    });
});
