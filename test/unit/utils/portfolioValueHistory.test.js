// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The wallet's value over time (operator ruling 2026-11-16): balances replayed
// from the wallet's own history, valued at each point's own price.

import { describe, expect, it } from 'vitest';
import { nativeBackfilling } from '../../../packages/core/src/shared/hooks/useWalletHistory.js';
import {
    DAY_MS,
    HOUR_MS,
    addressScope,
    assetKeyOf,
    baseUnits,
    buildValueSeries,
    chartGridTimes,
    effectDelta,
    priceAt,
    readDeltas,
    replayBalances,
    timedPriceSeries,
    tokenFiatSeries,
    walletAssetDeltas,
} from '../../../packages/core/src/shared/utils/portfolioValueHistory.js';
import { prepareValuation, valueSeriesFor } from '../../../packages/core/src/shared/utils/portfolioValuation.js';
import { RANGES } from '../../../packages/core/src/shared/components/PortfolioChart.jsx';
import { holdingValueSeries } from '../../../packages/core/src/shared/components/holdingValueContext.js';
import { sumFiatValue } from '../../../packages/core/src/shared/components/BalanceList.jsx';

const NOW = Date.UTC(2026, 10, 16, 12);
const BTC = 'bitcoin-mainnet';
const LTC = 'litecoin-mainnet';
const ME = 'bc1qme';
const ME2 = 'bc1qmetoo';
const FRIEND = 'bc1qfriend';
const range = (id) => RANGES.find((r) => r.id === id);

function send({ chainId = BTC, index, ms, tick, amount, source, destination, address = ME, pending = false }) {
    return {
        key: `${chainId}:${index}:${address}`,
        chainId,
        address,
        actionIndex: String(index),
        action: 'SEND',
        timestamp: Math.floor(ms / 1000),
        source,
        pending: pending ? { state: 'mempool' } : undefined,
        raw: { tick, amount, source, destination, status: 'valid' },
    };
}

function row({ chainId = BTC, kind = 'native', tick = 'BTC', quantity, divisibility = 8, fiatRate }) {
    return { chainId, kind, tick, quantity: String(quantity), divisibility, fiatRate, displayName: tick };
}

// A daily price series flat at `price`, one point per day for a year.
function flatDaily(price, days = 365) {
    const out = [];
    for (let d = days; d >= 1; d -= 1) out.push([NOW - d * DAY_MS, price]);
    return out;
}

