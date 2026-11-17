// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The bet market's blue hero, on the shared outcome page layout (the one the
// poll page uses): the status and closing chips, the question, the leading
// outcome's chance and its move over the range, each outcome's chance over
// time drawn behind, the pool at the foot (no oracle in the header) and the
// range chips.

import { useMemo, useState } from 'react';
import { Icon } from '@xchain-wallet/core/ui';
import { RANGES as CHART_RANGES, defaultRangeId } from '../components/PortfolioChart.jsx';
import { OutcomeHero } from '../components/outcomeDetail/OutcomeDetailLayout.jsx';
import outcomeStyles from '../components/outcomeDetail/OutcomeDetail.module.css';
import { safeOutcomeLabel } from '../utils/betOutcomeLabels.js';
import { neutralizeControlText } from '../utils/textHardening.js';
import { formatWithThousands, trimAmountTail } from '../utils/amountFormat.js';
import { BET_RANGE_WINDOWS, lineChange, probabilitySeries } from './betMarketSeries.js';

/** The card's seven range chips (Home's, without YTD). */
const BET_RANGES = CHART_RANGES.filter((r) => r.id in BET_RANGE_WINDOWS);

/** A one-place percent, without a trailing ".0". */
function pctText(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '';
    const fixed = value.toFixed(1);
    return `${fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed}%`;
}

const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** "12 days", "5 hours", "3 minutes" for a span of seconds. */
function spanText(seconds) {
    if (seconds >= 86400) return plural(Math.floor(seconds / 86400), 'day');
    if (seconds >= 3600) return plural(Math.floor(seconds / 3600), 'hour');
    return plural(Math.max(1, Math.floor(seconds / 60)), 'minute');
}

/**
 * The closing chip's wording: "Closes in 12 days" before the deadline and
 * "Closed 2 days ago" after it; null when the market has no usable deadline.
 */
function betClosingText(deadline, now = Math.floor(Date.now() / 1000)) {
    const left = Number(deadline) - now;
    if (!Number.isFinite(left) || Number(deadline) <= 0) return null;
    return left > 0 ? `Closes in ${spanText(left)}` : `Closed ${spanText(-left)} ago`;
}

/** The status chip's short word and dot for each market status. */
function betStatusChip(status) {
    if (status === 'open') return { text: 'Open', dot: 'open' };
    if (status === 'closed') return { text: 'Purchases closed', dot: 'closed' };
    if (status === 'resolved') return { text: 'Settled', dot: 'done' };
    if (status === 'resolved_void') return { text: 'Void', dot: 'done' };
    if (status === 'cancelled') return { text: 'Cancelled', dot: 'done' };
    if (status === 'expired') return { text: 'Expired', dot: 'done' };
    return { text: status ? String(status) : 'Unknown', dot: 'done' };
}

/**
 * @param {object} props
 * @param {any} props.feed                     the market row
 * @param {string[]} props.outcomes            outcome labels in wire order
 * @param {any[]} props.pools                  validated per-outcome pool rows
 * @param {string} props.total                 the pot, a decimal string
 * @param {number} props.betCount              bets counted in the pools
 * @param {any[] | null} props.bets            the market's bet rows, null while loading
 * @param {boolean} props.live                 whether the split can still move
 */
export function BetMarketHero({ feed = null, outcomes: outcomesProp, pools = [], total = '0', betCount = 0, bets = null, live = false }) {
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
    const labelOf = (i) => safeOutcomeLabel(outcomes[i]) || `Outcome ${i}`;
    const leadingLabel = labelOf(leading);
    const change = current && series.fromBets ? lineChange(series.lines[leading]?.values) : null;
    const changeRounded = change === null ? null : Math.round(change * 10) / 10;
    const direction = changeRounded === null || changeRounded === 0 ? 'neutral' : changeRounded > 0 ? 'positive' : 'negative';
    const arrow = direction === 'positive' ? '▲' : direction === 'negative' ? '▼' : '';

    const status = betStatusChip(feed?.feed_status);
    // A market cancelled before its deadline never reaches "Closes in": once
    // it stops taking bets only a passed deadline is named.
    const closing = feed?.feed_status === 'open' || Number(feed?.deadline) <= Math.floor(Date.now() / 1000)
        ? betClosingText(feed?.deadline)
        : null;
    const chips = [
        { key: 'status', text: status.text, dot: status.dot },
        ...(closing ? [{ key: 'closes', text: closing, icon: <Icon.ClockIcon /> }] : []),
    ];
    const tick = feed?.tick ? String(feed.tick).toUpperCase() : '';
    const chartLabel = !current
        ? 'No positions to chart yet'
        : series.fromBets
            ? `Probability of each outcome over ${range.label}, rebuilt from position history`
            : `Current pool share of each outcome over ${range.label}; no earlier position history available`;

    // A current split can draw flat while the one bulk position-history read
    // loads or when it has no earlier rows. Markets with no split keep G16.
    const hasChart = series.fromBets || Boolean(current) || (bets === null && betCount > 0);

    return (
        <OutcomeHero
            hasChart={hasChart}
            chips={chips}
            title={neutralizeControlText(feed?.label, { maxLength: 250 }) || '(untitled market)'}
            lead={current ? {
                value: pctText(current[leading]),
                label: leadingLabel,
                change: changeRounded === null ? null : {
                    text: `${arrow ? `${arrow} ` : ''}${Math.abs(changeRounded)} pts ${range.label}`,
                    direction,
                    label: `${leadingLabel} moved ${changeRounded} points over ${range.label}`,
                },
            } : null}
            leadMessage={live ? 'No positions yet' : 'No positions'}
            lines={series.lines.map((line) => ({ key: line.outcome, values: line.values }))}
            chartLabel={chartLabel}
            chartRegionLabel="Outcome probabilities over time"
            // Without a chart the split is drawn as the stacked bar a poll
            // shows, named by the legend, in place of the range chips.
            legend={current ? {
                label: 'Current probability by outcome',
                items: outcomes.map((_, i) => ({ key: i, label: labelOf(i), value: pctText(current[i]) })),
            } : null}
            bar={!hasChart && current ? {
                segments: outcomes.map((_, i) => ({ key: i, percent: current[i] })),
            } : null}
            foot={(
                <p className={outcomeStyles.footLine} data-bet-hero-stats="">
                    <span>
                        Total <strong>{formatWithThousands(trimAmountTail(total) || '0')}{tick ? ` ${tick}` : ''}</strong>
                        {' · '}<strong>{betCount}</strong> position{betCount === 1 ? '' : 's'}
                    </span>
                </p>
            )}
            ranges={BET_RANGES}
            rangeId={range.id}
            onRangeChange={setRangeId}
        />
    );
}
