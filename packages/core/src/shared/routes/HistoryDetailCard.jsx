// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useRef, useState } from 'react';
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
import { useFiatRate } from '../hooks/useFiatRate.js';
import { formatFiat } from '../components/BalanceList.jsx';
import { coinToFiatExact } from '../../flows/priceLookup.js';
import { useToast } from '../components/ToastHost.jsx';
import { ConfirmModal } from '../components/ConfirmModal.jsx';
import { useConfirmModal } from '../hooks/useConfirmModal.js';
import { tickerForCoin, transactionExplorerLinks } from '../../registry/coinTicker.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/history.js';
import '../../i18n/locales/en/pending.js';
import { humanizeError } from '../utils/humanizeError.js';
import { actionDisplayLabel } from '../utils/actionDisplayLabel.js';
import { TxStatusTimeline } from '../components/TxStatusTimeline.jsx';
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
import { NATIVE_TICKER_BY_COIN, OFFLINE_ACTION_REASON, PENDING_WARNING_STATES, chainRegistry, coinOfChainId, describePendingAction, formatTimestamp, historyAmountDirection, peerAddressOfEntry, peerCacheKey, pendingCopyFor, pendingStateOf } from './HistoryShared.jsx';

// Image sources here are bundled assets. Third-party explorers use the local
// letter badge path below so opening History never fetches a remote favicon.
function ExplorerFavicon({ src, label }) {
    const [failed, setFailed] = useState(false);
    if (failed) {
        return <span className={styles.detailActionIcon} aria-hidden="true">{String(label).charAt(0)}</span>;
    }
    return (
        <img
            src={src}
            alt=""
            aria-hidden="true"
            className={styles.detailActionFavicon}
            onError={() => setFailed(true)}
        />
    );
}

/**
 * Inline detail card. For LINK-threaded entries we render two
 * `detailSide` blocks side-by-side; for everything else, one block.
 */
