// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The contract's blue card, laid out like Home's balance card (heroStack, chart
// behind, range chips along the foot). It shows the name, short address with
// copy, publisher and age, this wallet's calls, holdings, and calls over time.

import { useId, useMemo, useState } from 'react';
import { CopyButton, Icon } from '@xchain-wallet/core/ui';
import { truncateAddress } from '../../ui/AddressText.jsx';
import { BEHIND_CHART_FILL, BEHIND_CHART_STROKE, ChartRangeTabs, RANGES as CHART_RANGES, defaultRangeId } from '../components/PortfolioChart.jsx';
import portfolioChartStyles from '../components/PortfolioChart.module.css';
import homeTabsStyles from '../components/HomeTabs.module.css';
import { formatRelativeTime } from '../utils/dateTime.js';
import { formatWithThousands, trimAmountTail } from '../utils/amountFormat.js';
import { protocolCoinTickerFor } from '../../registry/nativeFee.js';
import { CALL_RANGE_WINDOWS, callSeries } from './contractDetailModel.js';
import betStyles from './BetFeedDetail.module.css';
import local from './ContractDetail.module.css';

/** The card's seven range chips (Home's, without YTD). */
const CALL_RANGES = CHART_RANGES.filter((r) => r.id in CALL_RANGE_WINDOWS);

function amountText(quantity) {
    const q = String(quantity ?? '');
    if (!/^-?\d+(\.\d+)?$/.test(q)) return q || '?';
    return formatWithThousands(trimAmountTail(q) || '0');
}

/**
 * Calls per slot drawn behind the card: Home's purple line and area, kept to
 * the lower half so the figures above stay readable.
 */
