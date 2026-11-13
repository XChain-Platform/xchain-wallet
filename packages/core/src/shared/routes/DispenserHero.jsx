// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Preview (Dispenser Detail redesign, 2026-11-12): the blue card at the top of
// a dispenser's page, built like Home's balance card: the offer, the stock
// gauge and the counts on top, the fills chart drawn behind them, and the
// range chips along the card's foot. Props only, no reads of its own: the
// page hands it the fills it already loaded.

import { useId, useMemo, useState } from 'react';
import { Icon } from '@xchain-wallet/core/ui';
import { BEHIND_CHART_FILL, BEHIND_CHART_STROKE, ChartRangeTabs } from '../components/PortfolioChart.jsx';
import portfolioChartStyles from '../components/PortfolioChart.module.css';
import heroStyles from '../components/TotalBalanceHero.module.css';
import homeTabsStyles from '../components/HomeTabs.module.css';
import { TickerIcon } from '../components/TickerIcon.jsx';
import local from './DispenserHero.module.css';

// Window length in seconds per range; All runs from the first fill to now.
export const FILL_RANGES = [
    { id: '1d', label: '1D', seconds: 86_400 },
    { id: '1w', label: '1W', seconds: 7 * 86_400 },
    { id: '1m', label: '1M', seconds: 30 * 86_400 },
    { id: '3m', label: '3M', seconds: 90 * 86_400 },
    { id: 'all', label: 'All', seconds: null },
];

const BUCKETS = 24;

/**
 * Fill counts per equal time bucket over one range window.
 *
 * @param {number[]} times     fill times in Unix seconds (ms tolerated)
 * @param {{ seconds: number | null }} range
 * @param {number} nowSec
 * @returns {number[]}         BUCKETS counts, oldest first
 */
export function fillBuckets(times, range, nowSec) {
    const secs = (Array.isArray(times) ? times : [])
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v) && v > 0)
        .map((v) => (v > 1e12 ? Math.floor(v / 1000) : v));
    const counts = new Array(BUCKETS).fill(0);
    if (secs.length === 0) return counts;
    const earliest = Math.min(...secs);
    const span = range.seconds ?? Math.max(86_400, nowSec - earliest);
    const start = nowSec - span;
    for (const s of secs) {
        if (s < start || s > nowSec) continue;
        const i = Math.min(BUCKETS - 1, Math.floor(((s - start) / span) * BUCKETS));
        counts[i] += 1;
    }
    return counts;
}

function FillBars({ counts, label }) {
    const max = Math.max(0, ...counts);
    // The svg is a fixed-height band above the range chips (see .chartSvg),
    // and the card's text keeps clear of it, so no bar ever runs under a figure.
    const TOP = 4;
    const BOTTOM = 100;
    const slot = 100 / counts.length;
    return (
        <svg className={local.chartSvg} viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={label}>
            {max > 0 ? counts.map((n, i) => {
                if (n <= 0) return null;
                const h = Math.max(2, (n / max) * (BOTTOM - TOP));
                return (
                    <rect
                        key={i}
                        x={(i * slot + slot * 0.18).toFixed(2)}
                        y={(BOTTOM - h).toFixed(2)}
                        width={(slot * 0.64).toFixed(2)}
                        height={h.toFixed(2)}
                        fill={BEHIND_CHART_STROKE}
                        fillOpacity="0.75"
                        stroke={BEHIND_CHART_FILL}
                        strokeWidth="0.3"
                        vectorEffect="non-scaling-stroke"
                    />
                );
            }) : null}
        </svg>
    );
}

/**
 * @param {object} props
 * @param {string} props.chainId
 * @param {string} props.tick                 the token the dispenser gives
 * @param {string} props.statusText
 * @param {'open' | 'closing' | 'done'} props.statusTone
 * @param {string} props.headline             e.g. "20 BANANE for 0.0004 BTC"
 * @param {string} [props.subLeft]
 * @param {string} [props.subRight]
 * @param {{ left: string, right?: string, fraction: number | null } | null} [props.gauge]
 * @param {number[]} props.fillTimes          valid fill times (Unix seconds)
 * @param {number | null} props.fillsSoFar
 * @param {boolean} props.fillsLoaded
 * @param {() => void} [props.onShare]
 * @param {string} [props.shareLabel]
 */
