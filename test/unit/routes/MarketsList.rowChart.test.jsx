// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The DEX market list rows (approved mashup Variant 2): the token name alone
// over a muted Depth line, a faint 24h area chart behind the row tinted by the
// sign of the 24h change, the last price over the change, and a chevron. No
// star column and no table header; the watchlist is a Show choice in the
// filter. The charts come from one series map per markets load, so the reads
// a page makes do not grow with its rows.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'node:fs';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import {
    MarketsList,
    daySeriesFromMatches,
    readMarketSeries,
} from '../../../packages/core/src/shared/routes/MarketsList.jsx';
import marketsStyles from '../../../packages/core/src/shared/routes/MarketsList.module.css';
import { selectOption } from '../../helpers/selectOption.js';

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        flows: { ...actual.flows, isDemoWallet: (id) => id === 'demo-wallet' },
    };
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const CHAIN = 'bitcoin-mainnet';

function chooseShow(value) {
    const trigger = screen.getByRole('button', { name: 'Filter markets' });
    if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger);
    selectOption(screen.getByLabelText('Show markets'), value);
}

// Every messaging call the page makes, whatever its name.
function countingMessaging(target) {
    const calls = [];
    const proxy = new Proxy(target, {
        get(obj, prop) {
            const value = obj[prop];
            if (typeof value !== 'function') return value;
            return (...args) => {
                calls.push(String(prop));
                return value(...args);
            };
        },
    });
    return { proxy, calls };
}

function marketRows(count) {
    return Array.from({ length: count }, (_, index) => ({
        tick1: `TOKEN${String(index).padStart(2, '0')}`,
        tick2: 'BTC',
        tick1_price: '0.00001',
        tick1_24hr_change: index % 2 === 0 ? '4.2' : '-1.8',
        depth: 40 - index,
    }));
}

function renderList({ walletId = 'w', rows }) {
    const { proxy, calls } = countingMessaging({
        getMarkets: vi.fn().mockResolvedValue(rows),
        listWatchlistForWallet: vi.fn().mockResolvedValue([]),
        getDispensersForToken: vi.fn().mockResolvedValue([]),
        getMarketHistory: vi.fn().mockResolvedValue([]),
    });
    render(
        <MessagingProvider shell="web" messaging={proxy}>
            <MarketsList
                walletId={walletId}
                selectedAsset={{ chainId: CHAIN, tick: 'BTC' }}
                onChangeAsset={() => {}}
                onOpenMarket={() => {}}
            />
        </MessagingProvider>,
    );
    return { calls };
}

