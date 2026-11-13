// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The bet market's blue card, laid out like Home's balance card: status and
// closing chip, the question, the leading outcome's chance and its move, and
// each outcome's chance over time drawn behind, with range chips at the foot.

import { useId, useMemo, useState } from 'react';
import { BEHIND_CHART_FILL, BEHIND_CHART_STROKE, ChartRangeTabs, RANGES as CHART_RANGES, defaultRangeId } from '../components/PortfolioChart.jsx';
import portfolioChartStyles from '../components/PortfolioChart.module.css';
import heroStyles from '../components/TotalBalanceHero.module.css';
import homeTabsStyles from '../components/HomeTabs.module.css';
import { safeOutcomeLabel } from '../utils/betOutcomeLabels.js';
import { neutralizeControlText } from '../utils/textHardening.js';
import { formatWithThousands, trimAmountTail } from '../utils/amountFormat.js';
import { BET_RANGE_WINDOWS, lineChange, probabilitySeries } from './betMarketSeries.js';
import local from './BetFeedDetail.module.css';
import formStyles from './IssueTokenForm.module.css';

/** The card's seven range chips (Home's, without YTD). */
const BET_RANGES = CHART_RANGES.filter((r) => r.id in BET_RANGE_WINDOWS);

/** One colour per outcome for three or more, readable on the blue card. */
export const OUTCOME_COLORS = ['#FFFFFF', '#F5B83D', '#E879F9', '#22D3EE', '#4ADE80', '#FB7185', '#A78BFA', '#FDE047'];

/** A one-place percent, without a trailing ".0". */
function pctText(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '';
    const fixed = value.toFixed(1);
    return `${fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed}%`;
}

/** "closes in 6 days" style wording for a deadline, or null once it passed. */
function closesInText(deadline, now = Math.floor(Date.now() / 1000)) {
    const left = Number(deadline) - now;
    if (!Number.isFinite(left) || left <= 0) return null;
    const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;
    if (left >= 86400) return `closes in ${plural(Math.floor(left / 86400), 'day')}`;
    if (left >= 3600) return `closes in ${plural(Math.floor(left / 3600), 'hour')}`;
    return `closes in ${plural(Math.max(1, Math.floor(left / 60)), 'minute')}`;
}

/**
 * The chart drawn behind the card: one line for a two-outcome market (the
 * leading side, with Home's purple area under it), one line per outcome for
 * three or more. The y axis is the chance itself, padded so a quiet market
 * is not drawn as a cliff.
 */
function ProbabilityLines({ lines, leading, label }) {
    const drawn = lines.length <= 2 ? lines.filter((l) => l.outcome === leading) : lines;
    const values = drawn.flatMap((l) => l.values).filter((v) => typeof v === 'number' && Number.isFinite(v));
    if (values.length === 0) return null;
    let lo = Math.max(0, Math.min(...values) - 8);
    let hi = Math.min(100, Math.max(...values) + 8);
    if (hi - lo < 24) {
        const mid = (hi + lo) / 2;
        lo = Math.max(0, mid - 12);
        hi = Math.min(100, lo + 24);
        lo = Math.max(0, hi - 24);
    }
    // The plot spans the whole card behind the figures, on the
    // Sparkline's own 1 to 99 band, the way Home's chart is drawn.
    const TOP = 1;
    const BOTTOM = 99;
    const y = (v) => BOTTOM - ((v - lo) / (hi - lo)) * (BOTTOM - TOP);
    const pathOf = (vals) => {
        const n = vals.length;
        const pts = [];
        vals.forEach((v, i) => {
            if (typeof v !== 'number' || !Number.isFinite(v)) return;
            pts.push(`${((i / Math.max(1, n - 1)) * 100).toFixed(2)},${y(v).toFixed(2)}`);
        });
        return pts;
    };
    return (
        <svg className={local.heroChartSvg} viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={label}>
            {drawn.map((line) => {
                const pts = pathOf(line.values);
                if (pts.length === 0) return null;
                const solo = drawn.length === 1;
                const first = pts[0].split(',')[0];
                const color = solo ? BEHIND_CHART_STROKE : OUTCOME_COLORS[line.outcome % OUTCOME_COLORS.length];
                return (
                    <g key={line.outcome}>
                        {solo ? (
                            <polygon fill={BEHIND_CHART_FILL} stroke="none" points={`${first},100 ${pts.join(' ')} 100,100`} />
                        ) : null}
                        <polyline
                            fill="none"
                            stroke={color}
                            strokeWidth="2"
                            strokeLinejoin="round"
                            strokeLinecap="round"
                            vectorEffect="non-scaling-stroke"
                            points={pts.length === 1 ? `${pts[0]} 100,${pts[0].split(',')[1]}` : pts.join(' ')}
                        />
                    </g>
                );
            })}
        </svg>
    );
}

/**
 * @param {object} props
 * @param {any} props.feed                     the market row
 * @param {string[]} props.outcomes            outcome labels in wire order
 * @param {any[]} props.pools                  validated per-outcome pool rows
 * @param {string} props.total                 the pot, a decimal string
 * @param {number} props.betCount              bets counted in the pools
 * @param {any[] | null} props.bets            the market's bet rows, null while loading
 * @param {string} props.statusText            the status wording
 * @param {boolean} props.live                 whether the split can still move
 */
