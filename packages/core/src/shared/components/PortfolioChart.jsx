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
import { formatCompactChartValue, Sparkline } from './Sparkline.jsx';
import { useMessaging } from '../useMessaging.js';
import { useSettings } from '../hooks/useSettings.js';
import { useBalancesHidden } from '../hooks/useBalancesHidden.js';
import { usePortfolioChartVisible } from '../hooks/usePortfolioChartVisible.js';
import { isDemoWallet } from '../../flows/demoMode.js';
import { synthesizeDemoNativePrices } from '../../flows/demoFixtures.js';
import { DEMO_CHART_SEED } from '../../flows/demoCapture.js';
import { formatFiatAmount } from '../utils/fiatAmountFormat.js';
import { readFailureMessage } from '../utils/readFailureMessage.js';
import { percentChangeDisplay } from '../utils/percentFormat.js';
import { defaultRegistry } from '../../registry/index.js';
import { prepareValuation, rangeWindowStart, valueSeriesFor } from '../utils/portfolioValuation.js';
import styles from './PortfolioChart.module.css';

// The calendar rule moved with the valuation; TokenDetail still reads it here.
export { rangeWindowStart };
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
 * Portfolio performance chart for Home: the wallet's value over time.
 *
 * Each point is the sum over assets of the balance the wallet held at that
 * time (replayed from its own history rows, see portfolioValueHistory.js)
 * times that asset's fiat price at that time. Coins price from the CoinGecko
 * hourly sparkline (24h, 1W) or the daily series (longer ranges); a token
 * with no price history sits out of every earlier point and the card says
 * so. The last point is every row's value now, so the line ends on the
 * headline total. With `unit` set (the headline shows the total in a coin)
 * each point is divided by that coin's price at the same time. Only the demo
 * wallet synthesizes prices, through the same valuation.
 *
 * @param {object} props
 * @param {Array<any>} props.rows                  rows from `buildBalanceRows`, already network-filtered
 * @param {string | null} [props.walletId]         used to seed synthesized walks per wallet so flipping wallets reshuffles
 * @param {ReturnType<typeof import('../hooks/useWalletHistory.js').useWalletHistory> | null} [props.history]
 *        the wallet's batch history and token price reads (useWalletHistory); without it every balance holds at today's
 * @param {Record<string, { address: string }> | null} [props.activeByChain]  the addresses the rows count
 * @param {{ tick: string, chainId: string, price: number } | null} [props.unit]  the coin the headline shows the total in
 */