export function DispenserHero({
    chainId, tick, statusText, statusTone, headline, subLeft, subRight, gauge,
    fillTimes, fillsSoFar, fillsLoaded, onShare, shareLabel = 'Copy dispenser address',
}) {
    const captionId = useId();
    const chartPanelId = `${useId()}-fills-chart`;
    const [rangeId, setRangeId] = useState('all');
    const range = FILL_RANGES.find((r) => r.id === rangeId) || FILL_RANGES[FILL_RANGES.length - 1];
    const counts = useMemo(
        () => fillBuckets(fillTimes, range, Math.floor(Date.now() / 1000)),
        [fillTimes, range],
    );
    const inRange = counts.reduce((a, b) => a + b, 0);
    const tone = statusTone === 'open' ? local.dotOpen : statusTone === 'closing' ? local.dotClosing : local.dotDone;
    const fraction = gauge && Number.isFinite(gauge.fraction) ? Math.max(0, Math.min(1, gauge.fraction)) : null;
    const chartLabel = !fillsLoaded
        ? 'Loading fills'
        : inRange === 0
            ? `No fills over ${range.label}`
            : `${inRange} fill${inRange === 1 ? '' : 's'} over ${range.label}`;

    return (
        <div className={`${homeTabsStyles.heroStack} ${homeTabsStyles.heroStackWithChart} ${local.heroStack}`}>
            <section className={local.hero} aria-labelledby={captionId}>
                <div className={local.top}>
                    <span className={local.token}>
                        <TickerIcon chainId={chainId} tick={tick} size={28} />
                        <span className={local.tokenName}>{tick || '-'}</span>
                    </span>
                    <span className={local.statusChip}>
                        <span className={`${local.dot} ${tone}`} aria-hidden="true" />
                        <span>{statusText}</span>
                    </span>
                    {onShare ? (
                        <button
                            type="button"
                            className={`${heroStyles.eye} ${local.share}`}
                            onClick={onShare}
                            aria-label={shareLabel}
                            title={shareLabel}
                        >
                            <Icon.CopyIcon />
                        </button>
                    ) : null}
                </div>
                <h2 id={captionId} className={local.headline}>{headline}</h2>
                {subLeft || subRight ? (
                    <p className={local.split}>
                        <span>{subLeft}</span>
                        <span>{subRight}</span>
                    </p>
                ) : null}
                {gauge ? (
                    <div className={local.gauge}>
                        <p className={`${local.split} ${local.strong}`}>
                            <span>{gauge.left}</span>
                            <span>{gauge.right}</span>
                        </p>
                        {fraction != null ? (
                            <div
                                className={local.track}
                                role="meter"
                                aria-label="Stock left"
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={Math.round(fraction * 100)}
                            >
                                <span className={local.fill} style={{ width: `${(fraction * 100).toFixed(1)}%` }} />
                            </div>
                        ) : null}
                    </div>
                ) : null}
                <p className={`${local.split} ${local.chartCaption}`}>
                    <span>Fills over time</span>
                    <span>{fillsSoFar != null ? `${fillsSoFar.toLocaleString('en-US')} so far` : ''}</span>
                </p>
            </section>
            <section
                className={`${portfolioChartStyles.wrap} ${portfolioChartStyles.behind}`}
                data-chart-behind="true"
                aria-label="Fills over time"
            >
                <div id={chartPanelId} role="tabpanel" aria-labelledby={`${chartPanelId}-tab-${range.id}`}>
                    <div className={portfolioChartStyles.slot}>
                        <div className={portfolioChartStyles.chart}>
                            <FillBars counts={counts} label={chartLabel} />
                        </div>
                    </div>
                </div>
                <ChartRangeTabs
                    panelId={chartPanelId}
                    ranges={FILL_RANGES}
                    rangeId={range.id}
                    onSelect={setRangeId}
                />
            </section>
        </div>
    );
}