export function DetailCard({ entry, peerCache, chainTip, indexerWatermark, walletId, showFiatInHistory, fiatCurrency, walletAddresses, onDismissFailed, networkAvailable = true }) {
    const { messaging, shell } = useMessaging();
    const { showToast } = useToast();
    const { settings, loading: settingsLoading } = useSettings();
    // Speed up and Cancel sign a replacement, which a watch-only wallet
    // cannot do, so they wait for the wallet mode; a failed settings read
    // opens in full mode.
    const walletModeReady = settings !== null || !settingsLoading;
    const isWatcherMode = settings?.walletMode === 'watcher';
    const [balancesHidden] = useBalancesHidden();
    const rbfConfirm = useConfirmModal();
    const [activeDetailTab, setActiveDetailTab] = useState(/** @type {'status' | 'details' | 'raw'} */ ('status'));

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

    // ───── More-menu / Save-as-contact state ─────
    // Contacts are fetched once so the "already a contact" check can run
    // synchronously when deciding whether to expose the Save-as-contact
    // option in the More dropdown.
    const [contacts, setContacts] = useState(/** @type {any[]} */ ([]));
    const [contactsLoaded, setContactsLoaded] = useState(false);
    const [moreOpen, setMoreOpen] = useState(false);
    const [contactSaveStage, setContactSaveStage] = useState(
        /** @type {'hidden' | 'editing' | 'saving' | 'saved'} */ ('hidden'),
    );
    const [contactName, setContactName] = useState('');
    const [contactSaveError, setContactSaveError] = useState(/** @type {string | null} */ (null));
    const moreWrapRef = useRef(/** @type {HTMLDivElement | null} */ (null));

    // ───── RBF (Speed up / Cancel) state ─────
    // Exposed through the More menu now instead of as a standalone
    // button cluster below the tabs. The status message renders inline
    // between the action row and the tabs so the user sees the result
    // of their tap without scrolling.
    const [rbfBusy, setRbfBusy] = useState(/** @type {'speedup' | 'cancel' | null} */ (null));
    const [rbfError, setRbfError] = useState(/** @type {string | null} */ (null));
    const [rbfDone, setRbfDone] = useState(/** @type {string | null} */ (null));

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

    useEffect(() => {
        if (!moreOpen) return undefined;
        const onClick = (e) => {
            if (moreWrapRef.current?.contains(e.target)) return;
            setMoreOpen(false);
        };
        const onKey = (e) => { if (e.key === 'Escape') setMoreOpen(false); };
        window.addEventListener('mousedown', onClick);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', onClick);
            window.removeEventListener('keydown', onKey);
        };
    }, [moreOpen]);

    // M2.3: a pending entry has no block, so the LINK pairing it would
    // render has not been indexed either. Suppressed outright rather
    // than left to render an empty peer block that reads like a failed
    // fetch. It comes back on its own when the confirmed entry replaces
    // this one, because that entry carries the link record.
    const isLinked = Boolean(entry.link) && Number(entry.blockIndex) > 0;
    const peerKey = entry.link?.peerChainId && entry.link?.peerActionIndex
        ? peerCacheKey(entry.link.peerChainId, entry.link.peerActionIndex)
        : null;
    const peer = peerKey ? peerCache[peerKey] : null;
    const rbfDescriptor = chainRegistry.get(entry.chainId);
    const replaceable = isEntryReplaceable(entry, { descriptor: rbfDescriptor });
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
    // Redact entry + peer raw payloads before stringifying. Cheap walk;
    // returns the same shape so the JSON pretty-printer indents identically.
    const rawForDisplay = balancesHidden ? redactAmountFields(entry.raw) : entry.raw;
    const detailTabs = [
        { id: 'status',  label: 'Status'  },
        { id: 'details', label: 'Details' },
        { id: 'raw',     label: 'Raw data' },
    ];

    // Compute Save-as-contact saveability + assemble the More menu so
    // the rightmost button on the explorer row reads as a single
    // entry-point for follow-up actions instead of being buried below
    // the tab panels.
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
    async function runRbf(strategy) {
        if (rbfBusy) return;
        setMoreOpen(false);
        setRbfBusy(strategy);
        setRbfError(null);
        setRbfDone(null);
        try {
            const quote = await replaceFromHistoryEntry({
                messaging, entry, strategy, walletId, descriptor: rbfDescriptor, preview: true,
            });
            const ticker = tickerForCoin(rbfDescriptor?.coin);
            const confirmed = await rbfConfirm.confirm({
                title: strategy === 'cancel' ? 'Cancel this transaction?' : 'Speed up this transaction?',
                message: `Old fee: ${quote.originalFee} ${ticker}. `
                    + `New fee: ${quote.replacementFee} ${ticker}. `
                    + `Additional cost: ${quote.feeIncrease} ${ticker}.`,
                confirmLabel: strategy === 'cancel' ? 'Broadcast cancellation' : 'Broadcast replacement',
                danger: strategy === 'cancel',
            });
            if (!confirmed) return;
            const res = await replaceFromHistoryEntry({ messaging, entry, strategy, walletId, descriptor: rbfDescriptor });
            setRbfDone(`Replacement sent: ${res?.replacementTxHash || 'Pending'}`);
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
                            setRbfError(null);
                            try {
                                const undone = await undoCancel({ messaging, snapshot });
                                setRbfDone(`Re-sent: ${undone?.replacementTxHash || 'Pending'}`);
                            } catch (undoErr) {
                                setRbfError(rbfFailureMessage(undoErr, 'Could not undo the cancellation.'));
                            }
                        },
                    });
                }
            }
        } catch (err) {
            setRbfError(rbfFailureMessage(err, "Couldn't speed up or cancel this transaction. Try again later."));
        } finally {
            setRbfBusy(null);
        }
    }

    const moreOptions = [];
    if (canSaveContact) {
        moreOptions.push({
            id: 'save-contact',
            label: 'Save as contact',
            icon: <Icon.UsersIcon />,
            onClick: () => {
                setMoreOpen(false);
                setContactSaveStage('editing');
                setContactName('');
                setContactSaveError(null);
            },
        });
    }
    // A transaction we have already replaced still satisfies the field
    // contract `isEntryReplaceable` checks (it has a hash, no block, and
    // an allowlisted action), so the offer has to be withdrawn here.
    // Replacing a replacement bumps the fee on a transaction the network
    // has already dropped, spends a fee, and moves nothing.
    if (walletModeReady && !isWatcherMode && isReplaceCallAvailable(messaging) && replaceable.ok && !entry.pending?.replaced) {
        moreOptions.push({
            id: 'rbf-speedup',
            label: rbfBusy === 'speedup' ? 'Speeding up…' : 'Speed up transaction',
            icon: <Icon.ForwardIcon />,
            disabled: rbfBusy !== null || !networkAvailable,
            disabledReason: !networkAvailable ? OFFLINE_ACTION_REASON : undefined,
            onClick: () => runRbf('speedup'),
        });
        moreOptions.push({
            id: 'rbf-cancel',
            label: rbfBusy === 'cancel' ? 'Cancelling…' : 'Cancel transaction',
            icon: <Icon.XIcon />,
            danger: true,
            disabled: rbfBusy !== null || !networkAvailable,
            disabledReason: !networkAvailable ? OFFLINE_ACTION_REASON : undefined,
            onClick: () => runRbf('cancel'),
        });
    }
    // Receipt sharing is deliberately narrower than the detail payload. The
    // user opts into these six public transaction facts, never addresses,
    // memos, contact data, wallet identifiers, or arbitrary raw fields.
    const receipt = transactionReceiptText(entry, { settings, balancesHidden });
    moreOptions.push({
        id: 'share-receipt',
        label: 'Share receipt',
        icon: <Icon.UploadIcon />,
        onClick: async () => {
            setMoreOpen(false);
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
    moreOptions.push({
        id: 'copy-receipt',
        label: 'Copy receipt',
        icon: <Icon.CopyIcon />,
        onClick: async () => {
            setMoreOpen(false);
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

            {/* Action row: explorer links followed by a "More" button
                that drops down a list of follow-up actions (e.g. Save
                as contact, Speed up, Cancel). The More button always
                renders so users get a consistent place to look across
                every action type; when no actions apply, the menu
                surfaces a placeholder message instead.

                The row also renders with no explorer links when an entry
                has neither an action index nor a transaction id. Keeping
                the More menu independent preserves Speed up and Cancel for
                incomplete pending records. */}
            {explorerButtons.length > 0 || moreOptions.length > 0 ? (
                <div className={styles.detailActions} role="group" aria-label={t('history.detail.options')}>
                    {explorerButtons.map((link) => networkAvailable ? (
                        <a
                            key={link.id}
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.detailAction}
                        >
                            {link.iconImg ? (
                                <ExplorerFavicon src={link.iconImg} label={link.label} />
                            ) : (
                                <span className={styles.detailActionIcon} aria-hidden="true">{link.icon}</span>
                            )}
                            <span>{link.label} <span aria-hidden="true">↗</span></span>
                        </a>
                    ) : (
                        <Button
                            key={link.id}
                            variant="secondary"
                            block
                            icon={link.iconImg ? (
                                <ExplorerFavicon src={link.iconImg} label={link.label} />
                            ) : link.icon}
                            disabled
                            title={OFFLINE_ACTION_REASON}
                            aria-describedby="history-offline-action-reason"
                        >
                            {link.label}
                        </Button>
                    ))}
                    <div className={styles.detailActionMoreWrap} ref={moreWrapRef}>
                        <button
                            type="button"
                            className={styles.detailAction}
                            aria-haspopup="menu"
                            aria-expanded={moreOpen}
                            onClick={() => setMoreOpen((o) => !o)}
                        >
                            <span className={styles.detailActionIcon} aria-hidden="true"><Icon.MoreIcon /></span>
                            <span>{t('history.detail.more')}</span>
                        </button>
                        {moreOpen ? (
                            <div className={styles.moreMenu} role="menu">
                                {moreOptions.length > 0 ? (
                                    moreOptions.map((opt) => (
                                        /* Native menu items keep the menu role and its custom focus model. */
                                        <button
                                            key={opt.id}
                                            type="button"
                                            role="menuitem"
                                            data-destructive={opt.danger ? 'true' : undefined}
                                            className={styles.moreMenuItem}
                                            onClick={opt.onClick}
                                            disabled={Boolean(opt.disabled)}
                                            title={opt.disabledReason}
                                            aria-describedby={opt.disabledReason ? 'history-offline-action-reason' : undefined}
                                        >
                                            {opt.icon ? (
                                                <span className={styles.moreMenuItemIcon} aria-hidden="true">
                                                    {opt.icon}
                                                </span>
                                            ) : null}
                                            <span>{opt.label}</span>
                                        </button>
                                    ))
                                ) : (
                                    /* Native menu items keep the menu role and its custom focus model. */
                                    <button
                                        type="button"
                                        role="menuitem"
                                        className={styles.moreMenuItem}
                                        disabled
                                    >
                                        <span>{t('history.detail.noAdditionalActions')}</span>
                                    </button>
                                )}
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : null}

            {/* RBF status: surfaces the outcome of Speed up / Cancel
                picked from the More menu. Sits between the action row
                and the tab strip so the user sees the result without
                scrolling, mirroring the inline save-contact form. */}
            {rbfError ? (
                <StatusMessage variant="error" className={styles.rbfError}>{rbfError}</StatusMessage>
            ) : null}
            {rbfDone ? (
                <p className={styles.rbfDone} role="status">{rbfDone}</p>
            ) : null}

            {/* Inline Save-as-contact form. Shown when the user picks
                "Save as contact" from the More menu, sits between the
                action buttons and the tab strip so the user doesn't
                lose the page context the way the bottom-of-card prompt
                did. */}
            {contactSaveStage === 'editing' || contactSaveStage === 'saving' ? (
                <form className={styles.saveContactForm} onSubmit={handleSaveContact}>
                    <Input
                        type="text"
                        label={t('history.contact.saveAs', { address: shortenAddress(contactPeer || '') })}
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

            {/* Tab strip: matches Home's HomeTabs visual rhythm. */}
            <div className={styles.detailTabs} role="tablist" aria-label={t('history.detail.view')}>
                {detailTabs.map((t) => (
                    /* Native buttons preserve the tablist's roving tab semantics. */
                    <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={activeDetailTab === t.id ? 'true' : 'false'}
                        className={`${styles.detailTab} ${activeDetailTab === t.id ? styles.detailTabActive : ''}`}
                        onClick={() => setActiveDetailTab(t.id)}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            <section
                className={`${styles.detailSection} ${activeDetailTab === 'details' ? styles.detailSectionFlush : ''}`}
                role="tabpanel"
            >
                {/* Details tab: full field dump (every value associated
                    with the action), as opposed to the curated hero
                    table at the top. */}
                {activeDetailTab === 'details' ? (
                    <table className={styles.detailsTable}>
                        <tbody>
                            {fullRows.map(([label, value]) => (
                                <tr key={label}>
                                    <th scope="row">{label}</th>
                                    <td>{value}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : null}

                {activeDetailTab === 'status' ? (
                    <TxStatusTimeline entry={entry} chainTip={chainTip} indexerWatermark={indexerWatermark} />
                ) : null}

                {activeDetailTab === 'raw' ? (
                    <>
                        <div className={styles.rawJsonWrap}>
                            <span className={styles.rawJsonCopy}>
                                <HistoryCopyButton
                                    value={decodeActionToText(rawForDisplay)}
                                    label={t('history.detail.copyRawJson')}
                                />
                            </span>
                            <pre className={styles.detailDecoded} tabIndex={0}>
                                {decodeActionToText(rawForDisplay)}
                            </pre>
                        </div>
                        {isLinked ? (
                            <div className={styles.detailPeerBlock}>
                                <SectionHeader
                                    title={t('history.detail.peerHeading', {
                                        ticker: entry.link.peerCoinTicker,
                                        index: entry.link.peerActionIndex,
                                    })}
                                    className={styles.detailSectionHeading}
                                />
                                {peer?.loading ? (
                                    <StatusMessage>{t('history.detail.loadingPeer')}</StatusMessage>
                                ) : peer?.error ? (
                                    <StatusMessage variant="error">
                                        {t('history.detail.peerError', { error: peer.error })}
                                    </StatusMessage>
                                ) : peer?.action ? (
                                    <div className={styles.rawJsonWrap}>
                                        <span className={styles.rawJsonCopy}>
                                            <HistoryCopyButton
                                                value={decodeActionToText(balancesHidden ? redactAmountFields(peer.action) : peer.action)}
                                                label={t('history.detail.copyPeerRawJson')}
                                            />
                                        </span>
                                        <pre className={styles.detailDecoded} tabIndex={0}>
                                            {decodeActionToText(balancesHidden ? redactAmountFields(peer.action) : peer.action)}
                                        </pre>
                                    </div>
                                ) : (
                                    <EmptyState
                                        title={t('history.detail.peerUnavailableTitle')}
                                        body={t('history.detail.peerUnavailable', {
                                            ticker: entry.link.peerCoinTicker,
                                            index: entry.link.peerActionIndex,
                                        })}
                                        titleAs="h3"
                                    />
                                )}
                            </div>
                        ) : null}
                    </>
                ) : null}
            </section>

            {/* Interactive widgets appended below the static sections.
                Save-as-contact and Speed up / Cancel moved up to the
                More button in the action row; recipient bulk-save
                stays here because it's a per-row affordance for
                DIVIDEND / AIRDROP entries with its own UI. */}
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
            {rbfConfirm.request ? (
                <ConfirmModal
                    {...rbfConfirm.request}
                    onConfirm={rbfConfirm.onConfirm}
                    onCancel={rbfConfirm.onCancel}
                />
            ) : null}
        </div>
    );
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
                        {t('pending.detail.confirmedBlock', { block: meta.confirmedBlockIndex.toLocaleString() })}
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
 * Inline value + small copy-icon button. Used in the ActionDetail
 * table for fields a user typically needs to paste somewhere else
 * (action_index, tx_hash, source / destination addresses).
 */
/**
 * A Details value with its copy button after it. A long identifier (an
 * address, a transaction ID) keeps both ends on one line and copies in
 * full; the button says "Copy" and names what it copies to assistive tech.
 * The button used to sit first with its whole name as text, which wrapped
 * to two lines on a phone and pushed every value out of line.
 */
function CopyableValue({ display, fullValue, ariaLabel }) {
    const full = String(fullValue ?? '');
    const identifier = typeof display === 'string' && display === full && full.length > 14 && !/\s/.test(full);
    return (
        <span className={styles.copyableValue}>
            <span className={styles.copyableText}>
                {identifier ? <AddressText address={full} size="md" /> : display}
            </span>
            <HistoryCopyButton value={full} label={ariaLabel} visibleLabel={t('common.copy')} />
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

function copyLabelForDetailField(key) {
    const normalized = String(key || '')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .toLowerCase();
    if (/(^|_)(tx_hash|txid|transaction_id)$/.test(normalized)) return 'Copy transaction ID';
    if (normalized === 'source' || normalized === 'from') return 'Copy from address';
    if (normalized === 'destination' || normalized === 'to') return 'Copy to address';
    if (normalized.includes('address')) return `Copy ${detailFieldLabel(key).toLowerCase()}`;
    return null;
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
        rows.push(['Action number', (
            <CopyableValue
                display={formatDecimalAmount(actionIndex)}
                fullValue={actionIndex}
                ariaLabel={t('history.copy.actionNumber')}
            />
        )]);
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
        rows.push(['Transaction ID', (
            <CopyableValue
                display={txHash}
                fullValue={txHash}
                ariaLabel={t('common.copyTransactionId')}
            />
        )]);
    }
    if (entrySource) {
        rows.push(['From', (
            <CopyableValue
                display={entrySource}
                fullValue={entrySource}
                ariaLabel={t('history.copy.fromAddress')}
            />
        )]);
    }
    if (walletAddress) {
        rows.push(['Address', (
            <CopyableValue
                display={walletAddress}
                fullValue={walletAddress}
                ariaLabel={t('history.copy.walletAddress')}
            />
        )]);
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
        <CopyableValue
            display={transfer.counterparty}
            fullValue={transfer.counterparty === 'Self' ? entry.address : transfer.counterparty}
            ariaLabel={t('history.detail.copyCounterparty')}
        />
    ) : '-']);
    rows.push(['Confirmations', confirmations == null ? '-' : formatDecimalAmount(confirmations)]);
    rows.push(['Block', block == null ? '-' : formatDecimalAmount(block)]);
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
            display = '0 (protocol placeholder; price set by oracle)';
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
        const copyLabel = copyLabelForDetailField(k);
        rows.push([detailFieldLabel(k), copyLabel && typeof v !== 'object' ? (
            <CopyableValue
                display={display}
                fullValue={String(v ?? '')}
                ariaLabel={copyLabel}
            />
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
            iconImg: branding.faviconUrl(),
            url: xchainUrl,
        });
    }

    // External chain explorers: only mainnet and testnet have
    // working third-party coverage. Regtest is local-only; suppress
    // external links so they don't render mainnet URLs that 404.
    const descriptor = chainRegistry.get(entry.chainId) || { coin, networkKind };
    links.push(...transactionExplorerLinks(descriptor, txHash));
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

/**
 * Recursively replace amount-field values with `'•••••'`. Object / array
 * traversal is preserved so the rest of the structure stays readable
 * when the redacted result is JSON.stringify'd into the Raw tab or
 * fed into the Details table. Returns the input unchanged when it
 * contains no amount fields, so the React identity stays stable.
 */
function redactAmountFields(value) {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map(redactAmountFields);
    if (typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = AMOUNT_KEY_RE.test(k) ? '•••••' : redactAmountFields(v);
        }
        return out;
    }
    return value;
}

/** Render the row's raw fields as pretty-printed JSON for the detail card. */
function decodeActionToText(row) {
    if (!row) return '(No data)';
    try {
        return JSON.stringify(row, null, 2);
    } catch (err) {
        return userFacingMessage(err, 'This action data could not be displayed.');
    }
}