export function PortfolioChart({ rows, walletId, nativePriceMap, nativePricesLoading, nativePricesError, behind = false, onRangeChange, history = null, activeByChain = null, unit = null }) {
    const { messaging } = useMessaging();
    const { settings } = useSettings();
    const fiatCurrency = settings?.fiatCurrency || 'USD';
    const numberLocale = settings?.language || getLocale();
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
    // Once a daily range has been picked for this chain set and currency, the
    // daily series stays wanted: a switch back to 24h or 1W neither cancels
    // the request in flight nor drops what it brought, so a later daily range
    // reads the held series instead of asking again.
    const dailyWantedKeys = useRef(new Set());
    if (range.source === 'daily') dailyWantedKeys.current.add(historyRequestKey);
    const dailyWanted = dailyWantedKeys.current.has(historyRequestKey);
    useEffect(() => {
        if (isDemo || !dailyWanted || historyChainIds.length === 0) return undefined;
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
        // Only the chains without a held series are asked for; with every
        // series held there is no request at all.
        const missingAtStart = historyChainIds.filter((chainId) => !hasDailyHistory(histories[chainId]));
        if (missingAtStart.length === 0 || typeof messaging?.getNativePricesRequest !== 'function') {
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
        requestHistories(missingAtStart);
        return () => {
            cancelled = true;
            if (retryTimer !== null) clearTimeout(retryTimer);
            historyRequests.current.delete(historyRequestKey);
        };
    }, [dailyWanted, fiatCurrency, historyChainKey, historyRequestKey, isDemo, messaging]); // eslint-disable-line react-hooks/exhaustive-deps
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

    // The demo wallet's line is synthesized and stays the same on every open,
    // so its rows' history never moves it.
    const prepared = useMemo(
        () => prepareValuation({ rows, history: isDemo ? null : history, activeByChain }),
        [rows, history, activeByChain, isDemo],
    );
    const unitTick = unit && unit.tick && Number(unit.price) > 0 ? String(unit.tick) : '';
    const valuation = useMemo(
        () => valueSeriesFor(prepared, {
            priceMap: effectivePriceMap, range, seedId, synthesize: isDemo, unit: unitTick ? unit : null,
        }),
        [prepared, effectivePriceMap, range, seedId, isDemo, unit, unitTick],
    );
    const series = valuation.series;
    // The selected range asks the wallet's reads for its own span: older
    // history and, for a daily range, the tokens' daily price series.
    const requestRange = isDemo ? null : history?.requestRange;
    const gridStartMs = valuation.grid?.[0];
    useEffect(() => {
        if (typeof requestRange === 'function' && Number.isFinite(gridStartMs)) {
            requestRange({ source: range.source, sinceMs: gridStartMs });
        }
    }, [requestRange, range.source, gridStartMs]);
    // While the reads load, or the coin tracker is still backfilling an
    // address, the line is drawn from what is known so far (a coin holds flat
    // before its oldest known change) and the card says so.
    const historyLoading = !isDemo && Boolean(history?.loading || history?.backfilling);
    // The change figure compares like with like: only the assets priced at
    // every point they were held, so a token that joins the line only at its
    // last point (no price history) is never counted as a gain.
    const changeSeries = useMemo(() => {
        if (!Array.isArray(series)) return null;
        const left = new Set([...valuation.missingTokenKeys, ...valuation.missingCoinKeys]);
        if (left.size === 0) return series;
        const sums = new Array(series.length).fill(0);
        for (const [key, values] of valuation.byAsset) {
            if (left.has(key)) continue;
            for (let i = 0; i < sums.length; i += 1) sums[i] += values[i];
        }
        return sums;
    }, [series, valuation]);

    const hasData = Array.isArray(series) && series.length > 0;
    const hasBalance = (rows || []).some((row) => hasNonZeroQuantity(row));
    const missingCoinNames = useMemo(() => {
        if (isDemo || !hasData) return [];
        const names = [];
        const seen = new Set();
        for (const key of valuation.missingCoinKeys) {
            const name = prepared.names.get(key);
            if (!name || seen.has(name)) continue;
            seen.add(name);
            names.push(name);
        }
        return names;
    }, [hasData, isDemo, prepared, valuation]);
    // A coin still loading is not yet missing.
    const missingCoinsNotice = missingCoinNames.length > 0 && !priceLoading
        ? t('components.portfolioChart.missingCoins', { coins: formatCoinList(missingCoinNames) })
        : '';
    // A token valued now but with no price history sits out of every earlier
    // point; the card says so wherever the line is drawn.
    const tokensLeftOut = !isDemo && hasData && !priceLoading && !history?.loading && valuation.missingTokenKeys.length > 0;

    // The amounts on the card follow the headline's unit: fiat, or the coin
    // the total is shown in.
    const formatUnitAmount = (value) => (unitTick
        ? `${new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 8 }).format(value)} ${unitTick}`
        : formatFiat(value, fiatCurrency));
    const formatChartAmount = (value) => formatCompactChartValue(value, unitTick
        ? { locale: numberLocale, unit: unitTick }
        : { locale: numberLocale, currency: fiatCurrency });
    const formatTooltipAmount = (value) => (unitTick
        ? formatUnitAmount(value)
        : formatFiatTooltip(value, fiatCurrency, numberLocale));

    // The last line drawn, held so that a range switch or a price refresh
    // keeps it on the card until the new series is ready instead of blanking
    // the chart. It belongs to one wallet, coin set, currency and unit, and is
    // shown only while something loads: a load that ends empty or failed says so.
    const heldScope = `${seedId || ''}|${nativeChainKey}|${fiatCurrency}|${unitTick}`;
    const heldLineRef = useRef(/** @type {{ scope: string, series: number[], rangeLabel: string } | null} */ (null));
    if (hasData) heldLineRef.current = { scope: heldScope, series, rangeLabel: range.label };
    const heldLine = heldLineRef.current?.scope === heldScope ? heldLineRef.current : null;
    let drawnLine = null;
    if (priceLoading) {
        drawnLine = hasData ? { series, rangeLabel: range.label, held: false } : (heldLine ? { ...heldLine, held: true } : null);
    } else if (hasData && !priceError) {
        drawnLine = { series, rangeLabel: range.label, held: false };
    }

    const { delta, pctDisplay, direction, arrow } = useMemo(
        () => seriesChange(hasData ? changeSeries : null),
        [hasData, changeSeries],
    );
    const tone = direction === 'positive'
        ? styles.changePositive
        : direction === 'negative' ? styles.changeNegative : styles.changeNeutral;
    const selectedTabId = `${chartPanelId}-tab-${range.id}`;

    // Hands the selected range's change to the balance card, which shows it
    // in place of a fixed 24h figure. In a coin unit the change is already in
    // that coin (`inCoin`), so the card prints it as it is.
    const rangeChange = useMemo(
        () => ({
            ...rangeChangeFor(hasData ? changeSeries : null, range.label, formatUnitAmount),
            inCoin: Boolean(unitTick),
        }),
        [hasData, changeSeries, range.label, fiatCurrency, unitTick, numberLocale], // eslint-disable-line react-hooks/exhaustive-deps
    );
    useEffect(() => {
        if (typeof onRangeChange !== 'function') return;
        onRangeChange(rangeChange);
    }, [onRangeChange, rangeChange]);

    // Chart-icon toggle in TotalBalanceHero collapses the whole section.
    // The eye toggle is a separate, narrower concern handled below; it
    // suppresses the numeric delta line but leaves the chart shape and
    // range pills visible. The early return lives below every hook call
    // so the hook count stays stable as the toggle flips.
    if ((!chartVisible && !behind) || !hasBalance) return null;

    return (
        <section
            className={behind ? `${styles.wrap} ${styles.behind}${hidden ? ` ${styles.behindHidden}` : ''}` : styles.wrap}
            data-chart-behind={behind ? 'true' : undefined}
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
                        aria-label={t('components.portfolioChart.change', { label: range.label, value: pctDisplay?.label ?? t('components.portfolioChart.changeUnavailable'), formatFiatValue: formatUnitAmount(Math.abs(delta)) })}
                    >
                        <bdi dir="ltr">
                            {arrow} {formatUnitAmount(Math.abs(delta))}
                            {pctDisplay ? ` (${pctDisplay.text})` : ''} · {range.label}
                        </bdi>
                    </div>
                ) : (
                    <div className={styles.change} aria-hidden="true" />
                )}
                <div className={styles.slot}>
                    {drawnLine ? (
                        <div className={styles.chart} data-chart-line={drawnLine.held ? 'held' : 'current'}>
                            <Sparkline
                                series={drawnLine.series}
                                height={behind ? '100%' : 40}
                                strokeColor={behind ? BEHIND_CHART_STROKE : undefined}
                                areaFill={behind ? BEHIND_CHART_FILL : undefined}
                                edgeToEdge={behind}
                                label={t('components.portfolioChart.portfolioPerformanceChart')}
                                rangeLabel={drawnLine.rangeLabel}
                                formatValue={formatTooltipAmount}
                                formatScaleValue={formatChartAmount}
                                showScale={behind}
                                heroScale={behind}
                            />
                            {/* The line stays drawn while the new range loads;
                                a screen reader still hears that it is loading. */}
                            {priceLoading ? (
                                <StatusMessage variant="status" className="sr-only">{t('components.portfolioChart.loadingPriceHistory')}</StatusMessage>
                            ) : null}
                        </div>
                    ) : priceLoading ? (
                        <StatusMessage variant="status" className={styles.slotMessage}>{t('components.portfolioChart.loadingPriceHistory')}</StatusMessage>
                    ) : priceError ? (
                        <StatusMessage variant="error" className={styles.slotMessage}>{priceError}</StatusMessage>
                    ) : (
                        <div className={styles.placeholder}>{t('components.portfolioChart.noPriceHistoryForThis')}</div>
                    )}
                </div>
                <div className={styles.missingNotice} aria-hidden={missingCoinsNotice ? undefined : 'true'}>
                    {missingCoinsNotice}
                </div>
            </div>
            <div className={styles.foot}>
                {historyLoading && hasData ? (
                    <div className={styles.tokenNote} data-chart-note="history-loading" role="status">
                        {t('components.portfolioChart.historyLoading')}
                    </div>
                ) : null}
                {tokensLeftOut && !hidden ? (
                    <div className={styles.tokenNote} data-chart-note="tokens-without-history">
                        {t('components.portfolioChart.tokensWithoutHistory')}
                    </div>
                ) : null}
                <ChartRangeTabs
                    panelId={chartPanelId}
                    ranges={ranges}
                    rangeId={range.id}
                    onSelect={setRangeId}
                />
            </div>
        </section>
    );
}

