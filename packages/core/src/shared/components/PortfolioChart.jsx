// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useId, useMemo, useState } from 'react';
import { StatusMessage } from '@xchain-wallet/core/ui';
import { Sparkline, synthesizeTokenChart } from './Sparkline.jsx';
import { useMessaging } from '../useMessaging.js';
import { useSettings } from '../hooks/useSettings.js';
import { useBalancesHidden } from '../hooks/useBalancesHidden.js';
import { usePortfolioChartVisible } from '../hooks/usePortfolioChartVisible.js';
import { isDemoWallet } from '../../flows/demoMode.js';
import { synthesizeDemoNativePrices } from '../../flows/demoFixtures.js';
import { DEMO_CHART_SEED } from '../../flows/demoCapture.js';
import { fiatValue } from './BalanceList.jsx';
import { formatFiatAmount } from '../utils/fiatAmountFormat.js';
import { readFailureMessage } from '../utils/readFailureMessage.js';
import { percentChangeDisplay } from '../utils/percentFormat.js';
import styles from './PortfolioChart.module.css';

// Range definitions. CoinGecko's sparkline is 168 hourly points (7d),
// so 24h slices the tail of that real series and 7d uses it as-is.
// Anything beyond 7d is synthesized via the same helper TokenDetail
// uses for tokens without a real price history feed.
export const RANGES = [
    { id: '24h', label: '24h', points: 24,  realCapable: true  },
    { id: '7d',  label: '7d',  points: 168, realCapable: true  },
    { id: '30d', label: '30d', points: 60,  realCapable: false },
    { id: '90d', label: '90d', points: 90,  realCapable: false },
    { id: 'all', label: 'All', points: 180, realCapable: false },
];

/**
 * Portfolio performance chart for Home.
 *
 * Sums each row's current fiat value into a single time series sized
 * by the active range. Native rows chart their real CoinGecko sparkline
 * (24h / 7d). A real wallet charts nothing else; only the demo wallet
 * fills the gaps with the deterministic walk Sparkline.jsx provides.
 * Each row's contribution is scaled so its series ends at the row's
 * current fiat value, which means the series end always equals the
 * portfolio total and stays in sync with TotalBalanceHero.
 *
 * @param {object} props
 * @param {Array<any>} props.rows                  rows from `buildBalanceRows`, already network-filtered
 * @param {string | null} [props.walletId]         used to seed synthesized walks per wallet so flipping wallets reshuffles
 */
