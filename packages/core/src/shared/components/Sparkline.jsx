// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useMemo } from 'react';

/**
 * Pure-SVG sparkline. Renders the series as a single polyline scaled
 * to a 100×100 viewBox; min/max are computed from the series so the
 * line uses the full vertical extent. Stroke color flips green/red
 * based on whether the last point is above or below the first.
 *
 * @param {object} props
 * @param {number[] | null | undefined} props.series
 * @param {number} [props.height=80]
 * @param {number} [props.strokeWidth=1.5]
 * @param {string} [props.label='Price trend']
 * @param {string} [props.rangeLabel]
 * @param {(value: number) => string} [props.formatValue]
 */
export function Sparkline({
    series,
    height = 80,
    strokeWidth = 1.5,
    label = 'Price trend',
    rangeLabel,
    formatValue,
}) {
    const points = useMemo(() => {
        if (!Array.isArray(series) || series.length < 2) return null;
        const min = Math.min(...series);
        const max = Math.max(...series);
        const range = max - min || 1;
        const xStep = 100 / (series.length - 1);
        return series
            .map((v, i) => {
                const x = i * xStep;
                const y = 100 - ((v - min) / range) * 100;
                return `${x.toFixed(2)},${y.toFixed(2)}`;
            })
            .join(' ');
    }, [series]);
    if (!points) return null;
    const tone = series[series.length - 1] >= series[0] ? 'positive' : 'negative';
    const stroke = tone === 'positive' ? 'var(--xc-success, #14b86c)' : 'var(--xc-danger, #d93838)';
    const summary = describeChartSeries(series, { label, rangeLabel, formatValue });
    return (
        <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{ display: 'block', width: '100%', height }}
            role="img"
            aria-label={summary}
        >
            <polyline
                fill="none"
                stroke={stroke}
                strokeWidth={strokeWidth}
                vectorEffect="non-scaling-stroke"
                points={points}
            />
        </svg>
    );
}

/**
 * Builds a concise text alternative for a numeric chart series.
 *
 * @param {number[]} series
 * @param {{ label?: string, rangeLabel?: string, formatValue?: (value: number) => string }} [options]
 * @returns {string}
 */
export function describeChartSeries(series, options = {}) {
    const {
        label = 'Price trend',
        rangeLabel,
        formatValue = formatChartValue,
    } = options;
    const values = Array.isArray(series) ? series.filter(Number.isFinite) : [];
    if (values.length === 0) return `${label}. No data.`;

    const start = values[0];
    const end = values[values.length - 1];
    const low = Math.min(...values);
    const high = Math.max(...values);
    const delta = end - start;
    const change = `${delta > 0 ? '+' : delta < 0 ? '-' : ''}${formatValue(Math.abs(delta))}`;
    const percentage = start !== 0
        ? ` (${delta > 0 ? '+' : ''}${((delta / start) * 100).toFixed(2)}%)`
        : '';
    const selectedRange = rangeLabel ? ` Range ${rangeLabel}.` : '';
    return `${label}.${selectedRange} Values range from ${formatValue(low)} to ${formatValue(high)}. Start ${formatValue(start)}. End ${formatValue(end)}. Change ${change}${percentage}.`;
}

function formatChartValue(value) {
    return new Intl.NumberFormat('en-US', { maximumSignificantDigits: 8 }).format(value);
}

// FNV-1a hash of a string → uint32. Used as the seed for the
// synthesized walk below so the line is stable across re-renders for
// the same key.
function hashStringFor(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/**
 * Synthesize a price walk that ends at `currentPrice`. Seeded by
 * `assetKey` so the line is stable across re-renders. Used by
 * TokenDetail when no real price history is available, and by Home's
 * PortfolioChart for ranges longer than the CoinGecko sparkline window
 * (30d / 90d / All).
 *
 * Trend is bounded to ±30% over the window; per-step noise is ±1.5%
 * of the running value. The final point is clamped to `currentPrice`
 * so the line ends exactly where the KPI reads.
 *
 * @param {string} assetKey
 * @param {number} currentPrice
 * @param {number} [points=168]   default 168 = 1/hr × 7d
 * @returns {{ sparkline: number[] | null, change24hPct: number | null }}
 */
export function synthesizeTokenChart(assetKey, currentPrice, points = 168) {
    if (typeof currentPrice !== 'number' || !isFinite(currentPrice) || currentPrice <= 0) {
        return { sparkline: null, change24hPct: null };
    }
    let rng = hashStringFor(assetKey);
    const advance = () => {
        rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
        return (rng / 0xffffffff) * 2 - 1;
    };
    const trendPct = advance() * 30;
    const start = currentPrice / (1 + trendPct / 100);
    const n = Math.max(2, points | 0);
    const series = new Array(n);
    series[0] = start;
    for (let i = 1; i < n; i += 1) {
        const drift = (currentPrice - series[i - 1]) / (n - i);
        const noise = advance() * 0.015 * series[i - 1];
        series[i] = Math.max(0.0000001, series[i - 1] + drift + noise);
    }
    series[n - 1] = currentPrice;
    // 24h change derived from the last 24 hourly samples (only meaningful
    // when the series is 168-pt hourly; otherwise this is best-effort).
    const back = series[Math.max(0, n - 25)] || start;
    const change24hPct = back > 0 ? ((currentPrice - back) / back) * 100 : null;
    return { sparkline: series, change24hPct };
}
