// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Fragment, useEffect, useState } from 'react';
import {
    Button,
    CopyButton,
    EmptyState,
    Icon,
    Input,
    SectionHeader,
    StatusMessage,
} from '@xchain-wallet/core/ui';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import {
    isEntryReplaceable,
    isReplaceCallAvailable,
    replaceFromHistoryEntry,
    cancelUndoSnapshot,
    undoCancel,
} from '../../flows/rbfReplace.js';
import { rbfFailureMessage } from '../utils/rbfFailureMessage.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { useMessaging } from '../useMessaging.js';
import { useBalancesHidden } from '../hooks/useBalancesHidden.js';
import { useSettings } from '../hooks/useSettings.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useFiatRate } from '../hooks/useFiatRate.js';
import { formatFiat } from '../components/BalanceList.jsx';
import { coinToFiatExact } from '../../flows/priceLookup.js';
import { useToast } from '../components/ToastHost.jsx';
import { ConfirmModal } from '../components/ConfirmModal.jsx';
import { ActionList } from '../components/ActionList.jsx';
import { useConfirmModal } from '../hooks/useConfirmModal.js';
import { tickerForCoin, transactionExplorerLinks } from '../../registry/coinTicker.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/history.js';
import '../../i18n/locales/en/pending.js';
import '../../i18n/locales/en/tokenDetail.js';
import { humanizeError } from '../utils/humanizeError.js';
import { actionDisplayLabel } from '../utils/actionDisplayLabel.js';
import { ActionsDetailsToggle } from '../components/ActionsDetailsToggle.jsx';
import { classifyEntryStatus } from '../utils/historyFilter.js';
import { AddressText } from '../../ui/AddressText.jsx';
import { findContactByName, withEntriesAdded } from '../utils/contactMerge.js';
import { copyText } from '../clipboard.js';
import { shareOrCopy, ShareOutcome } from '../share.js';
import { explorerPageUrl } from '../utils/explorerLinks.js';
import { transactionReceiptText } from '../utils/transactionReceipt.js';
import {
    formatDecimalAmount,
    formatDisplayAmount,
    formatHistoryAmount,
    formatHistoryAmountForSpeech,
    isDisplayableAmount,
} from '../utils/amountFormat.js';
import { formatFiatAmountForSpeech } from '../utils/fiatAmountFormat.js';
import { RelativeTime } from '../components/RelativeTime.jsx';
import { useNetworkOffline } from '../hooks/useNetworkOffline.js';
import styles from './History.module.css';
import facts from './FactRows.module.css';
import { NATIVE_TICKER_BY_COIN, OFFLINE_ACTION_REASON, PENDING_WARNING_STATES, chainRegistry, coinOfChainId, describePendingAction, formatTimestamp, historyAmountDirection, peerAddressOfEntry, pendingCopyFor, pendingStateOf } from './HistoryShared.jsx';

import { ExplorerFavicon } from '../components/ExplorerFavicon.jsx';

/**
 * Inline detail card. For LINK-threaded entries we render two
 * `detailSide` blocks side-by-side; for everything else, one block.
 */
