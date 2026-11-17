// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The one page layout the bet market and the governance poll share (Layout 1,
// "Leading Line Hero", ruled 2026-11-13): a Home-style blue hero with the
// status chips, the question, the leading share and its move, a chart drawn
// behind, the standing foot and the range chips; then the shared tab strip
// (Bet or Vote, or Result once closed | Activity | Details) and the chosen
// tab's panel. The pieces below draw every part of that page, and both routes
// feed them, so the two pages cannot drift apart. Every word on screen comes
// in as a prop from the page.
//
// The blue hero is only for an item with a real history to chart (G10). An
// item without one (every governance poll, whose ballots keep no history,
// and a bet market with no bet rows) opens with the outlined identity card
// instead (G16): no blue fill, no chart and no range chips. The card still
// carries the hero's content in the hero's order (the chips, the question,
// the leading share or the line said in its place, the legend, the stacked
// split bar and the standing foot), so a poll and a bet read alike whichever
// surface they open on.

import { useId } from 'react';
import { Button, Checkbox, StatusMessage, Tabs } from '@xchain-wallet/core/ui';
import { ActionList } from '../ActionList.jsx';
import { ChartRangeTabs } from '../PortfolioChart.jsx';
import portfolioChartStyles from '../PortfolioChart.module.css';
import homeTabsStyles from '../HomeTabs.module.css';
import heroStyles from '../TotalBalanceHero.module.css';
import { outcomeSurfaceColor } from './outcomeColors.js';
import styles from './OutcomeDetail.module.css';

const outcomeHeroColor = (key) => `color-mix(in srgb, ${outcomeSurfaceColor(key)} 75%, var(--xc-hero-text))`;

/**
 * The lines drawn behind the hero, one per outcome, on a fixed probability
 * scale. The labelled and halfway guides match the Home hero grid.
 *
 * @param {object} props
 * @param {Array<{ key: number, values: Array<number | null> }>} props.lines
 * @param {string} props.label     what the chart shows, for assistive tech
 */
function OutcomeLines({ lines, label }) {
    const values = lines.flatMap((l) => l.values).filter((v) => typeof v === 'number' && Number.isFinite(v));
    if (values.length === 0) return null;
    const TOP = 4;
    const BOTTOM = 96;
    const scale = [100, 87.5, 75, 62.5, 50, 37.5, 25, 12.5, 0].map((value, index) => ({
        value,
        y: TOP + ((BOTTOM - TOP) * index) / 8,
        labelled: index % 2 === 0,
    }));
    const y = (v) => BOTTOM - (Math.max(0, Math.min(100, v)) / 100) * (BOTTOM - TOP);
    const pointsOf = (vals) => {
        const n = vals.length;
        const pts = [];
        vals.forEach((v, i) => {
            if (typeof v !== 'number' || !Number.isFinite(v)) return;
            pts.push(`${((i / Math.max(1, n - 1)) * 100).toFixed(2)},${y(v).toFixed(2)}`);
        });
        return pts;
    };
    return (
        <div className={styles.probabilityChart} data-probability-chart="0-100">
            <svg className={styles.chartSvg} viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={label}>
                {lines.map((line) => {
                    const pts = pointsOf(line.values);
                    if (pts.length === 0) return null;
                    const color = outcomeHeroColor(line.key);
                    return (
                        <polyline
                            key={line.key}
                            data-outcome-line={line.key}
                            fill="none"
                            stroke={color}
                            strokeWidth="2"
                            strokeLinejoin="round"
                            strokeLinecap="round"
                            vectorEffect="non-scaling-stroke"
                            points={pts.length === 1 ? `${pts[0]} 100,${pts[0].split(',')[1]}` : pts.join(' ')}
                        />
                    );
                })}
                {scale.map((mark) => (
                    <line
                        key={mark.value}
                        className={`${styles.chartGuide}${mark.labelled ? '' : ` ${styles.chartGuideHalfway}`}`}
                        data-probability-guide={mark.value}
                        data-probability-guide-kind={mark.labelled ? 'labelled' : 'halfway'}
                        x1="0"
                        x2="100"
                        y1={mark.y}
                        y2={mark.y}
                        vectorEffect="non-scaling-stroke"
                    />
                ))}
            </svg>
            <div className={styles.probabilityScale} aria-hidden="true">
                {scale.filter((mark) => mark.labelled).map((mark) => (
                    <span key={mark.value} data-probability-scale={mark.value} style={{ top: `${mark.y}%` }}>
                        {mark.value}%
                    </span>
                ))}
            </div>
        </div>
    );
}