describe('balance replay', () => {
    it('steps back through sends and receives at the times they happened', () => {
        const scope = addressScope({ [BTC]: [{ address: ME }] });
        const assets = new Map([[assetKeyOf(BTC, 'PEPE'), { chainId: BTC, tick: 'PEPE', divisibility: 0 }]]);
        const entries = [
            send({ index: 1, ms: NOW - 10 * DAY_MS, tick: 'PEPE', amount: '100', source: FRIEND, destination: ME }),
            send({ index: 2, ms: NOW - 5 * DAY_MS, tick: 'PEPE', amount: '30', source: ME, destination: FRIEND }),
            send({ index: 3, ms: NOW - 2 * DAY_MS, tick: 'PEPE', amount: '5', source: FRIEND, destination: ME }),
        ];
        const deltas = walletAssetDeltas(entries, { scope, assets }).get(assetKeyOf(BTC, 'PEPE'));
        expect(deltas.map((d) => d.delta)).toEqual([5n, -30n, 100n]);

        const grid = [NOW - 12 * DAY_MS, NOW - 7 * DAY_MS, NOW - 3 * DAY_MS, NOW - DAY_MS, NOW];
        const { balances, clamped } = replayBalances({ currentAtomic: 75n, deltas, grid });
        expect(balances).toEqual([0n, 100n, 70n, 75n, 75n]);
        expect(clamped).toBe(false);
    });

    it('counts an action read for two own addresses once, and nets a move between them to zero', () => {
        const scope = addressScope({ [BTC]: [{ address: ME }, { address: ME2 }] });
        const assets = new Map([[assetKeyOf(BTC, 'PEPE'), { chainId: BTC, tick: 'PEPE', divisibility: 0 }]]);
        const move = { index: 9, ms: NOW - DAY_MS, tick: 'PEPE', amount: '40', source: ME, destination: ME2 };
        const entries = [send({ ...move, address: ME }), send({ ...move, address: ME2 })];
        expect(walletAssetDeltas(entries, { scope, assets }).size).toBe(0);
    });

    it('counts only the addresses the rows count (the active address on Home)', () => {
        const scope = addressScope({ [BTC]: [{ address: ME }, { address: ME2 }] }, { [BTC]: { address: ME } });
        const assets = new Map([[assetKeyOf(BTC, 'PEPE'), { chainId: BTC, tick: 'PEPE', divisibility: 0 }]]);
        const entries = [send({ index: 9, ms: NOW - DAY_MS, tick: 'PEPE', amount: '40', source: ME, destination: ME2 })];
        expect(walletAssetDeltas(entries, { scope, assets }).get(assetKeyOf(BTC, 'PEPE'))[0].delta).toBe(-40n);
    });

    it('leaves pending rows out and reads whole-unit SEND amounts in base units', () => {
        const scope = addressScope({ [BTC]: [{ address: ME }] });
        const assets = new Map([[assetKeyOf(BTC, 'XCP'), { chainId: BTC, tick: 'XCP', divisibility: 8 }]]);
        const entries = [
            send({ index: 1, ms: NOW - DAY_MS, tick: 'XCP', amount: '1.5', source: FRIEND, destination: ME }),
            send({ index: 2, ms: NOW - HOUR_MS, tick: 'XCP', amount: '9', source: FRIEND, destination: ME, pending: true }),
        ];
        const deltas = walletAssetDeltas(entries, { scope, assets }).get(assetKeyOf(BTC, 'XCP'));
        expect(deltas).toEqual([{ ms: NOW - DAY_MS, delta: 150000000n }]);
    });

    it('holds the oldest known balance before the history it loaded begins', () => {
        const deltas = [{ ms: NOW - 2 * DAY_MS, delta: 10n }];
        const grid = [NOW - 30 * DAY_MS, NOW - 3 * DAY_MS, NOW];
        // The loaded rows reach back only 5 days: before that nothing is known.
        const { balances } = replayBalances({ currentAtomic: 25n, deltas, grid, coverageStartMs: NOW - 5 * DAY_MS });
        expect(balances).toEqual([15n, 15n, 25n]);
    });

    it('reads zero, and reports it, where the rows would take a balance below zero', () => {
        const { balances, clamped } = replayBalances({
            currentAtomic: 5n,
            deltas: [{ ms: NOW - DAY_MS, delta: 50n }],
            grid: [NOW - 2 * DAY_MS, NOW],
        });
        expect(balances).toEqual([0n, 5n]);
        expect(clamped).toBe(true);
    });
});