export function DetailCard({ entry, chainTip, walletId, showFiatInHistory, fiatCurrency, walletAddresses, onDismissFailed, networkAvailable = true }) {
    const { messaging, shell } = useMessaging();
    const { showToast } = useToast();
    const { settings } = useSettings();
    const [balancesHidden] = useBalancesHidden();

    // Fiat equivalent, native-coin amounts only. `nativeAmountFieldOf`
    // returns null for anything that isn't unambiguously a native-coin SEND
    // (in particular, a token SEND carrying a non-native tick), so a token
    // amount never gets priced against the coin's rate - the exact bug this
    // deliberately avoids replicating (in the old numbering).
    const nativeAmount = showFiatInHistory ? nativeAmountFieldOf(entry) : null;
    const entryCoin = coinOfChainId(entry?.chainId);
    const fiatRate = useFiatRate({
        chainCoin: nativeAmount != null ? entryCoin : null,
        fiatCurrency: fiatCurrency || 'USD',
    });
    const nativeFiatValue = nativeAmount != null && fiatRate
        ? coinToFiatExact(nativeAmount, fiatRate)
        : null;

    // ───── Actions tab / Save-as-contact state ─────
    // Contacts are fetched once so the "already a contact" check can run
    // synchronously when deciding whether to offer the Save-as-contact row
    // in the Actions tab.
    const [contacts, setContacts] = useState(/** @type {any[]} */ ([]));
    const [contactsLoaded, setContactsLoaded] = useState(false);
    const [contactSaveStage, setContactSaveStage] = useState(
        /** @type {'hidden' | 'editing' | 'saving' | 'saved'} */ ('hidden'),
    );
    const [contactName, setContactName] = useState('');
    const [contactSaveError, setContactSaveError] = useState(/** @type {string | null} */ (null));

    // ───── RBF (Speed up / Cancel) state ─────
    // Offered as rows of the Actions tab's list. The outcome renders under
    // that list so the user sees the result of their tap without scrolling.
    const rbf = useRbfReplace({ entry, walletId, networkAvailable });
    const { busy: rbfBusy, error: rbfError, done: rbfDone } = rbf;

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

    // §24.6 / Cluster Y FOLLOWUP 4: desktop-only "Open in new window"
    // affordance for pending (mempool-only) entries. The detached
    // window opens directly on this row via the History `initialFocus`
    // prop and keeps its own auto-lock + last-view memory because the
    // shared MessageHost stays singleton across windows. Surfaces on
    // desktop only; extension popup + web SPA have no equivalent
    // multi-window primitive.
    const isPending = !entry.blockIndex;
    const detachAvailable = shell === 'desktop'
        && isPending
        && typeof globalThis.xchainWalletWindow?.openDetached === 'function';

    const detailRows = basicDetailRows(
        entry,
        chainTip,
        nativeAmount,
        nativeFiatValue,
        balancesHidden,
        fiatCurrency,
        detailTransferDirection(entry, walletAddresses),
    );
    const explorerButtons = explorerLinksFor(entry, settings);

    const fullRows = fullDetailRows(
        entry,
        balancesHidden,
        chainTip,
        walletAddresses,
        explorerButtons,
    );

    // The Actions tab's list (G101): the explorer links as "View on ..."
    // rows, then Save as contact, Speed up, Cancel and the two receipt rows.
    // Offline, an explorer row stays as a disabled row with the reason.
    const actionRows = explorerButtons.map((link) => ({
        id: `explorer-${link.id}`,
        title: `View on ${link.label}`,
        description: `This transaction on the ${link.label} explorer`,
        icon: <ExplorerFavicon src={link.iconImg} label={link.label} explorerId={link.id} />,
        href: link.url,
        // A disabled row renders as a button, which takes no link attributes.
        ...(networkAvailable ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
        disabled: !networkAvailable,
        disabledReason: !networkAvailable ? OFFLINE_ACTION_REASON : undefined,
    }));

    // Compute Save-as-contact saveability for its row.
    const contactPeer = peerAddressOfEntry(entry);
    const contactPeerCoin = coinOfChainId(entry?.chainId);
    const contactPeerIsSelf = Boolean(entry?.address && contactPeer === entry.address);
    const contactAlreadySaved = Boolean(contactPeer && contacts.some((c) =>
        Array.isArray(c?.entries) && c.entries.some((e) => e?.address === contactPeer),
    ));
    const canSaveContact = contactsLoaded
        && Boolean(contactPeer)
        && !contactPeerIsSelf
        && !contactAlreadySaved
        && Boolean(contactPeerCoin)
        && contactSaveStage !== 'saved';
    if (canSaveContact) {
        actionRows.push({
            id: 'save-contact',
            title: 'Save as contact',
            description: 'Add the other address to your contacts',
            icon: <Icon.UsersIcon />,
            onClick: () => {
                setContactSaveStage('editing');
                setContactName('');
                setContactSaveError(null);
            },
        });
    }
    if (rbf.available) {
        actionRows.push({
            id: 'rbf-speedup',
            title: rbfBusy === 'speedup' ? 'Speeding up…' : 'Speed up transaction',
            description: 'Pay a higher fee so it confirms sooner',
            icon: <Icon.ForwardIcon />,
            disabled: rbfBusy !== null || !networkAvailable,
            disabledReason: !networkAvailable ? OFFLINE_ACTION_REASON : undefined,
            onClick: () => rbf.run('speedup'),
        });
        actionRows.push({
            id: 'rbf-cancel',
            title: rbfBusy === 'cancel' ? 'Cancelling…' : 'Cancel transaction',
            description: 'Send the coins back to this wallet before it confirms',
            icon: <Icon.XIcon />,
            tone: 'danger',
            disabled: rbfBusy !== null || !networkAvailable,
            disabledReason: !networkAvailable ? OFFLINE_ACTION_REASON : undefined,
            onClick: () => rbf.run('cancel'),
        });
    }
    // Receipt sharing is deliberately narrower than the detail payload. The
    // user opts into these six public transaction facts, never addresses,
    // memos, contact data, wallet identifiers, or arbitrary raw fields.
    const receipt = transactionReceiptText(entry, { settings, balancesHidden });
    actionRows.push({
        id: 'share-receipt',
        title: 'Share receipt',
        description: 'Send the public transaction facts through another app',
        icon: <Icon.UploadIcon />,
        onClick: async () => {
            const outcome = await shareOrCopy({
                title: 'XChain transaction receipt',
                text: receipt,
            }, receipt);
            if (outcome === ShareOutcome.COPIED) {
                showToast({ message: 'Transaction receipt copied.' });
            } else if (outcome === ShareOutcome.UNAVAILABLE) {
                showToast({ message: 'Sharing is unavailable.' });
            }
        },
    });
    actionRows.push({
        id: 'copy-receipt',
        title: 'Copy receipt',
        description: 'The same receipt as text, ready to paste',
        icon: <Icon.CopyIcon />,
        onClick: async () => {
            const { ok } = await copyText(receipt);
            showToast({
                message: ok ? 'Transaction receipt copied.' : 'Copy failed: clipboard unavailable',
                variant: ok ? 'default' : 'error',
            });
        },
    });

    async function handleSaveContact(event) {
        event.preventDefault();
        const trimmed = contactName.trim();
        if (!trimmed) {
            setContactSaveError('Name is required.');
            return;
        }
        setContactSaveStage('saving');
        setContactSaveError(null);
        const entry = { chain: contactPeerCoin, address: contactPeer, label: '' };
        try {
            // The same person seen on another chain: add this address to the
            // contact that already carries the name, not a second contact.
            const existing = findContactByName(contacts, trimmed);
            if (existing) {
                await messaging.saveContact({ record: withEntriesAdded(existing, [entry]) });
            } else {
                await messaging.saveContact({ input: { name: trimmed, notes: '', entries: [entry] } });
            }
            setContactSaveStage('saved');
        } catch (err) {
            setContactSaveError(userFacingMessage(err, 'Could not save this contact. Try again.'));
            setContactSaveStage('editing');
        }
    }

    return (
        <div className={styles.detailContainer} role="region" aria-label={t('history.detail.label')}>
            {/* M2.3: the pending branch. First, because on a pending
                entry the thing the user came to find out is what is
                happening to it, and because the warning states have to
                be impossible to scroll past. Disappears of its own
                accord when the confirmed entry replaces this one. */}
            {isPending ? (
                <PendingDetailPanel
                    entry={entry}
                    transferDirection={detailTransferDirection(entry, walletAddresses)}
                    balancesHidden={balancesHidden}
                    onDismissFailed={onDismissFailed}
                />
            ) : null}

            {/* Basic details hero: concise summary at the top of the
                page. Flush variant: zero card padding so the table's
                row-divider lines run all the way to the card edges,
                with horizontal cell padding restoring the inner gutter
                so text doesn't crowd the border. */}
            <section className={`${styles.detailSection} ${styles.detailSectionFlush}`}>
                <table className={styles.detailsTable}>
                    <tbody>
                        {detailRows.map(([label, value]) => (
                            <tr key={label}>
                                <th scope="row">{label}</th>
                                <td>{value}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </section>

            {/* The shared Actions | Details toggle (G102, operator ruling
                2026-11-13): Actions first and chosen on arrival, then
                Details. No status or raw-data views. */}
            <ActionsDetailsToggle
                label={t('history.detail.view')}
                actions={(
                    /* One ActionList (G101), the explorer rows first, then
                       Save as contact, Speed up, Cancel and the receipts. It
                       is its own card, so the panel draws none. The Speed up
                       / Cancel outcome and the Save-as-contact form sit under
                       the list, where the tap happened. Copy receipt applies
                       to every entry, so the list is never empty. */
                    <div className={styles.detailActionsPanel}>
                        <ActionList label={t('history.detail.options')} items={actionRows} />
                        {rbfError ? (
                            <StatusMessage variant="error" className={styles.rbfError}>{rbfError}</StatusMessage>
                        ) : null}
                        {rbfDone ? (
                            <p className={styles.rbfDone} role="status">{rbfDone}</p>
                        ) : null}
                        {contactSaveStage === 'editing' || contactSaveStage === 'saving' ? (
                            <form className={styles.saveContactForm} onSubmit={handleSaveContact}>
                                <Input
                                    type="text"
                                    label={t('history.contact.saveAs', { address: shortenAddress(contactPeer || '') })}
                                    help={t('history.contact.saveAsHelp')}
                                    enterKeyHint="go"
                                    autoComplete="off"
                                    value={contactName}
                                    onChange={(e) => setContactName(e.target.value)}
                                    autoFocus
                                    maxLength={80}
                                    placeholder={t('common.contactName')}
                                />
                                {contactSaveError ? (
                                    <StatusMessage variant="error" className={styles.saveContactError}>{contactSaveError}</StatusMessage>
                                ) : null}
                                <div className={styles.saveContactActions}>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
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
                                        loading={contactSaveStage === 'saving'}
                                    >
                                        {t('history.contact.save')}
                                    </Button>
                                </div>
                            </form>
                        ) : null}
                    </div>
                )}
                details={(
                    /* Every value associated with the action, as opposed to
                       the curated hero table at the top, in the detail
                       pages' shared facts card (G14, FactRows): one row per
                       fact, label left and value right, no copy buttons. */
                    <dl className={facts.list} aria-label={t('tokenDetail.tabs.details')}>
                        {fullRows.map(([label, value], index) => (
                            <Fragment key={`${label}-${index}`}>
                                <dt className={facts.label}>{label}</dt>
                                <dd className={facts.value}>{value}</dd>
                            </Fragment>
                        ))}
                    </dl>
                )}
            />

            {/* Interactive widgets appended below the static sections.
                Save-as-contact and Speed up / Cancel are rows of the
                Actions tab; recipient bulk-save stays here because it's
                a per-row affordance for DIVIDEND / AIRDROP entries with
                its own UI. */}
            <RecipientsBlock entry={entry} walletId={walletId} />
            {detachAvailable ? (
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                        globalThis.xchainWalletWindow.openDetached({
                            initialView: 'history',
                            initialContext: {
                                walletId,
                                chainId: entry.chainId,
                                actionIndex: entry.actionIndex,
                                txHash: entry.txHash,
                            },
                        }).catch(() => { /* main returns ok:false on failure */ });
                    }}
                >
                    {t('history.detail.openNewWindow')}
                </Button>
            ) : null}
            {rbf.modal}
        </div>
    );
}

/**
 * Speed up and Cancel for one History entry: whether they are on offer, the
 * run itself (quote, confirm, broadcast, and the Undo toast a cancel gets),
 * and its outcome. The inline card offers them as Actions tab rows; the Action
 * detail page puts Speed Up under its status bar and Cancel in its header
 * menu. Both render `modal` where the confirm dialog belongs.
 *
 * @param {{ entry: any, walletId: string, networkAvailable?: boolean }} props
 */
export function useRbfReplace({ entry, walletId, networkAvailable = true }) {
    const { messaging } = useMessaging();
    const { showToast } = useToast();
    // Speed up and Cancel sign a replacement, which a watch-only wallet
    // cannot do, so they wait for this wallet's mode; a wallet list that
    // cannot say opens in full mode.
    const { isWatcherMode, walletModeKnown: walletModeReady } = useWalletMode(walletId);
    const rbfConfirm = useConfirmModal();
    const [busy, setBusy] = useState(/** @type {'speedup' | 'cancel' | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [done, setDone] = useState(/** @type {string | null} */ (null));
    const descriptor = chainRegistry.get(entry?.chainId);
    const replaceable = entry ? isEntryReplaceable(entry, { descriptor }) : { ok: false };
    // A transaction we have already replaced still satisfies the field
    // contract `isEntryReplaceable` checks (it has a hash, no block, and
    // an allowlisted action), so the offer has to be withdrawn here.
    // Replacing a replacement bumps the fee on a transaction the network
    // has already dropped, spends a fee, and moves nothing.
    const available = Boolean(walletModeReady && !isWatcherMode && isReplaceCallAvailable(messaging)
        && replaceable.ok && !entry?.pending?.replaced);

    async function run(strategy) {
        if (busy) return;
        setBusy(strategy);
        setError(null);
        setDone(null);
        try {
            const quote = await replaceFromHistoryEntry({
                messaging, entry, strategy, walletId, descriptor, preview: true,
            });
            const ticker = tickerForCoin(descriptor?.coin);
            const confirmed = await rbfConfirm.confirm({
                title: strategy === 'cancel' ? 'Cancel this transaction?' : 'Speed up this transaction?',
                message: `Old fee: ${quote.originalFee} ${ticker}. `
                    + `New fee: ${quote.replacementFee} ${ticker}. `
                    + `Additional cost: ${quote.feeIncrease} ${ticker}.`,
                confirmLabel: strategy === 'cancel' ? 'Broadcast cancellation' : 'Broadcast replacement',
                danger: strategy === 'cancel',
            });
            if (!confirmed) return;
            const res = await replaceFromHistoryEntry({ messaging, entry, strategy, walletId, descriptor });
            setDone(`Replacement sent: ${res?.replacementTxHash || 'Pending'}`);
            // §37.2 / Cluster D FOLLOWUP 3: a cancel gets an Undo toast.
            // The undo is a THIRD transaction replacing the cancel and
            // re-issuing the spend, so it is only offered while the
            // cancel is still in the mempool; `cancelUndoSnapshot`
            // returns null when the pair cannot support one.
            if (strategy === 'cancel') {
                const snapshot = cancelUndoSnapshot({ entry, result: res, walletId });
                if (snapshot) {
                    showToast({
                        message: 'Transaction cancelled',
                        actionLabel: 'Undo',
                        onAction: async () => {
                            setError(null);
                            try {
                                const undone = await undoCancel({ messaging, snapshot });
                                setDone(`Re-sent: ${undone?.replacementTxHash || 'Pending'}`);
                            } catch (undoErr) {
                                setError(rbfFailureMessage(undoErr, 'Could not undo the cancellation.'));
                            }
                        },
                    });
                }
            }
        } catch (err) {
            setError(rbfFailureMessage(err, "Couldn't speed up or cancel this transaction. Try again later."));
        } finally {
            setBusy(null);
        }
    }

    const modal = rbfConfirm.request ? (
        <ConfirmModal
            {...rbfConfirm.request}
            onConfirm={rbfConfirm.onConfirm}
            onCancel={rbfConfirm.onCancel}
        />
    ) : null;

    return { available, busy, error, done, run, modal, networkAvailable };
}

/**
 * Split a failed record's stored error into safe prose and the raw text for a
 * collapsed disclosure. The shared humanizer keeps flow prefixes, SDK strings
 * and unclassified node text out of the primary explanation.
 *
 * @param {unknown} stored
 * @returns {{ reason: string | null, details: string }}
 */
function failedReasonOf(stored) {
    const raw = stored == null ? '' : String(stored).trim();
    if (!raw) {
        return {
            reason: "Couldn't send this transaction. The wallet did not record a specific reason.",
            details: '',
        };
    }
    const h = humanizeError(raw, 'send this transaction');
    return { reason: h.message, details: raw };
}

const DESTINATION_SLOT = '\u0000';

/**
 * One decoded output, "+100 BTC to <address>". The address keeps both ends
 * on one line with a copy button after it; printed whole, it wrapped across
 * two lines on a phone with no way to copy it.
 */
function PendingOutputLine({ text, destination }) {
    const [before, after = ''] = String(text).split(DESTINATION_SLOT);
    if (!destination) return <>{before}{after}</>;
    return (
        <span className={styles.copyableValue}>
            <span className={styles.copyableText}>
                {before}
                <AddressText address={destination} size="md" />
                {after}
            </span>
            <HistoryCopyButton
                value={destination}
                label={t('history.copy.walletAddress')}
                visibleLabel={t('common.copy')}
            />
        </span>
    );
}

/**
 * M2.3 pending branch of the detail card. Everything a user can be told
 * honestly about a transaction that has been sent and not yet indexed:
 * which of the five states it is in, when the network first reported it,
 * what it is about to do, and the one sentence that has to survive every
 * rewrite of this panel, that nothing has validated it yet.
 *
 * Deliberately absent: any SPV or LINK section. Both need an indexed
 * action, and rendering them empty reads as a fetch that failed rather
 * than as a stage that has not happened.
 *
 * @param {{ entry: any, balancesHidden?: boolean }} props
 */
function PendingDetailPanel({ entry, balancesHidden = false, onDismissFailed, transferDirection = null }) {
    const state = pendingStateOf(entry);
    const copy = state ? pendingCopyFor(state, entry) : null;
    const warning = state != null && PENDING_WARNING_STATES.has(state);
    const settled = state === 'confirmed';
    const failed = state === 'failed';
    const meta = entry?.pending || null;
    const failure = failed ? failedReasonOf(meta?.error) : null;
    const desc = describePendingAction(entry);
    const amountOf = (value) => (balancesHidden
        ? '•••••'
        : formatHistoryAmount(value, historyAmountDirection(entry)));

    return (
        <section
            className={`${styles.pendingPanel} ${warning ? styles.pendingPanelWarning : ''}`}
            aria-label={t(settled
                ? 'pending.detail.confirmedSectionLabel'
                : failed ? 'pending.detail.failedSectionLabel' : 'pending.detail.sectionLabel')}
        >
            {copy ? (
                <>
                    <p className={styles.pendingHeadline}>{t(copy.headline)}</p>
                    <p className={styles.pendingHelp}>{t(copy.help)}</p>
                </>
            ) : null}
            {/* The honesty line (§7). A mempool sighting is not
                acceptance: the indexer can still reject this action when
                the block lands, so it renders in every pending state. A
                proven block is the one thing that retires it, and the
                block takes its place. A failure has nothing left to
                validate; the recorded reason takes the line instead. */}
            {settled ? (
                meta?.confirmedBlockIndex ? (
                    <p className={styles.pendingTiming}>
                        {t('pending.detail.confirmedBlock', { block: String(meta.confirmedBlockIndex) })}
                    </p>
                ) : null
            ) : failed ? (
                <>
                    {failure?.reason ? (
                        <p className={styles.pendingNotValidated}>{failure.reason}</p>
                    ) : null}
                    {failure?.details ? (
                        <details className={styles.pendingTiming}>
                            <summary>{t('pending.detail.technicalDetails')}</summary>
                            <code>{failure.details}</code>
                        </details>
                    ) : null}
                    {typeof onDismissFailed === 'function' && meta?.pendingTxId ? (
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => onDismissFailed(meta.pendingTxId)}
                        >
                            {t('pending.detail.dismissFailed')}
                        </Button>
                    ) : null}
                </>
            ) : state === 'replaced-elsewhere' ? null : (
                // A send spent around has nothing left to validate: its
                // headline already says it won't confirm.
                <p className={styles.pendingNotValidated}>{t('pending.detail.notValidated')}</p>
            )}

            {meta?.firstSeenMs ? (
                <p className={styles.pendingTiming}>
                    <RelativeTime timestamp={meta.firstSeenMs}>
                        {(when) => t('pending.detail.firstSeen', { when })}
                    </RelativeTime>
                </p>
            ) : null}
            {meta?.broadcastAtMs ? (
                <p className={styles.pendingTiming}>
                    <RelativeTime timestamp={meta.broadcastAtMs}>
                        {(when) => t('pending.detail.broadcastAt', { when })}
                    </RelativeTime>
                </p>
            ) : null}
            {meta?.replaced && meta.replacementTxHash ? (
                <p className={styles.pendingTiming}>
                    {t('pending.detail.replacementTx', {
                        txHash: shortenAddress(meta.replacementTxHash),
                    })}
                </p>
            ) : null}

            {/* A settled record with nothing decodable has nothing to
                promise under this heading: "not reported yet" would say
                more data is coming, and none is. */}
            {settled && desc.kind === 'none' ? null : (
                <SectionHeader
                    title={t('pending.detail.decodedHeading')}
                    className={styles.detailSectionHeading}
                />
            )}
            {desc.kind === 'send' || desc.kind === 'local' ? (
                <ul className={styles.pendingOutputs}>
                    {desc.outputs.map((o, i) => (
                        <li key={`${o.destination}:${i}`}>
                            <PendingOutputLine
                                text={t('pending.detail.sendOutput', {
                                    amount: amountOf(o.amount),
                                    tick: o.tick,
                                    destination: DESTINATION_SLOT,
                                })}
                                destination={o.destination}
                            />
                            {o.memo ? (
                                <span className={styles.pendingMemo}>
                                    {' '}{t('pending.detail.memo', { memo: o.memo })}
                                </span>
                            ) : null}
                        </li>
                    ))}
                </ul>
            ) : null}
            {/* The note promises data the network has "not reported yet";
                for a settled transaction nothing more is coming, so the
                outputs stand on their own. */}
            {desc.kind === 'local' && !settled ? (
                <p className={styles.pendingHelp}>{transferDirection === 'in'
                    ? t('pending.detail.localRecordNoteIn')
                    : transferDirection === 'self'
                        ? t('pending.detail.localRecordNoteSelf')
                        : t('pending.detail.localRecordNote')}</p>
            ) : null}
            {desc.kind === 'segments' ? (
                <>
                    <p className={styles.pendingHelp}>
                        {t('pending.detail.undecodable', { action: actionDisplayLabel(desc.action) })}
                    </p>
                    <ul className={styles.pendingSegments}>
                        {desc.segments.map((seg, i) => (
                            <li key={`${i}:${seg}`}><code>{seg}</code></li>
                        ))}
                    </ul>
                </>
            ) : null}
            {desc.kind === 'none' ? (
                <p className={styles.pendingHelp}>{t('pending.detail.noData')}</p>
            ) : null}
        </section>
    );
}

function capitalize(s) {
    if (typeof s !== 'string' || s.length === 0) return '';
    return s[0].toUpperCase() + s.slice(1);
}

/**
 * Build the rows shown in the "Action details" table at the top of
 * ActionDetail. Each tuple is `[label, value]`. Empty / missing fields
 * are skipped so the table only shows what's actually populated.
 */
function basicDetailRows(entry, chainTip, nativeAmount, nativeFiatValue, balancesHidden, fiatCurrency, transferDirection = null) {
    if (!entry) return [];
    const rows = [];

    // Action: just the colored bubble. The action number now lives
    // on its own "Index" row below Block.
    rows.push(['Action', (
        <span className={styles.actionTag}>{entry.action ? detailActionLabel(entry, transferDirection) : '-'}</span>
    )]);

    // Fiat-display toggle. Only rendered when the caller resolved a
    // native-coin amount for this entry (see nativeAmountFieldOf) - token
    // amounts never reach here, so there's no coin-rate-on-token bug to
    // replicate.
    if (nativeAmount != null) {
        const nativeCoin = coinOfChainId(entry.chainId);
        const nativeTick = NATIVE_TICKER_BY_COIN(
            chainRegistry.get(entry.chainId) || (nativeCoin ? { coin: nativeCoin } : null),
        ) || '';
        const amountSpeech = balancesHidden
            ? 'Amount hidden'
            : formatHistoryAmountForSpeech(
                nativeAmount,
                nativeTick,
                historyAmountDirection(entry),
            );
        const fiatSpeech = nativeFiatValue != null && !balancesHidden
            ? formatFiatAmountForSpeech(nativeFiatValue, fiatCurrency)
            : '';
        rows.push(['Amount', (
            <span aria-label={`${amountSpeech}${fiatSpeech ? `, approximately ${fiatSpeech}` : ''}`}>
                {balancesHidden
                    ? '•••••'
                    : formatHistoryAmount(nativeAmount, historyAmountDirection(entry))}
                {' '}{nativeTick}
                {nativeFiatValue != null ? (
                    <span className={styles.rowRelativeTime}>
                        {' '}(≈ {balancesHidden ? '•••' : formatFiat(nativeFiatValue, fiatCurrency)})
                    </span>
                ) : null}
            </span>
        )]);
    }

    // Status: second, so success / failure is visible immediately.
    const status = classifyEntryStatus(entry);
    const statusLabel = status === 'confirmed' ? 'Confirmed'
        : status === 'failed' ? 'Failed'
        : 'Pending';
    const statusColorClass = status === 'confirmed' ? styles.statusPillSuccess
        : status === 'failed' ? styles.statusPillError
        : styles.statusPillPending;
    rows.push(['Status', (
        <span className={`${styles.statusBubble} ${statusColorClass}`}>{statusLabel}</span>
    )]);

    // Hero stays minimal: Action, Status, and Time only. Block,
    // Index, Tx hash, Source, Destination, Amount, Memo, and every
    // per-action field live in the Details tab below.
    if (entry.timestamp) rows.push(['Time', formatTimestamp(entry.timestamp)]);
    return rows;
}

/**
 * A Details value for an identifier (an address, a transaction ID, an action
 * number). A long identifier is AddressText in its fit form (G99): whole when
 * it fits the row, cut in the middle only when it does not. No copy button
 * rides beside it (operator ruling 2026-11-13): copying lives in the Actions
 * list, as Copy receipt and Share receipt.
 */
function DetailValue({ display, fullValue }) {
    const full = String(fullValue ?? '');
    const identifier = typeof display === 'string' && display === full && full.length > 14 && !/\s/.test(full);
    return (
        <span className={styles.copyableText}>
            {identifier ? <AddressText address={full} size="md" /> : display}
        </span>
    );
}

function HistoryCopyButton({ value, label = t('history.copy.clipboard'), visibleLabel = label }) {
    const [copied, setCopied] = useState(false);
    const onCopied = () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };
    return (
        <span
            role="status"
            aria-live="polite"
            title={copied ? t('history.copy.copiedTitle') : label}
        >
            <CopyButton
                value={value}
                label={visibleLabel}
                ariaLabel={label}
                onCopied={onCopied}
            />
            <span className={styles.visuallyHidden}>
                {copied ? t('history.copy.copied') : ''}
            </span>
        </span>
    );
}

