// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useState } from 'react';
import {
    Button,
    Icon,
    InfoTip,
    Input,
    ListPage,
    PageHeader,
    Screen,
    StatusMessage,
    VerifiedBadge,
} from '@xchain-wallet/core/ui';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/actionDetail.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/flows.js';
import '../../i18n/locales/en/history.js';
import '../../i18n/locales/en/pending.js';
import '../../i18n/locales/en/send.js';
import '../../i18n/locales/en/tokenDetail.js';
import { useMessaging } from '../useMessaging.js';
import { useSettings } from '../hooks/useSettings.js';
import { useBalancesHidden } from '../hooks/useBalancesHidden.js';
import { useToast } from '../components/ToastHost.jsx';
import { TickerIcon } from '../components/TickerIcon.jsx';
import { actionIconForAction } from '../components/ActivityRow.jsx';
import { activityRowTick } from '../utils/activityAmount.js';
import { ExplorerFavicon } from '../components/ExplorerFavicon.jsx';
import { ActionList } from '../components/ActionList.jsx';
import { ActionsDetailsToggle } from '../components/ActionsDetailsToggle.jsx';
import { txStatusStages } from '../components/TxStatusTimeline.jsx';
import { RelativeTime } from '../components/RelativeTime.jsx';
import { AddressText, truncateAddress } from '../../ui/AddressText.jsx';
import { copyText } from '../clipboard.js';
import { shareOrCopy, ShareOutcome } from '../share.js';
import { transactionReceiptText } from '../utils/transactionReceipt.js';
import { findContactByName, withEntriesAdded } from '../utils/contactMerge.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { titleCase } from '../utils/titleCase.js';
import {
    formatDisplayAmount,
    isDisplayableAmount,
    sumDecimalStrings,
} from '../utils/amountFormat.js';
import {
    OFFLINE_ACTION_REASON,
    coinOfChainId,
    describePendingAction,
    peerAddressOfEntry,
} from './HistoryShared.jsx';
import {
    DetailValue,
    RecipientsBlock,
    detailActionLabel,
    detailTransfer,
    explorerLinksFor,
    failedReasonOf,
    firstPopulatedValue,
    formatDetailAmount,
    fullDetailRows,
    nativeTickerForEntry,
    useRbfReplace,
} from './HistoryDetailCard.jsx';
import historyStyles from './History.module.css';
import facts from './FactRows.module.css';
import styles from './ActionDetailView.module.css';

const HIDDEN = '•••••';
const STEP_TICK_MS = 30_000;

// The states a send can stop in short of a block, and the word the bar shows
// on its Confirmed step for each. Every other pending state is a send still
// on its way, and the step reads as in progress.
const STOPPED_STEP_LABEL = Object.freeze({
    'not-seen': () => t('actionDetail.step.notSeen'),
    dropped: () => t('actionDetail.step.dropped'),
    replaced: () => t('pending.detail.replacedElsewhere'),
    'replaced-elsewhere': () => t('pending.detail.replacedElsewhere'),
});

/**
 * The four steps the Action detail bar shows (Signed, Broadcast, Confirmed,
 * Processed), read from the same stage verdicts the full timeline draws.
 * Each step is `done`, `current`, `todo`, or, where the send stopped,
 * `warn` (replaced, dropped, not seen) or `error` (the wallet's own failure).
 *
 * @param {any} entry
 * @param {{ chainTip?: number, indexerWatermark?: number, nowMs?: number }} [options]
 * @returns {{ steps: Array<{ key: string, label: string, state: 'done' | 'current' | 'todo' | 'warn' | 'error' }>,
 *             confirmed: boolean, stopped: boolean }}
 */