export function PortfolioChart({ rows, walletId }) {
    const { messaging } = useMessaging();
    const { settings } = useSettings();
    const fiatCurrency = settings?.fiatCurrency || 'USD';
    const [hidden] = useBalancesHidden();
    const [chartVisible] = usePortfolioChartVisible();
    const chartPanelId = useId();
    // Only 24h and 7d have recorded prices behind them, so a real wallet
    // offers just those and opens on 7d; the longer ranges exist for the
    // demo wallet's synthesized walk.
    const isDemo = isDemoWallet(walletId);
    const ranges = isDemo ? RANGES : RANGES.filter((r) => r.realCapable);
    const [rangeId, setRangeId] = useState(isDemo ? '30d' : '7d');
    useEffect(() => {
        setRangeId(isDemo ? '30d' : '7d');
    }, [isDemo]);
    const range = ranges.find((r) => r.id === rangeId) || ranges[ranges.length - 1];

    // Pull native price entries (with sparkline) for any native row in
    // the displayed set. Mirrors TotalBalanceHero's fetch pattern.
    const nativeChainIds = useMemo(() => {
        const set = new Set();
        for (const r of rows || []) {
            if (r?.kind === 'native' && typeof r.chainId === 'string' && r.chainId) {
                set.add(r.chainId);
            }
        }
        return Array.from(set);
    }, [rows]);
    const nativeChainKey = nativeChainIds.join(',');

    // A demo wallet prices itself from its own fixtures, like every other
    // number on this screen (see TotalBalanceHero for the whole argument).
    const [priceMap, setPriceMap] = useState(/** @type {Record<string, any>} */ ({}));
    const [priceLoading, setPriceLoading] = useState(!isDemo && nativeChainIds.length > 0);
    const [priceError, setPriceError] = useState(/** @type {string | null} */ (null));
    useEffect(() => {
        if (isDemo) {
            setPriceMap(synthesizeDemoNativePrices(nativeChainIds));
            setPriceLoading(false);
            setPriceError(null);
            return undefined;
        }
        if (nativeChainIds.length === 0) {
            setPriceMap({});
            setPriceLoading(false);
            setPriceError(null);
            return undefined;
        }
        if (typeof messaging?.getNativePricesRequest !== 'function') {
            setPriceMap({});
            setPriceLoading(false);
            setPriceError('Price history is unavailable.');
            return undefined;
        }
        let cancelled = false;
        setPriceMap({});
        setPriceLoading(true);
        setPriceError(null);
        messaging.getNativePricesRequest({
            chainIds: nativeChainIds,
            includeSparkline: true,
            fiatCurrency,
        })
            .then((res) => {
                if (cancelled) return;
                if (res?.disabled) { setPriceMap({}); setPriceLoading(false); return; }
                setPriceMap(res?.prices || {});
                setPriceLoading(false);
            })
            .catch((err) => {
                if (cancelled) return;
                setPriceMap({});
                setPriceLoading(false);
                setPriceError(readFailureMessage(err, 'load portfolio price history'));
            });
        return () => { cancelled = true; };
    }, [messaging, nativeChainKey, isDemo, fiatCurrency]); // eslint-disable-line react-hooks/exhaustive-deps

    // A demo wallet's id is a fresh UUID on every demo session, and the
    // synthesized walk below is seeded by it, so the demo chart (and the
    // price-change figure printed above it) came out different every
    // time the same demo was opened. That is per-session noise on data
    // that is synthetic to begin with, and it is one of the three inputs
    // that made a store-listing capture unreproducible - the sparkline
    // and the change figure were two of the only moving bands between
    // two captures of an unchanged tree. Demo wallets therefore seed on
    // a constant; real wallets keep seeding on their own id, so flipping
    // between them still reshuffles. See flows/demoCapture.js.
    const seedId = isDemo ? DEMO_CHART_SEED : walletId;

    const series = useMemo(
        () => buildPortfolioSeries(rows, priceMap, seedId, range, isDemo),
        [rows, priceMap, seedId, range, isDemo],
    );

    const hasData = Array.isArray(series) && series.length > 0;
    const hasBalance = (rows || []).some((row) => hasNonZeroQuantity(row));

    const { delta, pct } = useMemo(() => {
        if (!hasData) return { delta: null, pct: null };
        const start = series[0];
        const end = series[series.length - 1];
        const d = end - start;
        const p = start > 0 ? (d / start) * 100 : null;
        return { delta: d, pct: p };
    }, [hasData, series]);

    const pctDisplay = percentChangeDisplay(pct);
    const direction = pctDisplay?.direction ?? 'neutral';
    const tone = direction === 'positive'
        ? styles.changePositive
        : direction === 'negative' ? styles.changeNegative : styles.changeNeutral;
    const arrow = direction === 'positive' ? '▲' : direction === 'negative' ? '▼' : '-';
    const selectedTabId = `${chartPanelId}-tab-${range.id}`;

    // Chart-icon toggle in TotalBalanceHero collapses the whole section.
    // The eye toggle is a separate, narrower concern handled below; it
    // suppresses the numeric delta line but leaves the chart shape and
    // range pills visible. The early return lives below every hook call
    // so the hook count stays stable as the toggle flips.
    if (!chartVisible || !hasBalance) return null;

    return (
        <section
            className={styles.wrap}
            aria-label="Portfolio performance"
            aria-busy={priceLoading || undefined}
        >
            <div
                id={chartPanelId}
                role="tabpanel"
                aria-labelledby={selectedTabId}
            >
                {hasData && delta != null && !hidden ? (
                    <div
                        className={`${styles.change} ${tone}`}
                        aria-label={`${pctDisplay?.label ?? 'Change unavailable'}; ${formatFiat(Math.abs(delta), fiatCurrency)}`}
                    >
                        {arrow} {formatFiat(Math.abs(delta), fiatCurrency)}
                        {pctDisplay ? ` (${pctDisplay.text})` : ''}
                    </div>
                ) : null}
                {priceLoading ? (
                    <StatusMessage variant="status">Loading price history…</StatusMessage>
                ) : priceError ? (
                    <StatusMessage variant="error">{priceError}</StatusMessage>
                ) : hasData ? (
                    <div className={styles.chart}>
                        <Sparkline
                            series={series}
                            height={40}
                            label="Portfolio performance chart"
                            rangeLabel={range.label}
                            formatValue={(value) => formatFiatTooltip(value, fiatCurrency)}
                        />
                    </div>
                ) : (
                    <div className={styles.placeholder}>No price history for this range yet.</div>
                )}
            </div>
            <div className={styles.ranges} role="tablist" aria-label="Chart range">
                {ranges.map((r) => (
                    <button
                        key={r.id}
                        id={`${chartPanelId}-tab-${r.id}`}
                        type="button"
                        role="tab"
                        aria-selected={r.id === range.id ? 'true' : 'false'}
                        aria-controls={chartPanelId}
                        tabIndex={r.id === range.id ? 0 : -1}
                        className={`${styles.range} ${r.id === range.id ? styles.rangeActive : ''}`}
                        onClick={() => setRangeId(r.id)}
                    >
                        {r.label}
                    </button>
                ))}
            </div>
        </section>
    );
}