const DETAIL_FIELD_LABELS = Object.freeze({
    action: 'Action',
    action_index: 'Action number',
    address: 'Address',
    block_index: 'Block',
    chain: 'Network',
    chain_id: 'Network',
    destination: 'To',
    source: 'From',
    time: 'Time',
    timestamp: 'Time',
    tx_hash: 'Transaction ID',
});

/** Turn a protocol field name into the label shown in the Details table. */
function detailFieldLabel(key) {
    const normalized = String(key || '')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[\s-]+/g, '_')
        .toLowerCase();
    if (DETAIL_FIELD_LABELS[normalized]) return DETAIL_FIELD_LABELS[normalized];
    const words = normalized.replace(/_+/g, ' ').trim();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Field';
}

/** Translate wire enum values while leaving identifiers and free text intact. */
function detailValue(value, key) {
    if (typeof value !== 'string') return value;
    const normalizedKey = String(key || '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
    if (!/(^|_)(status|state|side|direction|type)$/.test(normalizedKey)) return value;
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(value)) return value;
    const words = value.toLowerCase().replace(/[_-]+/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A raw field that holds a transaction ID or an address, shown as one. */
function isIdentifierDetailField(key) {
    const normalized = String(key || '')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .toLowerCase();
    return /(^|_)(tx_hash|txid|transaction_id)$/.test(normalized)
        || normalized === 'source' || normalized === 'from'
        || normalized === 'destination' || normalized === 'to'
        || normalized.includes('address');
}

/**
 * Comprehensive field-by-field dump shown in the Details tab. Lists
 * every entry-level identifier plus every key in `entry.raw`, in a
 * stable order so the user can scan all values associated with the
 * transaction in one place. The curated hero table at the top of the
 * page covers the most-relevant fields; this is the long-form view.
 */
function fullDetailRows(entry, balancesHidden = false, chainTip = null, walletAddresses = null, explorerLinks = []) {
    if (!entry) return [];
    const rows = [];
    const raw = entry.raw || {};
    const transfer = detailTransfer(entry, walletAddresses);
    const action = String(entry.action || '').toUpperCase();
    const rawAsset = firstPopulatedValue(raw, ['tick', 'TICK', 'token', 'TOKEN']);
    const asset = rawAsset || (action === 'SEND' || action === 'RECEIVE'
        ? nativeTickerForEntry(entry)
        : null);
    const amount = firstPopulatedValue(raw, ['amount', 'AMOUNT', 'quantity', 'QUANTITY']);
    const fee = firstPopulatedValue(entry, ['fee', 'networkFee', 'network_fee'])
        || firstPopulatedValue(raw, [
            'network_fee', 'networkFee', 'miner_fee', 'minerFee', 'tx_fee', 'txFee', 'fee', 'FEE',
        ]);
    const nativeTicker = nativeTickerForEntry(entry);
    const explicitConfirmations = firstPopulatedValue(entry, ['confirmations'])
        || firstPopulatedValue(raw, ['confirmations', 'CONFIRMATIONS']);
    const block = finitePositiveNumber(entry.blockIndex ?? raw.block_index ?? raw.blockIndex);
    const tip = finitePositiveNumber(chainTip);
    const confirmations = finiteNonNegativeNumber(explicitConfirmations)
        ?? (block != null && tip != null && tip >= block ? tip - block + 1 : null);
    const timestamp = entry.timestamp ?? raw.timestamp ?? raw.block_time ?? raw.blockTime;
    const memo = firstPopulatedValue(raw, ['memo', 'MEMO']);
    const primaryExplorer = Array.isArray(explorerLinks) ? explorerLinks[0] : null;
    const actionIndex = firstPopulatedValue(entry, ['actionIndex']);
    const txHash = firstPopulatedValue(entry, ['txHash', 'txid']);
    const entrySource = firstPopulatedValue(entry, ['source']);
    const walletAddress = firstPopulatedValue(entry, ['address']);

    if (entry.action) rows.push(['Action', detailActionLabel(entry, transfer.amountDirection)]);
    if (actionIndex) {
        rows.push(['Action number', String(actionIndex)]);
    }
    // The chain family reads from the chainId (e.g. 'bitcoin-regtest').
    // The network kind is not printed: the wallet never labels it (the
    // network is a Settings choice), so a "Network: Regtest" row was the one
    // place the detail page did.
    if (entry.chainId) {
        const [coin = ''] = String(entry.chainId).split('-');
        if (coin) rows.push(['Network', capitalize(coin)]);
    }
    if (txHash) {
        rows.push(['Transaction ID', <DetailValue display={txHash} fullValue={txHash} />]);
    }
    if (entrySource) {
        rows.push(['From', <DetailValue display={entrySource} fullValue={entrySource} />]);
    }
    if (walletAddress) {
        rows.push(['Address', <DetailValue display={walletAddress} fullValue={walletAddress} />]);
    }

    rows.push(['Direction', transfer.label]);
    rows.push(['Amount', amount != null && asset && isDisplayableAmount(amount) ? (
        balancesHidden
            ? `••••• ${asset}`
            : `${formatDetailAmount(amount, transfer.amountDirection)} ${asset}`
    ) : '-']);
    rows.push(['Network fee', fee != null && nativeTicker ? (
        balancesHidden ? `••••• ${nativeTicker}` : `${formatDisplayAmount(fee)} ${nativeTicker}`
    ) : '-']);
    rows.push(['Counterparty', transfer.counterparty ? (
        <DetailValue
            display={transfer.counterparty}
            fullValue={transfer.counterparty === 'Self' ? entry.address : transfer.counterparty}
        />
    ) : '-']);
    rows.push(['Confirmations', confirmations == null ? '-' : formatDecimalAmount(confirmations)]);
    rows.push(['Block', block == null ? '-' : String(block)]);
    rows.push(['Time', formatTimestamp(timestamp)]);
    rows.push(['Memo', memo ?? '-']);
    rows.push(['Explorer', primaryExplorer?.url ? (
        <a href={primaryExplorer.url} target="_blank" rel="noopener noreferrer">{t('history.detail.openInExplorer')} <span aria-hidden="true">↗</span></a>
    ) : '-']);

    // Every other raw key, sorted alphabetically. Skip the
    // entry-level fields we already surfaced above so we don't print
    // the same datum twice (matched by snake_case and camelCase).
    // `params` is also skipped because the synth fixtures nest the
    // same fields there as at the top level; would render twice.
    const skipKeys = new Set([
        'action', 'ACTION',
        'action_index', 'actionIndex', 'ACTION_INDEX',
        'chain_id', 'chainId', 'CHAIN_ID',
        'block_index', 'blockIndex', 'BLOCK_INDEX',
        'timestamp', 'block_time', 'BLOCK_TIME',
        'tx_hash', 'txHash', 'TX_HASH',
        'source', 'SOURCE',
        'address', 'ADDRESS',
        'amount', 'AMOUNT', 'quantity', 'QUANTITY',
        'memo', 'MEMO',
        'network_fee', 'networkFee', 'miner_fee', 'minerFee',
        'tx_fee', 'txFee', 'fee', 'FEE',
        'confirmations', 'CONFIRMATIONS',
        'params', 'PARAMS',
    ]);
    const rawKeys = Object.keys(raw).sort();
    for (const k of rawKeys) {
        if (skipKeys.has(k)) continue;
        const v = raw[k];
        let display;
        if (isEmptyDetailValue(v)) {
            display = '-';
        } else if (balancesHidden && AMOUNT_KEY_RE.test(k)) {
            display = '•••••';
        } else if (isRemovedAccessListValue(k, v)) {
            display = 'None';
        } else if (isOraclePricedGetAmount(entry, raw, k, v)) {
            // Drop the wire 0: next to an amount it reads as free.
            const fiat = String(raw.fiat_code ?? raw.FIAT_CODE ?? '').trim();
            display = fiat
                ? `Varies: set from the oracle's ${fiat} price at each purchase`
                : "Varies: set from the oracle's price at each purchase";
        } else if (AMOUNT_KEY_RE.test(k) && /^[-+]?\d+(?:\.\d+)?$/.test(String(v))) {
            const isPrimarySendAmount = String(entry.action || '').toUpperCase() === 'SEND'
                && /^(amount|quantity)$/i.test(k);
            display = isPrimarySendAmount
                ? (
                    <span aria-label={formatHistoryAmountForSpeech(
                        v,
                        raw.tick ?? raw.TICK ?? raw.token ?? '',
                        historyAmountDirection(entry),
                    )}
                    >
                        {formatHistoryAmount(v, historyAmountDirection(entry))}
                    </span>
                )
                : formatDisplayAmount(v);
        } else if (typeof v === 'number' || (typeof v === 'string' && /^-?\d+$/.test(v))) {
            display = formatNumberWithCommas(v);
        }
        else if (typeof v === 'object') {
            try { display = JSON.stringify(v); } catch { display = String(v); }
        } else if (typeof v === 'string') {
            display = detailValue(String(v), k);
        } else {
            display = String(v);
        }
        rows.push([detailFieldLabel(k), isIdentifierDetailField(k) && typeof v !== 'object' ? (
            <DetailValue display={display} fullValue={String(v ?? '')} />
        ) : display]);
    }

    return rows;
}

function firstPopulatedValue(source, keys) {
    for (const key of keys) {
        const value = source?.[key];
        if (!isEmptyDetailValue(value)) return String(value).trim();
    }
    return null;
}

function finitePositiveNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
}

function finiteNonNegativeNumber(value) {
    if (isEmptyDetailValue(value)) return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
}

function nativeTickerForEntry(entry) {
    const coin = coinOfChainId(entry?.chainId);
    const descriptor = chainRegistry.get(entry?.chainId) || (coin ? { coin } : null);
    return NATIVE_TICKER_BY_COIN(descriptor) || '';
}

function formatDetailAmount(amount, direction) {
    const formatted = formatHistoryAmount(amount, direction);
    if (direction !== 'self' || !formatted || /^[+-]/.test(String(amount).trim())) return formatted;
    return /[1-9]/.test(String(amount)) ? `±${formatted}` : formatted;
}

function detailTransfer(entry, walletAddresses) {
    const raw = entry?.raw || {};
    const source = firstPopulatedValue(raw, ['source', 'SOURCE'])
        || firstPopulatedValue(entry, ['source']);
    const destination = firstPopulatedValue(raw, ['destination', 'DESTINATION', 'recipient', 'RECIPIENT']);
    const own = new Set(
        (walletAddresses instanceof Set ? [...walletAddresses] : (walletAddresses || []))
            .map((address) => String(address).toLowerCase()),
    );
    if (entry?.address) own.add(String(entry.address).toLowerCase());
    const sourceIsOurs = Boolean(source) && own.has(source.toLowerCase());
    const destinationIsOurs = Boolean(destination) && own.has(destination.toLowerCase());
    const action = String(entry?.action || '').toUpperCase();
    const peer = peerAddressOfEntry(entry);
    const safePeer = isEmptyDetailValue(peer) ? null : peer;
    if (action !== 'SEND' && action !== 'RECEIVE') {
        return { label: '-', amountDirection: null, counterparty: safePeer };
    }
    if (sourceIsOurs && destinationIsOurs) {
        return { label: 'Self', amountDirection: 'self', counterparty: 'Self' };
    }
    const pendingDirection = entry?.pending?.direction;
    const direction = sourceIsOurs ? 'out'
        : destinationIsOurs ? 'in'
        : pendingDirection === 'out' || pendingDirection === 'in' ? pendingDirection
        : source && entry?.address ? 'in'
        : null;
    if (direction === 'out') {
        return { label: 'Sent', amountDirection: 'out', counterparty: destination };
    }
    if (direction === 'in') {
        return { label: 'Received', amountDirection: 'in', counterparty: source };
    }
    return { label: '-', amountDirection: null, counterparty: safePeer };
}

/**
 * Which way a SEND or RECEIVE row moved value, resolved the same way the
 * detail table's Sent / Received row is: 'in', 'out', 'self', or null when
 * the row is not a transfer or its direction is unknown. The detail page
 * header names the transaction by this, so an incoming SEND reads Receive.
 *
 * @param {any} entry
 * @param {Iterable<string> | null | undefined} walletAddresses
 * @returns {'in' | 'out' | 'self' | null}
 */
export function detailTransferDirection(entry, walletAddresses) {
    return detailTransfer(entry, walletAddresses).amountDirection;
}

/**
 * The name the detail page gives the action: a plain transfer is named by
 * the way value moved (the protocol calls both sides SEND, so an incoming
 * one would read as money leaving), and every other action keeps its
 * protocol name.
 *
 * @param {any} entry
 * @param {'in' | 'out' | 'self' | null} direction  from detailTransferDirection
 * @returns {string}
 */
export function detailActionLabel(entry, direction) {
    const action = String(entry?.action || '').toUpperCase();
    if (action === 'SEND' || action === 'RECEIVE') {
        if (direction === 'in') return actionDisplayLabel('RECEIVE');
        if (direction === 'out' || direction === 'self') return actionDisplayLabel('SEND');
    }
    return actionDisplayLabel(entry?.action);
}

function isEmptyDetailValue(value) {
    if (value == null || value === '' || (typeof value === 'number' && !Number.isFinite(value))) return true;
    return typeof value === 'string' && /^(?:|undefined|null|nan|[+-]?infinity)$/i.test(value.trim());
}

function isRemovedAccessListValue(key, value) {
    return ['allow_list', 'ALLOW_LIST', 'block_list', 'BLOCK_LIST'].includes(key)
        && Number(value) === 0;
}

function isOraclePricedGetAmount(entry, raw, key, value) {
    const action = entry.action || raw.action || raw.ACTION;
    const oracle = raw.oracle_address ?? raw.ORACLE_ADDRESS;
    return String(action || '').toUpperCase() === 'DISPENSER'
        && (key === 'get_amount' || key === 'GET_AMOUNT')
        && Boolean(String(oracle || '').trim())
        && Number(value) === 0;
}

// Thousands-separated formatting that handles strings of digits (which
// is how the explorer / synth data delivers large integer amounts) as
// well as JS numbers. Uses BigInt for pure-integer strings so values
// past Number.MAX_SAFE_INTEGER still round-trip correctly.
function formatNumberWithCommas(value) {
    return formatDecimalAmount(value);
}

/**
 * Per-chain block-explorer link list. Demo entries (synthesized
 * tx hashes) get no links since they wouldn't resolve. Always
 * surfaces the XChain explorer when an action index or transaction id
 * is available.
 */
function explorerLinksFor(entry, settings) {
    const links = [];
    if (!entry) return links;
    const txHash = firstPopulatedValue(entry, ['txHash', 'txid']);
    const actionIndex = firstPopulatedValue(entry, ['actionIndex']);
    const [coin = '', networkKind = 'mainnet'] = String(entry.chainId || '').split('-');

    // XChain actions have their own detail page. Plain transfers keep the
    // third-party transaction links below when that network has coverage.
    const hasActionIndex = actionIndex != null;
    const xchainUrl = (hasActionIndex || txHash) ? explorerPageUrl({
        chainId: entry.chainId,
        kind: hasActionIndex ? 'action' : 'transaction',
        value: hasActionIndex ? actionIndex : txHash,
        settings,
    }) : null;
    if (xchainUrl) {
        links.push({
            id: 'xchain',
            label: 'XChain',
            iconImg: branding.explorerLogoUrl('xchain'),
            url: xchainUrl,
        });
    }

    // External chain explorers: only mainnet and testnet have
    // working third-party coverage. Regtest is local-only; suppress
    // external links so they don't render mainnet URLs that 404.
    const descriptor = chainRegistry.get(entry.chainId) || { coin, networkKind };
    // Each third-party explorer shows its own bundled logo (never a remote
    // iconImg a registry entry names).
    links.push(...transactionExplorerLinks(descriptor, txHash).map((link) => ({
        ...link,
        iconImg: branding.explorerLogoUrl(link.id) ?? undefined,
    })));
    return links;
}

/**
 * §31.4 / Cluster O FOLLOWUP 2: recipient list for DIVIDEND / AIRDROP
 * rows. The recipient set is derived (holders of TICK for DIVIDEND, the
 * referenced LIST's ITEM array for AIRDROP), so the user has to opt in
 * to the fetch by clicking Show recipients. Once loaded, a "Save N as
 * one contact" affordance bulk-saves the addresses into a single
 * Contact record with N entries; the address-book grouping that
 * matches the data model best (one DIVIDEND / AIRDROP = one address
 * book).
 *
 * @param {{ entry: any, walletId?: string | null }} props
 */
function RecipientsBlock({ entry, walletId }) {
    const { messaging } = useMessaging();
    const { offline: networkOffline } = useNetworkOffline({ walletId });
    const networkAvailable = !networkOffline;
    const action = String(entry?.action || '').toUpperCase();
    const isDividend = action === 'DIVIDEND';
    const isAirdrop = action === 'AIRDROP';
    const supported = isDividend || isAirdrop;

    const [stage, setStage] = useState(/** @type {'idle' | 'loading' | 'loaded' | 'saving' | 'saved'} */ ('idle'));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [recipients, setRecipients] = useState(/** @type {object[]} */ ([]));
    const [snapshotNote, setSnapshotNote] = useState(/** @type {string | null} */ (null));
    const [name, setName] = useState('');

    if (!supported) return null;
    if (typeof messaging?.getDividendRecipients !== 'function'
        && typeof messaging?.getAirdropRecipients !== 'function') {
        // No host wiring; degrade silently.
        return null;
    }

    const coin = coinOfChainId(entry?.chainId);
    if (!coin) return null;

    const tick = String(entry?.raw?.TICK || entry?.raw?.tick || '').trim();
    const listIdx = String(entry?.raw?.LIST_ACTION_INDEX || entry?.raw?.list_action_index || '').trim();
    const defaultName = isDividend
        ? `${actionDisplayLabel('DIVIDEND')} #${entry?.actionIndex || '?'}${tick ? ` (${tick})` : ''} holders`
        : `${actionDisplayLabel('AIRDROP')} #${entry?.actionIndex || '?'}${listIdx ? ` (list #${listIdx})` : ''} recipients`;

    async function load() {
        setStage('loading');
        setError(null);
        try {
            const r = isDividend
                ? await messaging.getDividendRecipients({
                    chainId: entry.chainId,
                    actionIndex: String(entry.actionIndex),
                    tick: tick || undefined,
                })
                : await messaging.getAirdropRecipients({
                    chainId: entry.chainId,
                    actionIndex: String(entry.actionIndex),
                    listActionIndex: listIdx || undefined,
                });
            setRecipients(Array.isArray(r?.recipients) ? r.recipients : []);
            setSnapshotNote(typeof r?.snapshotNote === 'string' ? r.snapshotNote : null);
            setName(defaultName);
            setStage('loaded');
        } catch (err) {
            setError(userFacingMessage(err, 'Failed to load recipients.'));
            setStage('idle');
        }
    }

    async function handleSaveAll() {
        if (recipients.length === 0) return;
        if (!name.trim()) {
            setError('Name is required.');
            return;
        }
        setStage('saving');
        setError(null);
        try {
            await messaging.saveContact({
                input: {
                    name: name.trim(),
                    notes: '',
                    entries: recipients
                        .map((r) => r?.address)
                        .filter((a) => typeof a === 'string' && a.length > 0)
                        .map((address) => ({ chain: coin, address, label: '' })),
                },
            });
            setStage('saved');
        } catch (err) {
            setError(userFacingMessage(err, 'Could not save these recipients. Try again.'));
            setStage('loaded');
        }
    }

    const blockStyle = {
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--xc-space-1)',
        marginTop: 'var(--xc-space-2)',
    };
    const headingStyle = { color: 'var(--xc-text-muted)', fontSize: 'var(--xc-text-xs)' };

    if (stage === 'idle') {
        return (
            <div style={blockStyle}>
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={load}
                    disabled={!networkAvailable}
                    title={!networkAvailable ? OFFLINE_ACTION_REASON : undefined}
                    aria-describedby={!networkAvailable ? 'history-offline-action-reason' : undefined}
                >
                    {isDividend
                        ? t('history.recipients.showHolders')
                        : t('history.recipients.showRecipients')}
                </Button>
                <StatusMessage variant="error">{error}</StatusMessage>
            </div>
        );
    }
    if (stage === 'loading') {
        return (
            <div style={blockStyle}>
                <span style={headingStyle}>{isDividend
                    ? t('history.recipients.loadingHolders')
                    : t('history.recipients.loadingRecipients')}</span>
            </div>
        );
    }
    if (stage === 'saved') {
        return (
            <div style={blockStyle}>
                <StatusMessage variant="success">
                    {t('history.recipients.saved', { count: recipients.length, name: name.trim() })}
                </StatusMessage>
            </div>
        );
    }

    // stage === 'loaded' or 'saving'
    return (
        <div style={blockStyle}>
            <span style={headingStyle}>
                {isDividend
                    ? t('history.recipients.holderCount', { count: recipients.length })
                    : t('history.recipients.recipientCount', { count: recipients.length })}
            </span>
            {snapshotNote ? <span style={headingStyle}>{snapshotNote}</span> : null}
            {recipients.length > 0 ? (
                <div style={{
                    fontFamily: 'monospace',
                    fontSize: 'var(--xc-text-xs)',
                    color: 'var(--xc-text)',
                }}>
                    {recipients.slice(0, 20).map((r, i) => (
                        <div key={`${r.address}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--xc-space-1)' }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.address}</span>
                            {r.balance !== undefined ? <span style={{ color: 'var(--xc-text-muted)' }}>{r.balance}</span> : null}
                        </div>
                    ))}
                    {recipients.length > 20 ? (
                        <div style={{ color: 'var(--xc-text-muted)', marginTop: 'var(--xc-space-1)' }}>
                            {t('history.recipients.moreNotShown', { count: recipients.length - 20 })}
                        </div>
                    ) : null}
                </div>
            ) : (
                <EmptyState
                    title={isDividend
                        ? t('history.recipients.noHoldersFound')
                        : t('history.recipients.noRecipientsFound')}
                    body={isDividend
                        ? t('history.recipients.noHoldersBody')
                        : t('history.recipients.noRecipientsBody')}
                    titleAs="p"
                />
            )}
            {recipients.length > 0 ? (
                <div className={styles.recipientContactActions}>
                    <Input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={120}
                        aria-label={t('common.contactName')}
                        disabled={stage === 'saving'}
                    />
                    <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        loading={stage === 'saving'}
                        onClick={handleSaveAll}
                    >
                        {t('history.recipients.saveAsContact', { count: recipients.length })}
                    </Button>
                </div>
            ) : null}
            <StatusMessage variant="error">{error}</StatusMessage>
        </div>
    );
}

/**
 * Resolve an exact native-coin amount for `entry`, or `null` when the
 * amount can't be trusted to price against the chain's own coin rate.
 *
 * IMPORTANT (old-numbering): a SEND action carries a
 * `tick` for BOTH native-coin sends and token sends. Only a SEND whose
 * `tick` is absent or matches the chain's own native ticker (BTC/DOGE/LTC)
 * is a native-coin movement; a token SEND (tick = a protocol asset ticker)
 * must never be priced with the coin's fiat rate, so this returns null for
 * those. This is the deliberate fix for the known latent bug elsewhere in
 * the app that conflates token amounts with the coin rate - don't
 * replicate it here.
 *
 * @param {import('./History.jsx').HistoryEntry | null | undefined} entry
 * @returns {string | null}
 */
function nativeAmountFieldOf(entry) {
    if (!entry || String(entry.action || '').toUpperCase() !== 'SEND') return null;
    const coin = coinOfChainId(entry.chainId);
    const descriptor = chainRegistry.get(entry.chainId) || (coin ? { coin } : null);
    const nativeTicker = NATIVE_TICKER_BY_COIN(descriptor);
    if (!nativeTicker) return null;
    const raw = entry.raw || {};
    const tick = raw.tick ?? raw.TICK ?? raw.token;
    if (tick && String(tick).toUpperCase() !== nativeTicker) return null; // token movement
    const amt = raw.amount ?? raw.AMOUNT ?? raw.quantity ?? raw.QUANTITY;
    if (amt == null) return null;
    const amount = String(amt).trim();
    return /^-?\d+(\.\d+)?$/.test(amount) ? amount : null;
}

// Longer middle-ellipsis truncation used in the ActionDetail "Source"
// table cell. The cell has more horizontal room than the row meta so
// we can show more of each end before collapsing.
function shortenAddress(addr) {
    if (!addr) return '';
    if (addr.length <= 26) return addr;
    return `${addr.slice(0, 16)}…${addr.slice(-8)}`;
}

// Field names whose values are financial amounts the privacy toggle
// should opaque. Matched case-insensitively against both snake_case and
// camelCase variants. Keep this conservative: only known amount-bearing
// keys, not address / index / status fields.
const AMOUNT_KEY_RE = /^(amount|quantity|supply|max_supply|maxSupply|give_amount|giveAmount|get_amount|getAmount|give_remaining|giveRemaining|get_remaining|getRemaining|escrow_quantity|escrowQuantity|mainchainrate|dispense_quantity|dispenseQuantity|dispense_count|dispenseCount|fee|fee_per_kb|feePerKb)$/i;

// The Action detail page lays the same facts out its own way (a hero, a
// status bar and the Actions | Details toggle), so it reads them through
// these rather than keeping a second copy of each rule.
export {
    DetailValue,
    RecipientsBlock,
    detailTransfer,
    explorerLinksFor,
    failedReasonOf,
    firstPopulatedValue,
    formatDetailAmount,
    fullDetailRows,
    isEmptyDetailValue,
    nativeTickerForEntry,
};