export function actionStatusSteps(entry, options = {}) {
    const { stages, pendingState, confirmed, failed } = txStatusStages(entry, options);
    const stage = (key) => stages.find((s) => s.key === key) || { done: false };
    const steps = [
        { key: 'signed', label: t('actionDetail.step.signed'), done: stage('signed').done },
        { key: 'broadcast', label: t('actionDetail.step.broadcast'), done: stage('broadcast').done },
        { key: 'confirmed', label: t('history.status.confirmed'), done: confirmed },
        { key: 'processed', label: t('actionDetail.step.processed'), done: stage('indexed').done },
    ];
    let stopAt = -1;
    let stopState = /** @type {'warn' | 'error'} */ ('warn');
    let stopLabel = '';
    if (failed) {
        // The wallet gave up before the network took it: the first step it
        // did not reach is where it stopped.
        stopAt = steps.findIndex((s) => !s.done);
        stopState = 'error';
        stopLabel = t('history.status.failed');
    } else if (!confirmed && pendingState && STOPPED_STEP_LABEL[pendingState]) {
        stopAt = 2;
        stopLabel = STOPPED_STEP_LABEL[pendingState]();
    }
    const current = stopAt >= 0 ? stopAt : steps.findIndex((s) => !s.done);
    return {
        steps: steps.map((s, i) => ({
            key: s.key,
            label: i === stopAt ? stopLabel : s.label,
            state: s.done ? 'done'
                : i === stopAt ? stopState
                : i === current ? 'current'
                : 'todo',
        })),
        confirmed,
        stopped: stopAt >= 0,
    };
}

/** The bar itself. A pending row re-reads its verdict on the timeline's beat. */
function ActionStatusBar({ entry, chainTip, indexerWatermark }) {
    const [nowMs, setNowMs] = useState(Date.now);
    const { steps, confirmed } = actionStatusSteps(entry, { chainTip, indexerWatermark, nowMs });
    useEffect(() => {
        if (confirmed) return undefined;
        const id = setInterval(() => setNowMs(Date.now()), STEP_TICK_MS);
        return () => clearInterval(id);
    }, [confirmed]);
    const stateText = {
        done: t('actionDetail.stepState.done'),
        current: t('actionDetail.stepState.current'),
        todo: t('actionDetail.stepState.todo'),
        warn: t('actionDetail.stepState.problem'),
        error: t('actionDetail.stepState.problem'),
    };
    return (
        <div className={styles.statusCard}>
            {/* The one place the page states and announces how far the
                transaction has got (operator ruling 2026-11-13: Details
                carries no second timeline). */}
            <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                {confirmed ? t('actionDetail.status.confirmed') : ''}
            </span>
            <ol className={styles.statusBar} aria-label={t('actionDetail.status.label')}>
                {steps.map((step) => (
                    <li
                        key={step.key}
                        className={styles.step}
                        data-step={step.key}
                        data-state={step.state}
                        aria-current={step.state === 'done' || step.state === 'todo' ? undefined : 'step'}
                    >
                        <span className={styles.stepDot} aria-hidden="true">
                            {step.state === 'done' ? <Icon.CheckIcon />
                                : step.state === 'error' ? <Icon.XIcon />
                                : step.state === 'warn' ? '!'
                                : null}
                        </span>
                        <span className={styles.stepLabel}>{step.label}</span>
                        <span className="sr-only">{`, ${stateText[step.state]}`}</span>
                    </li>
                ))}
            </ol>
        </div>
    );
}

/** The amount the hero shows, when the row carries one it can show honestly. */
function heroAmountOf(entry) {
    const raw = entry?.raw || {};
    let amount = firstPopulatedValue(raw, ['amount', 'AMOUNT', 'quantity', 'QUANTITY']);
    let tick = firstPopulatedValue(raw, ['tick', 'TICK', 'token', 'TOKEN']);
    if (amount == null) {
        // A send the network reported before any indexer did carries its
        // amount only in the wire data.
        const desc = describePendingAction(entry);
        if ((desc.kind === 'send' || desc.kind === 'local') && desc.outputs.length === 1) {
            amount = desc.outputs[0].amount;
            tick = tick || desc.outputs[0].tick;
        }
    }
    const action = String(entry?.action || '').toUpperCase();
    if (!tick && (action === 'SEND' || action === 'RECEIVE')) tick = nativeTickerForEntry(entry);
    if (amount == null || !tick || !isDisplayableAmount(amount)) return null;
    return { amount: String(amount), tick: String(tick).toUpperCase() };
}