// The chart drawn behind a balance card (Home's and a coin or token's) takes
// the logo purple: a light line over a deep area fill.
export const BEHIND_CHART_STROKE = 'var(--xc-hero-chart-line)';
export const BEHIND_CHART_FILL = 'var(--xc-hero-chart-fill)';

/**
 * The chart's range buttons, one equal slot per range along the card's foot.
 * Home's portfolio chart and the coin and token balance card share it, so
 * both cards draw the same pills.
 *
 * @param {object} props
 * @param {string} props.panelId                 id of the tabpanel the tabs control; each tab is `${panelId}-tab-${id}`
 * @param {Array<{ id: string, label: string }>} props.ranges
 * @param {string} props.rangeId                 the selected range
 * @param {(id: string) => void} props.onSelect
 * @param {string} [props.className]             extra classes for the row
 */
export function ChartRangeTabs({ panelId, ranges, rangeId, onSelect, className = '' }) {
    return (
        <div className={`${styles.ranges} ${styles.rangesSpread}${className ? ` ${className}` : ''}`} role="tablist" aria-label={t('routes.manageToken.chartRange')}>
            {ranges.map((r) => (
                <button
                    key={r.id}
                    id={`${panelId}-tab-${r.id}`}
                    type="button"
                    role="tab"
                    aria-selected={r.id === rangeId ? 'true' : 'false'}
                    aria-controls={panelId}
                    tabIndex={r.id === rangeId ? 0 : -1}
                    className={`${styles.range} ${styles.rangeSlot} ${r.id === rangeId ? styles.rangeActive : ''}`}
                    onClick={() => onSelect(r.id)}
                >
                    <span className={styles.rangeLabel}>{r.label}</span>
                </button>
            ))}
        </div>
    );
}

