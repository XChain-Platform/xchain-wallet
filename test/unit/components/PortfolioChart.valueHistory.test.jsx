// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Home's chart is the wallet's real value over time (operator ruling
// 2026-11-16): the note for tokens without price history, the coin unit, the
// end on the headline total, the batch reads (token history with its
// per-address effects, native coin history and token price series: their
// read counts, incremental refresh and the backfilling note), and wide Home's
// holding line.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('../../../packages/core/src/flows/demoMode.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, isDemoWallet: (id) => id === 'demo-wallet' };
});

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PortfolioChart, RANGES } from '../../../packages/core/src/shared/components/PortfolioChart.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { HoldingValueContext, holdingValueSeries } from '../../../packages/core/src/shared/components/holdingValueContext.js';
import { sumFiatValue } from '../../../packages/core/src/shared/components/BalanceList.jsx';
import { clearWalletHistoryStore, useWalletHistory } from '../../../packages/core/src/shared/hooks/useWalletHistory.js';
import { prepareValuation } from '../../../packages/core/src/shared/utils/portfolioValuation.js';
import { formatFiatAmount } from '../../../packages/core/src/shared/utils/fiatAmountFormat.js';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import { configureFiatRateSource, _resetPriceLookupForTests } from '../../../packages/core/src/flows/priceLookup.js';

const BTC = 'bitcoin-mainnet';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const SPARKLINE = Array.from({ length: 168 }, (_, i) => 40000 + i * 50);
const PRICES = { [BTC]: { priceFiat: SPARKLINE.at(-1), sparkline: SPARKLINE, change24hPct: 1 } };

let consoleError;
let savedResizeObserver;
beforeAll(() => {
    class StubObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
    savedResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = globalThis.ResizeObserver || StubObserver;
});
afterAll(() => { globalThis.ResizeObserver = savedResizeObserver; });
beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    globalThis.localStorage.clear();
    clearWalletHistoryStore();
    _resetPriceLookupForTests();
});
afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
    consoleError.mockRestore();
    vi.restoreAllMocks();
});

function btcRow(quantity = '100000000', fiatRate = SPARKLINE.at(-1)) {
    return { chainId: BTC, kind: 'native', tick: 'BTC', quantity, divisibility: 8, fiatRate, displayName: 'Bitcoin' };
}
function tokenRow(tick, quantity, fiatRate) {
    return { chainId: BTC, kind: 'token', tick, quantity: String(quantity), divisibility: 0, fiatRate, displayName: tick };
}

function messagingStub() {
    return {
        getSettings: vi.fn(async () => ({ fiatCurrency: 'USD' })),
        getNativePricesRequest: vi.fn(async () => ({ prices: {} })),
        getAddressesByChain: vi.fn(async () => ({})),
        getAddressHistory: vi.fn(async () => ({ data: [] })),
        getLinksForAddress: vi.fn(async () => ({ data: [] })),
    };
}

function Chart({ rows, walletId = 'real-wallet', unit = null, history = null }) {
    return (
        <PortfolioChart
            rows={rows}
            walletId={walletId}
            nativePriceMap={PRICES}
            nativePricesLoading={false}
            history={history}
            unit={unit}
        />
    );
}

function chartImage() {
    return screen.getByRole('img', { name: /^Portfolio performance chart\./ });
}

