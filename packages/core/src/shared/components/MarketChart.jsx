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

/**
 * @param {object} props
 * @param {string} props.chainId
 * @param {string} props.tick1
 * @param {string} props.tick2
 * @param {string} [props.height]   css value, default '240px'
 */
export function MarketChart({ chainId, tick1, tick2, height = '240px' }) {
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
                const chart = lw.createChart(containerRef.current, {
                    height: parseInt(String(height), 10) || 240,
                    layout: {
                        background: { color: 'transparent' },
                        textColor: 'var(--xc-fg, #ccc)',
                    },
                    grid: {
                        horzLines: { visible: false },
                        vertLines: { visible: false },
                    },
                    timeScale: { timeVisible: true, secondsVisible: false },
                });
                const series = chart.addCandlestickSeries({
                    upColor: '#26a69a',
                    downColor: '#ef5350',
                    borderVisible: false,
                    wickUpColor: '#26a69a',
                    wickDownColor: '#ef5350',
                });
                chartRef.current = chart;
                seriesRef.current = series;
                setChartReady(true);
            } catch (err) {
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
                setRawRows(extractRows(resp));
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || String(err));
            });
        return () => { cancelled = true; };
    }, [messaging, chainId, tick1, tick2]);

    // Rebucket + push into the series whenever rows or period change.
    useEffect(() => {
        if (!chartReady || !seriesRef.current) return;
        const candles = bucketizeMatches(rawRows, {
            tick1, tick2, periodSeconds: period.seconds,
        });
        try {
            seriesRef.current.setData(candles);
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
                    gap: '0.25rem',
                    marginBottom: '0.5rem',
                    flexWrap: 'wrap',
                }}
            >
                {PERIODS.map((p) => (
                    <Button
                        key={p.id}
                        variant={p.id === periodId ? 'primary' : 'ghost'}
                        size="sm"
                        onClick={() => setPeriodId(p.id)}
                    >
                        {p.label}
                    </Button>
                ))}
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
