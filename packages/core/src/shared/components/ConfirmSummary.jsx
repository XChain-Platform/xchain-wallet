// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The blocks of the action confirm page: a centred hero with the signed amount,
// the address, one before and after row per change, the cost, and folded
// technical details. ConfirmActionModal places them; this file draws them.
//
// Nothing here computes a balance. A before and after row comes from the
// host's projection of the composed action (composed.simulation) or from a
// value the calling form already holds; a row whose before value is unknown
// is left out rather than shown as a guess.

import { AddressText, Icon } from '@xchain-wallet/core/ui';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { defaultRegistry } from '../../registry/index.js';
import { TickerIcon } from './TickerIcon.jsx';
import { formatDisplayAmount } from '../utils/amountFormat.js';
import { neutralizeControlText } from '../utils/textHardening.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/firstPaint.js';
import '../../i18n/locales/en/verifySignature.js';
import styles from './ConfirmSummary.module.css';

const chainRegistry = defaultRegistry();
// The longest target the hero shows before it is cut with an ellipsis.
const TARGET_MAX = 120;

/**
 * @typedef {object} ConfirmChange
 * @property {string} label
 * @property {string} before
 * @property {string} after
 * @property {string} [tick]   the balance this row covers, so a projected row for the same tick is not repeated
 */
/**
 * @typedef {object} ConfirmSummaryInput
 * @property {string} [verb]            "Mint", "Send", "Issue"
 * @property {string} [amount]          the signed amount, as a decimal string
 * @property {string} [ticker]
 * @property {string} [chainId]
 * @property {'in'|'out'|'none'} [direction]   green "+" coming in, red minus leaving
 * @property {string} [address]         the address the action happens on
 * @property {string} [recipient]
 * @property {string} [target]          what the action works on when that is not an address (a
 *   list, a poll, a contract): the hero's big line when there is no amount, else after the
 *   chain on the line under it; a token target without an amount is `ticker`
 * @property {ConfirmChange[]} [changes]   rows only the form knows (a supply)
 * @property {{ amount: string, ticker?: string }} [networkFee]   the form's fee ESTIMATE, used only when the composed fee is unknown
 * @property {{ amount: string, ticker: string }} [protocolFee]  the form's protocol fee figure, used only when the screen has none
 * @property {string} [notice]          a fact the form no longer shows as a standing warning, shown as a muted line under the cost
 */

const IN_VERBS = /^(mint|issue|receive|claim|unstake|redeem|withdraw)$/i;
const OUT_VERBS = /^(send|destroy|burn|sweep|pay|bet|stake|give|airdrop|dividend|transfer)$/i;

/** @param {string} verb */
export function directionForVerb(verb) {
    const word = String(verb || '').trim().split(/\s+/)[0];
    if (IN_VERBS.test(word)) return 'in';
    if (OUT_VERBS.test(word)) return 'out';
    return 'none';
}

