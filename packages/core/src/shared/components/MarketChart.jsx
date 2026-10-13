// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// MarketChart (§41.3.1): candlestick/line chart for a single market.
//
// `lightweight-charts` is imported lazily so the module loads clean
// in Node (smoke tests, SSR) and only pulls the chart runtime when
// the component mounts. Period toggles rebucket in memory; one
// getMarketHistory call feeds every period.
//
// Data flow:
//
//   MarketView → MarketChart
//     useEffect (on mount + tick/period change):
//       await messaging.getMarketHistory({ chainId, tick1, tick2 })
//       matches = extractRows(resp)
//       candles = bucketizeMatches(matches, { tick1, tick2, periodSeconds })
//       chart.setData(candles)
//
// If `lightweight-charts` isn't installed yet (pre-pnpm-install), the
// dynamic import throws and we render a single-line hint instead of
// blowing up MarketView.

import { useEffect, useMemo, useRef, useState } from 'react';
import { StatusMessage, useReducedMotion } from '@xchain-wallet/core/ui';
import { bucketizeMatches, PERIODS, DEFAULT_PERIOD_ID } from '../../market/bucketize.js';
import { useMessaging } from '../useMessaging.js';
import { sampleMatchesFor } from '../../market/sampleMarketData.js';
import { readFailureMessage } from '../utils/readFailureMessage.js';
import { describeChartSeries } from './Sparkline.jsx';

/**
 * @param {object} props
 * @param {string} props.chainId
 * @param {string} props.tick1
 * @param {string} props.tick2
 * @param {boolean} [props.demo]   demo wallet: chart sample matches when there's no live history
 * @param {string} [props.height]   css value, default '240px'
 */