const DOT_TONES = { open: styles.dotOpen, closed: styles.dotClosed, done: styles.dotDone };
const CHIP_TONES = { ok: styles.chipOk, bad: styles.chipBad };
const CHANGE_PILLS = {
    positive: heroStyles.changePositive,
    negative: heroStyles.changeNegative,
    neutral: heroStyles.changeNeutral,
    // A closed item's share no longer moves: a plain dark "Final" pill.
    final: styles.finalPill,
};

/** The status pills at the top of the hero or the identity card. */
function OutcomeChips({ chips }) {
    if (!chips.length) return null;
    return (
        <div className={styles.chips}>
            {chips.map((chip) => (
                <span key={chip.key} className={`${styles.chip} ${chip.tone ? CHIP_TONES[chip.tone] || '' : ''}`} data-outcome-chip={chip.key}>
                    {chip.dot ? <span className={`${styles.chipDot} ${DOT_TONES[chip.dot] || ''}`} aria-hidden="true" /> : null}
                    {chip.icon ? <span className={styles.chipIcon} aria-hidden="true">{chip.icon}</span> : null}
                    <span>{chip.text}</span>
                </span>
            ))}
        </div>
    );
}

/**
 * The leading share, its label and its move, or the line said in its place
 * ("No bets yet", "Counted at close") when there is no standing to show.
 */
function OutcomeLead({ lead, leadMessage }) {
    if (!lead && !leadMessage) return null;
    return (
        <div className={styles.bigRow} data-outcome-lead="">
            {lead ? (
                <>
                    <span className={styles.bigPct}>{lead.value}</span>
                    <span className={styles.bigLabel}>{lead.label}</span>
                    {lead.change ? (
                        <span className={`${CHANGE_PILLS[lead.change.direction] || heroStyles.changeNeutral} ${styles.changePill}`} aria-label={lead.change.label}>
                            {lead.change.text}
                        </span>
                    ) : null}
                </>
            ) : (
                <span className={`${styles.bigPct} ${styles.bigMessage}`}>{leadMessage}</span>
            )}
        </div>
    );
}

/** One swatch, name and share per outcome; the stacked bar's text alternative. */
function OutcomeLegend({ legend, colorOf }) {
    if (!legend || !legend.items.length) return null;
    return (
        <ul className={styles.legend} aria-label={legend.label}>
            {legend.items.map((item) => (
                <li key={item.key} className={styles.legendItem}>
                    <span
                        className={styles.legendSwatch}
                        data-outcome-legend={item.key}
                        data-outcome-color={colorOf(item.key)}
                        style={{ background: colorOf(item.key) }}
                        aria-hidden="true"
                    />
                    <span className={styles.legendText}>{item.label}</span>
                    <span className={styles.legendValue}>{item.value}</span>
                </li>
            ))}
        </ul>
    );
}

/**
 * The split as one stacked bar, a segment per outcome in its colour. It is
 * decorative: the legend beside it names every share.
 */
function OutcomeBar({ bar, colorOf }) {
    const segments = (bar?.segments || []).filter((s) => Number.isFinite(s.percent) && s.percent > 0);
    if (!segments.length) return null;
    return (
        <span className={styles.bar} data-outcome-bar="" aria-hidden="true">
            {segments.map((segment) => (
                <span
                    key={segment.key}
                    className={styles.barSegment}
                    data-outcome-segment={segment.key}
                    style={{ width: `${Math.max(0, Math.min(100, segment.percent))}%`, background: colorOf(segment.key) }}
                />
            ))}
        </span>
    );
}