/**
 * The one address under the hero amount: who a send went to, who a receive
 * came from, and the address a protocol action was made from.
 */
function heroAddressOf(entry, transfer) {
    const raw = entry?.raw || {};
    const destination = firstPopulatedValue(raw, ['destination', 'DESTINATION', 'recipient', 'RECIPIENT']);
    const source = firstPopulatedValue(raw, ['source', 'SOURCE']) || firstPopulatedValue(entry, ['source']);
    if (transfer.amountDirection === 'out' || transfer.amountDirection === 'self') {
        return destination ? { side: 'to', address: destination } : null;
    }
    if (transfer.amountDirection === 'in') {
        return source ? { side: 'from', address: source } : null;
    }
    return source ? { side: 'source', address: source } : null;
}

const HERO_SIDE_LABEL = Object.freeze({
    to: () => t('actionDetail.hero.to'),
    from: () => t('actionDetail.hero.from'),
    source: () => t('actionDetail.hero.source'),
});

function DirectionMark({ direction }) {
    const Glyph = direction === 'out' ? Icon.SendIcon
        : direction === 'in' ? Icon.IncomingIcon
        : direction === 'self' ? Icon.SwapIcon
        : Icon.ZapIcon;
    return <span className={styles.directionMark} aria-hidden="true"><Glyph /></span>;
}

/**
 * The Details facts in the detail pages' shared look (G14, FactRows): one
 * card, a row per fact with the label left and the value right on one line,
 * a divider between rows. No value carries its own copy button; copying
 * lives in the Actions list (operator ruling 2026-11-13).
 */
function FactsList({ rows, label }) {
    return (
        <dl className={facts.list} aria-label={label}>
            {rows.map(([rowLabel, value, help], index) => (
                <FactsRow key={`${rowLabel}-${index}`} label={rowLabel} help={help}>{value}</FactsRow>
            ))}
        </dl>
    );
}

function FactsRow({ label, help, children }) {
    return (
        <>
            <dt className={facts.label}>
                {help ? (
                    <span className={styles.labelWithTip}>
                        {label}
                        <InfoTip label={help} />
                    </span>
                ) : label}
            </dt>
            <dd className={facts.value}>{children}</dd>
        </>
    );
}

/**
 * The Action detail page (operator ruling 2026-11-13, Layout 1 with the
 * shared Actions | Details toggle, G102): the token mark and signed amount
 * with the one address under it, the four-step status bar, then Actions and
 * Details. Actions comes first and is chosen on arrival: one action list
 * (G101) holding Speed up while a replaceable send is still on its way,
 * Remove from history, View dispenser, Open in new window, the explorer
 * links, the receipt, Save as contact and Cancel transaction. Details is
 * one facts card, the basic facts first and every other fact after them.
 * The page has no header menu and no raw-data view. Nothing collapses.
 *
 * @param {object} props
 * @param {any} props.entry
 * @param {string} props.walletId
 * @param {string} props.variant           the Screen variant for this shell
 * @param {import('react').ReactNode} props.title
 * @param {() => void} props.onBack
 * @param {string} props.backLabel
 * @param {boolean} props.networkAvailable
 * @param {{ status: string, reason?: string } | null} [props.verdict]
 * @param {number} [props.chainTip]
 * @param {number} [props.indexerWatermark]
 * @param {((pendingTxId: string) => void) | undefined} [props.onDismissFailed]
 * @param {((chainId: string, actionIndex: string) => void) | undefined} [props.onOpenDispenser]
 * @param {boolean} [props.embedded]  drawn in wide Home's detail panel (G115): Home's Screen owns the
 *   header and scroller, so the body renders with a heading of its own and no header or Back
 */
export function ActionDetailView(props) {
    // ActionDetail renders its own empty state when no row was handed over;
    // this body only ever draws a row.
    if (!props?.entry) return null;
    return <ActionDetailBody {...props} />;
}

