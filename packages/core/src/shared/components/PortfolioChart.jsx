// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
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
import { defaultRegistry } from '../../registry/index.js';
import styles from './PortfolioChart.module.css';
import { getLocale, t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/routes.js';

// Range definitions. Every wallet, demo or real, offers the same list.
// CoinGecko's sparkline is 168 hourly points (one week), so 24h slices
// the tail of that recorded series and 1W uses it as-is. Longer ranges
// use the daily 365-day series. The public API does not serve `days=max`,
// so All is the complete 365-day series available from this source. Demo
// wallets synthesize every range via the same helper TokenDetail uses.
// Point counts are fixed (YTD included) so captures stay reproducible.
export const RANGES = [
    { id: '24h', label: '24h', points: 24,  source: 'hourly' },
    { id: '1w',  label: '1W',  points: 168, source: 'hourly' },
    { id: '1m',  label: '1M',  points: 60,  source: 'daily' },
    { id: '3m',  label: '3M',  points: 90,  source: 'daily' },
    { id: '6m',  label: '6M',  points: 120, source: 'daily' },
    { id: '1y',  label: '1Y',  points: 180, source: 'daily' },
    { id: 'ytd', label: 'YTD', points: 150, source: 'daily' },
    { id: 'all', label: 'All', points: 240, source: 'daily' },
];

const HISTORY_RETRY_BACKOFF_MS = [2000, 4000, 8000];

// Every wallet opens on the recorded week: demo mode swaps only the data
// source, never the view, so the demo wallet opens where a real one does.
export function defaultRangeId() {
    return '1w';
}

/**
 * Portfolio performance chart for Home.
 *
 * Sums each row's current fiat value into a single time series sized
 * by the active range. Native rows chart their real CoinGecko sparkline
 * (24h / 1W) or daily history (longer ranges). Only the demo wallet fills
 * missing history with the deterministic walk Sparkline.jsx provides.
 * Each row's contribution is scaled so its series ends at the row's
 * current fiat value, which means the series end always equals the
 * portfolio total and stays in sync with TotalBalanceHero.
 *
 * @param {object} props
 * @param {Array<any>} props.rows                  rows from `buildBalanceRows`, already network-filtered
 * @param {string | null} [props.walletId]         used to seed synthesized walks per wallet so flipping wallets reshuffles
 */
export function PortfolioChart({ rows, walletId, nativePriceMap, nativePricesLoading, nativePricesError }) {
    const { messaging } = useMessaging();
    const { settings } = useSettings();
    const fiatCurrency = settings?.fiatCurrency || 'USD';
    const [hidden] = useBalancesHidden();
    const [chartVisible] = usePortfolioChartVisible();
    const chartPanelId = useId();
    // Every wallet offers every range and opens on its hourly 1W view. Real
    // wallets request daily history only after a daily range is selected;
    // demo wallets synthesize every range without a network request.
    const isDemo = isDemoWallet(walletId);
    const ranges = RANGES;
    const [rangeId, setRangeId] = useState(defaultRangeId());
    useEffect(() => {
        setRangeId(defaultRangeId());
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
    const historyChainIds = useMemo(() => nativeChainIds.filter(
        (chainId) => defaultRegistry().get(chainId)?.networkKind === 'mainnet',
    ), [nativeChainKey]); // eslint-disable-line react-hooks/exhaustive-deps
    const historyChainKey = historyChainIds.join(',');

    // A demo wallet prices itself from its own fixtures, like every other
    // number on this screen (see TotalBalanceHero for the whole argument).
    const [priceMap, setPriceMap] = useState(/** @type {Record<string, any>} */ ({}));
    const [fetchedPriceLoading, setFetchedPriceLoading] = useState(!isDemo && nativeChainIds.length > 0);
    const [fetchedPriceError, setFetchedPriceError] = useState(/** @type {string | null} */ (null));
    useEffect(() => {
        if (nativePriceMap !== undefined) return undefined;
        if (isDemo) {
            setPriceMap(synthesizeDemoNativePrices(nativeChainIds));
            setFetchedPriceLoading(false);
            setFetchedPriceError(null);
            return undefined;
        }
        if (nativeChainIds.length === 0) {
            setPriceMap({});
            setFetchedPriceLoading(false);
            setFetchedPriceError(null);
            return undefined;
        }
        if (typeof messaging?.getNativePricesRequest !== 'function') {
            setPriceMap({});
            setFetchedPriceLoading(false);
            setFetchedPriceError('Price history is unavailable.');
            return undefined;
        }
        let cancelled = false;
        setPriceMap({});
        setFetchedPriceLoading(true);
        setFetchedPriceError(null);
        messaging.getNativePricesRequest({
            chainIds: nativeChainIds,
            includeSparkline: true,
            fiatCurrency,
        })
            .then((res) => {
                if (cancelled) return;
                if (res?.disabled) { setPriceMap({}); setFetchedPriceLoading(false); return; }
                setPriceMap(res?.prices || {});
                setFetchedPriceLoading(false);
            })
            .catch((err) => {
                if (cancelled) return;
                setPriceMap({});
                setFetchedPriceLoading(false);
                setFetchedPriceError(readFailureMessage(err, 'load portfolio price history'));
            });
        return () => { cancelled = true; };
    }, [messaging, nativeChainKey, isDemo, fiatCurrency, nativePriceMap]); // eslint-disable-line react-hooks/exhaustive-deps
    const basePriceMap = nativePriceMap ?? priceMap;
    const historyRequestKey = `${historyChainKey}|${fiatCurrency}`;
    const historyRequests = useRef(new Set());
    const [historyByKey, setHistoryByKey] = useState(
        /** @type {Record<string, { histories: Record<string, Array<[number, number]> | null>, loading: boolean, error: string | null }>} */ ({}),
    );
    useEffect(() => {
        if (isDemo || range.source !== 'daily' || historyChainIds.length === 0) return undefined;
        if (historyRequests.current.has(historyRequestKey)) return undefined;
        historyRequests.current.add(historyRequestKey);
        let cancelled = false;
        let retryTimer = null;
        let retryIndex = 0;
        const histories = {};
        const existingHistories = historyByKey[historyRequestKey]?.histories || {};
        for (const chainId of historyChainIds) {
            const existing = existingHistories[chainId] ?? basePriceMap?.[chainId]?.historyDaily;
            if (hasDailyHistory(existing)) histories[chainId] = existing;
        }
        if (typeof messaging?.getNativePricesRequest !== 'function') {
            setHistoryByKey((current) => ({
                ...current,
                [historyRequestKey]: { histories, loading: false, error: null },
            }));
            return () => { historyRequests.current.delete(historyRequestKey); };
        }
        setHistoryByKey((current) => ({
            ...current,
            [historyRequestKey]: { histories: { ...histories }, loading: true, error: null },
        }));

        const publish = () => {
            if (cancelled) return;
            setHistoryByKey((current) => ({
                ...current,
                [historyRequestKey]: { histories: { ...histories }, loading: false, error: null },
            }));
        };
        const requestHistories = async (chainIds) => {
            let response = null;
            try {
                response = await messaging.getNativePricesRequest({
                    chainIds,
                    includeHistory: true,
                    fiatCurrency,
                });
            } catch {
                // A refused history request is treated as missing data so the
                // partial chart and bounded retry path remain available.
            }
            if (cancelled) return;
            for (const chainId of chainIds) {
                const received = response?.prices?.[chainId]?.historyDaily;
                if (hasDailyHistory(received)) histories[chainId] = received;
            }
            publish();
            const missing = historyChainIds.filter((chainId) => !hasDailyHistory(histories[chainId]));
            if (missing.length === 0 || retryIndex >= HISTORY_RETRY_BACKOFF_MS.length) return;
            const delay = HISTORY_RETRY_BACKOFF_MS[retryIndex];
            retryIndex += 1;
            retryTimer = setTimeout(() => {
                retryTimer = null;
                requestHistories(missing);
            }, delay);
        };
        requestHistories(historyChainIds);
        return () => {
            cancelled = true;
            if (retryTimer !== null) clearTimeout(retryTimer);
            historyRequests.current.delete(historyRequestKey);
        };
    }, [fiatCurrency, historyChainKey, historyRequestKey, isDemo, messaging, range.source]); // eslint-disable-line react-hooks/exhaustive-deps
    const historyState = historyByKey[historyRequestKey];
    const effectivePriceMap = useMemo(() => {
        if (!historyState) return basePriceMap;
        const merged = { ...basePriceMap };
        for (const chainId of historyChainIds) {
            const nextHistory = historyState.histories[chainId];
            const lastGoodHistory = basePriceMap?.[chainId]?.historyDaily;
            merged[chainId] = {
                ...(basePriceMap?.[chainId] || {}),
                historyDaily: hasDailyHistory(nextHistory) ? nextHistory : (lastGoodHistory ?? null),
            };
        }
        return merged;
    }, [basePriceMap, historyChainKey, historyState]); // eslint-disable-line react-hooks/exhaustive-deps
    const dailyHistorySelected = !isDemo && range.source === 'daily' && historyChainIds.length > 0;
    const dailyHistoryLoading = dailyHistorySelected
        && (!historyState || historyState.loading);
    const priceLoading = (nativePriceMap === undefined ? fetchedPriceLoading : Boolean(nativePricesLoading))
        || dailyHistoryLoading;
    const priceError = (nativePriceMap === undefined ? fetchedPriceError : nativePricesError)
        || (dailyHistorySelected ? historyState?.error : null);

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
        () => buildPortfolioSeries(rows, effectivePriceMap, seedId, range, isDemo),
        [rows, effectivePriceMap, seedId, range, isDemo],
    );

    const hasData = Array.isArray(series) && series.length > 0;
    const hasBalance = (rows || []).some((row) => hasNonZeroQuantity(row));
    const missingCoinNames = useMemo(() => {
        if (isDemo || !hasData) return [];
        const names = [];
        const seen = new Set();
        for (const row of rows || []) {
            if (row?.kind !== 'native') continue;
            const current = fiatValueOf(row);
            if (current === null || !Number.isFinite(current) || current <= 0) continue;
            if (seriesForRow(row, current, effectivePriceMap, seedId, range, false)) continue;
            const name = String(row.displayName || row.name || row.coin || row.tick || '').trim();
            if (!name || seen.has(name)) continue;
            seen.add(name);
            names.push(name);
        }
        return names;
    }, [effectivePriceMap, hasData, isDemo, range, rows, seedId]);
    const missingCoinsNotice = missingCoinNames.length > 0
        ? t('components.portfolioChart.missingCoins', { coins: formatCoinList(missingCoinNames) })
        : '';

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
            aria-label={t('components.portfolioChart.portfolioPerformance')}
            aria-busy={priceLoading || undefined}
        >
            <div
                id={chartPanelId}
                role="tabpanel"
                aria-labelledby={selectedTabId}
            >
                {/* The change row and the chart slot keep the same height in
                    every state (chart, loading, failure, no history, hidden
                    balances), so the Home card does not resize as price
                    history arrives or is missing. */}
                {hasData && delta != null && !hidden ? (
                    <div
                        className={`${styles.change} ${tone}`}
                        aria-label={t('components.portfolioChart.change', { label: range.label, value: pctDisplay?.label ?? t('components.portfolioChart.changeUnavailable'), formatFiatValue: formatFiat(Math.abs(delta), fiatCurrency) })}
                    >
                        <bdi dir="ltr">
                            {arrow} {formatFiat(Math.abs(delta), fiatCurrency)}
                            {pctDisplay ? ` (${pctDisplay.text})` : ''} · {range.label}
                        </bdi>
                    </div>
                ) : (
                    <div className={styles.change} aria-hidden="true" />
                )}
                <div className={styles.slot}>
                    {priceLoading ? (
                        <StatusMessage variant="status" className={styles.slotMessage}>{t('components.portfolioChart.loadingPriceHistory')}</StatusMessage>
                    ) : priceError ? (
                        <StatusMessage variant="error" className={styles.slotMessage}>{priceError}</StatusMessage>
                    ) : hasData ? (
                        <div className={styles.chart}>
                            <Sparkline
                                series={series}
                                height={40}
                                label={t('components.portfolioChart.portfolioPerformanceChart')}
                                rangeLabel={range.label}
                                formatValue={(value) => formatFiatTooltip(value, fiatCurrency)}
                            />
                        </div>
                    ) : (
                        <div className={styles.placeholder}>{t('components.portfolioChart.noPriceHistoryForThis')}</div>
                    )}
                </div>
                <div className={styles.missingNotice} aria-hidden={missingCoinsNotice ? undefined : 'true'}>
                    {missingCoinsNotice}
                </div>
            </div>
            <div className={`${styles.ranges} ${styles.rangesSpread}`} role="tablist" aria-label={t('routes.manageToken.chartRange')}>
                {ranges.map((r) => (
                    <button
                        key={r.id}
                        id={`${chartPanelId}-tab-${r.id}`}
                        type="button"
                        role="tab"
                        aria-selected={r.id === range.id ? 'true' : 'false'}
                        aria-controls={chartPanelId}
                        tabIndex={r.id === range.id ? 0 : -1}
                        className={`${styles.range} ${styles.rangeSlot} ${r.id === range.id ? styles.rangeActive : ''}`}
                        onClick={() => setRangeId(r.id)}
                    >
                        <span className={styles.rangeLabel}>{r.label}</span>
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

function hasDailyHistory(value) {
    return Array.isArray(value) && value.length >= 2;
}

function formatCoinList(names) {
    try {
        if (typeof Intl?.ListFormat === 'function') {
            return new Intl.ListFormat(getLocale(), { style: 'long', type: 'conjunction' }).format(names);
        }
    } catch {
        // A runtime without this locale or API falls back to a stable join.
    }
    return names.join(', ');
}

function seriesForRow(row, current, priceMap, seedId, range, synthesize) {
    // Native row + real CoinGecko history -> scale into the row's
    // current fiat value. The series always ends at `current`, so the
    // summed chart's last point equals the portfolio total exactly.
    if (row.kind === 'native' && row.chainId) {
        const resampled = priceHistoryForRange(priceMap?.[row.chainId], range);
        if (resampled) {
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

const MONTHS_BACK = { '1m': 1, '3m': 3, '6m': 6, '1y': 12 };

// The daily series has one point at 00:00 UTC per day. A window opens on a
// calendar day of the device's own calendar (1 January for YTD), and starts
// at that day's 00:00 UTC point, so the first day is kept in every timezone.
// A month back from the 31st lands on the earlier month's last day.
export function rangeWindowStart(rangeId, now) {
    if (rangeId === 'all') return -Infinity;
    const at = new Date(now);
    if (!Number.isFinite(at.getTime())) return Number.NaN;
    const year = at.getFullYear();
    let month = at.getMonth();
    let day = at.getDate();
    if (rangeId === 'ytd') {
        month = 0;
        day = 1;
    } else if (MONTHS_BACK[rangeId]) {
        month -= MONTHS_BACK[rangeId];
        day = Math.min(day, new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
    } else {
        return Number.NaN;
    }
    return Date.UTC(year, month, day);
}

export function priceHistoryForRange(entry, range, now = Date.now()) {
    if (range?.source === 'hourly') {
        if (!Array.isArray(entry?.sparkline)) return null;
        const finite = entry.sparkline.filter((point) => Number.isFinite(point) && point > 0);
        if (finite.length === 0) return null;
        const source = range.id === '24h'
            ? finite.slice(-Math.min(range.points, finite.length))
            : finite;
        return resampleTo(source, range.points);
    }
    if (range?.source !== 'daily' || !Array.isArray(entry?.historyDaily)) return null;
    const start = rangeWindowStart(range.id, now);
    const prices = entry.historyDaily
        .filter((point) => Array.isArray(point)
            && Number.isFinite(point[0])
            && Number.isFinite(point[1])
            && point[1] > 0
            && point[0] >= start)
        .map((point) => point[1]);
    if (prices.length < 2) return null;
    return resampleTo(prices, range.points);
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