/**
 * The blue hero, laid out like Home's balance card, when the item has a
 * history to chart; otherwise the outlined identity card (G16), which keeps
 * the same content (status pills, the question, the lead, the legend and
 * stacked bar, the foot) on the white card surface and draws no chart or
 * range chips.
 *
 * @param {object} props
 * @param {boolean} [props.hasChart]                       false for an item with no history to draw
 * @param {Array<{ key: string, text: string, dot?: 'open' | 'closed' | 'done', tone?: 'ok' | 'bad', icon?: import('react').ReactNode }>} props.chips
 * @param {import('react').ReactNode} props.title         the question
 * @param {{ value: string, label: string, change?: { text: string, direction: 'positive' | 'negative' | 'neutral' | 'final', label: string } | null } | null} props.lead
 * @param {string} props.leadMessage                       shown in place of the share when there is none
 * @param {Array<{ key: number, values: Array<number | null> }>} props.lines
 * @param {string} props.chartLabel
 * @param {string} props.chartRegionLabel
 * @param {{ label: string, items: Array<{ key: number, label: string, value: string }> } | null} [props.legend]
 * @param {{ segments: Array<{ key: number, percent: number }> } | null} [props.bar]   the split as one stacked bar
 * @param {import('react').ReactNode} props.foot           the standing line at the card's foot
 * @param {Array<{ id: string, label: string }>} props.ranges
 * @param {string} props.rangeId
 * @param {(id: string) => void} props.onRangeChange
 */
export function OutcomeHero({
    hasChart = true,
    chips = [],
    title,
    lead = null,
    leadMessage = '',
    lines = [],
    chartLabel = '',
    chartRegionLabel = '',
    legend = null,
    bar = null,
    foot = null,
    ranges = [],
    rangeId,
    onRangeChange,
}) {
    const titleId = useId();
    const chartPanelId = useId();
    if (!hasChart) {
        // The white card takes the hues darkened for a light surface.
        return (
            <section className={styles.identity} aria-labelledby={titleId} data-outcome-hero="" data-outcome-identity="">
                <OutcomeChips chips={chips} />
                <h2 id={titleId} className={styles.identityTitle}>{title}</h2>
                <OutcomeLead lead={lead} leadMessage={leadMessage} />
                <OutcomeLegend legend={legend} colorOf={outcomeSurfaceColor} />
                <OutcomeBar bar={bar} colorOf={outcomeSurfaceColor} />
                {foot ? <div className={styles.identityLine}>{foot}</div> : null}
            </section>
        );
    }
    return (
        <div className={`${homeTabsStyles.heroStack} ${homeTabsStyles.heroStackWithChart} ${styles.heroStack}`} data-outcome-hero="" data-outcome-chart-hero="">
            <section className={styles.hero} aria-labelledby={titleId}>
                <OutcomeChips chips={chips} />
                <h2 id={titleId} className={styles.question}>{title}</h2>
                <OutcomeLead lead={lead} leadMessage={leadMessage} />
                <OutcomeLegend legend={legend} colorOf={outcomeHeroColor} />
                <OutcomeBar bar={bar} colorOf={outcomeHeroColor} />
                {foot ? <div className={styles.foot}>{foot}</div> : null}
            </section>
            <section
                className={`${portfolioChartStyles.wrap} ${portfolioChartStyles.behind}`}
                data-chart-behind="true"
                aria-label={chartRegionLabel}
            >
                <div id={chartPanelId} role="tabpanel" aria-labelledby={`${chartPanelId}-tab-${rangeId}`}>
                    <div className={portfolioChartStyles.slot}>
                        <div className={portfolioChartStyles.chart}>
                            <OutcomeLines lines={lines} label={chartLabel} />
                        </div>
                    </div>
                </div>
                <ChartRangeTabs panelId={chartPanelId} ranges={ranges} rangeId={rangeId} onSelect={onRangeChange} />
            </section>
        </div>
    );
}

