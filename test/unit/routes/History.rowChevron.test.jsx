// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every tappable list row ends in the Back-sized chevron. A History row that
// opens its detail page carries the forward chevron in ActivityRow's trailing
// cell, clipped like the Coins, Tokens and DeFi rows; a row that expands in
// place keeps its expand chevron instead.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';
import rowStyles from '../../../packages/core/src/shared/components/ActivityRow.module.css';
import historyStyles from '../../../packages/core/src/shared/routes/History.module.css';
import { resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';

const CHAIN = 'litecoin-regtest';
const OURS = 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi';
const THEIRS = 'moV6MFm6cLkPXAhLKGRAGyPTPtFYPMYLW1';

const historyCss = readFileSync('packages/core/src/shared/routes/History.module.css', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

function ruleBody(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(historyCss)?.[1] ?? '';
}

function mountHistory(props = {}) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: OURS }] }),
        getAddressHistory: vi.fn().mockResolvedValue([{
            action_index: '7',
            action: 'SEND',
            block_index: 7707,
            timestamp: Math.floor(Date.now() / 1000) - 60,
            tx_hash: 'ab'.repeat(32),
            source: OURS,
            destination: THEIRS,
            tick: 'XCHAIN',
            amount: '1',
        }]),
        getLinksForAddress: vi.fn().mockResolvedValue([]),
        getAddressMempool: vi.fn().mockResolvedValue([]),
        getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
        getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
        getSettings: vi.fn().mockResolvedValue({}),
        listContacts: vi.fn().mockResolvedValue([]),
        getActionByIndex: vi.fn().mockResolvedValue(null),
    };
    return render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(History, { walletId: 'w1', accountId: 'a1', ...props }),
        ),
    );
}

afterEach(() => {
    cleanup();
    resetBackStackForTests();
    localStorage.clear();
});

describe('History row chevron', () => {
    it('ends a row that opens its detail page in the forward chevron, in the trailing cell', async () => {
        const view = mountHistory({ onSelectEntry: vi.fn() });
        await waitFor(() => expect(view.container.querySelector('button[data-history-row]')).toBeTruthy());

        const row = view.container.querySelector('button[data-history-row]');
        expect(row).not.toHaveClass(rowStyles.noTrailing);
        expect(row).not.toHaveAttribute('aria-expanded');
        const trailing = row.querySelector(`.${rowStyles.trailing}`);
        expect(trailing).not.toBeNull();
        expect(trailing).toBe(row.lastElementChild);
        const chevron = trailing.querySelector('[data-row-chevron]');
        expect(chevron).not.toBeNull();
        expect(chevron).toHaveClass(historyStyles.rowChevron);
        expect(chevron.querySelector('svg')).not.toBeNull();
    });

    it('keeps the expand chevron, not the forward one, on a row that expands in place', async () => {
        const view = mountHistory();
        await waitFor(() => expect(view.container.querySelector('button[data-history-row]')).toBeTruthy());

        const row = view.container.querySelector('button[data-history-row]');
        expect(row).toHaveAttribute('aria-expanded', 'false');
        expect(row.querySelector('[data-row-chevron]')).toBeNull();
        expect(row.querySelector(`.${rowStyles.trailing} svg`)).not.toBeNull();
    });

    it('draws the chevron at the Back size, clipped to the middle third of its box', () => {
        const box = ruleBody('.rowChevron');
        expect(box).toMatch(/--xc-icon-size:\s*32px/);
        expect(box).toMatch(/width:\s*calc\(var\(--xc-icon-size\) \/ 3\)/);
        expect(box).toMatch(/overflow:\s*hidden/);
        const glyph = ruleBody('.rowChevron svg');
        expect(glyph).toMatch(/width:\s*var\(--xc-icon-size\)/);
        expect(glyph).toMatch(/height:\s*var\(--xc-icon-size\)/);
    });
});