function ActionDetailBody({
    entry, walletId, variant, title, onBack, backLabel, networkAvailable, verdict = null,
    chainTip, indexerWatermark, onDismissFailed, onOpenDispenser, embedded = false,
}) {
    const { messaging, shell } = useMessaging();
    const { settings } = useSettings();
    const [balancesHidden] = useBalancesHidden();
    const { showToast } = useToast();
    const rbf = useRbfReplace({ entry, walletId, networkAvailable });

    const [contacts, setContacts] = useState(/** @type {any[]} */ ([]));
    const [contactsLoaded, setContactsLoaded] = useState(false);
    const [contactSaveStage, setContactSaveStage] = useState(
        /** @type {'hidden' | 'editing' | 'saving' | 'saved'} */ ('hidden'),
    );
    const [contactName, setContactName] = useState('');
    const [contactSaveError, setContactSaveError] = useState(/** @type {string | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        messaging.listContacts()
            .then((rows) => {
                if (cancelled) return;
                setContacts(Array.isArray(rows) ? rows : []);
                setContactsLoaded(true);
            })
            .catch(() => { if (!cancelled) setContactsLoaded(true); });
        return () => { cancelled = true; };
    }, [messaging]);

    const walletAddresses = entry.detailContext?.walletAddresses;
    const transfer = detailTransfer(entry, walletAddresses);
    const direction = transfer.amountDirection;
    const meta = entry.pending || null;
    const raw = entry.raw || {};
    const isPending = !(Number(entry.blockIndex) > 0);
    const { confirmed } = actionStatusSteps(entry, { chainTip, indexerWatermark });
    const failure = meta?.failed === true && !confirmed ? failedReasonOf(meta?.error) : null;
    const explorerLinks = explorerLinksFor(entry, settings);
    const receipt = transactionReceiptText(entry, { settings, balancesHidden });

    // Speed Up and Cancel Transaction only while the send is still on its
    // way and can be replaced. The hook already withdraws them from a
    // confirmed, failed or replaced send; a send the network has not reported
    // (or stopped reporting) keeps them, as the History card always has,
    // because a higher-fee replacement is how the user gets it moving again.
    const replaceOffered = rbf.available && !confirmed && !failure;
    const replaceDisabled = rbf.busy !== null || !networkAvailable;

    const contactPeer = peerAddressOfEntry(entry);
    const contactPeerCoin = coinOfChainId(entry.chainId);
    const contactAlreadySaved = Boolean(contactPeer && contacts.some((c) => (
        Array.isArray(c?.entries) && c.entries.some((e) => e?.address === contactPeer)
    )));
    const canSaveContact = contactsLoaded
        && Boolean(contactPeer)
        && !(entry.address && contactPeer === entry.address)
        && !contactAlreadySaved
        && Boolean(contactPeerCoin)
        && contactSaveStage !== 'saved';

    const isDispenser = String(entry.action || '').toUpperCase() === 'DISPENSER';
    const dispenserIndex = String(entry.actionIndex ?? '').trim();
    const detachAvailable = shell === 'desktop'
        && isPending
        && typeof globalThis.xchainWalletWindow?.openDetached === 'function';
    const offlineReason = !networkAvailable ? OFFLINE_ACTION_REASON : undefined;

    // The Actions view's one action list (G101): every action this
    // transaction allows, a row each, in the order the page used to show them
    // (the page's own buttons, then what the header menu held). Each row keeps
    // the guard and handler its button or menu row had.
    const actionItems = [];
    if (replaceOffered) {
        actionItems.push({
            id: 'speed-up',
            icon: <Icon.ForwardIcon />,
            title: rbf.busy === 'speedup' ? t('actionDetail.actions.speedingUp') : t('actionDetail.actions.speedUp'),
            description: t('actionDetail.actions.speedUpDescription'),
            disabled: replaceDisabled,
            disabledReason: offlineReason,
            onClick: () => rbf.run('speedup'),
        });
    }
    if (failure && typeof onDismissFailed === 'function' && meta?.pendingTxId) {
        actionItems.push({
            id: 'dismiss-failed',
            icon: <Icon.TrashIcon />,
            title: t('actionDetail.actions.dismissFailed'),
            description: t('actionDetail.actions.dismissFailedDescription'),
            tone: 'danger',
            onClick: () => onDismissFailed(meta.pendingTxId),
        });
    }
    if (isDispenser && !isPending && dispenserIndex && typeof onOpenDispenser === 'function') {
        actionItems.push({
            id: 'view-dispenser',
            icon: <Icon.MarketIcon />,
            title: t('actionDetail.actions.viewDispenser'),
            description: t('actionDetail.actions.viewDispenserDescription'),
            onClick: () => onOpenDispenser(entry.chainId, dispenserIndex),
        });
    }
    if (detachAvailable) {
        actionItems.push({
            id: 'open-new-window',
            icon: <Icon.ExternalLinkIcon />,
            title: t('actionDetail.actions.openNewWindow'),
            description: t('actionDetail.actions.openNewWindowDescription'),
            onClick: () => {
                globalThis.xchainWalletWindow.openDetached({
                    initialView: 'history',
                    initialContext: {
                        walletId,
                        chainId: entry.chainId,
                        actionIndex: entry.actionIndex,
                        txHash: entry.txHash,
                    },
                }).catch(() => { /* main returns ok:false on failure */ });
            },
        });
    }
    explorerLinks.forEach((link, index) => {
        actionItems.push({
            id: `explorer-${link.id}`,
            icon: <ExplorerFavicon src={link.iconImg} label={link.label} explorerId={link.id} />,
            title: index === 0
                ? t('actionDetail.actions.viewOnExplorer')
                : t('actionDetail.actions.viewOn', { explorer: link.label }),
            description: t('actionDetail.actions.explorerDescription'),
            href: link.url,
            target: '_blank',
            rel: 'noopener noreferrer',
            disabled: !networkAvailable,
            disabledReason: offlineReason,
        });
    });
    // Receipt sharing is deliberately narrower than the detail payload: six
    // public transaction facts, never addresses, memos or contact data.
    actionItems.push({
        id: 'share-receipt',
        icon: <Icon.UploadIcon />,
        title: t('actionDetail.actions.shareReceipt'),
        description: t('actionDetail.actions.shareReceiptDescription'),
        onClick: async () => {
            const outcome = await shareOrCopy({ title: t('actionDetail.receipt.shareTitle'), text: receipt }, receipt);
            if (outcome === ShareOutcome.COPIED) {
                showToast({ message: t('actionDetail.receipt.copied') });
            } else if (outcome === ShareOutcome.UNAVAILABLE) {
                showToast({ message: t('actionDetail.receipt.shareUnavailable') });
            }
        },
    });
    actionItems.push({
        id: 'copy-receipt',
        icon: <Icon.CopyIcon />,
        title: t('actionDetail.actions.copyReceipt'),
        description: t('actionDetail.actions.copyReceiptDescription'),
        chevron: false,
        onClick: async () => {
            const { ok } = await copyText(receipt);
            showToast({
                message: ok ? t('actionDetail.receipt.copied') : t('components.logConsole.copyFailedClipboardUnavailable'),
                variant: ok ? 'default' : 'error',
            });
        },
    });
    if (canSaveContact) {
        actionItems.push({
            id: 'save-contact',
            icon: <Icon.UsersIcon />,
            title: t('actionDetail.actions.saveContact'),
            description: t('actionDetail.actions.saveContactDescription'),
            onClick: () => {
                setContactSaveStage('editing');
                setContactName('');
                setContactSaveError(null);
            },
        });
    }
    if (replaceOffered) {
        actionItems.push({
            id: 'cancel-transaction',
            icon: <Icon.XIcon />,
            title: rbf.busy === 'cancel' ? t('actionDetail.actions.cancelling') : t('actionDetail.actions.cancelTransaction'),
            description: t('actionDetail.actions.cancelDescription'),
            tone: 'danger',
            disabled: replaceDisabled,
            disabledReason: offlineReason,
            onClick: () => rbf.run('cancel'),
        });
    }

    async function handleSaveContact(event) {
        event.preventDefault();
        const trimmed = contactName.trim();
        if (!trimmed) {
            setContactSaveError(t('actionDetail.contact.nameRequired'));
            return;
        }
        setContactSaveStage('saving');
        setContactSaveError(null);
        const contactEntry = { chain: contactPeerCoin, address: contactPeer, label: '' };
        try {
            // The same person seen on another chain: add this address to the
            // contact that already carries the name, not a second contact.
            const existing = findContactByName(contacts, trimmed);
            if (existing) {
                await messaging.saveContact({ record: withEntriesAdded(existing, [contactEntry]) });
            } else {
                await messaging.saveContact({ input: { name: trimmed, notes: '', entries: [contactEntry] } });
            }
            setContactSaveStage('saved');
        } catch (err) {
            setContactSaveError(userFacingMessage(err, 'Could not save this contact. Try again.'));
            setContactSaveStage('editing');
        }
    }

    // --- hero ---
    const heroAmount = heroAmountOf(entry);
    const heroAddress = heroAddressOf(entry, transfer);
    // The mark is the asset the action is about, chosen as the History row
    // chooses it (its amount's ticker, then the action's own ticker, the coin
    // for a plain send or receive). An action with no asset (a file, a poll, a
    // dispenser with no ticker) shows the action icon that row shows instead.
    const heroAction = String(entry.action || '').toUpperCase();
    const iconTick = heroAmount?.tick
        || activityRowTick(entry)
        || (heroAction === 'SEND' || heroAction === 'RECEIVE' ? nativeTickerForEntry(entry) : '');
    const subjectIcon = iconTick ? null : actionIconForAction(entry.action);
    const actionName = titleCase(detailActionLabel(entry, direction));

    // --- Overview: the basic facts ---
    const nativeTicker = nativeTickerForEntry(entry);
    const fee = firstPopulatedValue(entry, ['fee', 'networkFee', 'network_fee'])
        || firstPopulatedValue(raw, ['network_fee', 'networkFee', 'miner_fee', 'minerFee', 'tx_fee', 'txFee', 'fee', 'FEE']);
    const feeShown = fee != null && nativeTicker && isDisplayableAmount(fee);
    const source = firstPopulatedValue(raw, ['source', 'SOURCE']) || firstPopulatedValue(entry, ['source']);
    const destination = firstPopulatedValue(raw, ['destination', 'DESTINATION', 'recipient', 'RECIPIENT']);
    const memo = firstPopulatedValue(raw, ['memo', 'MEMO']);
    const overviewRows = [];
    if (!heroAmount) overviewRows.push([t('actionDetail.title'), actionName]);
    if (heroAmount) {
        overviewRows.push([t('send.fields.amount'), balancesHidden
            ? `${HIDDEN} ${heroAmount.tick}`
            : `${formatDisplayAmount(String(heroAmount.amount).replace(/^[-+]/, ''))} ${heroAmount.tick}`]);
    }
    if (feeShown) {
        overviewRows.push([
            t('send.networkFee'),
            balancesHidden ? `${HIDDEN} ${nativeTicker}` : `${formatDisplayAmount(fee)} ${nativeTicker}`,
            t('actionDetail.help.networkFee'),
        ]);
    }
    // A total is only honest when the amount and the fee are the same coin
    // and both left this wallet.
    if (heroAmount && feeShown && heroAmount.tick === nativeTicker && (direction === 'out' || direction === 'self')) {
        const total = sumDecimalStrings([String(heroAmount.amount).replace(/^[-+]/, ''), fee]);
        if (total) {
            overviewRows.push([
                t('flows.feesCard.total'),
                balancesHidden ? `${HIDDEN} ${nativeTicker}` : `${formatDisplayAmount(total)} ${nativeTicker}`,
                t('actionDetail.help.total'),
            ]);
        }
    }
    if (source) {
        overviewRows.push([t('send.fields.from'), <DetailValue display={source} fullValue={source} />]);
    }
    if (destination) {
        overviewRows.push([t('send.fields.to'), <DetailValue display={destination} fullValue={destination} />]);
    }
    if (memo) overviewRows.push([t('send.memo'), memo]);

    // --- Details: the basic facts above first, then every other fact ---
    // The Overview view folded in here (operator ruling 2026-11-13). The full
    // dump names the same facts with the same labels (Action, Amount, Network
    // fee, From, To, Memo), so each such fact shows once, in the basic order
    // with its help tip. It keeps the dump's value where the dump has one,
    // since that is the richer form (the signed amount), and the basic value
    // where the dump only has its "-" placeholder (an amount read from a
    // pending send's wire data).
    const allRows = fullDetailRows(entry, balancesHidden, chainTip, walletAddresses, explorerLinks);
    const dumpByLabel = new Map(allRows.map((row) => [row[0], row[1]]));
    const basicLabels = new Set(overviewRows.map(([label]) => label));
    // To also reads a `recipient` field, which the dump labels "Recipient".
    if (destination && !firstPopulatedValue(raw, ['destination', 'DESTINATION'])) basicLabels.add('Recipient');
    const detailRows = [
        ...overviewRows.map(([label, value, help]) => {
            const dumped = dumpByLabel.get(label);
            return [label, dumped != null && dumped !== '-' ? dumped : value, help];
        }),
        ...allRows.filter(([label]) => !basicLabels.has(label)),
    ];
    if (verdict) {
        detailRows.push([t('actionDetail.field.verification'), (
            <VerifiedBadge status={verdict.status} reason={verdict.reason} size="sm" />
        )]);
    }
    if (meta?.firstSeenMs) {
        detailRows.push([t('actionDetail.field.firstSeen'), <RelativeTime timestamp={meta.firstSeenMs} />]);
    }
    if (meta?.broadcastAtMs) {
        detailRows.push([t('actionDetail.field.broadcastAt'), <RelativeTime timestamp={meta.broadcastAtMs} />]);
    }
    if (meta?.replaced && meta.replacementTxHash) {
        detailRows.push([t('actionDetail.field.replacement'), (
            <DetailValue display={meta.replacementTxHash} fullValue={meta.replacementTxHash} />
        )]);
    }
    if (failure?.details) {
        detailRows.push([t('actionDetail.field.failureDetails'), <code>{failure.details}</code>]);
    }
    // What a send the network has reported (and no indexer has yet) is about
    // to do, decoded from its wire data: every output, not only the one the
    // hero can show.
    const pendingDesc = isPending ? describePendingAction(entry) : null;
    if (pendingDesc && (pendingDesc.kind === 'send' || pendingDesc.kind === 'local')) {
        pendingDesc.outputs.forEach((output, index) => {
            detailRows.push([t('actionDetail.field.output', { number: index + 1 }), (
                <span className={styles.outputValue}>
                    {t('actionDetail.output.amountTo', {
                        amount: balancesHidden ? HIDDEN : formatDisplayAmount(output.amount),
                        tick: output.tick,
                    })}
                    {' '}
                    {output.destination ? <AddressText address={output.destination} size="sm" /> : '-'}
                    {output.memo ? ` · ${output.memo}` : ''}
                </span>
            )]);
        });
    }

    const header = <PageHeader onBack={onBack} backLabel={backLabel} title={title} />;
    // Embedded in wide Home's detail panel, Home's Screen is the page.
    const PageFrame = embedded ? EmbeddedFrame : Screen;

    return (
        <PageFrame variant={variant} header={header}>
            <ListPage className={historyStyles.body}>
                {embedded ? <h2 className="sr-only">{title}</h2> : null}
                <div className={styles.page} role="region" aria-label={t('history.detail.label')}>
                    {!networkAvailable ? (
                        <StatusMessage variant="warning" id="history-offline-action-reason">
                            {t('actionDetail.offline')}
                        </StatusMessage>
                    ) : null}
                    <section className={styles.hero}>
                        <span className={styles.heroMark}>
                            {subjectIcon ? (
                                <span className={styles.subjectMark} data-testid="action-hero-subject" aria-hidden="true">
                                    {subjectIcon}
                                </span>
                            ) : (
                                <>
                                    <TickerIcon chainId={entry.chainId} tick={iconTick} context="hero" />
                                    <DirectionMark direction={direction} />
                                </>
                            )}
                        </span>
                        <p className={styles.heroAmount} data-testid="action-hero-amount">
                            {heroAmount ? (
                                <>
                                    <bdi>{balancesHidden ? HIDDEN : formatDetailAmount(heroAmount.amount, direction)}</bdi>
                                    {' '}
                                    <span className={styles.heroTicker}>{heroAmount.tick}</span>
                                </>
                            ) : <bdi>{actionName}</bdi>}
                        </p>
                        {heroAddress ? (
                            <p className={styles.heroLine} data-testid="action-hero-address">
                                <span className="sr-only">{`${HERO_SIDE_LABEL[heroAddress.side]()} `}</span>
                                <AddressText address={heroAddress.address} size="sm" />
                            </p>
                        ) : null}
                    </section>

                    <ActionStatusBar entry={entry} chainTip={chainTip} indexerWatermark={indexerWatermark} />
                    {/* A proof that FAILED is a warning the user has to see;
                        a passing one is a fact, and waits under Details. */}
                    {verdict?.status === 'failed' ? (
                        <div className={styles.verdictLine}>
                            <VerifiedBadge status={verdict.status} reason={verdict.reason} size="sm" />
                        </div>
                    ) : null}

                    {failure ? <StatusMessage variant="error">{failure.reason}</StatusMessage> : null}
                    {rbf.error ? (
                        <StatusMessage variant="error" className={historyStyles.rbfError}>{rbf.error}</StatusMessage>
                    ) : null}
                    {rbf.done ? (
                        <p className={historyStyles.rbfDone} role="status">{rbf.done}</p>
                    ) : null}

                    {contactSaveStage === 'editing' || contactSaveStage === 'saving' ? (
                        <form className={historyStyles.saveContactForm} onSubmit={handleSaveContact}>
                            <Input
                                type="text"
                                label={t('history.contact.saveAs', { address: truncateAddress(contactPeer || '') })}
                                help={t('actionDetail.contact.help')}
                                enterKeyHint="go"
                                autoComplete="off"
                                value={contactName}
                                onChange={(e) => setContactName(e.target.value)}
                                autoFocus
                                maxLength={80}
                                placeholder={t('common.contactName')}
                            />
                            {contactSaveError ? (
                                <StatusMessage variant="error" className={historyStyles.saveContactError}>{contactSaveError}</StatusMessage>
                            ) : null}
                            <div className={historyStyles.saveContactActions}>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    icon={<Icon.XIcon />}
                                    onClick={() => {
                                        setContactSaveStage('hidden');
                                        setContactName('');
                                        setContactSaveError(null);
                                    }}
                                    disabled={contactSaveStage === 'saving'}
                                >
                                    {t('common.cancel')}
                                </Button>
                                <Button
                                    type="submit"
                                    variant="primary"
                                    size="sm"
                                    icon={<Icon.SaveIcon />}
                                    loading={contactSaveStage === 'saving'}
                                >
                                    {t('history.contact.save')}
                                </Button>
                            </div>
                        </form>
                    ) : null}

                    {/* The shared Actions | Details toggle (G102), Actions
                        first and chosen on arrival. Each panel names itself
                        with an h2 so the page's outline stays h1 then h2. */}
                    <ActionsDetailsToggle
                        label={t('actionDetail.view.label')}
                        actions={(
                            <>
                                <h2 className="sr-only">{t('tokenDetail.tabs.actions')}</h2>
                                <ActionList label={t('actionDetail.actions.label')} items={actionItems} />
                            </>
                        )}
                        details={(
                            <>
                                <h2 className="sr-only">{t('tokenDetail.tabs.details')}</h2>
                                <FactsList rows={detailRows} label={t('tokenDetail.tabs.details')} />
                            </>
                        )}
                    />

                    <RecipientsBlock entry={entry} walletId={walletId} />
                    {rbf.modal}
                </div>
            </ListPage>
        </PageFrame>
    );
}

/** Wide Home's detail panel: the body with no Screen around it. */
function EmbeddedFrame({ children }) {
    return children;
}
