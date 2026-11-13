// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The oracle's blue card, laid out like the bet market card and Home's balance
// card: the chart behind it, range chips along its foot, and the address's
// market history, name, resolved markets and running, fee, expired and earned figures.

import { useId, useMemo, useState } from 'react';
import { BEHIND_CHART_FILL, BEHIND_CHART_STROKE, ChartRangeTabs, RANGES as CHART_RANGES, defaultRangeId } from '../components/PortfolioChart.jsx';
import portfolioChartStyles from '../components/PortfolioChart.module.css';
import heroStyles from '../components/TotalBalanceHero.module.css';
import homeTabsStyles from '../components/HomeTabs.module.css';
import { neutralizeControlText } from '../utils/textHardening.js';
import { formatWithThousands, trimAmountTail } from '../utils/amountFormat.js';
import { ORACLE_RANGE_WINDOWS, activeForText, feeRangeText, rangeCountKind, resolvedSeries } from './oracleRecordSeries.js';
import betLocal from './BetFeedDetail.module.css';
import local from './OracleRecord.module.css';

/** The card's five range chips (1M, 3M, 6M, 1Y, All). */
const ORACLE_RANGES = CHART_RANGES.filter((r) => r.id in ORACLE_RANGE_WINDOWS);

/** The first 8 and last 6 characters of an address. */
export function shortAddress(address) {
    const a = String(address || '');
    return a.length > 18 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a;
}

function num(v) {
    const n = Number(v || 0);
    return Number.isFinite(n) ? n : 0;
}

/** The cumulative line behind the card, padded so a flat record is not a cliff. */
function ResolvedLine({ values, label }) {
    if (!values.length) return null;
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    // The plot spans the whole card behind the figures, on the Sparkline's
    // own 1 to 99 band, as Home's chart is drawn. A flat record lies between
    // the big figure and the stats line, so its area still fills the lower card.
    const TOP = 1;
    const BOTTOM = 99;
    const y = (v) => (hi === lo ? 62 : BOTTOM - ((v - lo) / (hi - lo)) * (BOTTOM - TOP));
    const pts = values.map((v, i) => `${((i / Math.max(1, values.length - 1)) * 100).toFixed(2)},${y(v).toFixed(2)}`);
    return (
        <svg className={betLocal.heroChartSvg} viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={label}>
            <polygon fill={BEHIND_CHART_FILL} stroke="none" points={`0,100 ${pts.join(' ')} 100,100`} />
            <polyline
                fill="none"
                stroke={BEHIND_CHART_STROKE}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                points={pts.join(' ')}
            />
        </svg>
    );
}

/**
 * @param {object} props
 * @param {string} props.address          the oracle address
 * @param {string | null} [props.name]    a saved contact name for it, if any
 * @param {any} props.record              the oracle record
 * @param {any[] | null} props.markets    its markets (one page), null while loading
 */
export function OracleRecordHero({ address, name, record, markets }) {
    const captionId = useId();
    const chartPanelId = useId();
    const initial = defaultRangeId();
    const [rangeId, setRangeId] = useState(initial in ORACLE_RANGE_WINDOWS ? initial : 'all');
    const range = ORACLE_RANGES.find((r) => r.id === rangeId) || ORACLE_RANGES[ORACLE_RANGES.length - 1];

    const series = useMemo(
        () => resolvedSeries({ record, markets: markets || [], rangeId: range.id }),
        [record, markets, range.id],
    );
    const activeFor = markets ? activeForText(record, markets) : null;
    const feeText = markets ? feeRangeText(markets) : null;
    const running = num(record?.active_feeds);
    const expired = num(record?.counts?.expired);
    const fees = Array.isArray(record?.fees_earned) ? record.fees_earned : [];

    // The pill shows only a count the loaded page can stand behind: never on
    // All, never with no dated rows, and as "N+" when the range reaches past
    // the oldest loaded market.
    const inRange = series.inRange;
    const pillKind = rangeCountKind({ rangeId: range.id, series, record, markets });
    const floor = pillKind === 'floor' ? '+' : '';
    const pillClass = inRange > 0 ? heroStyles.changePositive : heroStyles.changeNeutral;
    const pillText = inRange > 0 || floor ? `▲ ${inRange}${floor} in ${range.label}` : `None in ${range.label}`;
    const pillLabel = floor
        ? `At least ${inRange} resolved over ${range.label}`
        : `${inRange} resolved over ${range.label}`;

    const title = neutralizeControlText(name, { maxLength: 80 }) || shortAddress(address);
    const chipText = activeFor
        ? `Active for ${activeFor}`
        : running > 0 ? `${running} market${running === 1 ? '' : 's'} running` : 'No markets running';
    const chartLabel = series.dated > 0
        ? `Markets resolved over ${range.label}, each dated at its betting close`
        : `${series.total} markets resolved; no settled market in the loaded page to date`;

    return (
        <div className={`${homeTabsStyles.heroStack} ${homeTabsStyles.heroStackWithChart} ${betLocal.heroStack} ${local.heroStack}`}>
            <section className={betLocal.hero} aria-labelledby={captionId}>
                <div className={betLocal.heroTop}>
                    <span className={betLocal.statusChip}>
                        <span className={`${betLocal.statusDot} ${running > 0 ? betLocal.statusDotOpen : betLocal.statusDotDone}`} aria-hidden="true" />
                        <span>{chipText}</span>
                    </span>
                </div>
                <h2 id={captionId} className={betLocal.question}>{title}</h2>
                {name ? <p className={local.heroAddress}>{shortAddress(address)}</p> : null}
                <div className={betLocal.bigRow}>
                    <span className={betLocal.bigPct}>{formatWithThousands(String(series.total))}</span>
                    <span className={betLocal.bigLabel}>market{series.total === 1 ? '' : 's'} resolved</span>
                    {pillKind !== 'hide' ? (
                        <span className={`${pillClass} ${betLocal.changePill}`} aria-label={pillLabel}>
                            {pillText}
                        </span>
                    ) : null}
                </div>
                <p className={betLocal.heroStats}>
                    <span><strong>{running}</strong> running</span>
                    {feeText ? <span><strong>{feeText}</strong> fee</span> : null}
                    <span><strong>{expired}</strong> left to expire</span>
                    {fees.length === 1 ? (
                        <span>Earned <strong>{`${formatWithThousands(trimAmountTail(String(fees[0].amount)) || '0')} ${String(fees[0].tick || '').toUpperCase()}`}</strong></span>
                    ) : fees.length > 1 ? (
                        <span>Earned fees in <strong>{`${fees.length} tokens`}</strong></span>
                    ) : null}
                </p>
            </section>
            <section
                className={`${portfolioChartStyles.wrap} ${portfolioChartStyles.behind}`}
                data-chart-behind="true"
                aria-label="Markets resolved over time"
            >
                <div id={chartPanelId} role="tabpanel" aria-labelledby={`${chartPanelId}-tab-${range.id}`}>
                    <div className={portfolioChartStyles.slot}>
                        <div className={portfolioChartStyles.chart}>
                            <ResolvedLine values={series.values} label={chartLabel} />
                        </div>
                    </div>
                </div>
                <ChartRangeTabs
                    panelId={chartPanelId}
                    ranges={ORACLE_RANGES}
                    rangeId={range.id}
                    onSelect={setRangeId}
                />
            </section>
        </div>
    );
}