/**
 * First-to-last change of a chart series, with its display direction and
 * arrow. A missing or empty series has no change.
 *
 * @param {number[] | null | undefined} series
 */
export function seriesChange(series) {
    if (!Array.isArray(series) || series.length === 0) {
        return { delta: null, pct: null, pctDisplay: percentChangeDisplay(null), direction: 'neutral', arrow: '-' };
    }
    const start = series[0];
    const end = series[series.length - 1];
    const delta = end - start;
    const pct = start > 0 ? (delta / start) * 100 : null;
    const pctDisplay = percentChangeDisplay(pct);
    const direction = pctDisplay?.direction ?? 'neutral';
    const arrow = direction === 'positive' ? '▲' : direction === 'negative' ? '▼' : '-';
    return { delta, pct, pctDisplay, direction, arrow };
}

/**
 * The selected range's change in the shape a balance card shows
 * (TotalBalanceHero's `rangeChange`). The series is in fiat, so `text` is a
 * fiat amount and `delta` the unsigned fiat change a card can convert.
 *
 * @param {number[] | null | undefined} series
 * @param {string} label                         the range's label
 * @param {(value: number) => string} formatAmount formats an unsigned fiat amount
 */
export function rangeChangeFor(series, label, formatAmount) {
    const { delta, pctDisplay, direction, arrow } = seriesChange(series);
    const text = delta != null
        ? `${arrow} ${formatAmount(Math.abs(delta))}${pctDisplay ? ` (${pctDisplay.text})` : ''}`
        : null;
    return {
        text,
        direction: text ? direction : 'neutral',
        label,
        delta: text ? Math.abs(delta) : null,
        arrow,
        pctText: pctDisplay ? pctDisplay.text : '',
    };
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

function formatFiatTooltip(value, currency, locale) {
    const code = String(currency || 'USD').toUpperCase();
    return `${formatFiatAmount(String(value), code, locale)} ${code}`;
}