describe('valuation', () => {
    it('charts a wallet that held 3 BTC last month and holds 1 today as 3 then 1', () => {
        const rows = [row({ quantity: 100000000, fiatRate: 50000 })];
        const history = {
            entries: [send({ index: 1, ms: NOW - 10 * DAY_MS, tick: 'BTC', amount: '2', source: ME, destination: FRIEND })],
            addressesByChain: { [BTC]: [{ address: ME }] },
            coverageStartMs: -Infinity,
        };
        const prepared = prepareValuation({ rows, history });
        const result = valueSeriesFor(prepared, {
            priceMap: { [BTC]: { historyDaily: flatDaily(50000), priceFiat: 50000 } },
            range: range('1m'),
            seedId: 'w',
            synthesize: false,
            nowMs: NOW,
        });
        expect(result.series[0]).toBeCloseTo(150000, 6);
        expect(result.series.at(-1)).toBe(50000);
        // The drop lands at the send, not spread over the range.
        const sendIndex = result.grid.findIndex((ms) => ms > NOW - 10 * DAY_MS);
        expect(result.series[sendIndex - 1]).toBeCloseTo(150000, 6);
        expect(result.series[sendIndex]).toBeCloseTo(50000, 6);
    });

    it('values each point at that point\'s own price', () => {
        const prices = [];
        for (let d = 60; d >= 1; d -= 1) prices.push([NOW - d * DAY_MS, d > 30 ? 20000 : 40000]);
        const rows = [row({ quantity: 200000000, fiatRate: 40000 })];
        const result = valueSeriesFor(prepareValuation({ rows }), {
            priceMap: { [BTC]: { historyDaily: prices, priceFiat: 40000 } },
            range: range('3m'),
            seedId: 'w',
            synthesize: false,
            nowMs: NOW,
        });
        const at = (ms) => result.series[result.grid.findIndex((t) => t >= ms)];
        expect(at(NOW - 45 * DAY_MS)).toBeCloseTo(40000, 6);
        expect(at(NOW - 10 * DAY_MS)).toBeCloseTo(80000, 6);
        // Before the coin's first price the coin is left out and named.
        expect(result.series[0]).toBe(0);
        expect(result.missingCoinKeys).toEqual([assetKeyOf(BTC, 'BTC')]);
    });

    it('ends every range on the headline total, today\'s balances at today\'s prices', () => {
        const rows = [
            row({ quantity: 123456789, fiatRate: 61234.56 }),
            row({ chainId: LTC, tick: 'LTC', quantity: 987654321, fiatRate: 81.23 }),
            row({ kind: 'token', tick: 'PEPE', quantity: 42, divisibility: 0, fiatRate: 0.37 }),
        ];
        const priceMap = {
            [BTC]: { sparkline: Array.from({ length: 168 }, (_, i) => 60000 + i), historyDaily: flatDaily(60000), priceFiat: 61000 },
            [LTC]: { sparkline: Array.from({ length: 168 }, (_, i) => 80 + i / 100), historyDaily: flatDaily(80), priceFiat: 81 },
        };
        const prepared = prepareValuation({ rows });
        const total = Number(sumFiatValue(rows).total);
        for (const r of RANGES) {
            const result = valueSeriesFor(prepared, { priceMap, range: r, seedId: 'w', synthesize: false, nowMs: NOW });
            expect(result.series, r.id).toHaveLength(r.points);
            expect(result.series.at(-1), r.id).toBeCloseTo(total, 6);
        }
    });

    it('leaves a token with no price history out of the earlier points and names it', () => {
        const rows = [
            row({ quantity: 100000000, fiatRate: 50000 }),
            row({ kind: 'token', tick: 'PEPE', quantity: 1000, divisibility: 0, fiatRate: 2 }),
        ];
        const result = valueSeriesFor(prepareValuation({ rows }), {
            priceMap: { [BTC]: { historyDaily: flatDaily(50000), priceFiat: 50000 } },
            range: range('1m'), seedId: 'w', synthesize: false, nowMs: NOW,
        });
        expect(result.missingTokenKeys).toEqual([assetKeyOf(BTC, 'PEPE')]);
        expect(result.series[0]).toBeCloseTo(50000, 6);
        expect(result.series.at(-1)).toBeCloseTo(52000, 6);
    });

    it('includes a token at each point it has a price for, and names nothing', () => {
        const assets = [
            { key: 'a', kind: 'token', currentAtomic: 10n, divisibility: 0, currentFiat: 30, rate: 3, priceSeries: [[NOW - 40 * DAY_MS, 1], [NOW, 3]] },
        ];
        const grid = chartGridTimes(range('1m'), NOW, { windowStart: () => NOW - 30 * DAY_MS });
        const result = buildValueSeries({ assets, deltasByKey: new Map(), grid, range: range('1m') });
        expect(result.missingTokenKeys).toEqual([]);
        expect(result.series[0]).toBeGreaterThan(10);
        expect(result.series.at(-1)).toBe(30);
    });

    it('divides each point by BTC\'s price at that same point in BTC mode', () => {
        const prices = [];
        for (let d = 60; d >= 1; d -= 1) prices.push([NOW - d * DAY_MS, d > 30 ? 25000 : 50000]);
        const rows = [
            row({ quantity: 100000000, fiatRate: 50000 }),
            row({ chainId: LTC, tick: 'LTC', quantity: 10000000000, fiatRate: 100 }),
        ];
        const priceMap = {
            [BTC]: { historyDaily: prices, priceFiat: 50000 },
            [LTC]: { historyDaily: flatDaily(100), priceFiat: 100 },
        };
        const prepared = prepareValuation({ rows });
        const opts = { priceMap, range: range('3m'), seedId: 'w', synthesize: false, nowMs: NOW };
        const fiat = valueSeriesFor(prepared, opts);
        const btc = valueSeriesFor(prepared, { ...opts, unit: { tick: 'BTC', chainId: BTC, price: 50000 } });
        for (let i = 0; i < fiat.grid.length; i += 1) {
            const btcPrice = priceAt(prices.concat([[NOW, 50000]]), fiat.grid[i], 36 * HOUR_MS);
            if (btcPrice === null) continue;
            expect(btc.series[i]).toBeCloseTo(fiat.series[i] / btcPrice, 9);
        }
        // The last point is the headline's own coin amount.
        expect(btc.series.at(-1)).toBeCloseTo((50000 + 10000) / 50000, 12);
    });

    it('shares one valuation between the wallet line and each asset\'s line', () => {
        const rows = [
            row({ quantity: 100000000, fiatRate: 50000 }),
            row({ chainId: LTC, tick: 'LTC', quantity: 300000000, fiatRate: 100 }),
            row({ kind: 'token', tick: 'PEPE', quantity: 75, divisibility: 0, fiatRate: 1 }),
        ];
        const history = {
            entries: [
                send({ index: 1, ms: NOW - 3 * DAY_MS, tick: 'BTC', amount: '0.5', source: FRIEND, destination: ME }),
                send({ index: 2, ms: NOW - 9 * DAY_MS, tick: 'PEPE', amount: '25', source: ME, destination: FRIEND }),
            ],
            addressesByChain: { [BTC]: [{ address: ME }], [LTC]: [{ address: 'ltc1me' }] },
            coverageStartMs: -Infinity,
        };
        const priceMap = {
            [BTC]: { historyDaily: flatDaily(48000), sparkline: Array.from({ length: 168 }, (_, i) => 48000 + i * 10), priceFiat: 50000 },
            [LTC]: { historyDaily: flatDaily(90), sparkline: Array.from({ length: 168 }, () => 95), priceFiat: 100 },
        };
        const source = { prepared: prepareValuation({ rows, history }), priceMap, seedId: 'w', synthesize: false };
        for (const r of RANGES) {
            const wallet = valueSeriesFor(source.prepared, { priceMap, range: r, seedId: 'w', synthesize: false, nowMs: NOW });
            const parts = rows.map((x) => holdingValueSeries(source, { chainId: x.chainId, tick: x.tick, range: r, nowMs: NOW }));
            for (let i = 0; i < r.points; i += 1) {
                const sum = parts.reduce((acc, part) => acc + (part.series ? part.series[i] : wallet.byAsset.get(assetKeyOf(BTC, 'PEPE'))[i]), 0);
                expect(sum, `${r.id}[${i}]`).toBeCloseTo(wallet.series[i], 6);
            }
            // The token has no price history: its panel says so instead of a line.
            expect(parts[2]).toEqual({ series: null, noPriceHistory: true });
        }
    });
});