export function BetMarketHero({ feed = null, outcomes: outcomesProp, pools = [], total = '0', betCount = 0, bets = null, statusText = '', live = false }) {
    const captionId = useId();
    const chartPanelId = useId();
    const [rangeId, setRangeId] = useState(defaultRangeId());
    const range = BET_RANGES.find((r) => r.id === rangeId) || BET_RANGES[1];
    // Before the market loads there are no outcomes; the card shows its empty
    // state ("No bets") instead of failing.
    const outcomes = Array.isArray(outcomesProp) ? outcomesProp : [];
    const count = outcomes.length;

    const series = useMemo(() => probabilitySeries({
        bets: bets || [],
        pools,
        outcomeCount: count,
        rangeId: range.id,
        createdAt: feed?.timestamp,
    }), [bets, pools, count, range.id, feed?.timestamp]);

    const current = series.current;
    let leading = 0;
    if (current) {
        for (let i = 1; i < current.length; i += 1) if (current[i] > current[leading]) leading = i;
    }
    const leadingLabel = safeOutcomeLabel(outcomes[leading]) || `Outcome ${leading}`;
    const change = current && series.fromBets ? lineChange(series.lines[leading]?.values) : null;
    const changeRounded = change === null ? null : Math.round(change * 10) / 10;
    const direction = changeRounded === null || changeRounded === 0 ? 'neutral' : changeRounded > 0 ? 'positive' : 'negative';
    const pillClass = direction === 'positive'
        ? heroStyles.changePositive
        : direction === 'negative' ? heroStyles.changeNegative : heroStyles.changeNeutral;
    const arrow = direction === 'positive' ? '▲' : direction === 'negative' ? '▼' : '';
    const changeText = changeRounded === null
        ? null
        : `${arrow ? `${arrow} ` : ''}${Math.abs(changeRounded)} pts ${range.label}`;

    const closes = feed?.feed_status === 'open' ? closesInText(feed.deadline) : null;
    const tone = feed?.feed_status === 'open' ? local.statusDotOpen
        : feed?.feed_status === 'closed' ? local.statusDotClosed : local.statusDotDone;
    const tick = feed?.tick ? String(feed.tick).toUpperCase() : '';
    const chartLabel = !current
        ? 'No bets to chart yet'
        : series.fromBets
            ? `Chance of ${count <= 2 ? leadingLabel : 'each outcome'} over ${range.label}, rebuilt from the market's bets`
            : `Current split of ${leadingLabel} ${pctText(current[leading])}; no bet history to draw`;

    return (
        <div className={`${homeTabsStyles.heroStack} ${homeTabsStyles.heroStackWithChart} ${local.heroStack}`}>
            <section className={local.hero} aria-labelledby={captionId}>
                <div className={local.heroTop}>
                    <span className={local.statusChip}>
                        <span className={`${local.statusDot} ${tone}`} aria-hidden="true" />
                        <span>{statusText}{closes ? `, ${closes}` : ''}</span>
                    </span>
                </div>
                <h2 id={captionId} className={`${formStyles.betLongText} ${local.question}`}>
                    {neutralizeControlText(feed?.label, { maxLength: 250 }) || '(untitled market)'}
                </h2>
                <div className={local.bigRow}>
                    {current ? (
                        <>
                            <span className={local.bigPct}>{pctText(current[leading])}</span>
                            <span className={local.bigLabel}>{leadingLabel}</span>
                            {changeText ? (
                                <span className={`${pillClass} ${local.changePill}`} aria-label={`${leadingLabel} moved ${changeRounded} points over ${range.label}`}>
                                    {changeText}
                                </span>
                            ) : null}
                        </>
                    ) : (
                        <span className={`${local.bigPct} ${local.bigMessage}`}>{live ? 'No bets yet' : 'No bets'}</span>
                    )}
                </div>
                {count > 2 && current ? (
                    <ul className={local.legend} aria-label="Chance of each outcome">
                        {outcomes.map((label, i) => (
                            <li key={i} className={local.legendItem}>
                                <span className={local.legendSwatch} style={{ background: OUTCOME_COLORS[i % OUTCOME_COLORS.length] }} aria-hidden="true" />
                                <span className={local.legendText}>{safeOutcomeLabel(label) || `Outcome ${i}`}</span>
                                <span className={local.legendPct}>{pctText(current[i])}</span>
                            </li>
                        ))}
                    </ul>
                ) : null}
                <p className={local.heroStats}>
                    <span>Pool <strong>{formatWithThousands(trimAmountTail(total) || '0')}{tick ? ` ${tick}` : ''}</strong></span>
                    <span><strong>{betCount}</strong> bet{betCount === 1 ? '' : 's'}</span>
                </p>
            </section>
            <section
                className={`${portfolioChartStyles.wrap} ${portfolioChartStyles.behind}`}
                data-chart-behind="true"
                aria-label="Chance over time"
            >
                <div id={chartPanelId} role="tabpanel" aria-labelledby={`${chartPanelId}-tab-${range.id}`}>
                    <div className={portfolioChartStyles.slot}>
                        <div className={portfolioChartStyles.chart}>
                            <ProbabilityLines lines={series.lines} leading={leading} label={chartLabel} />
                        </div>
                    </div>
                </div>
                <ChartRangeTabs
                    panelId={chartPanelId}
                    ranges={BET_RANGES}
                    rangeId={range.id}
                    onSelect={setRangeId}
                />
            </section>
        </div>
    );
}
