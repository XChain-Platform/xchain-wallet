// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Wide Home's allocation card (G115; the operator's pick of 2026-11-15,
// layout 1's donut with layout 3's share bars): a blue hero beside the
// wallet value card, because it holds a chart (G10). The donut, with the
// asset and chain count in its centre, sits on the left; on the right a
// table of the top five assets by value plus Other, each row a colour dot,
// the ticker, a bar as long as the asset's share, then Share and Value
// right-aligned under headers that line up with them. Built from the rows
// Home already priced; it reads nothing itself.

import { memo, useMemo } from 'react';
import { fiatValue } from './BalanceList.jsx';
import { useBalancesHidden } from '../hooks/useBalancesHidden.js';
import { getFormatLocale, t } from '../../i18n/index.js';
import '../../i18n/locales/en/home.js';
import styles from './AllocationCard.module.css';

/** The largest assets that get their own row; the rest fold into Other. */
export const ALLOCATION_TOP_ASSETS = 5;
/** Rows the table can hold: the top assets plus Other. */
export const ALLOCATION_MAX_SLICES = ALLOCATION_TOP_ASSETS + 1;

/**
 * The card's surface, `--xc-accent-primary` in the light and dark themes.
 * Slice colours are checked against it; a unit test keeps it in step with
 * tokens.css.
 */
export const ALLOCATION_BLUE = '#1A7BAC';
/** Dots and arcs need this much contrast against the blue (non-text, 3:1). */
export const ALLOCATION_DOT_CONTRAST = 3;

// Tokens take these in turn: light tints that read on the blue. A coin
// takes its chain's own colour, lifted the same way (liftForBlue).
const TOKEN_COLORS = [
    '#E7A6EB',
    '#7CE3B5',
    '#FF9EB1',
    '#FFE08A',
    '#C9B8FF',
    '#9FE7F5',
    '#D6DEE8',
];
// Other is a dark slate, the one dark slice, so it never reads as a token.
export const ALLOCATION_OTHER_COLOR = '#0B2235';

