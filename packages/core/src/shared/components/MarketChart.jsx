// MarketChart — §41.3.1 candlestick/line chart for a single market.
//
// `lightweight-charts` is imported lazily so the module loads clean
// in Node (smoke tests, SSR) and only pulls the chart runtime when
// the component mounts. Period toggles rebucket in memory — one
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
import { Button } from '@xchain-wallet/core/ui';
import { bucketizeMatches, PERIODS, DEFAULT_PERIOD_ID } from '../../market/bucketize.js';
import { useMessaging } from '../useMessaging.js';
import { sampleMatchesFor } from '../../market/sampleMarketData.js';

/**
 * @param {object} props
 * @param {string} props.chainId
 * @param {string} props.tick1
 * @param {string} props.tick2
 * @param {string} [props.height]   css value, default '240px'
 */
export function MarketChart({ chainId, tick1, tick2, height = '120px' }) {
    const { messaging } = useMessaging();
    const containerRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    const chartRef = useRef(/** @type {any} */ (null));
    const seriesRef = useRef(/** @type {any} */ (null));

    const [periodId, setPeriodId] = useState(DEFAULT_PERIOD_ID);
    const [rawRows, setRawRows] = useState(/** @type {any[]} */ ([]));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [chartReady, setChartReady] = useState(false);
    const [chartUnavailable, setChartUnavailable] = useState(false);

    const period = useMemo(
        () => PERIODS.find((p) => p.id === periodId) ?? PERIODS.find((p) => p.id === DEFAULT_PERIOD_ID),
        [periodId],
    );

    // Lazy-init the chart once the container is mounted.
    useEffect(() => {
        let disposed = false;
        (async () => {
            try {
                const lw = await import('lightweight-charts');
                if (disposed || !containerRef.current) return;
                // lightweight-charts draws to canvas and can't parse CSS
                // variables — resolve them off the container's computed
                // style so the chart follows the theme.
                const cs = getComputedStyle(containerRef.current);
                const textColor = (cs.getPropertyValue('--xc-text') || cs.color || '#ccc').trim() || '#ccc';
                const chart = lw.createChart(containerRef.current, {
                    height: parseInt(String(height), 10) || 240,
                    layout: {
                        background: { color: 'transparent' },
                        textColor,
                    },
                    grid: {
                        horzLines: { visible: false },
                        vertLines: { visible: false },
                    },
                    timeScale: { timeVisible: true, secondsVisible: false },
                });
                const accent = (cs.getPropertyValue('--xc-accent-primary') || '#26a69a').trim() || '#26a69a';
                const series = chart.addLineSeries({
                    color: accent,
                    lineWidth: 2,
                    priceLineVisible: false,
                    lastValueVisible: true,
                    crosshairMarkerVisible: true,
                });
                chartRef.current = chart;
                seriesRef.current = series;
                setChartReady(true);
            } catch (err) {
                console.error('[MarketChart] init failed:', err);
                if (!disposed) setChartUnavailable(true);
            }
        })();
        return () => {
            disposed = true;
            try { chartRef.current?.remove?.(); } catch { /* swallow */ }
            chartRef.current = null;
            seriesRef.current = null;
        };
    }, [height]);

    // Fetch matches whenever the pair changes.
    useEffect(() => {
        let cancelled = false;
        setLoadError(null);
        setRawRows([]);
        messaging.getMarketHistory({ chainId, tick1, tick2 })
            .then((resp) => {
                if (cancelled) return;
                const real = extractRows(resp);
                // TEMP — fall back to sample matches so the chart draws
                // something pre-real-feed.
                setRawRows(real.length > 0 ? real : sampleMatchesFor(tick1, tick2));
            })
            .catch((err) => {
                if (cancelled) return;
                setRawRows(sampleMatchesFor(tick1, tick2));
                setLoadError(err?.message || String(err));
            });
        return () => { cancelled = true; };
    }, [messaging, chainId, tick1, tick2]);

    // Rebucket + push into the series whenever rows or period change.
    useEffect(() => {
        if (!chartReady || !seriesRef.current) return;
        const candles = bucketizeMatches(rawRows, {
            tick1, tick2, periodSeconds: period.seconds,
        });
        // Line series wants { time, value } — use each candle's close.
        const points = candles.map((c) => ({ time: c.time, value: c.close }));
        try {
            seriesRef.current.setData(points);
            chartRef.current?.timeScale?.().fitContent?.();
        } catch { /* chart disposed mid-update */ }
    }, [chartReady, rawRows, tick1, tick2, period]);

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
                <p style={{ margin: 0, color: 'var(--xc-fg-muted)', fontSize: '0.875rem' }}>
                    Chart library unavailable. Run <code>pnpm install</code> to
                    restore the chart.
                </p>
            </div>
        );
    }

    return (
        <div
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
                        appearance: 'none',
                        background: 'var(--xc-bg-muted)',
                        color: 'var(--xc-text)',
                        border: '1px solid var(--xc-border)',
                        borderRadius: 999,
                        padding: '2px 24px 2px 10px',
                        fontSize: 'var(--xc-text-sm)',
                        fontWeight: 600,
                        cursor: 'pointer',
                        font: 'inherit',
                        backgroundImage:
                            'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\' viewBox=\'0 0 10 6\'><path fill=\'%23888\' d=\'M0 0l5 6 5-6z\'/></svg>")',
                        backgroundRepeat: 'no-repeat',
                        backgroundPosition: 'right 8px center',
                    }}
                >
                    {PERIODS.map((p) => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                </select>
            </div>
            <div ref={containerRef} style={{ width: '100%', height }} aria-label="Price chart" />
            {loadError ? (
                <p style={{ margin: '0.25rem 0 0', color: 'var(--xc-fg-muted)', fontSize: '0.75rem' }}>
                    {loadError}
                </p>
            ) : null}
            {!loadError && rawRows.length === 0 ? (
                <p style={{ margin: '0.25rem 0 0', color: 'var(--xc-fg-muted)', fontSize: '0.75rem' }}>
                    No trades yet in this market.
                </p>
            ) : null}
        </div>
    );
}

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    if (Array.isArray(resp.history)) return resp.history;
    return [];
}
