// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Bet Markets gauge card: one market per card, with a segmented donut of
// the pools and what this wallet has on it. The whole card is one button that
// opens the market's detail page.

import { useId } from 'react';
import { Icon } from '@xchain-wallet/core/ui';
import { safeOutcomeLabel, outcomeLabelsOf } from '../utils/betOutcomeLabels.js';
import { neutralizeControlText } from '../utils/textHardening.js';
import { formatDecimalAmount } from '../utils/amountFormat.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';
import styles from './BetMarketCard.module.css';

// Segment colours in outcome order; the brand pair first, so Yes and No take
// the brand blue and purple.
const SEGMENT_COLORS = [
    'var(--xc-brand-blue)',
    'var(--xc-brand-purple)',
    'var(--xc-text-muted)',
    'var(--xc-warning)',
    'var(--xc-success)',
    'var(--xc-info)',
];
// More outcomes than this fold the smallest into one "Other" slice.
const MAX_LEGEND = 4;

// Exact decimal-string sum (pools are token amounts; no float drift in the
// figure a user reads).
export function addDecimals(values) {
    let scale = 0;
    const parts = [];
    for (const v of values) {
        const m = /^(\d+)(?:\.(\d+))?$/.exec(String(v ?? '').trim());
        if (!m) continue;
        parts.push(m);
        scale = Math.max(scale, (m[2] || '').length);
    }
    if (parts.length === 0) return '0';
    let total = 0n;
    for (const m of parts) total += BigInt(`${m[1]}${(m[2] || '').padEnd(scale, '0')}`);
    if (scale === 0) return total.toString();
    const s = total.toString().padStart(scale + 1, '0');
    const whole = s.slice(0, s.length - scale);
    const frac = s.slice(s.length - scale).replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : whole;
}

/** Total pool as a decimal string, or null when the row carries no pools. */
export function betPoolTotal(market) {
    if (!Array.isArray(market?.pools)) return null;
    return addDecimals(market.pools.map((p) => p?.pool));
}

/**
 * Outcome slices for the donut and legend: label, share of the pool (0..1)
 * and colour, folded to MAX_LEGEND entries.
 */
export function betSlices(market) {
    const labels = outcomeLabelsOf(market);
    const amountByOutcome = new Map();
    for (const p of Array.isArray(market?.pools) ? market.pools : []) {
        const i = Number(p?.outcome);
        const n = Number(p?.pool);
        if (!Number.isInteger(i) || !Number.isFinite(n) || n < 0) continue;
        amountByOutcome.set(i, (amountByOutcome.get(i) || 0) + n);
    }
    const count = Math.max(labels.length, ...[...amountByOutcome.keys()].map((i) => i + 1), 0);
    let slices = [];
    for (let i = 0; i < count; i += 1) {
        slices.push({ index: i, label: safeOutcomeLabel(labels[i]) || `Outcome ${i}`, amount: amountByOutcome.get(i) || 0 });
    }
    if (slices.length > MAX_LEGEND) {
        const byAmount = [...slices].sort((a, b) => b.amount - a.amount);
        const keep = new Set(byAmount.slice(0, MAX_LEGEND - 1).map((s) => s.index));
        const other = slices.filter((s) => !keep.has(s.index)).reduce((sum, s) => sum + s.amount, 0);
        slices = [...slices.filter((s) => keep.has(s.index)), { index: -1, label: 'Other', amount: other }];
    }
    const total = slices.reduce((sum, s) => sum + s.amount, 0);
    // Whole percents by largest remainder, so the legend always adds to 100.
    const raw = slices.map((s) => (total > 0 ? (s.amount / total) * 100 : 0));
    const whole = raw.map((r) => Math.floor(r));
    let left = total > 0 ? 100 - whole.reduce((a, b) => a + b, 0) : 0;
    const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
    for (const [, i] of order) { if (left <= 0) break; whole[i] += 1; left -= 1; }
    return {
        // The explorer's market LIST carries no pools (only a single market's
        // read does), so a row without a pools array is "unknown", never
        // "no bets yet".
        known: Array.isArray(market?.pools),
        total,
        slices: slices.map((s, n) => ({
            ...s,
            share: total > 0 ? s.amount / total : 0,
            percent: whole[n],
            color: s.index === -1 ? 'var(--xc-border-strong)' : SEGMENT_COLORS[n % SEGMENT_COLORS.length],
        })),
    };
}

function pct(slice) {
    return `${slice.percent}%`;
}

