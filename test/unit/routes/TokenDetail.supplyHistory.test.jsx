// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The supply chart reads indexer history that can arrive unordered, with
// blank or negative supplies, at exact precision beyond a double, or in
// the tens of thousands of points.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-regtest';

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
afterEach(() => { cleanup(); __clearTokenInfoCache(); });

function renderHistory(history) {
    const messaging = {
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getTokenInfo: vi.fn().mockResolvedValue({ creator: 'bcrt1qx' }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
        getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
        listGatedContent: vi.fn().mockResolvedValue([]),
        getSupplyHistory: vi.fn().mockResolvedValue(history),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TokenDetail walletId="w1" chainId={CHAIN} tick="HIST" kind="token" quantity="1" onBack={() => {}} />
        </MessagingProvider>,
    );
}

const pathOf = (chart) => chart.querySelector('path').getAttribute('d');

describe('TokenDetail supply history input', () => {
    it('draws points in time order when the indexer returns them unordered', async () => {
        renderHistory([
            { timestamp: 300, supply: 30 },
            { timestamp: 100, supply: 10 },
            { timestamp: 200, supply: 20 },
        ]);
        const chart = await screen.findByRole('img', { name: /Supply of HIST over time, latest 30/ });
        expect(pathOf(chart)).toBe('M0.0 80.0 L150.0 40.0 L300.0 0.0');
    });

    it('orders ISO timestamps by time', async () => {
        renderHistory([
            { timestamp: '2026-03-01T00:00:00Z', supply: 50 },
            { timestamp: '2026-01-01T00:00:00Z', supply: 10 },
        ]);
        const chart = await screen.findByRole('img', { name: /latest 50/ });
        expect(pathOf(chart)).toBe('M0.0 80.0 L300.0 0.0');
    });

    it('drops blank, negative and non-numeric supplies instead of plotting them as zero', async () => {
        renderHistory([
            { height: 1, supply: null },
            { height: 2, supply: '' },
            { height: 3, supply: -4 },
            { height: 4, supply: 'abc' },
            { height: 5, supply: 5 },
            { height: 6, supply: 10 },
        ]);
        const chart = await screen.findByRole('img', { name: /latest 10/ });
        expect(pathOf(chart)).toBe('M0.0 80.0 L300.0 0.0');
    });

    it('labels the latest supply with its exact digits', async () => {
        renderHistory([
            { height: 1, supply: '12345678901234567890.12345678' },
            { height: 2, supply: '12345678901234567891.12345678' },
        ]);
        expect(await screen.findByRole('img', {
            name: 'Supply of HIST over time, latest 12,345,678,901,234,567,891.12345678',
        })).toBeTruthy();
    });

    it('thins a 10,000-point history and keeps its first and last points', async () => {
        const history = Array.from({ length: 10_000 }, (_, i) => ({ height: i + 1, supply: i + 1 }));
        renderHistory(history);
        const chart = await screen.findByRole('img', { name: /latest 10,000/ });
        const segments = pathOf(chart).split(' L');
        expect(segments.length).toBeLessThanOrEqual(600);
        expect(segments[0]).toBe('M0.0 80.0');
        expect(segments[segments.length - 1]).toBe('300.0 0.0');
    });
});