describe('grid and prices', () => {
    it('anchors the hourly sparkline at now, an hour apart', () => {
        const series = timedPriceSeries({ sparkline: [1, 2, 3] }, range('24h'), NOW);
        expect(series).toEqual([[NOW - 2 * HOUR_MS, 1], [NOW - HOUR_MS, 2], [NOW, 3]]);
        const grid = chartGridTimes(range('1w'), NOW);
        expect(grid).toHaveLength(168);
        expect(grid[0]).toBe(NOW - 167 * HOUR_MS);
        expect(grid.at(-1)).toBe(NOW);
    });

    it('reads history before the wallet\'s first transaction as zero', () => {
        const rows = [row({ quantity: 100000000, fiatRate: 50000 })];
        const history = {
            entries: [send({ index: 1, ms: NOW - 100 * DAY_MS, tick: 'BTC', amount: '1', source: FRIEND, destination: ME })],
            addressesByChain: { [BTC]: [{ address: ME }] },
            coverageStartMs: -Infinity,
        };
        const result = valueSeriesFor(prepareValuation({ rows, history }), {
            priceMap: { [BTC]: { historyDaily: flatDaily(50000), priceFiat: 50000 } },
            range: range('all'), seedId: 'w', synthesize: false, nowMs: NOW,
        });
        expect(result.series[0]).toBe(0);
        expect(result.series.at(-1)).toBe(50000);
        expect(result.series.filter((v) => v === 0).length).toBeGreaterThan(100);
    });
});

