// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Prediction markets adapt their wire rows to the same question row used by
// governance. Money-specific wording stays in this adapter.

import { Icon } from '@xchain-wallet/core/ui';
import { safeOutcomeLabel, outcomeLabelsOf } from '../utils/betOutcomeLabels.js';
import { neutralizeControlText } from '../utils/textHardening.js';
import { formatDecimalAmount } from '../utils/amountFormat.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';
import { QuestionListRow } from './QuestionList.jsx';
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

const spanText = (seconds) => {
    const absolute = Math.abs(seconds);
    if (absolute < 3600) return `${Math.max(1, Math.round(absolute / 60))} min`;
    if (absolute < 86400) return `${Math.round(absolute / 3600)} h`;
    const days = Math.round(absolute / 86400);
    return `${days} day${days === 1 ? '' : 's'}`;
};

function marketTiming(deadline, now = Date.now() / 1000) {
    const end = Number(deadline);
    if (!Number.isFinite(end) || end <= 0) return null;
    return end > now ? `Closing in ${spanText(end - now)}` : `Closed ${spanText(now - end)} ago`;
}

function marketStatus(status) {
    if (status === 'open') return 'Open';
    if (status === 'closed') return 'Closed';
    if (status === 'resolved') return 'Settled';
    if (status === 'resolved_void') return 'Void';
    if (status === 'cancelled') return 'Cancelled';
    if (status === 'expired') return 'Expired';
    return status ? String(status).replace(/_/g, ' ') : 'Unknown';
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
    // Market text is attacker-authored on-chain data. React escapes markup,
    // and the display pass also exposes bidi controls instead of letting them
    // reorder the card.
    const question = neutralizeControlText(market?.label, { maxLength: 100 }) || '(untitled market)';
    const tick = neutralizeControlText(market?.tick, { maxLength: 24 }) || 'n/a';
    const { slices, total, known } = betSlices(market);
    const pool = betPoolTotal(market);
    return (
        <QuestionListRow
            question={question}
            status={marketStatus(market?.feed_status)}
            timing={marketTiming(market?.deadline)}
            answers={slices.map((slice) => ({ key: slice.index, label: slice.label, percent: slice.percent }))}
            sharesKnown={known && total > 0}
            onOpen={onOpen}
            selected={selected}
            className={className ? `${styles.card} ${className}` : styles.card}
            data-market-index={market?.action_index == null ? undefined : String(market.action_index)}
            footer={(
                <>
                    <span className={styles.pool}>
                    <span className={styles.poolIcon} aria-hidden="true"><Icon.CoinsIcon /></span>
                    {pool !== null ? (
                        <><strong>{formatDecimalAmount(pool)} {tick}</strong>&nbsp;{t('components.betMarketCard.pool')}</>
                    ) : <>{t('components.betMarketCard.poolOnPage')}</>}
                    </span>
                    {yours ? <span className={`${styles.chip} ${styles.chipYours}`}>{t('components.betMarketCard.yourMarket')}</span> : null}
                    {yourBet ? <span className={styles.chip} data-testid="bet-market-your-bet">{yourBet}</span> : null}
                </>
            )}
        />
    );
}