function titleCaseAction(name) {
    const words = String(name || '').trim().toLowerCase().split(/[_\s]+/).filter(Boolean);
    if (words.length === 0) return '';
    const text = words.join(' ');
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The hero for an action whose form passed no summary: the decoded action's
 * own amount, token and verb when the host decoded it, otherwise the action's
 * name alone.
 *
 * @param {{ decoded?: { summary?: string, details?: Array<{ label: string, value: string }> } | null, actionName?: string }} args
 * @returns {ConfirmSummaryInput}
 */
export function summaryFromDecoded({ decoded, actionName }) {
    const details = Array.isArray(decoded?.details) ? decoded.details : [];
    const find = (re) => details.find((detail) => re.test(String(detail?.label || '')));
    const amount = String(find(/^(amount|quantity)$/i)?.value ?? '').trim();
    const ticker = String(find(/^token$/i)?.value ?? '').trim();
    const recipient = String(find(/^(destination|recipient|receive address|to)$/i)?.value ?? '').trim();
    const summaryText = String(decoded?.summary || '').trim();
    const verb = summaryText.split(/\s+/)[0] || titleCaseAction(actionName);
    return {
        verb,
        amount: amount && ticker && /^\d/.test(amount) ? amount : '',
        ticker,
        recipient,
        direction: directionForVerb(verb),
    };
}

/**
 * "Your <TICK>" rows from the host's projection of the composed action.
 * Label-only fee rows and any row with an unknown side are left out.
 *
 * @param {{ deltas?: Array<any> } | null | undefined} simulation
 * @returns {ConfirmChange[]}
 */
export function changesFromSimulation(simulation) {
    const deltas = Array.isArray(simulation?.deltas) ? simulation.deltas : [];
    const rows = [];
    for (const delta of deltas) {
        if (!delta || delta.beforeUnknown || delta.afterUnknown || delta.feeUnknown) continue;
        const before = String(delta.before ?? '');
        const after = String(delta.after ?? '');
        if (!before || !after) continue;
        const tick = String(delta.tick || '').toUpperCase();
        if (!tick || rows.some((row) => row.tick === tick)) continue;
        rows.push({
            label: t('components.confirmSummary.your', { tick }),
            before: formatDisplayAmount(before) || before,
            after: formatDisplayAmount(after) || after,
            tick,
        });
    }
    return rows;
}

/**
 * The form's rows first (what only it knows), then the projected balances it
 * did not already cover.
 *
 * @param {ConfirmChange[]|undefined} formRows
 * @param {ConfirmChange[]} projected
 */
export function mergeChanges(formRows, projected) {
    const own = (Array.isArray(formRows) ? formRows : [])
        .filter((row) => row && row.label && row.before !== undefined && row.before !== null
            && String(row.before) !== '' && row.after !== undefined && row.after !== null && String(row.after) !== '');
    const covered = new Set(own.map((row) => String(row.tick || '').toUpperCase()).filter(Boolean));
    const labels = new Set(own.map((row) => row.label));
    return [
        ...own,
        ...projected.filter((row) => !covered.has(row.tick) && !labels.has(row.label)),
    ];
}

/**
 * The "Looks good" state of the pre-flight panel: the check passed, the
 * network was reached and judged all of it, and nothing was held back.
 *
 * @param {any} report
 */
export function preflightCleanPass(report) {
    if (!report || report.verdict !== 'pass' || report.restricted) return false;
    const findings = Array.isArray(report.findings) ? report.findings : [];
    if (findings.some((f) => f?.severity === 'error' || f?.severity === 'warning')) return false;
    if (findings.some((f) => f?.code === 'DRYRUN_UNAVAILABLE')) return false;
    const partlyJudged = findings.some((f) => f?.code === 'DRYRUN_VALID'
        && Number.isInteger(f?.data?.subCommandCount)
        && Number.isInteger(f?.data?.accepted)
        && f.data.accepted < f.data.subCommandCount);
    if (partlyJudged) return false;
    return !(Array.isArray(report.unverified) && report.unverified.length > 0);
}

/**
 * @param {{ summary: ConfirmSummaryInput, chainId?: string, actionLabel?: string }} props
 */
export function ConfirmHero({ summary, chainId: chainIdProp }) {
    const chainId = summary.chainId || chainIdProp || '';
    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const chainName = descriptor?.displayName || '';
    const chainIcon = descriptor ? branding.chainIconSmallUrl(descriptor.id) : null;
    const direction = summary.direction || directionForVerb(summary.verb);
    const sign = direction === 'in' ? '+' : direction === 'out' ? '−' : '';
    const tone = direction === 'in' ? styles.in : direction === 'out' ? styles.out : '';
    const ticker = String(summary.ticker || '');
    const amount = summary.amount ? formatDisplayAmount(summary.amount) : '';
    const verb = String(summary.verb || '').trim();
    // Without an amount the big line names what the action works on, so the
    // verb is not said twice and the target is not left off the page. With
    // no chain line under it, the verb keeps the big line.
    // A target can be text from the chain (a poll question, a list name), so
    // it is cleaned of hidden and direction controls and kept to one line.
    const target = neutralizeControlText(String(summary.target || '').trim(), { maxLength: TARGET_MAX });
    const subject = chainName ? (target || ticker) : '';
    if (!amount && !verb) return null;
    return (
        <section className={styles.hero} data-testid="confirm-hero">
            {ticker && descriptor ? (
                <span className={styles.heroMark}>
                    <TickerIcon chainId={descriptor.id} tick={ticker} context="hero" />
                </span>
            ) : null}
            {amount ? (
                <p className={`${styles.heroAmount} ${tone}`.trim()} data-testid="confirm-hero-amount">
                    <bdi>{sign}{amount}</bdi>{' '}
                    <span className={styles.heroTicker}>{ticker}</span>
                </p>
            ) : (
                <p className={styles.heroAmount} data-testid="confirm-hero-amount"><bdi>{subject || verb}</bdi></p>
            )}
            {verb && chainName ? (
                <p className={styles.heroLine} data-testid="confirm-hero-line">
                    <span>{t('components.confirmSummary.actionOn', { action: verb })}</span>
                    <span>
                        {chainIcon ? (
                            <img className={styles.chainIcon} src={chainIcon} alt="" aria-hidden="true" />
                        ) : null}
                        {' '}{chainName}
                    </span>
                    {summary.recipient ? (
                        <span>
                            {t('components.confirmSummary.toPrefix')}{' '}
                            <AddressText address={summary.recipient} size="sm" />
                        </span>
                    ) : amount && target ? (
                        // An amount took the big line, so the target it goes
                        // to or comes from (a contract) rides on this one.
                        <span data-testid="confirm-hero-target">
                            {t('components.confirmSummary.targetSuffix', { target })}
                        </span>
                    ) : null}
                </p>
            ) : null}
        </section>
    );
}

/** @param {{ address: string }} props */
export function ConfirmAddressCard({ address }) {
    return (
        <dl className={styles.card} data-testid="confirm-address">
            <div className={styles.row}>
                <dt className={styles.label}>{t('verifySignature.address')}</dt>
                <dd className={styles.addressValue}>
                    <AddressText address={address} fit />
                </dd>
            </div>
        </dl>
    );
}

/** @param {{ rows: ConfirmChange[] }} props */
export function ConfirmChangesCard({ rows }) {
    if (!rows.length) return null;
    return (
        <dl className={styles.card} data-testid="confirm-changes" aria-label={t('components.confirmSummary.changes')}>
            {rows.map((row) => (
                <div key={row.label} className={styles.row} data-testid="confirm-change">
                    <dt className={styles.label}>{row.label}</dt>
                    <dd className={styles.value}>
                        <bdi>{row.before}</bdi>
                        <span className={styles.arrow} aria-hidden="true"><Icon.ArrowRightIcon /></span>
                        <bdi className={styles.after}>{row.after}</bdi>
                    </dd>
                </div>
            ))}
        </dl>
    );
}

/**
 * @typedef {object} CostRow
 * @property {string} key
 * @property {string} label
 * @property {string} [value]       "0.000015 BTC"
 * @property {string|null} [fiat]   "~$0.98"
 * @property {import('react').ReactNode} [text]   a whole line when the figure is only text
 * @property {boolean} [total]
 * @property {string} [testId]
 */
/** @param {{ rows: CostRow[] }} props */
export function ConfirmCostCard({ rows }) {
    if (!rows.length) return null;
    return (
        <dl className={styles.card} data-testid="confirm-cost">
            {rows.map((row) => (row.text ? (
                <div key={row.key} className={`${styles.row} ${styles.textRow}`} data-testid={row.testId}>
                    <dt className={styles.label} hidden>{row.label}</dt>
                    <dd className={styles.value}>{row.text}</dd>
                </div>
            ) : (
                <div
                    key={row.key}
                    className={`${styles.row} ${row.total ? styles.totalRow : ''}`.trim()}
                    data-testid={row.testId}
                >
                    <dt className={styles.label}>{row.label}</dt>
                    <dd className={styles.value}>
                        <bdi className={styles.amount}>{row.value}</bdi>
                        {row.fiat ? <bdi className={styles.fiat}>{row.fiat}</bdi> : null}
                    </dd>
                </div>
            )))}
        </dl>
    );
}

/**
 * A fact a form moved off its own page (the bridge lock-and-credit line):
 * muted, under the cost and above the network check, never at the top.
 *
 * @param {{ text?: string }} props
 */
export function ConfirmNotice({ text }) {
    const value = String(text || '').trim();
    if (!value) return null;
    return <p className={styles.notice} data-testid="confirm-summary-notice">{value}</p>;
}

/** @param {{ children: import('react').ReactNode }} props */
export function ConfirmTechnicalDetails({ children }) {
    return (
        <details className={styles.tech} data-testid="confirm-technical">
            <summary className={styles.techSummary}>
                <Icon.ChevronDownIcon />
                {t('pending.detail.technicalDetails')}
            </summary>
            <div className={styles.techBody}>{children}</div>
        </details>
    );
}

export { styles as confirmSummaryStyles };