// The batch reads (useWalletHistory.js) as the replay sees them: /history
// actions with per-address effects, /native_history transactions with each
// address's net.
function chainReads({ actions = [], txs = [], tokenTruncatedAtMs = null, nativeTruncatedAtMs = null } = {}) {
    return {
        actions: new Map(actions.map((a) => [String(a.index), { ms: a.ms, effects: a.effects }])),
        txs: new Map(txs.map((t) => [t.txid, { ms: t.ms, nets: t.nets }])),
        tokenTruncatedAtMs,
        nativeTruncatedAtMs,
    };
}
const effect = (address, tick, netBase, decimals = 0) => ({
    address, tick, decimals, credit_base: null, debit_base: null, net_base: netBase, net_whole: String(netBase),
});

describe('batch reads', () => {
    it('moves a coin balance through its native history, counting only the addresses the row counts', () => {
        // 1 BTC held now on ME. Three days ago ME received 0.6 BTC; yesterday a
        // move from ME to ME2 (both the wallet's), and today ME2 paid 0.1 away.
        const rows = [row({ quantity: 100000000, fiatRate: 50000 })];
        const reads = new Map([[BTC, chainReads({ txs: [
            { txid: 'a', ms: NOW - 3 * DAY_MS, nets: { [ME]: '60000000' } },
            { txid: 'b', ms: NOW - DAY_MS, nets: { [ME]: '-20000000', [ME2]: '20000000' } },
            { txid: 'c', ms: NOW - 2 * HOUR_MS, nets: { [ME2]: '-10000000' } },
        ] })]]);
        const history = { reads, addressesByChain: { [BTC]: [ME, ME2] } };
        const prepared = prepareValuation({ rows, history });
        // The whole wallet (no active address): the move between ME and ME2 nets out.
        expect(prepared.deltasByKey.get(`${BTC}:BTC`).map((d) => d.delta)).toEqual([-10000000n, 60000000n]);
        const result = valueSeriesFor(prepared, {
            priceMap: { [BTC]: { historyDaily: flatDaily(50000), priceFiat: 50000 } },
            range: range('1m'), seedId: 'w', synthesize: false, nowMs: NOW,
        });
        // Before the receive the wallet held 0.5 BTC; after it 1.1; now 1.
        expect(result.series[0]).toBeCloseTo(25000, 6);
        expect(result.series.at(-2)).toBeCloseTo(55000, 6);
        expect(result.series.at(-1)).toBe(50000);
        // Home's rows count ME only (its active address): the same reads replay ME alone.
        const activeOnly = prepareValuation({ rows, history, activeByChain: { [BTC]: { address: ME } } });
        expect(activeOnly.deltasByKey.get(`${BTC}:BTC`).map((d) => d.delta)).toEqual([-20000000n, 60000000n]);
    });

    it('counts every token action type through its effects, and never a coin-tick effect toward the coin', () => {
        const actions = [
            { index: 1, ms: NOW - 9 * DAY_MS, effects: [effect(ME, 'PEPE', '1000')] },           // ISSUE
            { index: 2, ms: NOW - 8 * DAY_MS, effects: [effect(ME, 'PEPE', '-100')] },           // SEND out
            { index: 3, ms: NOW - 7 * DAY_MS, effects: [effect(ME, 'PEPE', '50')] },             // DISPENSE in
            { index: 4, ms: NOW - 6 * DAY_MS, effects: [effect(ME, 'PEPE', '-200')] },           // ORDER (escrowed)
            { index: 5, ms: NOW - 5 * DAY_MS, effects: [effect(ME, 'PEPE', '120')] },            // ORDER_MATCH
            { index: 6, ms: NOW - 4 * DAY_MS, effects: [effect(ME, 'PEPE', '30')] },             // DIVIDEND
            { index: 7, ms: NOW - 3 * DAY_MS, effects: [effect(ME, 'PEPE', '-0.5')] },           // a fee finer than the token
            { index: 8, ms: NOW - 2 * DAY_MS, effects: [effect(ME, 'PEPE', '-50'), effect(ME, 'BTC', '-5', 8)] }, // DESTROY, with a ledger BTC leg
            { index: 9, ms: NOW - DAY_MS, effects: [effect(FRIEND, 'PEPE', '999')] },           // not ours
        ];
        const rows = [row({ quantity: 100000000, fiatRate: 50000 }), row({ kind: 'token', tick: 'PEPE', quantity: 850, divisibility: 0, fiatRate: 2 })];
        const prepared = prepareValuation({ rows, history: { reads: new Map([[BTC, chainReads({ actions })]]), addressesByChain: { [BTC]: [ME] } } });
        const pepe = prepared.deltasByKey.get(`${BTC}:PEPE`).map((d) => d.delta);
        expect(pepe).toEqual([-50n, 0n, 30n, 120n, -200n, 50n, -100n, 1000n].filter((d) => d !== 0n));
        // The coin's balance comes only from native history.
        expect(prepared.deltasByKey.get(`${BTC}:BTC`)).toBeUndefined();
        // Replayed to the start of the range the token was not yet issued.
        const series = valueSeriesFor(prepared, {
            priceMap: { [BTC]: { historyDaily: flatDaily(50000), priceFiat: 50000 } },
            range: range('1m'), seedId: 'w', synthesize: false, nowMs: NOW,
        });
        expect(series.byAsset.get(`${BTC}:PEPE`)[0]).toBe(0);
    });

    it('reads amounts in base units with the token\'s own decimals, rescaled to the row', () => {
        expect(baseUnits('-12')).toBe(-12n);
        expect(baseUnits('-0.5')).toBe(0n);
        expect(baseUnits(null)).toBeNull();
        expect(effectDelta({ net_base: '150', decimals: 2 }, 2)).toBe(150n);
        expect(effectDelta({ net_base: '150', decimals: 2 }, 4)).toBe(15000n);
        expect(effectDelta({ net_base: null, net_whole: '-1.5', decimals: null }, 8)).toBe(-150000000n);
    });

    it('holds an asset flat before the oldest change a walk that stopped short read', () => {
        const rows = [row({ quantity: 100000000, fiatRate: 50000 })];
        const reads = new Map([[BTC, chainReads({
            txs: [{ txid: 'a', ms: NOW - 10 * DAY_MS, nets: { [ME]: '50000000' } }, { txid: 'b', ms: NOW - 20 * DAY_MS, nets: { [ME]: '50000000' } }],
            nativeTruncatedAtMs: NOW - 10 * DAY_MS,
        })]]);
        const prepared = prepareValuation({ rows, history: { reads, addressesByChain: { [BTC]: [ME] } } });
        const series = valueSeriesFor(prepared, {
            priceMap: { [BTC]: { historyDaily: flatDaily(50000), priceFiat: 50000 } },
            range: range('1m'), seedId: 'w', synthesize: false, nowMs: NOW,
        }).series;
        // The older receive is past where the walk stopped: the start holds at 1 BTC.
        expect(series[0]).toBeCloseTo(50000, 6);
    });

    it('reads a backfilling status in each shape the tracker can send it', () => {
        expect(nativeBackfilling({ history_status: 'backfilling' }, [ME])).toBe(true);
        expect(nativeBackfilling({ history_status: { [ME]: 'backfilling' } }, [ME])).toBe(true);
        expect(nativeBackfilling({ addresses: { [ME]: { history_status: 'backfilling' } } }, [ME])).toBe(true);
        expect(nativeBackfilling({ address_status: { [ME]: { history_status: 'complete' } } }, [ME])).toBe(false);
        expect(nativeBackfilling({ transactions: [] }, [ME])).toBe(false);
    });
});

