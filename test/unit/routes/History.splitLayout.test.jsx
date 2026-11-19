// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';
import { resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';

vi.mock('../../../packages/core/src/shared/routes/ActionDetail.jsx', () => ({
    ActionDetail: ({ entry, embedded }) => (
        <div data-action-detail={entry.actionIndex} data-embedded={embedded ? 'true' : 'false'}>
            Action {entry.actionIndex}
        </div>
    ),
}));

const CHAIN = 'litecoin-regtest';
const ADDRESS = 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi';
let contentWidth = 0;
let savedResizeObserver;

function historyRow(actionIndex, timestamp) {
    return {
        action: 'SEND',
        action_index: String(actionIndex),
        block_index: 7000 + actionIndex,
        timestamp,
        tx_hash: String(actionIndex).repeat(64),
        status: 'valid',
        details: {
            tick: 'LTC',
            source: ADDRESS,
            destination: 'moV6MFm6cLkPXAhLKGRAGyPTPtFYPMYLW1',
            amount: String(actionIndex),
        },
    };
}

function mountHistory(props = {}) {
    const now = Math.floor(Date.now() / 1000);
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: ADDRESS }] }),
        getAddressHistory: vi.fn().mockResolvedValue([
            historyRow(11, now - 10),
            historyRow(22, now - 20),
        ]),
        getLinksForAddress: vi.fn().mockResolvedValue([]),
        getAddressMempool: vi.fn().mockResolvedValue([]),
        getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
        getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
        getSettings: vi.fn().mockResolvedValue({ verifyProofs: false }),
        listContacts: vi.fn().mockResolvedValue([]),
    };
    const onSelectEntry = props.onSelectEntry || vi.fn();
    const view = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ToastHost>
                <History
                    walletId="history-split-wallet"
                    accountId="account-1"
                    onBack={vi.fn()}
                    onSelectEntry={onSelectEntry}
                    {...props}
                />
            </ToastHost>
        </MessagingProvider>,
    );
    return { ...view, messaging, onSelectEntry };
}

beforeEach(() => {
    contentWidth = 0;
    savedResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class ResizeObserver {
        constructor(callback) { this.callback = callback; }
        observe() { this.callback([]); }
        disconnect() {}
    };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
        width: contentWidth,
        height: 800,
        top: 0,
        right: contentWidth,
        bottom: 800,
        left: 0,
        x: 0,
        y: 0,
        toJSON() {},
    }));
    localStorage.clear();
    sessionStorage.clear();
    resetBackStackForTests();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    globalThis.ResizeObserver = savedResizeObserver;
    resetBackStackForTests();
});

describe('History split layout', () => {
    it('preselects the first wide row and swaps detail without routing', async () => {
        contentWidth = 900;
        const { container, onSelectEntry } = mountHistory();

        const split = await waitFor(() => {
            const node = container.querySelector('[data-list-detail="two-panel"]');
            expect(node).not.toBeNull();
            return node;
        });
        expect(split).toBeTruthy();
        const listRegion = screen.getByRole('region', { name: 'History entries' });
        expect(listRegion).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Action details' })).toBeInTheDocument();
        // The list panel has no filter bar. Its scroll region is the panel's
        // first child, and the header carries Filter immediately before More.
        expect(listRegion.previousElementSibling).toBeNull();
        const filter = screen.getByRole('button', { name: 'History filters' });
        const more = screen.getByRole('button', { name: 'More actions' });
        const headerActions = more.closest('[data-history-header-actions]');
        expect(headerActions).not.toBeNull();
        expect(screen.getByRole('heading', { name: 'History', level: 1 }).closest('div'))
            .toContainElement(headerActions);
        expect([...headerActions.querySelectorAll('button')]).toEqual([filter, more]);

        fireEvent.click(filter);
        expect(screen.getByRole('dialog', { name: 'History filters' })).toBeInTheDocument();
        fireEvent.change(screen.getByRole('searchbox', { name: 'Search history' }), {
            target: { value: 'send' },
        });
        expect(filter).toHaveAttribute('data-active', 'true');
        expect(container.querySelector('[data-action-detail="11"]')).toHaveAttribute('data-embedded', 'true');

        const rows = [...container.querySelectorAll('button[data-history-row]')];
        expect(rows).toHaveLength(2);
        expect(rows[0]).toHaveAttribute('aria-current', 'true');
        fireEvent.click(rows[1]);

        await waitFor(() => expect(container.querySelector('[data-action-detail="22"]')).not.toBeNull());
        expect(rows[1]).toHaveAttribute('aria-current', 'true');
        expect(onSelectEntry).not.toHaveBeenCalled();
        expect(container.querySelectorAll('[data-action-detail]')).toHaveLength(1);

        fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize the history list' }), {
            key: 'ArrowRight',
        });
        const prefs = JSON.parse(localStorage.getItem('xc:displayPrefs'));
        expect(prefs.panelSplits.history).toBeGreaterThan(0);
    });

    it('keeps narrow History as a list that routes on row selection', async () => {
        contentWidth = 600;
        const { container, onSelectEntry } = mountHistory();

        await waitFor(() => expect(container.querySelectorAll('button[data-history-row]')).toHaveLength(2));
        expect(container.querySelector('[data-list-detail="two-panel"]')).toBeNull();
        expect(container.querySelector('[data-action-detail]')).toBeNull();

        fireEvent.click(container.querySelectorAll('button[data-history-row]')[0]);
        expect(onSelectEntry).toHaveBeenCalledOnce();
        expect(onSelectEntry.mock.calls[0][0].actionIndex).toBe('11');
    });
});
