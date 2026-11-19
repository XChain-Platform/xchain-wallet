// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useId, useMemo } from 'react';
import { percentChangeDisplay } from '../utils/percentFormat.js';
import { getFormatLocale, t } from '../../i18n/index.js';
import styles from './Sparkline.module.css';
import '../../i18n/locales/en/components.js';

export const HERO_SCALE_PLOT = Object.freeze({ left: 0, right: 100, top: 4, bottom: 96 });

/**
 * Pure-SVG sparkline. Renders finite samples as a polyline inside a
 * padded 100×100 viewBox so endpoint strokes remain visible. Rising,
 * falling, and unchanged series use their semantic theme tokens.
 *
 * @param {object} props
 * @param {number[] | null | undefined} props.series
 * @param {number} [props.height=80]
 * @param {number} [props.strokeWidth=1.5]
 * @param {string} [props.label='Price trend']
 * @param {string} [props.rangeLabel]
 * @param {(value: number) => string} [props.formatValue]
 * @param {boolean} [props.showScale=false]
 * @param {(value: number) => string} [props.formatScaleValue]
 * @param {boolean} [props.heroScale=false]
 * @param {number[] | null | undefined} [props.secondarySeries]
 * @param {string} [props.secondaryLabel]
 * @param {boolean} [props.secondaryDashed=false]
 * @param {boolean} [props.stepped=false]
 */