/**
 * The page under the hero: the shared tab strip and the chosen tab's panel.
 * A held tab the item no longer offers (Bet once the market closes) reads
 * as the first tab.
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.hero
 * @param {Array<{ id: string, label: string, icon: import('react').ReactNode }>} props.tabs
 * @param {string | null} props.tab   null, or a tab the item no longer offers, opens the first tab
 * @param {(id: string) => void} props.onTabChange
 * @param {string} props.tabsLabel
 * @param {Record<string, import('react').ReactNode>} props.panels
 */
export function OutcomeDetailLayout({ hero, tabs, tab, onTabChange, tabsLabel, panels }) {
    const tabsId = useId();
    const active = tabs.some((item) => item.id === tab) ? tab : tabs[0]?.id;
    // Its own 8px column (G13): the page's 16px section gap would otherwise
    // space the hero, the tab row and the panel.
    return (
        <div className={styles.stack} data-outcome-stack="">
            {hero}
            <Tabs
                id={tabsId}
                items={tabs}
                value={active}
                onChange={onTabChange}
                panelId={`${tabsId}-panel`}
                aria-label={tabsLabel}
                className={styles.tabs}
            />
            <div
                id={`${tabsId}-panel`}
                role="tabpanel"
                aria-labelledby={`${tabsId}-tab-${active}`}
                className={styles.panel}
                data-outcome-panel={active}
            >
                {panels[active] ?? null}
            </div>
        </div>
    );
}

/**
 * The Bet or Vote tab: the pick, then one green full-width button that opens
 * the item's own Form Standard step with the pick carried.
 *
 * `single` rows are toggle buttons named by the outcome's own label (the
 * amount and share describe it), `multi` rows are checkboxes for an approval
 * ballot, and `custom` draws only the children (a split-weight ballot).
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.icon
 * @param {string} props.title
 * @param {string} [props.aside]       the short line at the end of the pick's head ("Pick a side")
 * @param {import('react').ReactNode} [props.help]
 * @param {string} [props.groupLabel]
 * @param {'single' | 'multi' | 'custom'} props.mode
 * @param {Array<{ key: number, label: string, sub?: string | null, share?: string | null, selected: boolean, disabled?: boolean, onSelect: () => void }>} [props.options]
 * @param {import('react').ReactNode} [props.children]   under the rows, inside the pick
 * @param {import('react').ReactNode} [props.status]     the pick's error, just above the button
 * @param {string} props.actionLabel
 * @param {import('react').ReactNode} props.actionIcon
 * @param {boolean} [props.actionDisabled]
 * @param {() => void} props.onAction
 * @param {import('react').ReactNode} [props.before]     notes between the pick and the status
 * @param {import('react').ReactNode} [props.after]      under the button
 */
