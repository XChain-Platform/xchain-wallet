// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { memo } from 'react';
import { VerifiedBadge } from '@xchain-wallet/core/ui';
import { useBalancesHidden } from '../hooks/useBalancesHidden.js';
import { tickerForCoin, tickerForDescriptor } from '../../registry/coinTicker.js';
import { t } from '../../i18n/index.js';
import { actionDisplayLabel } from '../utils/actionDisplayLabel.js';
import { ActivityRow } from '../components/ActivityRow.jsx';
import { classifyEntryAction, classifyEntryStatus } from '../utils/historyFilter.js';
import { contractDisplayLabel } from './contractResponseShape.js';
import { truncateAddress } from '../../ui/AddressText.jsx';
import {
    formatDecimalAmount,
    formatHistoryAmount,
    formatHistoryAmountForSpeech,
} from '../utils/amountFormat.js';
import { activityRowAmount } from '../utils/activityAmount.js';
import styles from './History.module.css';
import { DoubleChevron, PENDING_WARNING_STATES, chainRegistry, coinOfChainId, describePendingAction, historyAmountDirection, peerAddressOfEntry, pendingCopyFor, pendingStateOf } from './HistoryShared.jsx';
import { DetailCard } from './HistoryDetailCard.jsx';

/**
 * M2.5: which verb the row annotation uses, keyed by the direction the
 * merge already decided (I-9). A null direction is not in the table on
 * purpose: it means neither party was identified as ours, and a plus or
 * a minus there would put a sign on money the wallet cannot attribute.
 */
const PENDING_AMOUNT_COPY = {
    out: 'pending.amount.sending',
    in: 'pending.amount.receiving',
};

/**
 * M2.5: what a pending transaction is about to move, or null when the
 * wallet cannot say.
 *
 * Null is the answer for every action but SEND v0-v3 and our own record
 * of a send. A MINT carries its supply at the same segment offset a SEND
 * carries its amount, so reading it positionally would invent a figure
 * rather than report one, which is the whole point of I-9. The decode
 * comes from `describePendingAction`, which yields outputs for nothing
 * else; the kind check below states that contract rather than enforcing
 * it a second time.
 *
 * Amount strings are the wire's own, untouched: a value too large or too
 * precise for a JS number reaches the screen intact because nothing here
 * parses one.
 *
 * @param {any} entry
 * @returns {{ direction: 'in' | 'out' | null,
 *             outputs: Array<{ tick: string, amount: string }> } | null}
 */
function pendingAmountAnnotation(entry) {
    if (!entry?.pending) return null;
    const desc = describePendingAction(entry);
    if (desc.kind !== 'send' && desc.kind !== 'local') return null;
    const outputs = desc.outputs.filter((o) => o.amount !== '' && o.tick !== '');
    if (outputs.length === 0) return null;
    return { direction: entry.pending.direction ?? null, outputs };
}

/**
 * The amount a row prints in its amount column. A settled SEND prints its
 * own figure. So does a blockless SEND that carries no pending metadata (a
 * synthesized demo row or an older shell's row): it has no pending
 * annotation to print instead, and without this its amount column said
 * only "pending", beside a status chip that already says Pending, where
 * Home's Activity tab prints the same row's amount.
 */
function settledAmountAnnotation(entry) {
    if (!entry || String(entry.action || '').toUpperCase() !== 'SEND') return null;
    if (!entry.blockIndex && entry.pending) return null;
    const raw = entry.raw || {};
    const amount = raw.amount ?? raw.AMOUNT ?? raw.quantity ?? raw.QUANTITY;
    const tick = raw.tick ?? raw.TICK ?? raw.token;
    if (amount == null || !tick) return null;
    return { amount: String(amount), tick: String(tick), direction: historyAmountDirection(entry) };
}

/**
 * M2.3: the meta-line label for a row with no block. It used to be the
 * flat word "unconfirmed", which was the wrong vocabulary (§7 fixes
 * "pending" for anything a user reads) and, worse, was the same word for
 * a healthy send and for one no node has ever reported.
 *
 * The warning treatment is the list-level half of M2 acceptance test 3:
 * a transaction the network has not seen has to be findable in a long
 * list without opening it.
 *
 * @param {{ entry: any }} props
 */
function PendingRowLabel({ entry }) {
    const state = pendingStateOf(entry);
    const warning = state != null && PENDING_WARNING_STATES.has(state);
    const label = state ? t(pendingCopyFor(state, entry).row) : t('pending.row.seen');
    return (
        <span
            className={`${styles.pendingLabel} ${warning ? styles.pendingLabelWarning : ''}`}
            data-pending-state={state || 'pending'}
        >
            {warning ? <span aria-hidden="true">⚠</span> : null}
            {label}
        </span>
    );
}