// `seedId` is the wallet's own id for a real wallet and a constant for a
// demo one; it only ever feeds the synthesized walk's seed.
function buildPortfolioSeries(rows, priceMap, seedId, range, synthesize) {
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const points = range.points;
    if (points < 2) return null;
    const sums = new Array(points).fill(0);
    let anyContrib = false;
    for (const row of rows) {
        const current = fiatValueOf(row);
        if (current === null || !Number.isFinite(current) || current <= 0) continue;
        const rowSeries = seriesForRow(row, current, priceMap, seedId, range, synthesize);
        if (!rowSeries) continue;
        anyContrib = true;
        for (let i = 0; i < points; i += 1) sums[i] += rowSeries[i];
    }
    return anyContrib ? sums : null;
}

function seriesForRow(row, current, priceMap, seedId, range, synthesize) {
    // Native row + real CoinGecko sparkline → scale into the row's
    // current fiat value. The series always ends at `current`, so the
    // summed chart's last point equals the portfolio total exactly.
    if (range.realCapable && row.kind === 'native' && row.chainId) {
        const entry = priceMap?.[row.chainId];
        const spark = entry?.sparkline;
        if (Array.isArray(spark) && spark.length > 0) {
            const finiteSpark = spark.filter((point) => Number.isFinite(point) && point > 0);
            const src = range.id === '24h'
                ? finiteSpark.slice(-Math.min(range.points, finiteSpark.length))
                : finiteSpark;
            if (src.length === 0) return null;
            const resampled = resampleTo(src, range.points);
            const last = resampled[resampled.length - 1];
            if (last > 0) {
                const scaled = resampled.map((p) => (p / last) * current);
                scaled[scaled.length - 1] = current;
                return scaled;
            }
        }
    }
    // A real wallet charts only recorded prices (§45.4: never fabricate a
    // number), so a row with no recorded history sits out; with none left
    // the card says there is no history yet.
    if (!synthesize) return null;
    // A demo wallet synthesizes. Seeded so re-renders stay stable but each
    // (wallet, row, range) combination gets its own walk shape.
    const key = `${seedId || '_'}|${row.chainId || ''}|${row.kind === 'native' ? 'native' : row.tick}|${range.id}|${current.toFixed(2)}`;
    const { sparkline } = synthesizeTokenChart(key, current, range.points);
    return sparkline;
}

// Linear resample of `src` onto `n` evenly-spaced points. Used when a
// real sparkline doesn't already have exactly the count we need (the
// 24h slice off a 168-pt series is 24, but the helper is generic).
export function resampleTo(src, n) {
    if (!Array.isArray(src) || src.length === 0 || n < 1) return [];
    if (src.length === n) return src.slice();
    if (n <= 1) return [src[src.length - 1]];
    const out = new Array(n);
    const step = (src.length - 1) / (n - 1);
    for (let i = 0; i < n; i += 1) {
        const t = i * step;
        const lo = Math.floor(t);
        const hi = Math.min(src.length - 1, Math.ceil(t));
        const frac = t - lo;
        out[i] = src[lo] * (1 - frac) + src[hi] * frac;
    }
    return out;
}

// Mirror of the helper in TotalBalanceHero. Returns the row's current
// fiat value, or null when the row has no price data.
function fiatValueOf(row) {
    if (!row) return null;
    const exact = fiatValue(row.quantity, row.divisibility, row.fiatRate);
    return exact === null ? null : Number(exact);
}

function hasNonZeroQuantity(row) {
    try {
        return BigInt(row?.quantity ?? 0) !== 0n;
    } catch {
        const quantity = Number(row?.quantity);
        return Number.isFinite(quantity) && quantity !== 0;
    }
}

function formatFiat(value, currency) {
    return formatFiatAmount(String(value), currency);
}

function formatFiatTooltip(value, currency) {
    const code = String(currency || 'USD').toUpperCase();
    return `${formatFiat(value, code)} ${code}`;
}