export function Sparkline({
    series,
    height = 80,
    strokeWidth = 1.5,
    strokeColor,
    areaFill,
    edgeToEdge = false,
    label = t('components.sparkline.priceTrend'),
    rangeLabel,
    formatValue,
    showScale = false,
    formatScaleValue = formatValue,
    heroScale = false,
    secondarySeries,
    secondaryLabel,
    secondaryDashed = false,
    stepped = false,
}) {
    const gradientId = `hero-fill-${useId().replace(/:/g, '')}`;
    const values = useMemo(
        () => Array.isArray(series) ? series.filter(Number.isFinite) : [],
        [series],
    );
    const secondaryValues = useMemo(
        () => Array.isArray(secondarySeries) ? secondarySeries.filter(Number.isFinite) : [],
        [secondarySeries],
    );
    const scaleValues = useMemo(() => [...values, ...secondaryValues], [values, secondaryValues]);
    const scale = useMemo(() => chartScale(scaleValues), [scaleValues]);
    const guides = useMemo(() => chartGuides(scale), [scale]);
    const plot = heroScale
        ? HERO_SCALE_PLOT
        : { left: edgeToEdge ? 0 : 1, right: edgeToEdge ? 100 : 99, top: 1, bottom: 99 };
    const bounds = useMemo(() => {
        if (scaleValues.length === 0) return null;
        return { low: Math.min(...scaleValues), high: Math.max(...scaleValues) };
    }, [scaleValues]);
    const pointsFor = (input) => {
        if (input.length === 0 || !bounds) return null;
        const middleY = (plot.top + plot.bottom) / 2;
        if (input.length === 1) {
            const middleX = (plot.left + plot.right) / 2;
            return `${(middleX - 2).toFixed(2)},${middleY.toFixed(2)} ${(middleX + 2).toFixed(2)},${middleY.toFixed(2)}`;
        }
        const flat = bounds.high === bounds.low;
        const range = bounds.high - bounds.low;
        const xStep = (plot.right - plot.left) / (input.length - 1);
        const coords = input.map((v, i) => {
                const x = plot.left + i * xStep;
                const y = flat ? middleY : plot.bottom - ((v - bounds.low) / range) * (plot.bottom - plot.top);
                return { x, y };
            });
        if (!stepped) return coords.map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
        const stair = [coords[0]];
        for (let i = 1; i < coords.length; i += 1) {
            stair.push({ x: coords[i].x, y: coords[i - 1].y }, coords[i]);
        }
        return stair.map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
    };
    const points = useMemo(
        () => pointsFor(values),
        [values, bounds, plot.left, plot.right, plot.top, plot.bottom, stepped], // eslint-disable-line react-hooks/exhaustive-deps
    );
    const secondaryPoints = useMemo(
        () => pointsFor(secondaryValues),
        [secondaryValues, bounds, plot.left, plot.right, plot.top, plot.bottom, stepped], // eslint-disable-line react-hooks/exhaustive-deps
    );
    if (!points) return null;
    const toneValues = secondaryValues.length > 0 ? secondaryValues : values;
    const first = toneValues[0];
    const last = toneValues[toneValues.length - 1];
    const tone = last > first ? 'up' : last < first ? 'down' : 'unchanged';
    const heroStroke = tone === 'up'
        ? 'var(--xc-hero-chart-up)'
        : tone === 'down' ? 'var(--xc-hero-chart-down)' : 'var(--xc-hero-scale-text)';
    const stroke = heroScale ? heroStroke : (strokeColor || (tone === 'up'
        ? 'var(--xc-success)'
        : tone === 'down' ? 'var(--xc-danger)' : 'var(--xc-text-muted)'));
    const resolvedStrokeWidth = heroScale ? 2 : strokeWidth;
    const useHeroGradient = heroScale && Boolean(areaFill);
    const scaleFormatter = formatScaleValue || formatChartValue;
    const summary = describeChartSeries(values, {
        label,
        rangeLabel,
        formatValue: formatValue || scaleFormatter,
        formatRangeValue: scaleFormatter,
        includeRangeExtrema: showScale,
    });
    const secondarySummary = secondaryPoints ? describeChartSeries(secondaryValues, {
        label: secondaryLabel || label,
        rangeLabel,
        formatValue: formatValue || scaleFormatter,
        formatRangeValue: scaleFormatter,
        includeRangeExtrema: false,
    }) : '';
    const chartSummary = secondarySummary ? `${summary} ${secondarySummary}` : summary;
    const scalePlot = plot;
    return (
        <div className={styles.root} style={{ height }}>
            <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                className={styles.plot}
                role="img"
                aria-label={chartSummary}
            >
                <title>{chartSummary}</title>
                {useHeroGradient ? (
                    <defs>
                        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1" data-chart-fill-tone={tone}>
                            <stop offset="0%" stopColor={heroStroke} stopOpacity="var(--xc-hero-chart-fill-opacity)" />
                            <stop offset="100%" stopColor={heroStroke} stopOpacity="0" />
                        </linearGradient>
                    </defs>
                ) : null}
                {areaFill ? <polygon fill={useHeroGradient ? `url(#${gradientId})` : areaFill} stroke="none" points={`${plot.left},100 ${points} ${plot.right},100`} /> : null}
                <polyline
                    data-chart-series="primary"
                    data-chart-tone={heroScale ? tone : undefined}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={resolvedStrokeWidth}
                    vectorEffect="non-scaling-stroke"
                    points={points}
                />
                {secondaryPoints ? (
                    <polyline
                        data-chart-series="secondary"
                        data-chart-tone={heroScale ? tone : undefined}
                        fill="none"
                        stroke={stroke}
                        strokeWidth={heroScale ? 1.25 : Math.max(1, resolvedStrokeWidth - 0.5)}
                        strokeDasharray={secondaryDashed ? '4 3' : undefined}
                        vectorEffect="non-scaling-stroke"
                        points={secondaryPoints}
                    />
                ) : null}
                {showScale ? guides.map((mark) => (
                    <line
                        key={mark.kind}
                        className={`${styles.guide}${heroScale ? ` ${styles.guideHero}` : ''}${mark.labelled ? '' : ` ${styles.guideHalfway}`}`}
                        data-chart-guide={mark.kind}
                        data-chart-guide-kind={mark.labelled ? 'labelled' : 'halfway'}
                        x1={plot.left}
                        x2={plot.right}
                        y1={scalePosition(mark, plot)}
                        y2={scalePosition(mark, plot)}
                        vectorEffect="non-scaling-stroke"
                    />
                )) : null}
            </svg>
            {showScale ? (
                <div
                    className={`${styles.scale} ${heroScale ? styles.scaleHero : ''}`}
                    data-chart-scale-band={heroScale ? 'hero' : undefined}
                    aria-hidden="true"
                >
                    {scale.map((mark) => (
                        <span
                            key={mark.kind}
                            data-chart-scale={mark.kind}
                            data-scale-position={mark.position}
                            style={{ top: `${scalePosition(mark, scalePlot)}%` }}
                        >
                            {scaleFormatter(mark.value)}
                        </span>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

/** Return five evenly spaced marks, or one middle mark for a flat line. */
export function chartScale(series) {
    const values = Array.isArray(series) ? series.filter(Number.isFinite) : [];
    if (values.length === 0) return [];
    const low = Math.min(...values);
    const high = Math.max(...values);
    if (high === low) return [{ kind: 'flat', value: high, position: 'middle' }];
    return [
        { kind: 'high', value: high, position: 'top' },
        { kind: 'upper-middle', value: low + ((high - low) * 0.75), position: 'upper-middle' },
        { kind: 'middle', value: low + ((high - low) / 2), position: 'middle' },
        { kind: 'lower-middle', value: low + ((high - low) * 0.25), position: 'lower-middle' },
        { kind: 'low', value: low, position: 'bottom' },
    ];
}

/** Add an unlabelled guide halfway between every adjacent labelled mark. */
function chartGuides(scale) {
    if (scale.length !== 5) return scale.map((mark) => ({ ...mark, labelled: true }));
    const guides = [];
    scale.forEach((mark, index) => {
        guides.push({ ...mark, labelled: true });
        if (index < scale.length - 1) {
            guides.push({
                kind: `${mark.kind}-${scale[index + 1].kind}-halfway`,
                position: `${mark.position}-${scale[index + 1].position}-halfway`,
                labelled: false,
            });
        }
    });
    return guides;
}

function scalePosition(mark, plot) {
    const ratio = {
        top: 0,
        'top-upper-middle-halfway': 0.125,
        'upper-middle': 0.25,
        'upper-middle-middle-halfway': 0.375,
        middle: 0.5,
        'middle-lower-middle-halfway': 0.625,
        'lower-middle': 0.75,
        'lower-middle-bottom-halfway': 0.875,
        bottom: 1,
    }[mark.position];
    return plot.top + ((plot.bottom - plot.top) * ratio);
}

/** Compact locale-aware chart label in fiat or coin units. */
export function formatCompactChartValue(value, { locale, currency, unit } = {}) {
    const options = {
        notation: 'compact',
        maximumSignificantDigits: 3,
        ...(currency ? { style: 'currency', currency: String(currency).toUpperCase(), currencyDisplay: 'narrowSymbol' } : {}),
    };
    let amount;
    try {
        amount = new Intl.NumberFormat(locale, options).format(value);
    } catch {
        amount = new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 3 }).format(value);
    }
    return unit ? `${amount} ${unit}` : amount;
}

/**
 * Builds a concise text alternative for a numeric chart series.
 *
 * @param {number[]} series
 * @param {{ label?: string, rangeLabel?: string, formatValue?: (value: number) => string, formatRangeValue?: (value: number) => string, includeRangeExtrema?: boolean }} [options]
 * @returns {string}
 */
export function describeChartSeries(series, options = {}) {
    const {
        label = t('components.sparkline.priceTrend'),
        rangeLabel,
        formatValue = formatChartValue,
        formatRangeValue = formatValue,
        includeRangeExtrema = false,
    } = options;
    const values = Array.isArray(series) ? series.filter(Number.isFinite) : [];
    if (values.length === 0) return t('components.sparkline.noData', { label });

    const start = values[0];
    const end = values[values.length - 1];
    const low = Math.min(...values);
    const high = Math.max(...values);
    const delta = end - start;
    const change = `${delta > 0 ? '+' : delta < 0 ? '-' : ''}${formatValue(Math.abs(delta))}`;
    const pctDisplay = start !== 0 ? percentChangeDisplay((delta / start) * 100) : null;
    return t('components.sparkline.summary', {
        label,
        rangeState: rangeLabel ? 'withRange' : 'withoutRange',
        range: rangeLabel || '',
        extremaState: includeRangeExtrema ? 'withExtrema' : 'withoutExtrema',
        rangeHigh: formatRangeValue(high),
        rangeLow: formatRangeValue(low),
        low: formatValue(low),
        high: formatValue(high),
        start: formatValue(start),
        end: formatValue(end),
        change,
        percentageState: pctDisplay ? 'withPercentage' : 'withoutPercentage',
        percentage: pctDisplay?.text || '',
    });
}

function formatChartValue(value) {
    return new Intl.NumberFormat(getFormatLocale(), { maximumSignificantDigits: 8 }).format(value);
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
 * `assetKey`, so every asset, range and series gets its own shape and the
 * line is stable across re-renders. Used by the demo wallet's charts only
 * (Home value, coin and token heroes).
 *
 * A demo never advertises a loss, so the walk starts 8% to 30% below
 * `currentPrice` and climbs. Between those ends it moves like a market: a
 * few slow swells and dips of different sizes (a low-frequency sine mix with
 * random phase), plus a bridged random walk for the day-to-day wobble.
 * Both are pinned to zero at either end, so the first point is the start,
 * the final point is exactly `currentPrice`, and the last day always reads
 * as a gain.
 *
 * @param {string} assetKey
 * @param {number} currentPrice
 * @param {number} [points=168]   default 168 = 1/hr x 7d
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
    // The first draws of an LCG are correlated across nearby seeds; burn a few.
    for (let i = 0; i < 6; i += 1) advance();
    const n = Math.max(2, points | 0);
    const trend = 0.08 + (advance() + 1) * 0.11;
    const end = currentPrice;
    const start = end / (1 + trend);
    const rise = end - start;
    // Swells: three slow components (1 to 4 half-waves), up to 0.6x, 0.4x and
    // 0.25x the rise in size, each signed so some are dips and some rallies.
    const swells = [0.6, 0.4, 0.25].map((amp, k) => ({
        k: k + 1 + (advance() > 0 ? 1 : 0),
        amp: amp * advance(),
    }));
    // Wobble: random walk with its drift removed (a Brownian bridge).
    const walk = new Array(n);
    walk[0] = 0;
    for (let i = 1; i < n; i += 1) walk[i] = walk[i - 1] + advance();
    const span = Math.sqrt(n);
    const bridge = (i) => (walk[i] - (i / (n - 1)) * walk[n - 1]) / span;
    const raw = new Array(n);
    for (let i = 0; i < n; i += 1) {
        const x = i / (n - 1);
        let dev = 0;
        for (const sw of swells) dev += sw.amp * Math.sin(sw.k * Math.PI * x);
        dev += 0.5 * bridge(i);
        raw[i] = start + rise * (x + dev);
    }
    // The last day eases in: the deviation fades over the final 24 samples
    // (about one hourly day) so the 24h figure is a gain.
    const fade = Math.min(n - 1, 24);
    const series = raw.map((v, i) => {
        const x = i / (n - 1);
        const line = start + rise * x;
        const tail = i >= n - fade ? (n - 1 - i) / fade : 1;
        return Math.max(start * 0.35, line + (v - line) * tail);
    });
    series[0] = start;
    series[n - 1] = end;
    // The fade starts one sample after the 24h reference point, so a swell
    // cresting there can still sit above the end. Only then, pull the last
    // day under the midpoint between the trend line and the end, which keeps
    // every walk that already rises unchanged.
    const backIndex = Math.max(0, n - 25);
    if (series[backIndex] >= end) {
        for (let i = backIndex; i < n - 1; i += 1) {
            const line = start + rise * (i / (n - 1));
            series[i] = Math.min(series[i], line + (end - line) * 0.5);
        }
    }
    const back = series[backIndex] || start;
    const change24hPct = back > 0 ? ((end - back) / back) * 100 : null;
    return { sparkline: series, change24hPct };
}