/**
 * M2.5: what the pending row moves, on the row itself. Until now a
 * pending entry named its action, its state and its counterparty and
 * said nothing about the value at stake, so the list gave the user no
 * way to tell a dust send from their rent without opening every row.
 *
 * Renders nothing rather than a placeholder when no amount can be stood
 * behind. A blank says the wallet does not know; a zero would say the
 * transaction moves nothing, which is a different and false claim.
 *
 * The phrasing is a verb still in progress, and the accessible name
 * carries the pre-validation caveat for a reader who never sees the
 * styling. Neither is decoration: this figure sits inches from settled
 * amounts in the same list, and the indexer can still reject the action
 * when its block lands.
 *
 * @param {{ entry: any }} props
 */
function PendingAmountLabel({ entry }) {
    const [balancesHidden] = useBalancesHidden();
    const annotation = pendingAmountAnnotation(entry);
    if (!annotation) return null;
    const amounts = annotation.outputs
        .map((o) => t('pending.amount.entry', {
            amount: balancesHidden
                ? '•••••'
                : formatHistoryAmount(o.amount, annotation.direction),
            tick: o.tick,
        }))
        .join(t('pending.amount.separator'));
    const summary = t(
        PENDING_AMOUNT_COPY[annotation.direction] || 'pending.amount.moving',
        { amounts },
    );
    const caveat = t('pending.amount.caveat', { summary });
    return (
        <span
            className={styles.pendingAmount}
            data-pending-amount={annotation.direction || 'unknown'}
            aria-label={caveat}
            title={caveat}
        >
            {summary}
        </span>
    );
}

/**
 * One history row. Used both for top-level entries and for member rows
 * inside an expanded group card.
 */
// Which actions name a contract on their payload. XEXEC is deliberately not
// here: its payload carries no contract index at all, only an
// `execute_action_index` one hop away, so there is nothing to label from.
const CONTRACT_ACTIONS = new Set(['DEPLOY', 'EXECUTE', 'DEPOSIT', 'WITHDRAW']);

/**
 * "Escrow v1.0.0 (C:BTC:12)" for a history row that touched a contract, or ''
 * for every other row.
 *
 * The four payloads carry the contract's `contract_meta_name` and
 * `contract_meta_version` beside its index (`deployed_contract_index` on a
 * DEPLOY, which is not necessarily the DEPLOY's own action under deferred
 * assembly; `contract_index` on the rest), so a user reading their history sees
 * WHICH contract they funded rather than a bare number. `normalizeHistoryRow`
 * has already lifted the payload out of `details`, so these read off `raw`.
 *
 * @param {any} entry
 * @returns {string}
 */
function contractRowLabel(entry) {
    const action = String(entry?.action || '').toUpperCase();
    if (!CONTRACT_ACTIONS.has(action)) return '';
    const raw = entry.raw || {};
    const idx = raw.deployed_contract_index ?? raw.contract_index ?? raw.contract_action_index;
    if (idx === null || idx === undefined || String(idx) === '') return '';
    return contractDisplayLabel(raw, { chainId: entry.chainId, actionIndex: idx });
}

/**
 * True when `label` is the name the wallet generated for an address
 * ("BTC Address #1", "LTC Change #2", "Imported Address") rather than one the
 * user chose. A generated name only repeats the coin, which the row's asset
 * mark already shows, so a row names the receiving address only when the
 * user named it.
 *
 * @param {string} label
 * @param {string | undefined} chainId
 * @returns {boolean}
 */