function Donut({ slices, total, known }) {
    // Drawn on an 84-unit box and shown at 64px (the compact card).
    const R = 34;
    const C = 2 * Math.PI * R;
    const live = slices.filter((s) => s.share > 0);
    const gap = live.length > 1 ? 2 : 0;
    let offset = 0;
    const leader = total > 0 ? [...slices].sort((a, b) => b.share - a.share)[0] : null;
    return (
        <span className={styles.donut} aria-hidden="true">
            <svg viewBox="0 0 84 84">
                <circle cx="42" cy="42" r={R} fill="none" stroke="var(--xc-bg-muted)" strokeWidth="10" />
                {live.map((s) => {
                    const len = Math.max(0, s.share * C - gap);
                    const el = (
                        <circle
                            key={s.index}
                            cx="42"
                            cy="42"
                            r={R}
                            fill="none"
                            stroke={s.color}
                            strokeWidth="10"
                            strokeDasharray={`${len} ${C - len}`}
                            strokeDashoffset={-offset}
                            transform="rotate(-90 42 42)"
                        />
                    );
                    offset += s.share * C;
                    return el;
                })}
            </svg>
            <span className={styles.donutCenter}>
                {leader ? (
                    <>
                        <span className={styles.donutPct}>{pct(leader)}</span>
                        <span className={styles.donutLabel}>{leader.label}</span>
                    </>
                ) : <span className={styles.donutLabel}>{known ? t('components.betMarketCard.noBets') : t('components.betMarketCard.oddsInside')}</span>}
            </span>
        </span>
    );
}

/**
 * @param {object} props
 * @param {any} props.market                 a bet_feeds row
 * @param {() => void} props.onOpen
 * @param {string | null} [props.yourBet]    e.g. "You bet 10 XCHAIN on Yes"
 * @param {boolean} [props.yours]            this wallet runs the market
 * @param {boolean} [props.selected]         shown in Bet Markets' wide detail panel
 * @param {string} [props.className]
 */
export function BetMarketCard({ market, onOpen, yourBet = null, yours = false, selected = false, className }) {
    const questionId = useId();
    const detailId = useId();
    // Market text is attacker-authored on-chain data. React escapes markup,
    // and the display pass also exposes bidi controls instead of letting them
    // reorder the card.
    const question = neutralizeControlText(market?.label, { maxLength: 100 }) || '(untitled market)';
    const tick = neutralizeControlText(market?.tick, { maxLength: 24 }) || 'n/a';
    const { slices, total, known } = betSlices(market);
    const pool = betPoolTotal(market);
    // Only the question, the odds and the pool line (operator ruling
    // 2026-11-13): no tile, market number, ticker caption, clock or status
    // pill. The button is named by the question; the odds and the pool line
    // are its description.
    return (
        <button
            type="button"
            className={className ? `${styles.card} ${className}` : styles.card}
            onClick={onOpen}
            aria-current={selected ? 'true' : undefined}
            aria-labelledby={questionId}
            aria-describedby={detailId}
            // The number is no longer drawn; scripts and specs find a market by it here.
            data-market-index={market?.action_index == null ? undefined : String(market.action_index)}
        >
            <span id={questionId} className={styles.question}>{question}</span>
            <span id={detailId} className={styles.detail}>
            <span className={styles.gauge}>
                <Donut slices={slices} total={total} known={known} />
                <span className={styles.legend}>
                    {slices.map((s) => (
                        <span key={s.index} className={styles.legendRow}>
                            <span className={styles.swatch} style={{ background: s.color }} aria-hidden="true" />
                            <span className={styles.legendLabel}>{s.label}</span>
                            {known ? <span className={styles.legendPct}>{pct(s)}</span> : null}
                        </span>
                    ))}
                </span>
            </span>
            <span className={styles.foot}>
                <span className={styles.pool}>
                    <span className={styles.poolIcon} aria-hidden="true"><Icon.CoinsIcon /></span>
                    {pool !== null ? (
                        <><strong>{formatDecimalAmount(pool)} {tick}</strong>&nbsp;{t('components.betMarketCard.pool')}</>
                    ) : <>{t('components.betMarketCard.poolOnPage')}</>}
                </span>
                {yours ? <span className={`${styles.chip} ${styles.chipYours}`}>{t('components.betMarketCard.yourMarket')}</span> : null}
                <span className={styles.right}>
                    {yourBet ? <span className={styles.chip} data-testid="bet-market-your-bet">{yourBet}</span> : null}
                    <span className={styles.chevron} aria-hidden="true"><Icon.ForwardIcon /></span>
                </span>
            </span>
            </span>
        </button>
    );
}