describe('Home value chart', () => {
    it('ends on the headline total, today\'s balances at today\'s prices', async () => {
        const rows = [btcRow('123456789'), tokenRow('PEPE', 40, 2.5)];
        render(<MessagingProvider shell="web" messaging={messagingStub()}><Chart rows={rows} /></MessagingProvider>);
        const total = Number(sumFiatValue(rows).total);
        expect(chartImage().getAttribute('aria-label')).toContain(`End ${formatFiatAmount(String(total), 'USD')} USD.`);
    });

    it('says some tokens are left out when a valued token has no price history', async () => {
        render(<MessagingProvider shell="web" messaging={messagingStub()}><Chart rows={[btcRow(), tokenRow('PEPE', 40, 2.5)]} /></MessagingProvider>);
        expect(await screen.findByText("Some tokens don't have price history and aren't included")).toBeInTheDocument();
    });

    it('measures the change on the assets priced across the range, not the token that joins at the end', async () => {
        const onRangeChange = vi.fn();
        render(
            <MessagingProvider shell="web" messaging={messagingStub()}>
                <PortfolioChart
                    rows={[btcRow(), tokenRow('PEPE', 4000, 2.5)]}
                    walletId="real-wallet"
                    nativePriceMap={PRICES}
                    nativePricesLoading={false}
                    onRangeChange={onRangeChange}
                />
            </MessagingProvider>,
        );
        const last = onRangeChange.mock.calls.at(-1)[0];
        // 1 BTC from 40,000 to 48,350 over the week; the $10,000 of PEPE with
        // no price history is in the line's last point but not in the change.
        expect(last.delta).toBeCloseTo(SPARKLINE.at(-1) - SPARKLINE[0], 6);
        expect(last.pctText).toBe('+20.88%');
    });

    it('shows no note when every valued asset has a price history', async () => {
        render(<MessagingProvider shell="web" messaging={messagingStub()}><Chart rows={[btcRow()]} /></MessagingProvider>);
        chartImage();
        expect(screen.queryByText(/Some tokens don't have price history/)).toBeNull();
    });

    it('draws in BTC when the headline shows BTC, each point at that point\'s BTC price', async () => {
        const rows = [btcRow('200000000')];
        render(<MessagingProvider shell="web" messaging={messagingStub()}><Chart rows={rows} unit={{ tick: 'BTC', chainId: BTC, price: SPARKLINE.at(-1) }} /></MessagingProvider>);
        // Two BTC held all week reads 2 BTC at every point, whatever BTC's price did.
        const label = chartImage().getAttribute('aria-label');
        expect(label).toContain('Start 2 BTC.');
        expect(label).toContain('End 2 BTC.');
        expect(label).toContain('Change 0 BTC (0.00%)');
    });
});

describe('reads', () => {
    // The explorer's batch routes over a fixed record per batch of addresses:
    // 150 token actions and 150 coin transactions, half an hour apart, served
    // 100 a page newest first, honoring since/until/before and
    // from_time/to_time/from_height the way the routes do: /history resolves
    // `since` through the newest block stamped before it, and the tracker
    // scans newest first and filters by time after the scan, so past
    // from_time it answers empty pages with a live cursor. `newer` adds one
    // more recent action and transaction to every batch, the action in a
    // block stamped earlier than the newest one held (block stamps are not
    // monotonic). `olderTxs` adds transactions older than any range.
    function venue({ backfilling = false, olderTxs = 0, failing = false } = {}) {
        const now = Date.now();
        const state = { newer: false, backfilling };
        const calls = { history: [], native: [], prices: [] };
        const PER_BATCH = 150;
        const PAGE = 100;
        const batchId = (addresses) => Number(addresses[0].replace(/\D/g, '') || 0);
        function actionsFor(addresses) {
            const base = (batchId(addresses) + 1) * 10_000;
            const out = [];
            if (state.newer) out.push({ j: -1, index: base + PER_BATCH + 1, ms: now - 40 * 60_000 });
            for (let j = 0; j < PER_BATCH; j += 1) out.push({ j, index: base + PER_BATCH - j, ms: now - (j + 1) * 30 * 60_000 });
            return out.map(({ j, index, ms }) => ({
                action_index: String(index),
                action: ['SEND', 'DISPENSE', 'ORDER_MATCH', 'DIVIDEND'][(j + 4) % 4],
                timestamp: String(Math.floor(ms / 1000)),
                effects: [{ address: addresses[(j + addresses.length) % addresses.length], tick: 'PEPE', decimals: 0, credit_base: '1', debit_base: '0', net_base: '1', net_whole: '1' }],
            }));
        }
        function txsFor(addresses) {
            const base = batchId(addresses);
            const out = [];
            if (state.newer) out.push({ j: -1, height: 2000, ms: now - 10 * 60_000 });
            for (let j = 0; j < PER_BATCH; j += 1) out.push({ j, height: 1999 - j, ms: now - (j + 1) * 30 * 60_000 });
            for (let k = 0; k < olderTxs; k += 1) out.push({ j: PER_BATCH + k, height: 1999 - PER_BATCH - k, ms: now - (20 + k) * DAY });
            return out.map(({ j, height, ms }) => {
                const address = addresses[(j + addresses.length) % addresses.length];
                return { txid: `${base}-${j}`, height, time: Math.floor(ms / 1000), net: '1000', addresses: { [address]: { received: '1000', sent: '0', net: '1000' } } };
            });
        }
        const messaging = {
            ...messagingStub(),
            getWalletHistoryBatch: vi.fn(async (req) => {
                calls.history.push(req);
                if (failing) throw Object.assign(new Error('Explorer does not serve /history'), { code: 'EXPLORER_BATCH_UNSUPPORTED' });
                const all = actionsFor(req.addresses);
                // One action per block: `since` opens after the newest block
                // stamped before it, `until` closes at the newest stamped at or before it.
                const after = req.since == null ? -Infinity
                    : Math.max(-Infinity, ...all.filter((a) => Number(a.timestamp) < Number(req.since)).map((a) => Number(a.action_index)));
                const through = req.until == null ? Infinity
                    : Math.max(-Infinity, ...all.filter((a) => Number(a.timestamp) <= Number(req.until)).map((a) => Number(a.action_index)));
                const before = req.before == null ? Infinity : Number(req.before);
                const rows = all.filter((a) => Number(a.action_index) > after
                    && Number(a.action_index) <= through && Number(a.action_index) < before)
                    .sort((x, y) => Number(y.action_index) - Number(x.action_index));
                const page = rows.slice(0, PAGE);
                return {
                    amount_unit: 'base', addresses: req.addresses, limit: PAGE,
                    next_cursor: rows.length > PAGE ? page.at(-1).action_index : null,
                    actions: page,
                };
            }),
            getNativeHistoryBatch: vi.fn(async (req) => {
                calls.native.push(req);
                if (failing) throw Object.assign(new Error('The UTXO tracker did not answer.'), { code: 'TRACKER_UNAVAILABLE' });
                const fromS = Number(req.from_time ?? 0);
                const toS = req.to_time == null ? Infinity : Number(req.to_time);
                const fromHeight = Number(req.from_height ?? 0);
                const toHeight = req.to_height == null ? Infinity : Number(req.to_height);
                const offset = Number(req.cursor ?? 0);
                // Heights bound the scan; times filter what it found.
                const scanned = txsFor(req.addresses).filter((t) => t.height >= fromHeight && t.height <= toHeight);
                const page = scanned.slice(offset, offset + PAGE).filter((t) => t.time >= fromS && t.time <= toS);
                return {
                    transactions: page,
                    cursor: offset + PAGE < scanned.length ? String(offset + PAGE) : null,
                    history_from_height: 0,
                    sync: { reorg_count: 0 },
                    // The tracker's per-address state, as its README documents it.
                    addresses: Object.fromEntries(req.addresses.map((a) => [a, { history_status: state.backfilling ? 'backfilling' : 'complete', history_from_height: 1850 }])),
                };
            }),
        };
        configureFiatRateSource({
            explorerUrlByCoin: { bitcoin: 'https://explorer.test' },
            fetch: async (url) => {
                calls.prices.push(url);
                const hours = Array.from({ length: 170 }, (_, i) => Math.floor((now - (170 - i) * HOUR) / 1000));
                return {
                    ok: true,
                    json: async () => ({
                        interval: 'hour', quote: 'BTC', missing: [],
                        series: [
                            { asset: 'BTC', source: 'oracle', pair: 'BTC/USD', quote: 'USD', points: hours.map((t, i) => ({ t, price: String(40000 + i * 50), at: t })) },
                            // PEPE trades only on the DEX, priced in BTC.
                            { asset: 'PEPE', source: 'dex', pair: 'PEPE/BTC', quote: 'BTC', points: hours.filter((_, i) => i % 6 === 0).map((t) => ({ t, price: '0.00005', at: t, fills: 1 })) },
                        ],
                    }),
                };
            },
        });
        return { messaging, calls, state, now };
    }

    function Harness({ walletId, rows, addresses, messaging, refreshKey = 1, onHistory }) {
        const addressesByChain = React.useMemo(() => ({ [BTC]: addresses }), [addresses]);
        const history = useWalletHistory({
            walletId,
            activeNetwork: 'mainnet',
            messaging,
            addressesByChain,
            chainIds: [BTC],
            tokenTicksByChain: { [BTC]: ['PEPE'] },
            refreshKey,
        });
        onHistory?.(history);
        return <Chart rows={rows} walletId={walletId} history={history} />;
    }

    const rowsFor = () => [btcRow('100000000'), tokenRow('PEPE', 1000, 2.5)];
    const addressList = (n) => Array.from({ length: n }, (_, i) => `bc1qaddr${String(i).padStart(2, '0')}`);

    async function loadAt(addressCount) {
        clearWalletHistoryStore();
        const v = venue();
        let latest = null;
        const addresses = addressList(addressCount);
        render(
            <MessagingProvider shell="web" messaging={v.messaging}>
                <Harness walletId={`wallet-${addressCount}`} rows={rowsFor()} addresses={addresses} messaging={v.messaging} onHistory={(h) => { latest = h; }} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(latest?.loading).toBe(false));
        await waitFor(() => expect(latest?.reads?.get(BTC)?.txs.size).toBeGreaterThan(0));
        const counts = { history: v.calls.history.length, native: v.calls.native.length, prices: v.calls.prices.length };
        cleanup();
        return { counts, latest, v };
    }

    it('reads one call per 20 addresses per page on each route, never per address, row or point', async () => {
        const one = await loadAt(1);
        const forty = await loadAt(40);
        // 150 rows a batch at 100 a page is two pages; 1 address is one
        // batch, 40 addresses two.
        expect(one.counts).toEqual({ history: 2, native: 2, prices: 1 });
        expect(forty.counts).toEqual({ history: 4, native: 4, prices: 1 });
        // Every call carries a whole batch, never one address of it.
        expect(forty.v.calls.history.map((c) => c.addresses.length).sort()).toEqual([20, 20, 20, 20]);
        expect(forty.v.calls.native.map((c) => c.addresses.length).sort()).toEqual([20, 20, 20, 20]);
        // Pages follow the single cursor of each batch.
        expect(one.v.calls.history.map((c) => c.before ?? null)).toEqual([null, expect.any(String)]);
        expect(one.v.calls.native.map((c) => c.cursor ?? null)).toEqual([null, '100']);
        // The reads held every row: 150 actions and transactions per batch.
        expect(one.latest.reads.get(BTC).actions.size).toBe(150);
        expect(forty.latest.reads.get(BTC).txs.size).toBe(300);
        // The chart and its detail panel add nothing at any range.
        const source = { prepared: prepareValuation({ rows: rowsFor(), history: one.latest }), priceMap: PRICES, seedId: 'w', synthesize: false };
        const before = one.v.calls.history.length;
        for (const r of RANGES.slice(0, 2)) holdingValueSeries(source, { chainId: BTC, tick: 'BTC', range: r });
        expect(one.v.calls.history.length).toBe(before);
    });

    it('moves the coin line through its native history: the week opens before the coin arrived', async () => {
        const v = venue();
        const onRangeChange = vi.fn();
        // One address received 150 x 1000 sat over the last three days; it holds 150,000 sat now.
        const rows = [btcRow('150000')];
        function Coin() {
            const history = useWalletHistory({
                walletId: 'coin-wallet', activeNetwork: 'mainnet', messaging: v.messaging,
                addressesByChain: React.useMemo(() => ({ [BTC]: ['bc1qaddr00'] }), []), chainIds: [BTC], refreshKey: 1,
            });
            return <PortfolioChart rows={rows} walletId="coin-wallet" nativePriceMap={PRICES} nativePricesLoading={false} history={history} onRangeChange={onRangeChange} />;
        }
        render(<MessagingProvider shell="web" messaging={v.messaging}><Coin /></MessagingProvider>);
        await waitFor(() => expect(chartImage().getAttribute('aria-label')).toContain(`Start ${formatFiatAmount('0', 'USD')} USD.`));
        const end = Number(sumFiatValue(rows).total);
        expect(chartImage().getAttribute('aria-label')).toContain(`End ${formatFiatAmount(String(end), 'USD')} USD.`);
        // No price-history read: the wallet holds no token.
        expect(v.calls.prices).toEqual([]);
    });

    it('prices a DEX-only token through the range in fiat, so no token is left out', async () => {
        const v = venue();
        render(
            <MessagingProvider shell="web" messaging={v.messaging}>
                <Harness walletId="dex-wallet" rows={rowsFor()} addresses={['bc1qaddr00']} messaging={v.messaging} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(v.calls.prices.length).toBe(1));
        const url = new URL(v.calls.prices[0]);
        expect(url.pathname).toBe('/BTC/api/price_history');
        expect(url.searchParams.get('assets')).toBe('BTC,PEPE');
        expect(url.searchParams.get('interval')).toBe('hour');
        await waitFor(() => expect(document.querySelector('[data-chart-note="history-loading"]')).toBeNull());
        expect(screen.queryByText("Some tokens don't have price history and aren't included")).toBeNull();
        const total = Number(sumFiatValue(rowsFor()).total);
        expect(chartImage().getAttribute('aria-label')).toContain(`End ${formatFiatAmount(String(total), 'USD')} USD.`);
    });

    it('says history is loading while the tracker backfills, then reads the coin whole once it is complete', async () => {
        const v = venue({ backfilling: true });
        const view = render(
            <MessagingProvider shell="web" messaging={v.messaging}>
                <Harness walletId="backfill-wallet" rows={rowsFor()} addresses={['bc1qaddr00']} messaging={v.messaging} refreshKey={1} />
            </MessagingProvider>,
        );
        const note = await screen.findByText('History loading');
        expect(note.closest('[data-chart-note="history-loading"]')).not.toBeNull();
        // The line is drawn from what is known meanwhile.
        chartImage();
        v.state.backfilling = false;
        const nativeBefore = v.calls.native.length;
        view.rerender(
            <MessagingProvider shell="web" messaging={v.messaging}>
                <Harness walletId="backfill-wallet" rows={rowsFor()} addresses={['bc1qaddr00']} messaging={v.messaging} refreshKey={2} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.queryByText('History loading')).toBeNull());
        // A backfill adds older transactions, so the refresh reads the range whole.
        const again = v.calls.native.slice(nativeBefore);
        expect(again[0].from_time).toBeTypeOf('number');
        expect(again[0].from_height).toBeUndefined();
        expect(again).toHaveLength(2);
    });

    it('refreshes with only the newer pages after the first load', async () => {
        const v = venue();
        let latest = null;
        const addresses = addressList(40);
        const view = render(
            <MessagingProvider shell="web" messaging={v.messaging}>
                <Harness walletId="refresh-wallet" rows={rowsFor()} addresses={addresses} messaging={v.messaging} refreshKey={1} onHistory={(h) => { latest = h; }} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(latest?.loading).toBe(false));
        await waitFor(() => expect(latest?.reads?.get(BTC)?.txs.size).toBe(300));
        const first = { history: v.calls.history.length, native: v.calls.native.length, prices: v.calls.prices.length };
        v.state.newer = true;
        view.rerender(
            <MessagingProvider shell="web" messaging={v.messaging}>
                <Harness walletId="refresh-wallet" rows={rowsFor()} addresses={addresses} messaging={v.messaging} refreshKey={2} onHistory={(h) => { latest = h; }} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(latest?.reads?.get(BTC)?.txs.size).toBe(302));
        // The new action sits in a block stamped earlier than the newest one
        // held, and still arrives.
        await waitFor(() => expect(latest?.reads?.get(BTC)?.actions.size).toBe(302));
        const history = v.calls.history.slice(first.history);
        const native = v.calls.native.slice(first.native);
        // One page per batch: from the top, stopping at the first page that
        // holds an action already held.
        expect(history).toHaveLength(2);
        expect(native).toHaveLength(2);
        for (const call of history) expect(call.before).toBeUndefined();
        for (const call of native) expect(call.from_height).toBe(1999);
        // The token prices are still fresh: no second read.
        expect(v.calls.prices.length).toBe(first.prices);
    });

    it('stops a coin walk at the first empty page past the range instead of scanning to the end', async () => {
        clearWalletHistoryStore();
        // 150 transactions in range, then 1,000 older ones the tracker would
        // scan through ten more pages to reach the end of.
        const v = venue({ olderTxs: 1000 });
        let latest = null;
        render(
            <MessagingProvider shell="web" messaging={v.messaging}>
                <Harness walletId="busy-wallet" rows={rowsFor()} addresses={['bc1qaddr00']} messaging={v.messaging} onHistory={(h) => { latest = h; }} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(latest?.reads?.get(BTC)?.txs.size).toBe(150));
        // Two pages of rows and the empty page that follows them.
        expect(v.calls.native).toHaveLength(3);
        expect(latest.reads.get(BTC).nativeTruncatedAtMs).toBeNull();
    });

    it('draws the line from today\'s balances when the routes fail, without a loading note or a retry on every refresh', async () => {
        const v = venue({ failing: true });
        const view = render(
            <MessagingProvider shell="web" messaging={v.messaging}>
                <Harness walletId="old-explorer" rows={rowsFor()} addresses={['bc1qaddr00']} messaging={v.messaging} refreshKey={1} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(v.calls.native.length).toBe(1));
        const total = Number(sumFiatValue(rowsFor()).total);
        await waitFor(() => expect(chartImage().getAttribute('aria-label')).toContain(`End ${formatFiatAmount(String(total), 'USD')} USD.`));
        expect(document.querySelector('[data-chart-note="history-loading"]')).toBeNull();
        const seen = { history: v.calls.history.length, native: v.calls.native.length };
        view.rerender(
            <MessagingProvider shell="web" messaging={v.messaging}>
                <Harness walletId="old-explorer" rows={rowsFor()} addresses={['bc1qaddr00']} messaging={v.messaging} refreshKey={2} />
            </MessagingProvider>,
        );
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect({ history: v.calls.history.length, native: v.calls.native.length }).toEqual(seen);
        expect(document.querySelector('[data-chart-note="history-loading"]')).toBeNull();
    });
});

describe('wide Home detail panel', () => {
    function renderEmbeddedBtc({ source, messaging }) {
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <HoldingValueContext.Provider value={source}>
                    <TokenDetail
                        embedded
                        walletId="real-wallet"
                        chainId={BTC}
                        tick="BTC"
                        kind="native"
                        quantity="100000000"
                        divisibility={8}
                        fiatRate={SPARKLINE.at(-1)}
                        onBack={() => {}}
                    />
                </HoldingValueContext.Provider>
            </MessagingProvider>,
        );
    }

    it('draws the holding\'s value (balance then times price then), the wallet chart\'s share of it', async () => {
        const now = Date.now();
        const rows = [btcRow('100000000')];
        const history = {
            entries: [{
                key: `${BTC}:1:bc1qme`, chainId: BTC, address: 'bc1qme', actionIndex: '1', action: 'SEND',
                timestamp: Math.floor((now - 2 * DAY) / 1000), source: 'bc1qfriend',
                raw: { tick: 'BTC', amount: '1', source: 'bc1qfriend', destination: 'bc1qme', status: 'valid' },
            }],
            addressesByChain: { [BTC]: [{ address: 'bc1qme' }] },
            coverageStartMs: -Infinity,
        };
        const source = { prepared: prepareValuation({ rows, history }), priceMap: PRICES, seedId: 'real-wallet', synthesize: false };
        const messaging = {
            ...messagingStub(),
            getNativePricesRequest: vi.fn(async () => ({ prices: PRICES })),
        };
        renderEmbeddedBtc({ source, messaging });
        let chart = await screen.findByRole('img', { name: /Range 1W\./ });
        let label = chart.getAttribute('aria-label');
        // The coin arrived two days ago: the week opens at nothing held and
        // the fiat hero values that balance at each point's price.
        expect(label).toMatch(/Start \$0\./);
        expect(label).toMatch(/End \$[\d.]+K\./);

        fireEvent.click(screen.getByRole('button', { name: 'Show in BTC' }));
        chart = await screen.findByRole('img', { name: /^Balance trend/ });
        label = chart.getAttribute('aria-label');
        expect(label).toMatch(/Start 0 BTC\./);
        expect(label).toContain('End 1 BTC.');
        expect(messaging.getAddressHistory).not.toHaveBeenCalled();
    });

    it('shows the no-history note for a token without a price history instead of a line, and reads no history of its own', async () => {
        const rows = [btcRow('100000000'), tokenRow('PEPE', 40, 2.5)];
        const source = { prepared: prepareValuation({ rows }), priceMap: PRICES, seedId: 'real-wallet', synthesize: false };
        expect(holdingValueSeries(source, { chainId: BTC, tick: 'PEPE', range: RANGES[1] }))
            .toEqual({ series: null, noPriceHistory: true });
        const messaging = {
            ...messagingStub(),
            getTokenInfo: vi.fn(async () => ({ creator: 'bc1qissuer', totalSupply: '1000' })),
            getHoldersForToken: vi.fn(async () => ({ data: [] })),
            listGatedContent: vi.fn(async () => []),
            getSupplyHistory: vi.fn(async () => []),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <HoldingValueContext.Provider value={source}>
                    <TokenDetail
                        embedded
                        walletId="real-wallet"
                        chainId={BTC}
                        tick="PEPE"
                        kind="token"
                        quantity="40"
                        divisibility={0}
                        fiatRate={2.5}
                        onBack={() => {}}
                    />
                </HoldingValueContext.Provider>
            </MessagingProvider>,
        );
        const note = await screen.findByText('No price history yet');
        expect(note.closest('[data-chart-note]')).not.toBeNull();
        expect(document.querySelector('[data-chart-behind] svg polyline')).toBeNull();
        // The hero's line comes from the wallet's one history read: the panel
        // reads no history of its own until its History tab opens. (Its one
        // address-list read is the issuer check, which predates this line.)
        expect(messaging.getAddressHistory).not.toHaveBeenCalled();
        expect(messaging.getAddressesByChain.mock.calls.length).toBeLessThanOrEqual(1);
    });
});