export function MarketChart({ chainId, tick1, tick2, demo = false, height = '120px' }) {
    const { messaging } = useMessaging();
    const reducedMotion = useReducedMotion();
    const containerRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    const chartRef = useRef(/** @type {any} */ (null));
    const seriesRef = useRef(/** @type {any} */ (null));
    const trendRef = useRef('neutral');

    const [periodId, setPeriodId] = useState(DEFAULT_PERIOD_ID);
    const [rawRows, setRawRows] = useState(/** @type {any[]} */ ([]));
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [chartReady, setChartReady] = useState(false);
    const [chartUnavailable, setChartUnavailable] = useState(false);

    const period = useMemo(
        () => PERIODS.find((p) => p.id === periodId) ?? PERIODS.find((p) => p.id === DEFAULT_PERIOD_ID),
        [periodId],
    );
    const points = useMemo(() => {
        const candles = bucketizeMatches(rawRows, {
            tick1, tick2, periodSeconds: period.seconds,
        });
        return candles.map((c) => ({ time: c.time, value: c.close }));
    }, [rawRows, tick1, tick2, period]);
    const chartLabel = points.length > 0
        ? describeChartSeries(points.map((point) => point.value), {
            label: `${tick1}/${tick2} price chart`,
            rangeLabel: period.label,
            formatValue: (value) => `${formatChartPrice(value)} ${tick2}`,
        })
        : `${tick1}/${tick2} price chart. No price trend available for the ${period.label} range.`;
    // Lazy-init the chart once the container is mounted.

    useEffect(() => {
        let disposed = false;
        let stopWatchingSize = () => {};
        let stopWatchingTheme = () => {};
        setChartReady(false);
        setChartUnavailable(false);
        (async () => {
            try {
                const lw = await import('lightweight-charts');
                if (disposed || !containerRef.current) return;
                const container = containerRef.current;
                const colors = readChartColors(container);
                const chart = lw.createChart(container, {
                    height: parseInt(String(height), 10) || 240,
                    layout: {
                        background: { color: 'transparent' },
                        textColor: colors.text,
                    },
                    grid: {
                        horzLines: { color: colors.grid },
                        vertLines: { color: colors.grid },
                    },
                    rightPriceScale: { borderColor: colors.border },
                    timeScale: {
                        timeVisible: true,
                        secondsVisible: false,
                        borderColor: colors.border,
                        fixLeftEdge: true,
                        fixRightEdge: true,
                    },
                    crosshair: {
                        vertLine: { color: colors.muted },
                        horzLine: { color: colors.muted },
                    },
                    kineticScroll: { mouse: !reducedMotion, touch: !reducedMotion },
                });
                const series = chart.addLineSeries({
                    color: colors.accent,
                    lineWidth: 2,
                    priceFormat: {
                        type: 'custom',
                        formatter: (value) => `${formatChartPrice(value)} ${tick2}`,
                    },
                    priceLineVisible: false,
                    lastValueVisible: true,
                    crosshairMarkerVisible: true,
                });
                chartRef.current = chart;
                seriesRef.current = series;

                const resize = (width) => {
                    const nextWidth = Math.floor(width || container.getBoundingClientRect().width);
                    if (nextWidth > 0) chart.applyOptions?.({ width: nextWidth });
                };
                if (typeof ResizeObserver === 'function') {
                    const observer = new ResizeObserver((entries) => {
                        resize(entries[0]?.contentRect?.width);
                    });
                    observer.observe(container);
                    stopWatchingSize = () => observer.disconnect();
                } else if (typeof window !== 'undefined') {
                    const onResize = () => resize();
                    window.addEventListener('resize', onResize);
                    stopWatchingSize = () => window.removeEventListener('resize', onResize);
                }

                const refreshTheme = () => {
                    const next = readChartColors(container);
                    chart.applyOptions?.({
                        layout: { background: { color: 'transparent' }, textColor: next.text },
                        grid: {
                            horzLines: { color: next.grid },
                            vertLines: { color: next.grid },
                        },
                        rightPriceScale: { borderColor: next.border },
                        timeScale: { borderColor: next.border },
                        crosshair: {
                            vertLine: { color: next.muted },
                            horzLine: { color: next.muted },
                        },
                    });
                    series.applyOptions?.({ color: trendColor(next, trendRef.current) });
                };
                stopWatchingTheme = watchTheme(refreshTheme);
                setChartReady(true);
            } catch (err) {
                console.error('[MarketChart] init failed:', err);
                if (!disposed) setChartUnavailable(true);
            }
        })();
        return () => {
            disposed = true;
            stopWatchingSize();
            stopWatchingTheme();
            try { chartRef.current?.remove?.(); } catch { /* swallow */ }
            chartRef.current = null;
            seriesRef.current = null;
        };
    }, [height, reducedMotion, tick2]);
    // Fetch matches whenever the pair changes.

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setLoadError(null);
        setRawRows([]);
        messaging.getMarketHistory({ chainId, tick1, tick2 })
            .then((resp) => {
                if (cancelled) return;
                const real = extractRows(resp);
                // Demo wallets chart sample matches when there's no live
                // history; real wallets chart real fills, or show the "No
                // trades yet" empty state below.
                setRawRows(real.length > 0 ? real : (demo ? sampleMatchesFor(tick1, tick2) : []));
                setLoading(false);
            })
            .catch((err) => {
                if (cancelled) return;
                setRawRows(demo ? sampleMatchesFor(tick1, tick2) : []);
                setLoadError(readFailureMessage(err, 'load the price chart'));
                setLoading(false);
            });
        return () => { cancelled = true; };
    }, [messaging, chainId, tick1, tick2, demo]);
    // Rebucket + push into the series whenever rows or period change.

    useEffect(() => {
        if (!chartReady || !seriesRef.current) return;
        const first = points[0]?.value;
        const last = points[points.length - 1]?.value;
        trendRef.current = points.length < 2 || last === first
            ? 'neutral'
            : last > first ? 'positive' : 'negative';
        try {
            seriesRef.current.setData(points);
            const colors = readChartColors(containerRef.current);
            seriesRef.current.applyOptions?.({ color: trendColor(colors, trendRef.current) });
            chartRef.current?.timeScale?.().fitContent?.();
        } catch { /* chart disposed mid-update */ }
    }, [chartReady, points]);

    if (chartUnavailable) {
        return (
            <div
                style={{
                    border: '1px solid var(--xc-border)',
                    borderRadius: '4px',
                    padding: '0.75rem',
                    minHeight: '6rem',
                }}
            >
                <p style={{ margin: '0 0 0.25rem', fontWeight: 600 }}>Chart</p>
                <p style={{ margin: 0, color: 'var(--xc-text-muted)', fontSize: '0.875rem' }}>
                    The price chart is unavailable right now.
                </p>
            </div>
        );
    }

    return (
        <div
            aria-busy={loading || undefined}
            style={{
                border: '1px solid var(--xc-border)',
                borderRadius: '4px',
                padding: '0.5rem',
            }}
        >
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 'var(--xc-space-2)',
                    marginBottom: 'var(--xc-space-2)',
                }}
            >
                <span style={{ fontSize: 'var(--xc-text-xs)', color: 'var(--xc-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Timeframe
                </span>
                <select
                    value={periodId}
                    onChange={(e) => setPeriodId(e.target.value)}
                    aria-label="Chart timeframe"
                    style={{
                        background: 'var(--xc-bg-muted)',
                        color: 'var(--xc-text)',
                        border: '1px solid var(--xc-border)',
                        borderRadius: 999,
                        padding: '2px 6px 2px 10px',
                        maxWidth: '100%',
                        fontSize: 'var(--xc-text-sm)',
                        fontWeight: 600,
                        cursor: 'pointer',
                        font: 'inherit',
                    }}
                >
                    {PERIODS.map((p) => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                </select>
            </div>
            <div
                ref={containerRef}
                style={{ width: '100%', minWidth: 0, maxWidth: '100%', overflow: 'hidden', height }}
                role="img"
                aria-label={chartLabel}
            />
            {loading ? (
                <StatusMessage variant="status">Loading price chart…</StatusMessage>
            ) : null}
            {loadError ? (
                <StatusMessage variant="error">{loadError}</StatusMessage>
            ) : null}
            {!loading && !loadError && points.length === 0 ? (
                <p style={{ margin: '0.25rem 0 0', color: 'var(--xc-text-muted)', fontSize: '0.75rem' }}>
                    No trades yet in this market.
                </p>
            ) : null}
        </div>
    );
}

function readChartColors(container) {
    const cs = container ? getComputedStyle(container) : null;
    const token = (name, fallback) => cs?.getPropertyValue(name).trim() || fallback;
    const text = token('--xc-text', cs?.color?.trim());
    return {
        text,
        muted: token('--xc-text-muted', text),
        grid: token('--xc-text-muted', text),
        border: token('--xc-border', text),
        accent: token('--xc-accent-primary', text),
        success: token('--xc-success', text),
        danger: token('--xc-danger', text),
    };
}

function trendColor(colors, trend) {
    if (trend === 'positive') return colors.success;
    if (trend === 'negative') return colors.danger;
    return colors.accent;
}

function watchTheme(onChange) {
    const teardown = [];
    if (typeof MutationObserver === 'function' && typeof document !== 'undefined') {
        const observer = new MutationObserver(onChange);
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-xc-theme', 'class', 'style'],
        });
        teardown.push(() => observer.disconnect());
    }
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        const query = window.matchMedia('(prefers-color-scheme: dark)');
        query.addEventListener?.('change', onChange);
        teardown.push(() => query.removeEventListener?.('change', onChange));
    }
    return () => teardown.forEach((stop) => stop());
}

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    if (Array.isArray(resp.history)) return resp.history;
    return [];
}

function formatChartPrice(value) {
    return new Intl.NumberFormat('en-US', { maximumSignificantDigits: 8 }).format(value);
}