describe('token prices from price history', () => {
    it('prefers an oracle series and converts a DEX series to fiat at the coin\'s price at each point', () => {
        const coinOracle = [[NOW - 2 * DAY_MS, 40000], [NOW - DAY_MS, 50000]];
        expect(tokenFiatSeries({ oracle: [[NOW - DAY_MS, 3]], dex: [[NOW - DAY_MS, 0.0001]] }, { coinOracle, toleranceMs: DAY_MS }))
            .toEqual([[NOW - DAY_MS, 3]]);
        expect(tokenFiatSeries({ dex: [[NOW - 2 * DAY_MS, 0.0001], [NOW - DAY_MS, 0.0001]] }, { coinOracle, toleranceMs: DAY_MS }))
            .toEqual([[NOW - 2 * DAY_MS, 4], [NOW - DAY_MS, 5]]);
        expect(tokenFiatSeries(null, { coinOracle, toleranceMs: DAY_MS })).toBeNull();
    });

    it('values a token through the range from its DEX series, and the asset lines sum to the wallet line', () => {
        const rows = [
            row({ quantity: 100000000, fiatRate: 50000 }),
            row({ kind: 'token', tick: 'PEPE', quantity: 1000, divisibility: 0, fiatRate: 5 }),
        ];
        const days = Array.from({ length: 60 }, (_, i) => NOW - (60 - i) * DAY_MS);
        const tokenPrices = new Map([[`${BTC}|day`, {
            byTick: new Map([['PEPE', { oracle: null, dex: days.map((ms) => [ms, 0.0001]) }]]),
            coinOracle: days.map((ms, i) => [ms, 40000 + i * 100]),
        }]]);
        const prepared = prepareValuation({ rows, history: { reads: new Map(), addressesByChain: { [BTC]: [ME] }, tokenPrices } });
        const result = valueSeriesFor(prepared, {
            priceMap: { [BTC]: { historyDaily: flatDaily(50000), priceFiat: 50000 } },
            range: range('1m'), seedId: 'w', synthesize: false, nowMs: NOW,
        });
        expect(result.missingTokenKeys).toEqual([]);
        expect(result.pricedKeys).toContain(`${BTC}:PEPE`);
        const pepe = result.byAsset.get(`${BTC}:PEPE`);
        // The DEX price moved with the coin, so the token's value did too.
        expect(pepe[0]).toBeLessThan(pepe.at(-2));
        expect(pepe.at(-1)).toBe(5000);
        for (let i = 0; i < result.series.length; i += 1) {
            const sum = [...result.byAsset.values()].reduce((acc, values) => acc + values[i], 0);
            expect(result.series[i]).toBeCloseTo(sum, 9);
        }
        expect(result.series.at(-1)).toBeCloseTo(Number(sumFiatValue(rows).total), 6);
    });
});

describe('demo wallet', () => {
    it('keeps its synthesized series the same on every open', () => {
        const rows = [
            row({ quantity: 50000000, fiatRate: 60000 }),
            row({ kind: 'token', tick: 'DEMOCOIN', quantity: 1000, divisibility: 0, fiatRate: 1.25 }),
        ];
        const run = (nowMs) => valueSeriesFor(prepareValuation({ rows }), {
            priceMap: { [BTC]: { priceFiat: 60000, sparkline: null } },
            range: range('1m'), seedId: 'demo-seed', synthesize: true, nowMs,
        }).series;
        const first = run(NOW);
        expect(first).not.toBeNull();
        expect(run(NOW)).toEqual(first);
        expect(run(NOW + 3 * DAY_MS)).toEqual(first);
        expect(first.at(-1)).toBeCloseTo(30000 + 1250, 6);
    });
});
