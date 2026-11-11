// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A token that failed to load shows its load error and nothing else at page
// level: the "No price history yet" empty state belongs to a loaded token.

import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

vi.mock('lightweight-charts', () => {
    const stub = () => new Proxy(() => {}, {
        get: (_target, property) => (typeof property === 'symbol' || property === 'then' ? undefined : stub()),
        apply: () => stub(),
    });
    return { createChart: () => stub(), ColorType: { Solid: 'solid' }, CrosshairMode: {}, LineStyle: {}, PriceScaleMode: {} };
});

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

let savedResizeObserver;
beforeAll(() => {
    class StubObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() { return []; }
    }
    savedResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = globalThis.ResizeObserver || StubObserver;
});
afterAll(() => { globalThis.ResizeObserver = savedResizeObserver; });

const CHAIN = 'bitcoin-mainnet';
const NOTICE = /Token details could not be loaded from the explorer/;
const NO_HISTORY = /No price history yet/;

function pageMessages(container) {
    const nodes = [...container.querySelectorAll('[data-variant], [data-empty-state]')]
        .filter((el) => !el.closest('[role="dialog"], [hidden], [aria-hidden="true"]'));
    return nodes
        .filter((el) => !nodes.some((other) => other !== el && other.contains(el)))
        .map((el) => el.textContent.replace(/\s+/g, ' ').trim());
}

function renderDetail(getTokenInfo) {
    const messaging = {
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'mainnet', fiatCurrency: 'USD' }),
        getTokenInfo,
        getAddressesByChain: vi.fn().mockResolvedValue({}),
        getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
        listGatedContent: vi.fn().mockResolvedValue([]),
        getWalletBalances: vi.fn().mockResolvedValue({}),
    };
    return render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(TokenDetail, {
            walletId: 'w1',
            chainId: CHAIN,
            tick: 'LOADERR',
            kind: 'token',
            quantity: '100',
            onBack() {},
            onManageToken: vi.fn(),
        }),
    ));
}

describe('TokenDetail load-error state', () => {
    it('shows exactly one page message, the load error', async () => {
        const { container } = renderDetail(vi.fn().mockResolvedValue({
            chainId: CHAIN, tick: 'LOADERR', creator: null, loadError: true,
        }));
        await screen.findByText(NOTICE);
        // Let the market panel and other reads settle before counting.
        await new Promise((resolve) => { setTimeout(resolve, 150); });
        await waitFor(() => expect(screen.queryByText(NO_HISTORY)).toBeNull());
        const messages = pageMessages(container);
        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatch(NOTICE);
    });

    it('still shows the price-history empty state for a loaded token with no history', async () => {
        renderDetail(vi.fn().mockResolvedValue({
            chainId: CHAIN, tick: 'LOADERR', creator: 'bc1qowner', divisibility: 8,
        }));
        expect(await screen.findByText(NO_HISTORY)).toBeTruthy();
        expect(screen.queryByText(NOTICE)).toBeNull();
    });
});