function channel(v) {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function parseHex(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    const n = Number.parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]) {
    return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** WCAG relative luminance of a #RRGGBB colour, or null for anything else. */
export function relativeLuminance(hex) {
    const rgb = parseHex(hex);
    if (!rgb) return null;
    return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

/** WCAG contrast ratio of two #RRGGBB colours (1 to 21), or null. */
export function contrastRatio(a, b) {
    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);
    if (la === null || lb === null) return null;
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The colour mixed toward white, in 5% steps, until it reaches 3:1 on the
 * card's blue, so a dark chain colour (Litecoin's navy) or a mid one
 * (Bitcoin's orange) still shows as a distinct dot and arc. A colour that
 * is not #RRGGBB falls back to the first token tint.
 *
 * @param {string} hex
 * @returns {string} #RRGGBB
 */
export function liftForBlue(hex) {
    const rgb = parseHex(hex);
    if (!rgb) return TOKEN_COLORS[0];
    for (let step = 0; step <= 20; step += 1) {
        const mix = step / 20;
        const candidate = toHex(rgb.map((v) => v + (255 - v) * mix));
        if (contrastRatio(candidate, ALLOCATION_BLUE) >= ALLOCATION_DOT_CONTRAST) return candidate;
    }
    return '#FFFFFF';
}

/**
 * The card's slices: one per asset with a positive value, largest first,
 * the top five kept and the rest folded into Other (only when two or more
 * would fold), each with its share and a one-decimal percent that adds to
 * 100.0 across the table (largest remainder).
 *
 * @param {Array<any>} rows  priced balance rows (Home's portfolio rows)
 * @param {{ get: (id: string) => any } | null | undefined} chainRegistry
 * @returns {{ total: number, assets: number, chains: number, other: { lead: string, more: number } | null, slices: Array<{ key: string, label: string, value: number, share: number, percent: number, color: string, other?: boolean }> }}
 */
export function allocationSlices(rows, chainRegistry) {
    const valued = [];
    const chains = new Set();
    for (const row of Array.isArray(rows) ? rows : []) {
        const value = Number(fiatValue(row?.quantity, row?.divisibility, row?.fiatRate));
        if (!Number.isFinite(value) || value <= 0) continue;
        const descriptor = chainRegistry?.get?.(row.chainId);
        chains.add(descriptor?.coin || row.chainId);
        valued.push({
            key: `${row.chainId}:${row.tick}`,
            label: String(row.tick || ''),
            value,
            native: row.kind === 'native',
            chainColor: typeof descriptor?.color === 'string' ? descriptor.color : null,
        });
    }
    valued.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
    let kept = valued;
    let other = null;
    if (valued.length > ALLOCATION_MAX_SLICES) {
        kept = valued.slice(0, ALLOCATION_TOP_ASSETS);
        const folded = valued.slice(ALLOCATION_TOP_ASSETS);
        const rest = folded.reduce((sum, s) => sum + s.value, 0);
        other = { lead: folded[0].label, more: folded.length - 1 };
        kept.push({ key: 'other', label: t('home.wide.allocation.other'), value: rest, native: false, chainColor: null, other: true });
    }
    const total = kept.reduce((sum, s) => sum + s.value, 0);
    // Tenths by largest remainder, so the table always adds to 100.0.
    const raw = kept.map((s) => (total > 0 ? (s.value / total) * 1000 : 0));
    const whole = raw.map((r) => Math.floor(r));
    let left = total > 0 ? 1000 - whole.reduce((a, b) => a + b, 0) : 0;
    const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
    for (const [, i] of order) { if (left <= 0) break; whole[i] += 1; left -= 1; }
    let tokenColor = 0;
    const slices = kept.map((s, i) => {
        let color;
        if (s.other) color = ALLOCATION_OTHER_COLOR;
        else if (s.native && s.chainColor) color = liftForBlue(s.chainColor);
        else { color = liftForBlue(TOKEN_COLORS[tokenColor % TOKEN_COLORS.length]); tokenColor += 1; }
        return {
            key: s.key,
            label: s.label,
            value: s.value,
            share: total > 0 ? s.value / total : 0,
            percent: whole[i] / 10,
            color,
            ...(s.other ? { other: true } : {}),
        };
    });
    return { total, assets: valued.length, chains: chains.size, other, slices };
}

/**
 * A row's value in whole currency units ("$100,000"), so the column stays
 * narrow beside the bars: cents only under one unit, and a compact form
 * from a million ("$1.2M"). The table's values are a guide to the shares;
 * the exact figures are on the balances list.
 *
 * @param {number} value
 * @param {string} [currency]
 * @returns {string}
 */
export function formatAllocationValue(value, currency = 'USD') {
    if (!Number.isFinite(value)) return '';
    const code = String(currency || 'USD').toUpperCase();
    const options = value >= 1_000_000
        ? { notation: 'compact', maximumFractionDigits: 1 }
        : value < 1
            ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
            : { minimumFractionDigits: 0, maximumFractionDigits: 0 };
    try {
        return new Intl.NumberFormat(getFormatLocale(), { style: 'currency', currency: code, ...options }).format(value);
    } catch {
        return `${new Intl.NumberFormat(getFormatLocale(), options).format(value)} ${code}`;
    }
}

function Donut({ slices }) {
    // Drawn on a 100-unit box; the card sizes it.
    const R = 40;
    const C = 2 * Math.PI * R;
    const live = slices.filter((s) => s.share > 0);
    const gap = live.length > 1 ? 1.2 : 0;
    let offset = 0;
    return (
        <svg className={styles.donutSvg} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
            <circle className={styles.donutTrack} cx="50" cy="50" r={R} fill="none" strokeWidth="15" />
            {live.map((s) => {
                const len = Math.max(0.6, s.share * C - gap);
                const el = (
                    <circle
                        key={s.key}
                        cx="50"
                        cy="50"
                        r={R}
                        fill="none"
                        stroke={s.color}
                        strokeWidth="15"
                        strokeDasharray={`${len} ${C - len}`}
                        strokeDashoffset={-offset}
                        transform="rotate(-90 50 50)"
                    />
                );
                offset += s.share * C;
                return el;
            })}
        </svg>
    );
}

/**
 * @param {object} props
 * @param {Array<any>} props.rows   the rows the wallet value card totals
 * @param {{ get: (id: string) => any }} props.chainRegistry
 * @param {string} [props.fiatCurrency]  the currency the rows are priced in
 */
export const AllocationCard = memo(function AllocationCard({ rows, chainRegistry, fiatCurrency = 'USD' }) {
    const { assets, chains, other, slices } = useMemo(
        () => allocationSlices(rows, chainRegistry),
        [rows, chainRegistry],
    );
    const [balancesHidden] = useBalancesHidden();
    const masked = '•••';
    const subtitle = other
        ? t('home.wide.allocation.otherIs', { tick: other.lead, count: other.more })
        : t('home.wide.allocation.byValue');
    return (
        <section className={styles.card} aria-labelledby="home-allocation-title" data-home-allocation="">
            <div className={styles.titleRow}>
                <h2 id="home-allocation-title" className={styles.title}>{t('home.wide.allocation.title')}</h2>
                {slices.length > 0 ? (
                    <span className={styles.subtitle} title={subtitle}>{subtitle}</span>
                ) : null}
            </div>
            {slices.length === 0 ? (
                <p className={styles.empty}>{t('home.wide.allocation.empty')}</p>
            ) : (
                <div className={styles.body}>
                    <div className={styles.donut}>
                        <Donut slices={slices} />
                        <span className={styles.donutCenter}>
                            <span className={styles.donutCount}>{assets}</span>
                            <span className={styles.donutAssets}>
                                {assets === 1 ? t('home.wide.allocation.assetWord') : t('home.wide.allocation.assetsWord')}
                            </span>
                            <span className={styles.donutChains}>
                                {chains === 1
                                    ? t('home.wide.allocation.oneChain')
                                    : t('home.wide.allocation.chains', { count: chains })}
                            </span>
                        </span>
                    </div>
                    <table className={styles.table} aria-label={t('home.wide.allocation.legend')}>
                        <thead>
                            <tr>
                                <th scope="col" colSpan={2} className={styles.headAsset}>{t('home.wide.allocation.asset')}</th>
                                <th scope="col" className={styles.num} data-allocation-col="share">{t('home.wide.allocation.share')}</th>
                                <th scope="col" className={styles.num} data-allocation-col="value">{t('home.tabs.value')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {slices.map((s) => (
                                <tr key={s.key} data-allocation-row={s.key}>
                                    <th scope="row" className={styles.asset}>
                                        <span className={styles.assetInner}>
                                            <span className={styles.dot} style={{ background: s.color }} aria-hidden="true" />
                                            <span className={styles.ticker} title={s.label}>{s.label}</span>
                                        </span>
                                    </th>
                                    <td className={styles.barCell}>
                                        <span className={styles.shareTrack} aria-hidden="true">
                                            <span
                                                className={styles.barFill}
                                                style={{ width: balancesHidden ? '0%' : `${(s.share * 100).toFixed(2)}%`, background: s.color }}
                                            />
                                        </span>
                                    </td>
                                    <td className={`${styles.num} ${styles.share}`} data-allocation-col="share">
                                        {balancesHidden ? masked : `${s.percent.toFixed(1)}%`}
                                    </td>
                                    <td className={`${styles.num} ${styles.value}`} data-allocation-col="value">
                                        {balancesHidden ? masked : formatAllocationValue(s.value, fiatCurrency)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
});