export function OutcomePick({
    icon,
    title,
    aside,
    help,
    groupLabel,
    mode,
    options = [],
    children,
    status,
    actionLabel,
    actionIcon,
    actionDisabled = false,
    onAction,
    before,
    after,
    ...rest
}) {
    const headId = useId();
    return (
        <div className={styles.action} {...rest}>
            <section className={styles.pick} aria-labelledby={headId}>
                <div className={styles.pickHead}>
                    <span className={styles.pickHeadIcon} aria-hidden="true">{icon}</span>
                    <span id={headId} className={styles.pickTitle}>{title}</span>
                    {help}
                    {aside ? <span className={styles.pickNote}>{aside}</span> : null}
                </div>
                {mode !== 'custom' && options.length ? (
                    <div
                        role="group"
                        {...(groupLabel ? { 'aria-label': groupLabel } : { 'aria-labelledby': headId })}
                        className={styles.pickList}
                        data-outcome-pick={mode}
                    >
                        {options.map((option) => {
                            if (mode === 'multi') {
                                return (
                                    <Checkbox
                                        key={option.key}
                                        className={`${styles.pickCheck} ${option.selected ? styles.pickOn : ''}`}
                                        label={option.label}
                                        description={[option.sub, option.share].filter(Boolean).join(' · ') || undefined}
                                        checked={option.selected}
                                        disabled={option.disabled}
                                        onChange={option.onSelect}
                                    />
                                );
                            }
                            // The row's text stays the outcome's own label, so
                            // its name is that label; the amount and share are
                            // drawn from data attributes and given to
                            // assistive tech as the row's description.
                            const detail = [option.sub, option.share].filter(Boolean).join(', ');
                            return (
                                <Button
                                    key={option.key}
                                    type="button"
                                    variant="secondary"
                                    className={`${styles.pickRow} ${option.selected ? styles.pickOn : ''}`}
                                    aria-label={option.label}
                                    aria-pressed={option.selected}
                                    aria-description={detail || undefined}
                                    disabled={option.disabled}
                                    onClick={option.onSelect}
                                    data-outcome-option={option.key}
                                >
                                    <span className={styles.pickMark} aria-hidden="true" />
                                    <span className={styles.pickText}>
                                        <span className={styles.pickName}>{option.label}</span>
                                        {option.sub ? <span className={styles.pickSub} data-sub={option.sub} aria-hidden="true" /> : null}
                                    </span>
                                    {option.share ? <span className={styles.pickShare} data-share={option.share} aria-hidden="true" /> : null}
                                </Button>
                            );
                        })}
                    </div>
                ) : null}
                {children}
            </section>
            {before}
            {status}
            <Button
                type="button"
                variant="success"
                block
                className={styles.go}
                icon={actionIcon}
                disabled={actionDisabled}
                onClick={onAction}
            >
                {actionLabel}
            </Button>
            {after}
        </div>
    );
}

/**
 * The Result tab of a closed item: its verdict, then the final results list
 * (the winner marked) and what this wallet did, as "You voted ..." or
 * "You bet ...".
 *
 * @param {object} props
 * @param {{ title: string, body?: import('react').ReactNode, tone: 'success' | 'error' | 'info', testId?: string, action?: import('react').ReactNode } | null} props.verdict
 * @param {import('react').ReactNode} props.icon
 * @param {string} props.title
 * @param {string} [props.aside]                         the short line at the end of the head ("47 voters")
 * @param {Array<{ key: number, label: string, sub?: string | null, percent: number | null, value: string, winner?: boolean }>} props.rows
 * @param {string} [props.winnerLabel]
 * @param {import('react').ReactNode} [props.empty]       shown in place of the rows when there are none
 * @param {import('react').ReactNode} [props.footer]      the wallet's own lines
 * @param {import('react').ReactNode} [props.children]    above the verdict (a settlement card)
 */
export function OutcomeResult({ verdict, icon, title, aside, rows, winnerLabel, empty, footer, children }) {
    const headId = useId();
    return (
        <>
            {children}
            {verdict ? (
                <StatusMessage variant={verdict.tone} role="note" lead={verdict.title} testId={verdict.testId}>
                    {verdict.body ?? null}
                </StatusMessage>
            ) : null}
            {verdict?.action ?? null}
            <section className={styles.results} aria-labelledby={headId} data-outcome-results="">
                <div className={styles.pickHead}>
                    <span className={styles.pickHeadIcon} aria-hidden="true">{icon}</span>
                    <span id={headId} className={styles.pickTitle}>{title}</span>
                    {aside ? <span className={styles.pickNote}>{aside}</span> : null}
                </div>
                {rows.length ? (
                    <ul className={styles.resultList} aria-labelledby={headId}>
                        {rows.map((row) => (
                            <li key={row.key} className={styles.resultRow} data-outcome-winner={row.winner ? '' : undefined}>
                                <span className={styles.resultTop}>
                                    <span className={styles.resultName}>{row.label}</span>
                                    {row.winner && winnerLabel ? <span className={styles.winnerPill}>{winnerLabel}</span> : null}
                                    <span className={styles.resultValue}>{row.value}</span>
                                </span>
                                {row.sub ? <span className={styles.resultSub}>{row.sub}</span> : null}
                                {row.percent !== null && Number.isFinite(row.percent) ? (
                                    <span className={styles.track} aria-hidden="true">
                                        <span className={`${styles.trackFill} ${row.winner ? '' : styles.trackFillLow}`} style={{ width: `${Math.max(0, Math.min(100, row.percent))}%` }} />
                                    </span>
                                ) : null}
                            </li>
                        ))}
                    </ul>
                ) : empty}
                {footer ? <div className={styles.resultFooter}>{footer}</div> : null}
            </section>
        </>
    );
}