describe('MarketsList rows (Variant 2)', () => {
    it('names the token alone, with no /BTC suffix, no star column and no header', async () => {
        renderList({ rows: marketRows(3) });
        const open = await screen.findByRole('button', { name: 'Open TOKEN00 market' });
        expect(open).toHaveTextContent('TOKEN00');
        expect(within(open).getByText('40 orders')).toHaveClass(marketsStyles.marketDepth);
        const list = screen.getByRole('list', { name: 'Markets' });
        expect(list.textContent).not.toMatch(/\/\s*BTC/);
        expect(list.textContent).not.toMatch(/[★☆]/);
        expect(within(list).queryByRole('button', { name: /watchlist/i })).toBeNull();
        expect(screen.queryByRole('columnheader')).toBeNull();
        expect(screen.queryByRole('table')).toBeNull();
        // One control per row: the open button.
        for (const item of within(list).getAllByRole('listitem')) {
            expect(within(item).getAllByRole('button')).toHaveLength(1);
        }
    });

    it('draws each row chart from the one series map, tinted by the sign of the change', async () => {
        // The demo trades are stamped from the clock; one fixed instant keeps
        // the page's map and this test's map bucketed alike.
        vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 10, 13, 12, 30));
        renderList({ walletId: 'demo-wallet', rows: marketRows(4) });
        await screen.findByRole('button', { name: 'Open TOKEN00 market' });
        const list = screen.getByRole('list', { name: 'Markets' });
        const items = within(list).getAllByRole('listitem');
        expect(items).toHaveLength(4);
        const series = readMarketSeries({ markets: marketRows(4), demo: true });
        for (const [index, item] of items.entries()) {
            const chart = item.querySelector(`.${marketsStyles.rowChart}`);
            expect(chart).not.toBeNull();
            expect(chart).toHaveAttribute('aria-hidden', 'true');
            const polyline = chart.querySelector('polyline');
            const points = polyline.getAttribute('points').trim().split(/\s+/);
            expect(points).toHaveLength(series.get(`TOKEN0${index}::BTC`).length);
            const up = index % 2 === 0;
            // The chart, its fill and the change figure share the change's tone.
            expect(item).toHaveAttribute('data-change-tone', up ? 'up' : 'down');
            expect(chart).toHaveAttribute('data-row-chart', up ? 'up' : 'down');
            const toneToken = up ? 'var(--xc-success)' : 'var(--xc-danger-fg)';
            expect(polyline.getAttribute('stroke')).toContain(toneToken);
            expect(chart.querySelector('polygon').getAttribute('fill')).toContain(toneToken);
            const change = item.querySelector(`.${marketsStyles.change}`);
            expect(change).toHaveTextContent(up ? '+4.20%' : '-1.80%');
            expect(change.style.color).toBe(toneToken);
        }
    });

    it('keeps the fill faint and the figures straight on the tint', () => {
        const source = readFileSync('packages/core/src/shared/routes/MarketsList.jsx', 'utf8');
        const fill = Number(source.match(/const ROW_CHART_FILL_PCT = (\d+);/)[1]);
        // Above 6% the muted Depth line over a red tint drops under 4.5:1 (light theme).
        expect(fill).toBeLessThanOrEqual(6);
        const css = readFileSync('packages/core/src/shared/routes/MarketsList.module.css', 'utf8');
        // The approved Variant 2 has no box behind the price and change; the
        // faint fill alone keeps them AA (5.0:1 or better in every theme).
        expect(css).not.toMatch(/\.figures\s*\{[^}]*background/s);
        expect(css).toMatch(/\.rowChart\s*\{[^}]*pointer-events:\s*none/s);
    });

    it('draws no chart for a market with no series and keeps the row', async () => {
        renderList({ rows: marketRows(2) });
        const open = await screen.findByRole('button', { name: 'Open TOKEN00 market' });
        const item = open.closest('li');
        expect(item.querySelector(`.${marketsStyles.rowChart}`)).toBeNull();
        expect(within(item).getByText('0.00001')).toBeInTheDocument();
        expect(readMarketSeries({ markets: marketRows(2), demo: false }).size).toBe(0);
    });

    it('makes the same reads for 6 markets as for 30', async () => {
        const reads = [];
        for (const count of [6, 30]) {
            for (const walletId of ['w', 'demo-wallet']) {
                const { calls } = renderList({ walletId, rows: marketRows(count) });
                await screen.findByRole('button', { name: 'Open TOKEN00 market' });
                chooseShow('all');
                const list = screen.getByRole('list', { name: 'Markets' });
                await waitFor(() => expect(within(list).getAllByRole('listitem'))
                    .toHaveLength(Math.min(count, 25)));
                reads.push({ count, walletId, calls: [...calls].sort() });
                cleanup();
            }
        }
        for (const entry of reads) {
            expect(entry.calls, `${entry.walletId} at ${entry.count}`)
                .toEqual(['getMarkets', 'listWatchlistForWallet']);
        }
    });

    // A list that wraps into two columns reads as two lists (operator
    // 2026-11-13): it stays one column, and wide content shows the market beside it.
    it('keeps the rows in one column at every width', async () => {
        renderList({ rows: marketRows(4) });
        await screen.findByRole('button', { name: 'Open TOKEN00 market' });
        expect(screen.getByRole('list', { name: 'Markets' })).toHaveClass(marketsStyles.marketsGrid);
        const css = readFileSync('packages/core/src/shared/routes/MarketsList.module.css', 'utf8');
        expect(css).toMatch(/\.marketsGrid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
        expect(css).not.toMatch(/repeat\(2, minmax\(0, 1fr\)\)/);
    });

    it('builds a 24h series from hourly closes, oldest first', () => {
        const now = 1_000_000;
        const rows = [
            { give_tick: 'AAA', get_tick: 'BTC', give_amount: '10', get_amount: '1', timestamp: now - 3 * 3600 },
            { give_tick: 'AAA', get_tick: 'BTC', give_amount: '10', get_amount: '2', timestamp: now - 2 * 3600 },
            { give_tick: 'AAA', get_tick: 'BTC', give_amount: '10', get_amount: '3', timestamp: now - 3600 },
        ];
        const series = daySeriesFromMatches(rows, 'AAA', 'BTC', now);
        expect(series).toHaveLength(3);
        expect(series[0]).toBeLessThan(series[2]);
        expect(daySeriesFromMatches([], 'AAA', 'BTC', now)).toBeNull();
    });
});