export function isGeneratedAddressLabel(label, chainId) {
    let text = String(label || '').trim();
    if (!text || text === 'Imported Address') return true;
    const ticker = tickerForCoin(coinOfChainId(chainId) || '');
    if (ticker && text.startsWith(`${ticker} `)) text = text.slice(ticker.length + 1);
    return /^(Address|Change|Dispenser)( #\d+)?$/.test(text);
}

/** Divisibility a record states for its own token; 8 when it states none. */
function recordDivisibility(raw) {
    const stated = Number(raw?.divisibility);
    if (Number.isInteger(stated) && stated >= 0) return stated;
    return raw?.divisible === false ? 0 : 8;
}

export const EntryRow = memo(function EntryRow({ entry, selected, opensDetail = false, showConnector, onClick, peerCache, isFull, chainTip, indexerWatermark, walletId, verify, showFiatInHistory, fiatCurrency, walletAddresses, onDismissFailed, networkAvailable = true }) {
    const d = chainRegistry.get(entry.chainId);
    const [balancesHidden] = useBalancesHidden();
    const settledAmount = settledAmountAnnotation(entry);
    const actionKind = classifyEntryAction(entry, walletAddresses);
    const receiveLabel = entry.receiveLabel
        && actionKind === 'receive'
        && !isGeneratedAddressLabel(entry.receiveLabel, entry.chainId)
        ? entry.receiveLabel
        : '';
    const nativeTick = tickerForDescriptor(d || { coin: coinOfChainId(entry.chainId) });
    const rawTick = entry.raw?.tick ?? entry.raw?.TICK ?? entry.raw?.token;
    const tick = String(settledAmount?.tick || rawTick || nativeTick || '?');
    // A settled sweep or issue prints the amount Home prints, from the same
    // formatter; its record carries base units.
    const baseUnitAmount = !settledAmount && entry.blockIndex
        && (actionKind === 'sweep' || actionKind === 'issue')
        ? activityRowAmount(entry, { divisibility: recordDivisibility(entry.raw) })
        : '';
    // Hidden balances mask the figure here as they do on Home and in the
    // pending annotation; the ticker stays, since it is not an amount.
    const amount = settledAmount ? (
        <span
            data-history-amount={settledAmount.direction || 'unknown'}
            aria-label={balancesHidden ? undefined : formatHistoryAmountForSpeech(
                settledAmount.amount,
                settledAmount.tick,
                settledAmount.direction,
            )}
        >
            {balancesHidden ? '•••••' : formatHistoryAmount(settledAmount.amount, settledAmount.direction)} {settledAmount.tick}
        </span>
    ) : entry.blockIndex ? (baseUnitAmount ? (
        <span data-history-amount="unknown">
            {balancesHidden ? '•••••' : baseUnitAmount} {tick}
        </span>
    ) : tick) : (
        <>
            <PendingRowLabel entry={entry} />
            <PendingAmountLabel entry={entry} />
        </>
    );
    const namedContext = contractRowLabel(entry)
        || (receiveLabel ? t('history.row.receivedAt', { label: receiveLabel }) : '');
    // A row names its counterparty, so a send shows where it went. The
    // address keeps both identifying ends: an end-clipped one showed only its
    // first characters on a phone.
    const counterparty = namedContext ? '' : (peerAddressOfEntry(entry) || entry.source || '');
    const contextLabel = namedContext || counterparty;
    const contextText = namedContext || truncateAddress(counterparty);
    const linkedTo = entry.link
        ? t('history.row.linkedTo', { ticker: entry.link.peerCoinTicker, index: entry.link.peerActionIndex })
        : '';
    const rowDescription = entry.blockIndex ? [
        t('history.row.block', { block: formatDecimalAmount(entry.blockIndex) }),
        chainTip ? t('history.row.confirmations', {
            count: Math.max(0, chainTip - Number(entry.blockIndex) + 1),
        }) : '',
    ].filter(Boolean).join(', ') : '';
    return (
        <li data-history-key={entry.key}>
            <ActivityRow
                onClick={() => onClick(entry)}
                data-history-row
                className={`${styles.row} ${selected ? styles.rowSelected : ''}`}
                // A row that opens the detail page is a link to it, not a
                // disclosure: no expand chevron and no expanded state.
                aria-expanded={opensDetail ? undefined : selected}
                chainId={entry.chainId}
                tick={tick}
                isNative={tick === nativeTick}
                label={actionDisplayLabel(actionKind) || actionDisplayLabel(entry.action)}
                context={(
                    <>
                        {linkedTo ? <span role="img" aria-label={linkedTo} title={linkedTo}>🔗</span> : null}
                        {verify ? (
                            <VerifiedBadge status={verify.status} reason={verify.reason} size="sm" details={false} />
                        ) : null}
                        {contextLabel ? <span title={contextLabel}>{contextText}</span> : null}
                    </>
                )}
                amount={amount}
                status={classifyEntryStatus(entry)}
                statusLabels={{
                    confirmed: t('history.status.confirmed'),
                    failed: t('history.status.failed'),
                    pending: t('history.status.pending'),
                }}
                timestamp={entry.timestamp}
                selected={selected}
                aria-description={rowDescription || undefined}
                decoration={showConnector ? <span className={styles.connector} aria-hidden="true" /> : null}
                trailing={opensDetail ? null : <DoubleChevron direction={selected ? 'up' : 'down'} />}
            />
            {selected ? (
                <DetailCard
                    entry={entry}
                    peerCache={peerCache}
                    isFull={isFull}
                    chainTip={chainTip}
                    indexerWatermark={indexerWatermark}
                    walletId={walletId}
                    showFiatInHistory={showFiatInHistory}
                    fiatCurrency={fiatCurrency}
                    walletAddresses={walletAddresses}
                    onDismissFailed={onDismissFailed}
                    networkAvailable={networkAvailable}
                />
            ) : null}
        </li>
    );
});