/**
 * The owner's Actions tab (G101, G102): the notes that time the owner's job,
 * then every action as one row of the shared ActionList (icon square,
 * title, one-line description, chevron; a destructive row in the danger
 * tone), and under it whichever action's form is open. The page's main
 * owner action leads the list as its first row; it opens a form, so it is a
 * row like the rest rather than a separate button. Shown only to the item's
 * owner; the page decides that and which actions are legal, and passes only
 * those.
 *
 * @param {object} props
 * @param {string} props.label                           the action list's name
 * @param {Array<import('../ActionList.jsx').ActionListItemProps & { id: string, open?: boolean }>} [props.items]
 *   the rows in order; `open` marks the row whose form shows below (aria-expanded)
 * @param {import('react').ReactNode} [props.notes]      a WarningCard of timing lines, first
 * @param {import('react').ReactNode} [props.status]     the action's error, above the list
 * @param {import('react').ReactNode} [props.children]   the open action's form
 */
export function OutcomeOwnerActions({
    label,
    items = [],
    notes,
    status,
    children,
    ...rest
}) {
    const rows = items.map(({ open, ...item }) => (
        open === undefined ? item : { ...item, 'aria-expanded': open }
    ));
    return (
        <div className={styles.action} data-outcome-owner-actions="" {...rest}>
            {notes}
            {status}
            {rows.length ? <ActionList label={label} items={rows} data-outcome-owner-list="" /> : null}
            {children}
        </div>
    );
}

/**
 * A fact list for the Details tab: one fact per row, the label at the start
 * and the value at the end.
 *
 * @param {object} props
 * @param {Array<{ key: string, label: string, value: import('react').ReactNode }>} props.rows
 * @param {string} [props.label]
 */
export function OutcomeFacts({ rows, label }) {
    if (!rows.length) return null;
    return (
        <dl className={styles.facts} aria-label={label}>
            {rows.map((row) => (
                <div key={row.key} className={styles.factRow}>
                    <dt className={styles.factLabel}>{row.label}</dt>
                    <dd className={styles.factValue}>{row.value}</dd>
                </div>
            ))}
        </dl>
    );
}

/**
 * The Activity list: one bet or vote per row, newest first. A row may lead
 * with a decorative icon (the bet market's outcome mark); a row without one
 * draws exactly as before.
 *
 * @param {object} props
 * @param {Array<{ key: string, title: string, amount?: string | null, icon?: import('react').ReactNode, meta: Array<{ key: string, text: import('react').ReactNode, tone?: 'danger' | 'mine' }> }>} props.rows
 */
export function OutcomeActivity({ rows }) {
    return (
        <ul className={styles.activityList} data-outcome-activity="">
            {rows.map((row) => {
                const body = (
                    <>
                        <span className={styles.activityMain}>
                            <span className={styles.activityTitle}>{row.title}</span>
                            {row.amount ? <span className={styles.activityAmount}>{row.amount}</span> : null}
                        </span>
                        <span className={styles.activityMeta}>
                            {row.meta.map((m) => (
                                <span key={m.key} className={m.tone === 'danger' ? styles.activityDanger : m.tone === 'mine' ? styles.activityMine : styles.activityMetaItem}>{m.text}</span>
                            ))}
                        </span>
                    </>
                );
                if (!row.icon) return <li key={row.key} className={styles.activityRow}>{body}</li>;
                return (
                    <li key={row.key} className={`${styles.activityRow} ${styles.activityRowLed}`}>
                        <span className={styles.activityLead} aria-hidden="true">{row.icon}</span>
                        <span className={styles.activityBody}>{body}</span>
                    </li>
                );
            })}
        </ul>
    );
}