function CallLine({ values, label }) {
    if (!values) return null;
    const max = Math.max(1, ...values);
    const TOP = 48;
    const BOTTOM = 99;
    const n = values.length;
    const pts = values.map((v, i) => `${((i / Math.max(1, n - 1)) * 100).toFixed(2)},${(BOTTOM - (v / max) * (BOTTOM - TOP)).toFixed(2)}`);
    return (
        <svg className={betStyles.heroChartSvg} viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={label}>
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
 * @param {string} props.name                 the chain-recorded name and version, or "Unnamed contract"
 * @param {string} props.headingRest          the rest of the display label (" (C:BTC:42)"), read by screen readers
 * @param {string | null} props.contractAddress
 * @param {string} props.chainId
 * @param {string | null} props.owner
 * @param {boolean} props.isOwner
 * @param {any} props.publishedAt             the contract row's timestamp
 * @param {string | number} props.deployBlock
 * @param {Array<{ tick: string, quantity: any }> | null} props.holdings  null while loading
 * @param {boolean} [props.holdingsError]   the balance read failed; the Code tab says why
 * @param {number | null} props.callsTotal   the explorer's total, null when unknown
 * @param {any[] | null} props.chartRows      the first page of executions, null while loading
 * @param {number | null} props.myCalls       this wallet's calls on that page, null when its addresses are unknown
 */
export function ContractHero({
    name,
    headingRest,
    contractAddress,
    chainId,
    owner,
    isOwner,
    publishedAt,
    deployBlock,
    holdings,
    holdingsError = false,
    callsTotal,
    chartRows,
    myCalls,
}) {
    const captionId = useId();
    const chartPanelId = useId();
    const [rangeId, setRangeId] = useState(defaultRangeId());
    const range = CALL_RANGES.find((r) => r.id === rangeId) || CALL_RANGES[1];

    const series = useMemo(
        () => callSeries({ rows: chartRows || [], rangeId: range.id }),
        [chartRows, range.id],
    );

    // The chain's own coin leads the holdings when the contract holds it.
    const coin = protocolCoinTickerFor(chainId);
    const rows = Array.isArray(holdings) ? holdings : [];
    const lead = rows.find((r) => String(r.tick).toUpperCase() === coin) || rows[0] || null;
    const rest = rows.filter((r) => r !== lead);

    const age = formatRelativeTime(publishedAt);
    const loadedRows = Array.isArray(chartRows) ? chartRows.length : 0;
    const partial = callsTotal !== null && callsTotal > loadedRows;
    const chartLabel = series.values
        ? `${series.counted} call${series.counted === 1 ? '' : 's'} over ${range.label}${partial ? `, from the latest ${loadedRows}` : ''}`
        : chartRows === null ? 'Loading calls' : `No calls with a time to chart over ${range.label}`;

    return (
        <div className={`${homeTabsStyles.heroStack} ${homeTabsStyles.heroStackWithChart} ${betStyles.heroStack}`}>
            <section className={betStyles.hero} aria-labelledby={captionId}>
                <div className={local.heroTitleRow}>
                    <span className={local.heroIcon} aria-hidden="true"><Icon.ContractIcon /></span>
                    <h2 id={captionId} className={local.heroName} style={{ overflowWrap: 'anywhere' }}>
                        {name}
                        {headingRest ? <span className="sr-only">{headingRest}</span> : null}
                    </h2>
                </div>
                {contractAddress ? (
                    <p className={local.heroLine}>
                        <span className={local.heroAddress}>{truncateAddress(contractAddress)}</span>
                        <span className={local.heroCopy}>
                            <CopyButton value={contractAddress} label="Copy Contract Address" iconOnly />
                        </span>
                    </p>
                ) : null}
                <p className={local.heroLine}>
                    {owner ? (
                        <>
                            <span>Published by</span>
                            <strong className={local.heroAddress}>{isOwner ? 'you' : truncateAddress(String(owner))}</strong>
                        </>
                    ) : <span>Publisher unknown</span>}
                    <span aria-hidden="true">·</span>
                    <span>{age || `block ${deployBlock}`}</span>
                </p>
                {myCalls !== null ? (
                    <div className={betStyles.heroTop}>
                        <span className={`${betStyles.statusChip} ${local.youChip}`}>
                            <span className={local.youIcon} aria-hidden="true"><Icon.UserIcon /></span>
                            <span>
                                You: {myCalls} call{myCalls === 1 ? '' : 's'}
                                {partial ? ` in the latest ${loadedRows}` : ''}
                            </span>
                        </span>
                    </div>
                ) : null}
                <div className={betStyles.bigRow}>
                    {holdingsError ? (
                        <span className={`${betStyles.bigPct} ${betStyles.bigMessage}`}>Holdings unavailable</span>
                    ) : holdings === null ? (
                        <span className={`${betStyles.bigPct} ${betStyles.bigMessage}`}>Loading holdings…</span>
                    ) : lead ? (
                        <>
                            <span className={betStyles.bigPct}>{amountText(lead.quantity)}</span>
                            <span className={betStyles.bigLabel}>{String(lead.tick)} held</span>
                        </>
                    ) : (
                        <span className={`${betStyles.bigPct} ${betStyles.bigMessage}`}>Holds no tokens</span>
                    )}
                </div>
                <p className={`${betStyles.heroStats} ${local.heroStats}`}>
                    <span className={local.heroOthers}>
                        {rest.length > 0 ? `+ ${amountText(rest[0].quantity)} ${rest[0].tick}${rest.length > 1 ? ` and ${rest.length - 1} more` : ''}` : ''}
                    </span>
                    <span className={local.heroTotal}>
                        {callsTotal !== null
                            ? `${formatWithThousands(String(callsTotal))} call${callsTotal === 1 ? '' : 's'} total`
                            : chartRows !== null ? `${loadedRows} call${loadedRows === 1 ? '' : 's'} loaded` : ''}
                    </span>
                </p>
            </section>
            <section
                className={`${portfolioChartStyles.wrap} ${portfolioChartStyles.behind}`}
                data-chart-behind="true"
                aria-label="Calls over time"
            >
                <div id={chartPanelId} role="tabpanel" aria-labelledby={`${chartPanelId}-tab-${range.id}`}>
                    <div className={portfolioChartStyles.slot}>
                        <div className={portfolioChartStyles.chart}>
                            <CallLine values={series.values} label={chartLabel} />
                        </div>
                    </div>
                </div>
                <ChartRangeTabs
                    panelId={chartPanelId}
                    ranges={CALL_RANGES}
                    rangeId={range.id}
                    onSelect={setRangeId}
                />
            </section>
        </div>
    );
}
