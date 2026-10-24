// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { t } from '../../i18n/index.js';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { AddressField, AddressText, Button, ChainPicker, CopyButton, EmptyState, FeeSelector, FieldNote, FormNotice, FormPage, Input, ListPage, PageHeader, Screen, Select, StatusMessage, Textarea } from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    decoder as decoderLib,
    airdrop as airdropLib,
    schemas as schemasLib,
} from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { useGatedTickNotice, gatedTickWarningCopy } from '../hooks/useGatedTickNotice.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { AmountField } from '../components/AmountField.jsx';
import { useTickBalance } from '../hooks/useTickBalance.js';
import { useTokenInfo } from '../hooks/useTokenInfo.js';
import {
    compareDecimalStrings,
    formatWithThousands,
    subtractDecimalStrings,
    tokenAmountPrecisionError,
} from '../utils/amountFormat.js';
import {
    compareDecimal,
    perUnitMax,
    multiplyDecimal,
    exceedsBalance,
} from '../utils/dividendPerUnit.js';
import { LockedTokenContext } from '../components/LockedTokenContext.jsx';
import { TokenField } from '../components/TokenField.jsx';
import { TokenPicker } from './TokenPicker.jsx';
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useDropZone } from '../hooks/useDropZone.js';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { DiagnosticDetails } from '../components/DiagnosticDetails.jsx';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { extractHolderCount } from '../utils/holderRows.js';
import { extractActionIndex } from '../utils/actionIndexFromTx.js';
import styles from './IssueTokenForm.module.css';
import { preferredSourceId } from '../addressSelection.js';
import { pickDefaultChainId } from '../chainSelection.js';
import { submitFailureMessage, SIGNED_NOT_BROADCAST_MESSAGE } from '../utils/submitFailureMessage.js';
import { tickerReferenceError } from '../utils/tickerGrammar.js';
import { classifyTickItems } from '../utils/listTickItems.js';
import { currentListItems } from '../../flows/listMembership.js';
import { MEMO_HINT, memoLengthError } from '../utils/memoLimit.js';
import { listLabel } from '../utils/listLabel.js';
import { listStatusText } from '../utils/listItemStatusText.js';
import { readFailureMessage } from '../utils/readFailureMessage.js';
import { ADDRESS_REFERENCE_ITEM_MESSAGE, addressReferenceNote } from '../utils/addressReferenceCopy.js';
import {
    classifyRecipientEntries,
    classifyRecipientEntriesAsync,
    parseCsvEntries,
    parsePasteEntries,
} from '../../airdrop/parseRecipients.js';
import { maxListItemsThatFit, splitListItems } from '../../airdrop/listSizeLimit.js';

const chainRegistry = registryLib.defaultRegistry();
const POLL_INTERVAL_MS = 10_000;
const OWNED_LIST_REVALIDATE_MS = 16_000;

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

/**
 * Airdrop form: §40.9, extended by PC-11 with a source-mode selector.
 *
 * Three ways to pick who gets paid (`sourceMode`):
 *
 *   'paste'    (default) - paste/upload addresses, publish a new
 *              ADDRESS list (TYPE=2), then airdrop to it. Two
 *              sequential transactions:
 *                1. LIST (v0, TYPE=2): creates the address list; gets
 *                   an ACTION_INDEX assigned by the indexer.
 *                2. AIRDROP (v0): references that ACTION_INDEX to pay
 *                   the per-recipient amount to each address.
 *   'existing' - pick an already-published list (either type) via the
 *              PC-10 listsForSource picker and airdrop straight to its
 *              ACTION_INDEX. No new LIST is created, so this is a
 *              single transaction; picking a TOKEN list here is how a
 *              holder-snapshot list gets *reused* rather than rebuilt.
 *   'holders'  - pick one or more tokens, publish a new TICK list
 *              (TYPE=1), then airdrop to it so every current holder of
 *              those tokens gets paid. Same two-transaction shape as
 *              'paste', just with TYPE=1 / ITEM=ticks.
 *
 * Stage machine (paste / holders):
 *   compose         - user fills in the list source, picks token+amount
 *   review-list     - decoder-rendered LIST preview + sign
 *   wait-index      - poll explorer for LIST's ACTION_INDEX
 *   review-airdrop  - decoder-rendered AIRDROP preview + sign
 *   done            - both txids shown
 *
 * Stage machine (existing): compose -> review-airdrop -> done. There is
 * no LIST leg, so `listTxid` never gets set and 'review-list'/'wait-index'
 * are never entered; `listActionIndex` is populated directly from the
 * picker's selection instead of from a broadcast + poll.
 *
 * Holder-snapshot honesty (holders / existing-with-a-TOKEN-list): a
 * TICK list pays every current HOLDER of the listed tokens, and that
 * holder set is only fixed at AIRDROP execution, not at compose or
 * review time (LIST_ACTION_INDEX just names the list; the indexer
 * resolves membership when the AIRDROP itself confirms). Any holder
 * count shown before that is a best-effort preview that can be
 * inflated between preview and settlement (e.g. by splitting a token
 * balance across more addresses), so it is always labeled "current,
 * not final" with the binding time called out. There is no min-balance
 * threshold field anywhere in this form: AIRDROP.md defines none.
 *
 * Progress is persisted to `vault.pendingAirdrops` at each stage
 * transition for the two-transaction modes (paste / holders) so the
 * user can close the wallet between signs and resume. AirdropForm
 * accepts an optional `resumeId`; when set, it hydrates from the saved
 * record (including which list TYPE it was building) and jumps to the
 * right stage. The single-transaction 'existing' mode has nothing
 * mid-flight to resume, so it never writes a pending-airdrop record.
 *
 * Address validation is light (length + base58/bech32 charset);
 * anything that slips through is caught by the encoder at sign time.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string | null} [props.resumeId]
 * @param {() => void} props.onBack
 */
export function AirdropForm({ walletId, resumeId = null, onBack, initialChainId, initialTick, initialFromAddress }) {
    const { messaging, shell } = useMessaging();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    // getActiveAddresses()[chainId], loaded in the same batch as the
    // address list so the source default resolves once, not fallback-then-swap.
    const [activeByChain, setActiveByChain] = useState(
        /** @type {Record<string, any> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [chainId, setChainId] = useState(/** @type {string | null} */ (initialChainId || null));
    const lockedToken = !!(initialChainId && initialTick);
    const [tokenPickerOpen, setTokenPickerOpen] = useState(false);
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const [fromAddressId, setFromAddressId] = useState(
        /** @type {string | null} */ (null),
    );

    const [token, setToken] = useState(initialTick || '');
    // PC-26: airdrops carry no gated-key handoff; warn when the dropped
    // token has gated content.
    const gatedDropNotice = useGatedTickNotice({ messaging, chainId, tick: token });
    const [amountPer, setAmountPer] = useState('');
    const [memo, setMemo] = useState('');
    const [password, setPassword] = useState('');

    // PC-11: which of the three ways to name the list of recipients is
    // in play. 'paste' is the pre-PC-11 default and behavior.
    const [sourceMode, setSourceMode] = useState(
        /** @type {'paste' | 'existing' | 'holders'} */ ('paste'),
    );

    // 'paste' mode: paste/upload addresses -> new ADDRESS list (TYPE=2).
    const [pasteText, setPasteText] = useState('');
    // Addresses taken off a list too large for one airdrop, kept on screen so
    // the user can copy them into the next one.
    const [setAsideRecipients, setSetAsideRecipients] = useState(/** @type {string[]} */ ([]));
    const [committedRecipients, setCommittedRecipients] = useState(
        /** @type {{ valid: string[], invalid: string[], duplicates: number, wrongNetwork: string[], addressRefs?: string[], invalidLines?: Array<{ address: string, line: number }> }} */
        ({ valid: [], invalid: [], duplicates: 0, wrongNetwork: [], addressRefs: [], invalidLines: [] }),
    );
    const [importedRecipientEntries, setImportedRecipientEntries] = useState(
        /** @type {{ text: string, entries: Array<{ value: string, line: number }> } | null} */ (null),
    );
    const [showInvalid, setShowInvalid] = useState(false);

    // 'holders' mode: type/pick tokens -> new TICK list (TYPE=1). Same
    // free-text tick parsing as ListCreateForm's TYPE=1 body, reused
    // verbatim so validation matches exactly.
    const [ticksText, setTicksText] = useState('');
    const [holderTicksPickerOpen, setHolderTicksPickerOpen] = useState(false);

    // 'existing' mode: pick an already-published list (either type) via
    // the PC-10 listsForSource picker; no new LIST gets created.
    const [listPickerOpen, setListPickerOpen] = useState(false);
    // Best-effort detail (type + current members) for the list picked in
    // 'existing' mode, fetched once its ACTION_INDEX is known. Backs the
    // "address list" (deterministic count) vs "token list" (holder-
    // snapshot preview) branch in the review-airdrop stage.
    const [existingListDetail, setExistingListDetail] = useState(
        /** @type {{ loading: boolean, kind: 'address' | 'tick' | null, items: string[], name: string | null, error: string | null } | null} */
        (null),
    );
    // Best-effort holder-count preview for whichever tick set is in play
    // (typed in 'holders' mode, or read off an 'existing' TYPE=1 list).
    // Always a preview, never a promise: see the file-level doc comment.
    const [holderPreview, setHolderPreview] = useState(
        /** @type {{ loading: boolean, total: string | null, error: string | null, failures: Array<{ subject: string, message: string }> }} */
        ({ loading: false, total: null, error: null, failures: [] }),
    );
    const [holderPreviewRetry, setHolderPreviewRetry] = useState(0);

    const [stage, setStage] = useState(
        /** @type {'compose' | 'review-list' | 'wait-index' | 'review-airdrop' | 'done'} */
        ('compose'),
    );
    const [submitting, setSubmitting] = useState(false);
    const [clearingPending, setClearingPending] = useState(false);
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [pendingId, setPendingId] = useState(/** @type {string | null} */ (null));
    const [listTxid, setListTxid] = useState(/** @type {string | null} */ (null));
    const [listActionIndex, setListActionIndex] = useState(
        /** @type {string | null} */ (null),
    );
    // What the chain actually stored for the LIST this flow just
    // published, read back once it is indexed and BEFORE step 2 is priced.
    // The indexer drops items it rejects into `list_items_invalid` and still
    // marks the LIST valid, so a shorter stored list is the only signal that
    // the recipient count (and therefore the per-recipient AIRDROP cost) the
    // user was shown is wrong. `null` means "not read yet / read failed",
    // which leaves the pre-existing behaviour untouched.
    const [listReconcile, setListReconcile] = useState(
        /** @type {{ storedCount: number, expectedCount: number, missing: string[], stored: unknown[] } | null} */
        (null),
    );
    const [airdropTxid, setAirdropTxid] = useState(/** @type {string | null} */ (null));
    const [waitElapsed, setWaitElapsed] = useState(0);
    const [indexReadError, setIndexReadError] = useState(/** @type {string | null} */ (null));
    const [hydrated, setHydrated] = useState(false);
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    // The active map and the settings read are best-effort: a host without
    // `getActiveAddresses` / `getSettings`, or one whose call fails, still
    // yields a usable form (newest-HD source, first-chain default).
    useEffect(() => {
        let cancelled = false;
        Promise.all([
            messaging.getAddressesByChain(walletId),
            typeof messaging.getActiveAddresses === 'function'
                ? Promise.resolve(messaging.getActiveAddresses(walletId)).catch(() => ({}))
                : Promise.resolve({}),
            typeof messaging.getSettings === 'function'
                ? Promise.resolve(messaging.getSettings()).catch(() => null)
                : Promise.resolve(null),
        ])
            .then(([byChain, active, settings]) => {
                if (cancelled) return;
                setAddressesByChain(byChain);
                setActiveByChain(active || {});
                const first = Object.keys(byChain)[0];
                if (!first) {
                    setLoadError(
                        'No addresses on any network yet. Use Receive to generate one before airdropping.',
                    );
                    return;
                }
                // `byChain` is in address-creation order, so opening on its
                // first key airdropped on the wallet's OLDEST chain forever.
                // Open on the last-used chain instead, behind a caller-seeded
                // one (a token context; a resumed airdrop sets its own chain
                // from the pending record) and ahead of the first-key
                // fallback, exactly as Send and Swap do.
                if (!resumeId && !lockedToken) {
                    setChainId((prev) => pickDefaultChainId(byChain, {
                        explicitChainId: prev,
                        settings,
                    }));
                }
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging, resumeId]);

    useEffect(() => {
        if (!resumeId || hydrated || !addressesByChain) return;
        let cancelled = false;
        messaging.listPendingAirdropsForWallet({ walletId })
            .then((records) => {
                if (cancelled) return;
                const rec = (records || []).find((r) => r.id === resumeId);
                if (!rec) {
                    setLoadError('Pending airdrop not found. It may have been cleared.');
                    return;
                }
                setChainId(rec.chainId);
                setToken(rec.token);
                setAmountPer(rec.amountPer);
                // rec.listType only distinguishes 'paste' (TYPE=2) from
                // 'holders' (TYPE=1); 'existing' never persists a pending
                // record (single tx, nothing mid-flight to resume from).
                if (rec.listType === '1') {
                    setSourceMode('holders');
                    setTicksText(rec.recipients.join('\n'));
                } else {
                    setSourceMode('paste');
                    setCommittedRecipients({
                        valid: [...rec.recipients], invalid: [], duplicates: 0, wrongNetwork: [],
                    });
                }
                setMemo(rec.memo || '');
                // The review stage renders no fee toggle, so the lane the LIST
                // was paid on is the only record of the signer's choice.
                nativeFee.setPayFeeInNativeCoin(rec.payFeeInNativeCoin === true);
                setPendingId(rec.id);
                setListTxid(rec.listTxid);
                setListActionIndex(rec.listActionIndex);
                setAirdropTxid(rec.airdropTxid);
                if (rec.stage === 'waiting-index') setStage('wait-index');
                else if (rec.stage === 'ready-to-airdrop') setStage('review-airdrop');
                else if (rec.stage === 'done') setStage('done');
                // Pick matching fromAddressId once addresses load.
                const addrs = addressesByChain[rec.chainId] || [];
                const match = addrs.find((a) => a.address === rec.fromAddress);
                if (match) setFromAddressId(match.id);
                setHydrated(true);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load pending airdrop.');
            });
        return () => { cancelled = true; };
    }, [resumeId, hydrated, addressesByChain, walletId, messaging]);

    // Default fromAddressId: the preferred issuer address when present,
    // else the same default as Send and every other spend-from-balance
    // form: the chain's active address, else the newest HD external. A
    // dispenser-delegated address is never the default; it vends rather
    // than funds.
    useEffect(() => {
        if (!chainId || !addressesByChain || !activeByChain || fromAddressId) return;
        const all = addressesByChain[chainId] || [];
        if (initialFromAddress) {
            const match = all.find((a) => a.address === initialFromAddress);
            if (match) { setFromAddressId(match.id); return; }
        }
        const funding = all.filter((a) => a.role !== 'dispenser');
        const picked = preferredSourceId(funding, activeByChain[chainId]);
        if (picked) setFromAddressId(picked);
    }, [chainId, addressesByChain, activeByChain, fromAddressId, initialFromAddress]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    // The chain the recipients have to be spendable ON. Passing it to
    // the parser is what makes a mainnet address pasted into a regtest wallet
    // count as skipped instead of valid; without it the form only checked
    // length + charset and the chain silently dropped the address after the
    // user had already paid for it. Split out as a plain object so recipient
    // classification depends on the two fields rather than descriptor identity.
    const recipientCoin = descriptor?.coin || null;
    const recipientNetwork = descriptor?.networkKind || null;

    // Deferred parsing keeps textarea updates at input priority for large lists.
    // Submit stays disabled until the deferred snapshot catches up.
    const deferredPasteText = useDeferredValue(pasteText);
    const deferredRecipientsPending = deferredPasteText !== pasteText;
    const recipientEntries = useMemo(
        () => (importedRecipientEntries?.text === deferredPasteText
            ? importedRecipientEntries.entries
            : parsePasteEntries(deferredPasteText)),
        [deferredPasteText, importedRecipientEntries],
    );
    const immediateRecipients = useMemo(
        () => (recipientEntries.length <= 1_000 ? classifyRecipientEntries(
            recipientEntries,
            { coin: recipientCoin, network: recipientNetwork },
        ) : null),
        [recipientEntries, recipientCoin, recipientNetwork],
    );
    const [largeRecipientResult, setLargeRecipientResult] = useState(
        /** @type {{ entries: Array<{ value: string, line: number }> | null, coin: string | null, network: string | null, recipients: any }} */
        ({ entries: null, coin: null, network: null, recipients: null }),
    );
    useEffect(() => {
        if (immediateRecipients) {
            setLargeRecipientResult((current) => (current.entries === null ? current : {
                entries: null,
                coin: null,
                network: null,
                recipients: null,
            }));
            return undefined;
        }
        if (stage !== 'compose' || sourceMode !== 'paste') return undefined;
        let cancelled = false;
        classifyRecipientEntriesAsync(
            recipientEntries,
            { coin: recipientCoin, network: recipientNetwork },
            { shouldCancel: () => cancelled },
        ).then((next) => {
            if (!cancelled && next) setLargeRecipientResult({
                entries: recipientEntries,
                coin: recipientCoin,
                network: recipientNetwork,
                recipients: next,
            });
        });
        return () => { cancelled = true; };
    }, [recipientEntries, immediateRecipients, recipientCoin, recipientNetwork, stage, sourceMode]);
    const largeRecipientsReady = largeRecipientResult.entries === recipientEntries
        && largeRecipientResult.coin === recipientCoin
        && largeRecipientResult.network === recipientNetwork;
    const parsedRecipients = immediateRecipients
        || (largeRecipientsReady ? largeRecipientResult.recipients : committedRecipients);
    const recipientClassificationPending = !immediateRecipients && !largeRecipientsReady;
    const recipientsPending = deferredRecipientsPending || recipientClassificationPending;
    const recipients = stage === 'compose' ? parsedRecipients : committedRecipients;
    // A resumed record carries no classification, so it has no reference list.
    const addressRefs = recipients.addressRefs || [];

    // Parse holder tickers with the same chain grammar as every token-list form.
    const tickItems = useMemo(() => classifyTickItems(ticksText), [ticksText]);
    const memberTicks = tickItems.valid;
    const invalidTicks = tickItems.invalid;

    // 'existing' mode: once a list is picked, fetch its type + current
    // members (same read ListDetail.jsx uses) so the review stage can
    // tell a deterministic ADDRESS-list count from a TICK-list
    // holder-snapshot preview.
    useEffect(() => {
        if (sourceMode !== 'existing' || !listActionIndex || !chainId) {
            setExistingListDetail(null);
            return undefined;
        }
        let cancelled = false;
        setExistingListDetail({ loading: true, kind: null, items: [], name: null, error: null });
        messaging.getListByActionIndex({ chainId, actionIndex: listActionIndex })
            .then((row) => {
                if (cancelled) return;
                const kind = String(row?.type) === '1' ? 'tick' : 'address';
                // The airdrop pays the list's newest valid edit, not its created members
                const items = currentListItems(row) || [];
                const name = typeof row?.name === 'string' && row.name.length > 0 ? row.name : null;
                setExistingListDetail({ loading: false, kind, items, name, error: null });
            })
            .catch((err) => {
                if (cancelled) return;
                setExistingListDetail({
                    loading: false, kind: null, items: [], name: null,
                    error: readFailureMessage(err, 'load this list'),
                });
            });
        return () => { cancelled = true; };
    }, [sourceMode, listActionIndex, chainId, messaging]);

    // Best-effort holder-count preview for whichever tick set is in
    // play right now: typed directly in 'holders' mode, or read off an
    // 'existing' TYPE=1 list's current members. Debounced like
    // DividendForm's holder fetch so fast typing doesn't hammer the
    // explorer. AIRDROP pays every holder of EACH listed tick
    // separately (AIRDROP.md: "sends AMOUNT of TICK to holders of each
    // TICK on the list"), so a wallet holding more than one listed
    // token can be paid more than once; the total below sums per-tick
    // holder counts rather than de-duping across tokens.
    const previewTicks = sourceMode === 'holders'
        ? memberTicks
        : (sourceMode === 'existing' && existingListDetail?.kind === 'tick')
            ? existingListDetail.items
            : [];
    const previewTicksKey = previewTicks.join('|');
    useEffect(() => {
        if (previewTicks.length === 0 || !chainId) {
            setHolderPreview({ loading: false, total: null, error: null, failures: [] });
            return undefined;
        }
        let cancelled = false;
        setHolderPreview({ loading: true, total: null, error: null, failures: [] });
        const handle = setTimeout(() => {
            // A short automatic retry absorbs transient explorer failures.
            // The final cause stays visible and the manual retry below lets
            // the user recover without editing the token list.
            const countHolders = async (t) => {
                let lastErr = null;
                for (let attempt = 0; attempt < 2; attempt += 1) {
                    if (attempt > 0) {
                        await new Promise((resolve) => { setTimeout(resolve, 1200); });
                        if (cancelled) return { tick: t, count: null, error: null };
                    }
                    try {
                        const resp = await messaging.getHoldersForToken({ chainId, tick: t });
                        return { tick: t, count: extractHolderCount(resp), error: null };
                    } catch (err) {
                        lastErr = err;
                    }
                }
                return {
                    tick: t,
                    count: null,
                    error: readFailureMessage(lastErr, `count holders of ${t}`),
                };
            };
            Promise.all(previewTicks.map(countHolders))
                .then((results) => {
                    if (cancelled) return;
                    const valid = results.filter((r) => r.count !== null);
                    const failures = results
                        .filter((r) => r.count === null)
                        .map((r) => ({ subject: r.tick, message: r.error }));
                    if (valid.length === 0) {
                        setHolderPreview({
                            loading: false,
                            total: null,
                            error: `Holder counts unavailable for ${failures.length} token${failures.length === 1 ? '' : 's'}`,
                            failures,
                        });
                        return;
                    }
                    const total = valid.reduce((sum, r) => sum + BigInt(r.count), 0n).toString();
                    setHolderPreview({
                        loading: false,
                        // Any missing token makes the overall payout unknown.
                        // An understated count would make Max unaffordable.
                        total: failures.length > 0 ? null : total,
                        error: failures.length > 0
                            ? `Holder counts unavailable for ${failures.length} of ${results.length} tokens`
                            : null,
                        failures,
                    });
                });
        }, 400);
        return () => { cancelled = true; clearTimeout(handle); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [previewTicksKey, chainId, messaging, holderPreviewRetry]);

    useEffect(() => {
        if (stage === 'review-list' || stage === 'review-airdrop') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    // reconcile: once the LIST this flow published is indexed, read the
    // membership the chain actually stored and compare it with what the wallet
    // submitted. The indexer accepts a LIST whose items it partly rejected (it
    // writes the rejects to `list_items_invalid` and still marks the action
    // valid), so without this read the wallet keeps quoting a per-recipient
    // AIRDROP cost for recipients that are not on the list. Deliberately runs
    // before step 2 is signed. 'existing' mode already reads its list through
    // existingListDetail, and 'holders' publishes ticks, not addresses.
    const submittedKey = recipients.valid.join('|');
    useEffect(() => {
        if (sourceMode !== 'paste' || !listActionIndex || !chainId) return undefined;
        if (typeof messaging.getListByActionIndex !== 'function') return undefined;
        const submitted = submittedKey ? submittedKey.split('|') : [];
        if (submitted.length === 0) return undefined;
        let cancelled = false;
        messaging.getListByActionIndex({ chainId, actionIndex: listActionIndex })
            .then((row) => {
                if (cancelled) return;
                // Reconcile against what the airdrop will resolve the list to
                const stored = currentListItems(row) || [];
                // Keep the stored members too: the token's access lists are matched against them.
                setListReconcile({ ...airdropLib.reconcileStoredList(submitted, stored), stored });
            })
            .catch(() => {
                // Non-fatal: a failed read must not block a paid-for airdrop.
                // Leaving it null keeps the pre-reconcile display.
                if (!cancelled) setListReconcile(null);
            });
        return () => { cancelled = true; };
    }, [sourceMode, listActionIndex, chainId, submittedKey, messaging]);

    // Stage-4 polling: waits for the LIST to be indexed and resolves
    // its ACTION_INDEX. Pauses when the tab is hidden to avoid burning
    // explorer bandwidth for off-screen windows.
    useEffect(() => {
        if (stage !== 'wait-index' || !listTxid || !chainId || !pendingId) return undefined;
        let cancelled = false;
        const started = Date.now();
        const tick = async () => {
            if (cancelled) return;
            setWaitElapsed(Math.floor((Date.now() - started) / 1000));
            if (typeof document !== 'undefined'
                && document.visibilityState === 'hidden') return;
            try {
                const resp = await messaging.getActionByTxid({ chainId, txid: listTxid });
                if (cancelled) return;
                setIndexReadError(null);
                const idx = extractActionIndex(resp);
                if (idx) {
                    setListActionIndex(idx);
                    try {
                        await messaging.updatePendingAirdrop({
                            id: pendingId,
                            patch: { stage: 'ready-to-airdrop', listActionIndex: idx },
                        });
                    } catch (err) {
                        // Persistence failure is non-fatal here; the in-memory
                        // state still advances, and the user can re-sign.
                    }
                    setStage('review-airdrop');
                }
            } catch (err) {
                if (!cancelled) {
                    setIndexReadError(readFailureMessage(err, 'check whether the recipient list is indexed'));
                }
            }
        };
        tick(); // fire once immediately
        const handle = setInterval(tick, POLL_INTERVAL_MS);
        return () => { cancelled = true; clearInterval(handle); };
    }, [stage, listTxid, chainId, pendingId, messaging]);

    const fromAddress = useMemo(() => {
        if (!chainId || !fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    // Balance of the amount tick at the source address, backing the
    // AmountField's "available" footer. It is NOT the Max: the field is
    // per-recipient, so see `maxPerRecipient` below.
    const tickAmtBalance = useTickBalance({
        messaging,
        walletId,
        chainId,
        address: fromAddress?.address,
        tick: token,
    });

    // Divisibility of the dropped token, so the per-recipient Max floors
    // to an amount the token can actually express (an indivisible token
    // cannot pay 16.6666 to each of three addresses).
    const dropInfo = useTokenInfo({
        chainId,
        tick: token.trim(),
        skip: !token.trim(),
    });

    // The network pays only the addresses the dropped token's own allow and
    // block lists admit, so read their members for the review count. A failed
    // read keeps the unfiltered count and says the payout may be smaller.
    const accessAllow = dropInfo?.allowList ?? null;
    const accessBlock = dropInfo?.blockList ?? null;
    const [accessLists, setAccessLists] = useState(
        /** @type {{ loading: boolean, allow: unknown[] | null, block: unknown[] | null, error: string | null } | null} */
        (null),
    );
    useEffect(() => {
        if (!chainId || (!accessAllow && !accessBlock)) {
            setAccessLists(null);
            return undefined;
        }
        let cancelled = false;
        const readMembers = (actionIndex) => {
            if (!actionIndex) return Promise.resolve(null);
            if (typeof messaging.getListByActionIndex !== 'function') {
                return Promise.reject(new Error('list reads are not available'));
            }
            return messaging.getListByActionIndex({ chainId, actionIndex }).then((row) => {
                // Count only a valid plain address list (a union row carries no members of its own).
                if (Number(row?.type) === 3) throw new Error('It combines other lists, which this wallet cannot count.');
                if (Number(row?.type) !== 2) throw new Error('It is not an address list.');
                if (row.status != null && row.status !== 'valid') throw new Error('The list it names is not valid.');
                const members = currentListItems(row);
                if (!Array.isArray(members)) throw new Error('the list has no member data');
                return members;
            });
        };
        setAccessLists({ loading: true, allow: null, block: null, error: null });
        Promise.all([readMembers(accessAllow), readMembers(accessBlock)])
            .then(([allow, block]) => {
                if (!cancelled) setAccessLists({ loading: false, allow, block, error: null });
            })
            .catch((err) => {
                if (cancelled) return;
                setAccessLists({
                    loading: false, allow: null, block: null,
                    error: readFailureMessage(err, 'read this token\'s allow or block list'),
                });
            });
        return () => { cancelled = true; };
    }, [chainId, accessAllow, accessBlock, messaging]);

    const chainsWithAddresses = addressesByChain ? Object.keys(addressesByChain) : [];
    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';

    // PC-51: native-coin protocol fee (LIST and AIRDROP are both
    // quotable, so the opt-in rides BOTH legs); the authoritative price
    // check runs at submit via applyNativeFeePreflight.
    const nativeFee = useNativeFee(coinTicker);

    // Stable reference (only changes when chainId/addressesByChain actually
    // do) so ExistingListPickerScreen's data-fetch effect below doesn't see
    // a fresh `[]` identity every render when this chain has no addresses.
    const currentChainAddresses = useMemo(
        () => (chainId && addressesByChain ? (addressesByChain[chainId] || []) : []),
        [chainId, addressesByChain],
    );

    // Network fee: Low / Normal / Fast / Custom via FeeSelector; feePerKb
    // prices both broadcasts (the LIST and the AIRDROP).
    const [feePick, setFeePick] = useState(
        /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: 'normal' }),
    );
    const feeTiers = useMemo(
        () => estimateNativeSendFeeTiers({ chainId, chainRegistry }),
        [chainId],
    );
    const feeCustomEstimate = useMemo(
        () => (feePick.mode === 'custom'
            ? customFeeEstimate({ chainId, chainRegistry, rate: Number(feePick.customRate) || 0 })
            : null),
        [chainId, feePick],
    );
    const feeEstimate = feePick.mode === 'custom'
        ? feeCustomEstimate
        : (feeTiers ? feeTiers[feePick.mode] : estimateNativeSendFee({ chainId, chainRegistry, speed: feePick.mode }));
    const feePerKb = (feeEstimate && feeEstimate.unit
        && Number.isFinite(feeEstimate.rateValue) && feeEstimate.rateValue > 0)
        ? displayRateToSettingsCustom(feeEstimate.unit, feeEstimate.rateValue)
        : null;

    // Only meaningful for 'paste' (TYPE=2, ITEM=addresses) and 'holders'
    // (TYPE=1, ITEM=ticks); 'existing' mode never enters the stages that
    // decode/broadcast a LIST, so this is simply unused there.
    const listItems = sourceMode === 'holders' ? memberTicks : recipients.valid;
    const listType = sourceMode === 'holders' ? '1' : '2';
    // Name the list the way the review title does, never by its opcode
    const listNoun = sourceMode === 'holders' ? 'token list' : 'address list';
    const listParams = useMemo(() => {
        /** @type {Record<string, string | string[]>} */
        const p = {
            VERSION: '0',
            TYPE: listType,
            ITEM: [...listItems],
        };
        return p;
    }, [listType, listItems]);

    // Above 8 KB this wallet cannot verify the LIST it would sign
    // (airdrop/listSizeLimit.js), so a list that large is named here, from the
    // items it would publish, before anything is composed. Null when it fits.
    const listFit = useMemo(() => {
        if (sourceMode === 'existing' || listItems.length === 0) return null;
        const fits = maxListItemsThatFit(listItems, listType);
        if (fits >= listItems.length) return null;
        const batches = splitListItems(listItems, listType);
        return { fits, total: listItems.length, batches: batches ? batches.length : null };
    }, [sourceMode, listItems, listType]);

    // Trim the paste box to the first airdrop's worth of valid addresses and
    // keep the rest on screen for the next one. Nothing is composed here: the
    // trimmed list still goes through review like any other.
    const keepFirstListBatch = useCallback(() => {
        if (!listFit || sourceMode !== 'paste') return;
        setSetAsideRecipients(listItems.slice(listFit.fits));
        setImportedRecipientEntries(null);
        setPasteText(listItems.slice(0, listFit.fits).join('\n'));
        setFormError(null);
    }, [listFit, listItems, sourceMode]);

    const airdropParams = useMemo(() => {
        /** @type {Record<string, string> } */
        const p = {
            VERSION: '0',
            TICK: token.trim(),
            AMOUNT: String(amountPer).trim(),
            LIST_ACTION_INDEX: listActionIndex || '',
        };
        if (memo.trim()) p.MEMO = memo.trim();
        return p;
    }, [token, amountPer, memo, listActionIndex]);

    const listDecoded = useMemo(() => {
        if (stage !== 'review-list' && stage !== 'wait-index') return null;
        return decoderLib.decodeAction({
            action: 'LIST',
            params: listParams,
            chainId: chainId || undefined,
            chainRegistry,
        });
    }, [stage, listParams, chainId]);

    const airdropDecoded = useMemo(() => {
        if (stage !== 'review-airdrop' && stage !== 'done') return null;
        return decoderLib.decodeAction({
            action: 'AIRDROP',
            params: airdropParams,
            chainId: chainId || undefined,
            chainRegistry,
        });
    }, [stage, airdropParams, chainId]);

    // Unified "who gets paid" preview across all three source modes.
    // ADDRESS lists (paste, or an 'existing' TYPE=2 pick) have a
    // deterministic recipient count fixed at the list's item count.
    // TICK lists (holders, or an 'existing' TYPE=1 pick) pay every
    // current HOLDER of the listed tokens instead, a set that is only
    // fixed at AIRDROP execution, not now -- so `volatile: true` there
    // means the count is a preview, never a promise (see the file-level
    // doc comment for the full honesty rationale).
    const recipientPreview = useMemo(() => {
        // Count only the listed addresses the token's access lists admit, once both are read.
        const addressPreview = (listed, unfilteredCount) => {
            const ready = accessLists && !accessLists.loading && !accessLists.error;
            const { approved, excluded } = ready
                ? airdropLib.applyTokenAccessLists(listed, accessLists)
                : { approved: null, excluded: [] };
            const count = approved ? approved.length : unfilteredCount;
            return {
                kind: 'address', count, listedCount: unfilteredCount, loading: false, error: null, volatile: false, excluded,
            };
        };
        if (sourceMode === 'paste') {
            // Once the published list has been read back, the chain's
            // count is the truth - it is what the AIRDROP will actually pay
            // and be charged for. Before that (and if the read failed) fall
            // back to what was submitted.
            const count = listReconcile ? listReconcile.storedCount : recipients.valid.length;
            return addressPreview(listReconcile ? listReconcile.stored : recipients.valid, count);
        }
        if (sourceMode === 'holders') {
            return { kind: 'tick', count: holderPreview.total, loading: holderPreview.loading, error: holderPreview.error, volatile: true };
        }
        // sourceMode === 'existing'
        if (!existingListDetail || existingListDetail.loading) {
            return { kind: null, count: null, loading: true, error: null, volatile: false };
        }
        if (existingListDetail.error) {
            return { kind: null, count: null, loading: false, error: existingListDetail.error, volatile: false };
        }
        if (existingListDetail.kind === 'address') {
            return addressPreview(existingListDetail.items, existingListDetail.items.length);
        }
        return { kind: 'tick', count: holderPreview.total, loading: holderPreview.loading, error: holderPreview.error, volatile: true };
    }, [sourceMode, recipients.valid, holderPreview, existingListDetail, listReconcile, accessLists]);

    // Say who the token's access lists keep out of this airdrop, or that they could not be read.
    const excludedRecipients = recipientPreview.excluded || [];
    const accessListNotice = !accessLists || accessLists.loading
        ? null
        : accessLists.error
            ? `${accessLists.error} This token has an allow or block list, so the network may pay `
                + 'fewer addresses than shown here.'
            : recipientPreview.kind === 'tick'
                ? 'This token has an allow or block list, and the network pays no holder it excludes, '
                    + 'so fewer addresses may be paid than counted here.'
                : excludedRecipients.length > 0
                    ? `This token's allow or block list excludes ${excludedRecipients.length} of these `
                        + 'addresses, and the network pays '
                        + `${excludedRecipients.length === 1 ? 'it' : 'them'} nothing. As the lists stand now, this airdrop pays `
                        + `${recipientPreview.count}. The lists can change before the airdrop confirms, so Max and the `
                        + `balance check still cover all ${recipientPreview.listedCount} listed addresses. The excluded `
                        + `${excludedRecipients.length === 1 ? 'address' : 'addresses'}: ${excludedRecipients.join(', ')}.`
                    : null;

    // Exact decimal math, not a float product. This number prices the
    // preview and its funded twin below gates submit, so an ulp of drift is
    // the difference between a payable drop and one the chain rejects.
    const totalDistribution = useMemo(() => {
        const amt = String(amountPer).trim();
        if (!(Number(amt) > 0)) return null;
        if (recipientPreview.count === null || recipientPreview.count === undefined) return null;
        return multiplyDecimal(amt, String(recipientPreview.count));
    }, [amountPer, recipientPreview.count]);

    // Size Max and the balance check on every listed address, not only the ones the
    // token's access lists admit now (those lists can widen before the airdrop confirms).
    const fundedCount = recipientPreview.listedCount ?? recipientPreview.count;
    const fundedDistribution = useMemo(() => {
        const amt = String(amountPer).trim();
        if (!(Number(amt) > 0)) return null;
        if (fundedCount === null || fundedCount === undefined) return null;
        return multiplyDecimal(amt, String(fundedCount));
    }, [amountPer, fundedCount]);

    // (E2E D-86, second form): the amount field is PER RECIPIENT,
    // so filling the whole balance into it proposes a payout of balance x
    // recipients - N times the total the form itself prints one row below.
    // Same defect and the same shape as Pay dividend's Max, whose divisor
    // was eligible units rather than a recipient count. The payable
    // ceiling is balance / recipients, floored to the token's
    // divisibility so the product can never round back above the balance.
    //
    // For a token-holder list the count is a live preview, not a promise
    // (holders can join before the AIRDROP lands), so this is a ceiling on
    // what is knowable now, exactly like the total distribution beside it.
    const maxPerRecipient = useMemo(
        () => perUnitMax({
            balance: tickAmtBalance,
            eligibleUnits: fundedCount != null ? String(fundedCount) : null,
            divisibility: dropInfo?.divisibility ?? null,
        }),
        [tickAmtBalance, fundedCount, dropInfo],
    );
    const maxPayable = maxPerRecipient !== null && Number(maxPerRecipient) > 0;
    const roundingRemainder = useMemo(() => {
        if (!maxPayable || compareDecimal(amountPer, maxPerRecipient) !== 0) return null;
        if (fundedDistribution === null || tickAmtBalance === null) return null;
        const remainder = subtractDecimalStrings(tickAmtBalance, fundedDistribution);
        return compareDecimal(remainder, '0') === 1 ? remainder : null;
    }, [amountPer, maxPayable, maxPerRecipient, tickAmtBalance, fundedDistribution]);

    const flowNetworkFee = useMemo(() => {
        if (!feeEstimate?.coinAmount) return null;
        return multiplyDecimal(feeEstimate.coinAmount, sourceMode === 'existing' ? '1' : '2');
    }, [feeEstimate, sourceMode]);

    const applyImportedRecipients = useCallback((text) => {
        const entries = parseCsvEntries(text);
        const normalized = entries.map(({ value }) => value).join('\n');
        setImportedRecipientEntries({ text: normalized, entries });
        setPasteText(normalized);
    }, []);

    // Recipient CSV and TXT files arrive by drop or by the file picker; both go
    // through the hook's size cap, type check and read-error report.
    const recipientsDrop = useDropZone({
        accept: ['.csv', '.txt', 'text/csv', 'text/plain'],
        readAs: 'text',
        onError: (msg) => setFormError(msg),
        onFile: ({ content }) => {
            const text = typeof content === 'string' ? content : '';
            applyImportedRecipients(text);
        },
    });

    // PC-11: the single compose-stage submit handler for all three
    // source modes. 'existing' skips straight to 'review-airdrop' (no
    // LIST leg to review); 'paste' / 'holders' still land on
    // 'review-list' first, exactly as the pre-PC-11 flow did.
    function handleComposeSubmit(event) {
        event.preventDefault();
        if (!chainId || !fromAddress) {
            setFormError('Pick a source address first.');
            return;
        }
        if (!token.trim()) {
            setFormError('Token is required.');
            return;
        }
        const tokenError = tickerReferenceError(token, { noun: 'Token ticker', allowRef: true });
        if (tokenError) {
            setFormError(tokenError);
            return;
        }
        const amt = String(amountPer).trim();
        if (!amt) {
            setFormError('Per-recipient amount is required.');
            return;
        }
        const amountComparison = compareDecimalStrings(amt, '0');
        if (amountComparison !== 1) {
            setFormError(amountComparison === null
                ? 'Per-recipient amount must be a positive decimal number.'
                : 'Per-recipient amount must be greater than zero.');
            return;
        }
        // Keep each payout within the dropped token's on-chain decimal scale.
        const precisionError = tokenAmountPrecisionError(amt, {
            divisibility: dropInfo?.divisibility,
            tick: token,
            noun: 'Per-recipient amount',
        });
        if (precisionError) {
            setFormError(precisionError);
            return;
        }
        // Stop a drop the balance cannot cover here, not several
        // screens and one broadcast LIST later. Only fires when both the
        // projected total and the balance are known, so an explorer
        // hiccup leaves the form ungated.
        if (fundedDistribution && exceedsBalance(fundedDistribution, tickAmtBalance)) {
            const TICK = token.trim();
            const lead = fundedCount === recipientPreview.count ? 'This pays' : 'Paying every listed address takes';
            setFormError(
                `${lead} ~${formatWithThousands(fundedDistribution)} ${TICK} in total, more than the `
                + `${formatWithThousands(tickAmtBalance)} ${TICK} this address holds.`
                + (maxPayable ? ` Up to ${formatWithThousands(maxPerRecipient)} each is payable.` : ''),
            );
            return;
        }
        if (memo && /[|;]/.test(memo)) {
            setFormError('Memo cannot contain | or ; characters.');
            return;
        }
        const memoError = memoLengthError(memo.trim());
        if (memoError) { setFormError(memoError); return; }
        if (sourceMode === 'existing') {
            if (!listActionIndex) {
                setFormError('Choose an existing list first.');
                return;
            }
            if (!/^[1-9]\d*$/.test(listActionIndex)) {
                setFormError('The selected list has an invalid action index. Choose the list again.');
                return;
            }
            setFormError(null);
            setStage('review-airdrop');
            return;
        }
        if (sourceMode === 'holders') {
            // Verify every token name is well formed before counting valid items.
            if (invalidTicks.length > 0) {
                setFormError(`These don't look like token names: ${invalidTicks.join(', ')}`);
                return;
            }
            if (memberTicks.length === 0) {
                setFormError('Add at least one token.');
                return;
            }
        } else if (recipientsPending) {
            setFormError('Still checking the recipient list. Try again in a moment.');
            return;
        } else if (recipients.valid.length === 0) {
            setFormError('Add at least one valid recipient address.');
            return;
        }
        // A LIST this wallet could not verify is refused here, before compose,
        // rather than at Approve with a refusal that reads like tampering.
        if (listFit) {
            setFormError(listTooLargeMessage(listFit, sourceMode === 'holders' ? 'holders' : 'paste'));
            return;
        }
        if (sourceMode === 'paste') setCommittedRecipients(recipients);
        setFormError(null);
        setStage('review-list');
    }

    const hw = isHwSource(fromAddress);
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    // §20 / Cluster W FOLLOWUP 5: AIRDROP is a multi-phase action. LIST is
    // broadcast first, then the wallet polls for indexer confirmation, then
    // AIRDROP is broadcast referencing the indexed LIST's ACTION_INDEX. The
    // index-wait step is fundamentally incompatible with the watcher-mode
    // contract (the wallet that builds the PSBT is not the wallet that
    // broadcasts it, so it can't observe the broadcast hitting the indexer).
    // Block the form in watcher mode with a redirect rather than ship a
    // partial flow that strands the user mid-LIST.
    const { isWatcherMode } = useWalletMode();

    // (§5.6 slice 2): AIRDROP is two signed transactions, so
    // BOTH legs get their own single-encode confirm round. The recipient-list
    // review stage stays: it is a data review (who gets what), not an encoded-
    // action preview, and the confirm page is what gates each signature.
    // Hardware comes through here too, on both legs.
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const singleEncode = !isWatcherMode;
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    const hwDispatch = {
        messaging,
        isHw: hw,
        signerId: fromAddress?.signerId,
        passwordRef: passwordValueRef,
    };
    const submitListConfirmed = useConfirmSubmit({
        ...hwDispatch, software: 'createList', hardware: 'createListHw',
    });
    const submitAirdropConfirmed = useConfirmSubmit({
        ...hwDispatch, software: 'airdropAction', hardware: 'airdropActionHw',
    });
    function sourceDescriptor() {
        return {
            address: fromAddress.address,
            publicKey: fromAddress.publicKey,
            derivationPath: fromAddress.derivationPath,
            addressId: fromAddress.id,
            source: fromAddress.source,
            signerId: fromAddress.signerId,
        };
    }

    // Leg 1: the LIST that names the recipients. On Approve the prebuilt PSBT
    // is signed and the pending-airdrop record is written before the wallet
    // starts polling the indexer for the LIST's ACTION_INDEX.
    async function openListConfirm() {
        const from = sourceDescriptor();
        setSubmitError(null);
        try {
            const res = await actionConfirm.run({
                chainId,
                from,
                actionData: { action: 'LIST', params: listParams },
                encoderOpts: {
                    payFeeInNativeCoin: nativeFee.flag,
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
                onApprove: (prebuiltPsbt) => submitListConfirmed({
                    walletId,
                    chainId,
                    from,
                    params: listParams,
                    payFeeInNativeCoin: nativeFee.flag,
                    ...(feePerKb != null ? { feePerKb } : {}),
                    prebuiltPsbt,
                }),
                // §5.4. This leg is the reason the resume descriptor
                // carries an `after` at all: the pending-airdrop record below
                // is written AFTER Approve, and a resume that broadcast the
                // LIST without it would leave the user with a published
                // recipient list, a spent fee, and no airdrop to finish. The
                // record travels with the session and the resume screen writes
                // it with the txid it could not know until the broadcast
                // returned.
                resume: {
                    software: 'createList',
                    hardware: 'createListHw',
                    base: {
                        walletId,
                        chainId,
                        from,
                        params: listParams,
                        payFeeInNativeCoin: nativeFee.flag,
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                    label: `airdrop recipient list (${listItems.length})`,
                    after: {
                        method: 'savePendingAirdrop',
                        base: {
                            record: schemasLib.createPendingAirdrop({
                                walletId,
                                chainId,
                                fromAddress: fromAddress.address,
                                token: token.trim(),
                                amountPer: String(amountPer).trim(),
                                recipients: listItems,
                                listTxid: '',
                                listType,
                                memo: memo.trim() || undefined,
                                payFeeInNativeCoin: nativeFee.payFeeInNativeCoin,
                            }),
                        },
                        txidPath: ['record', 'listTxid'],
                    },
                },
            });
            const txid = res?.txid || res?.broadcast?.txid;
            // A TRANSIENT post-sign broadcast failure RESOLVES as
            // `queued` rather than throwing. The LIST is signed and waiting in
            // the broadcast queue for the user to send it, but it has
            // no txid yet, so the pending-airdrop record that anchors leg 2
            // cannot be written. Say that, instead of the "did not return a
            // txid" internal that fell out below.
            if (res?.queued) {
                setSubmitError(`${SIGNED_NOT_BROADCAST_MESSAGE} Come back and finish the airdrop `
                    + 'once the recipient list has confirmed.');
                return;
            }
            if (!txid) throw new Error('Recipient list broadcast did not return a transaction ID.');
            const record = schemasLib.createPendingAirdrop({
                walletId,
                chainId,
                fromAddress: fromAddress.address,
                token: token.trim(),
                amountPer: String(amountPer).trim(),
                recipients: listItems,
                listTxid: txid,
                listType,
                memo: memo.trim() || undefined,
                payFeeInNativeCoin: nativeFee.payFeeInNativeCoin,
            });
            await messaging.savePendingAirdrop({ record });
            setPendingId(record.id);
            setListTxid(txid);
            setPassword('');
            setStage('wait-index');
        } catch (err) {
            if (isUserRejection(err)) return;
            setSubmitError(submitFailureMessage(err, {
                chainId,
                coinTicker, mandatory: nativeFee.mandatory, fallback: err?.message || 'Recipient list broadcast failed.',
            }));
        }
    }

    // Leg 2: the AIRDROP that references the now-indexed LIST.
    async function openAirdropConfirm() {
        const from = sourceDescriptor();
        setSubmitError(null);
        try {
            const res = await actionConfirm.run({
                chainId,
                from,
                actionData: { action: 'AIRDROP', params: airdropParams },
                encoderOpts: {
                    payFeeInNativeCoin: nativeFee.flag,
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
                onApprove: (prebuiltPsbt) => submitAirdropConfirmed({
                    walletId,
                    chainId,
                    from,
                    params: airdropParams,
                    payFeeInNativeCoin: nativeFee.flag,
                    ...(feePerKb != null ? { feePerKb } : {}),
                    prebuiltPsbt,
                }),
            });
            const txid = res?.txid || res?.broadcast?.txid;
            // Signed, queued, no txid yet (see leg 1). The pending
            // record stays at its current stage, so broadcasting the queued
            // copy from the banner is what completes the airdrop.
            if (res?.queued) {
                setSubmitError(SIGNED_NOT_BROADCAST_MESSAGE);
                return;
            }
            if (!txid) throw new Error('Airdrop broadcast did not return a transaction ID.');
            setAirdropTxid(txid);
            if (pendingId) {
                try {
                    await messaging.updatePendingAirdrop({
                        id: pendingId,
                        patch: { stage: 'done', airdropTxid: txid },
                    });
                } catch (_err) { /* non-fatal */ }
            }
            setPassword('');
            setStage('done');
        } catch (err) {
            if (isUserRejection(err)) return;
            setSubmitError(submitFailureMessage(err, {
                chainId,
                coinTicker, mandatory: nativeFee.mandatory, fallback: err?.message || 'Airdrop broadcast failed.',
            }));
        }
    }

    async function handleSignList(event) {
        event.preventDefault();
        if (singleEncode) { openListConfirm(); return; }
        if (submitting) return;
        if (!hw && (!signerReady && password.length === 0)) return;
        if (hw && hwStatus !== 'available') return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            const base = {
                walletId,
                chainId,
                from: {
                    address: fromAddress.address,
                    publicKey: fromAddress.publicKey,
                    derivationPath: fromAddress.derivationPath,
                    addressId: fromAddress.id,
                    source: fromAddress.source,
                    signerId: fromAddress.signerId,
                },
                params: listParams,
                payFeeInNativeCoin: nativeFee.flag,
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            const res = hw
                ? await messaging.createListHw({ ...base, signerId: fromAddress.signerId })
                : await messaging.createList({ ...base, password });
            const txid = res?.txid || res?.broadcast?.txid;
            if (!txid) throw new Error('Recipient list broadcast did not return a transaction ID.');
            const record = schemasLib.createPendingAirdrop({
                walletId,
                chainId,
                fromAddress: fromAddress.address,
                token: token.trim(),
                amountPer: String(amountPer).trim(),
                recipients: listItems,
                listTxid: txid,
                listType,
                memo: memo.trim() || undefined,
                payFeeInNativeCoin: nativeFee.payFeeInNativeCoin,
            });
            await messaging.savePendingAirdrop({ record });
            setPendingId(record.id);
            setListTxid(txid);
            setPassword('');
            setStage('wait-index');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : submitFailureMessage(err, {
                        chainId,
                        coinTicker,
                        mandatory: nativeFee.mandatory,
                        fallback: err?.message || 'Recipient list broadcast failed.',
                    }),
            );
            if (!hw) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        } finally {
            setSubmitting(false);
        }
    }

    async function handleSignAirdrop(event) {
        event.preventDefault();
        if (singleEncode) { openAirdropConfirm(); return; }
        if (submitting) return;
        if (!hw && (!signerReady && password.length === 0)) return;
        if (hw && hwStatus !== 'available') return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            const base = {
                walletId,
                chainId,
                from: {
                    address: fromAddress.address,
                    publicKey: fromAddress.publicKey,
                    derivationPath: fromAddress.derivationPath,
                    addressId: fromAddress.id,
                    source: fromAddress.source,
                    signerId: fromAddress.signerId,
                },
                params: airdropParams,
                payFeeInNativeCoin: nativeFee.flag,
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            const res = hw
                ? await messaging.airdropActionHw({ ...base, signerId: fromAddress.signerId })
                : await messaging.airdropAction({ ...base, password });
            const txid = res?.txid || res?.broadcast?.txid;
            if (!txid) throw new Error('Airdrop broadcast did not return a transaction ID.');
            setAirdropTxid(txid);
            if (pendingId) {
                try {
                    await messaging.updatePendingAirdrop({
                        id: pendingId,
                        patch: { stage: 'done', airdropTxid: txid },
                    });
                } catch (err) { /* non-fatal */ }
            }
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : submitFailureMessage(err, {
                        chainId,
                        coinTicker,
                        mandatory: nativeFee.mandatory,
                        fallback: err?.message || 'Airdrop broadcast failed.',
                    }),
            );
            if (!hw) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        } finally {
            setSubmitting(false);
        }
    }

    async function handleClearPending() {
        if (clearingPending) return;
        setClearingPending(true);
        try {
            if (pendingId) {
                try { await messaging.clearPendingAirdrop({ id: pendingId }); } catch (_) { /* */ }
            }
            onBack();
        } finally {
            setClearingPending(false);
        }
    }

    const headerBack = stage === 'review-list'
        ? () => { setSubmitError(null); setStage('compose'); }
        : stage === 'review-airdrop' && sourceMode === 'existing'
            ? () => { setSubmitError(null); setStage('compose'); }
            : onBack;
    const header = (
        <PageHeader
            onBack={headerBack}
            title={stage === 'review-list' ? (sourceMode === 'holders' ? 'Review token list' : 'Review address list')
                    : stage === 'wait-index' ? 'Waiting for list to be indexed'
                        : stage === 'review-airdrop' ? 'Review airdrop'
                            : stage === 'done' ? 'Airdrop complete'
                                : `Airdrop tokens`}
        />
    );
    // A review always opens at its top instead of inheriting how far the
    // form was scrolled; the form keeps its own position for Back.
    const wrap = (children) => (
        <Screen
            variant={variant}
            header={header}
            restoreScroll={stage !== 'review-list' && stage !== 'review-airdrop'}
        >
            {children}
        </Screen>
    );

    if (loadError) {
        return wrap(<StatusMessage variant="error">{loadError}</StatusMessage>);
    }
    if (!addressesByChain || !chainId) {
        return wrap(<p className={styles.hint}>Loading…</p>);
    }
    if (isWatcherMode) {
        return wrap(
            <>
                <h2 className={styles.successTitle}>Not available in watcher mode</h2>
                <p className={styles.hint}>
                    Airdrop is a two-phase action: the wallet broadcasts a
                    recipient-list transaction, waits for the network to
                    confirm it, then broadcasts the airdrop transaction
                    referencing the list. A watcher-mode wallet can't observe
                    the recipient list landing on-chain (broadcasting happens on a different
                    wallet), so this flow can't be split across an
                    air-gapped boundary today.
                </p>
                <p className={styles.hint}>
                    Switch this wallet to <strong>full</strong> mode to
                    author an airdrop, or use a Full-mode wallet that holds
                    the same seed.
                </p>
            </>,
        );
    }

    // confirm page, rendered in place of the review stage (the overlay
    // modal didn't fit small/mobile viewports); flow state stays intact.
    if (actionConfirm.open) {
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                screenVariant={variant}
                feeText={feeEstimate?.coinAmount
                    ? `Network fee: ${feeEstimate.coinAmount} ${coinTicker}`.trim()
                    : undefined}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hintClassName={styles.hint}
                // Hardware swaps the password field for the device block
                // and gates Approve on the device being available (§5.1).
                hwSource={hw ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                chainId={chainId}
                getSignerStatus={messaging.getSignerStatus}
            />
        );
    }

    if (stage === 'done') {
        return wrap(
            <>
                <h2 className={styles.successTitle}>Airdrop sent</h2>
                {listTxid ? (
                    <>
                        <p className={styles.successLabel}>Recipient list transaction</p>
                        <code className={styles.txid}>{listTxid}</code>
                    </>
                ) : null}
                <p className={styles.successLabel}>Airdrop transaction</p>
                <code className={styles.txid}>{airdropTxid}</code>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={handleClearPending} loading={clearingPending}>Done</Button>
                </div>
            </>,
        );
    }

    if (stage === 'wait-index') {
        const minutes = Math.floor(waitElapsed / 60);
        const slow = minutes >= 5;
        return wrap(
            <>
                <p className={styles.summary}>{listDecoded?.summary}</p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Recipient list transaction</dt>
                    <dd className={styles.detailsValue}>
                        <code className={styles.txid}>{listTxid}</code>
                    </dd>
                    <dt className={styles.detailsLabel}>Elapsed</dt>
                    <dd className={styles.detailsValue}>
                        {minutes > 0 ? `${minutes} min ${waitElapsed % 60}s` : `${waitElapsed}s`}
                    </dd>
                </dl>
                <p className={styles.hint}>
                    Waiting for the recipient-list transaction to be indexed. Once the
                    explorer assigns an action index, we'll continue to the
                    airdrop step. Safe to close the wallet; we'll resume from
                    Home when you reopen it.
                </p>
                {indexReadError ? (
                    <StatusMessage variant="error">{indexReadError}</StatusMessage>
                ) : null}
                {slow ? (
                    <p className={styles.hint}>
                        This is taking longer than usual. Typical wait is 1–2
                        block confirmations. You can leave it running or come
                        back later.
                    </p>
                ) : null}
                <div className={styles.actions}>
                    <Button variant="ghost" onClick={onBack}>Close (keep waiting)</Button>
                    <Button variant="danger" onClick={handleClearPending} loading={clearingPending}>Cancel airdrop</Button>
                </div>
            </>,
        );
    }

    if (stage === 'review-list') {
        return wrap(
            <FormPage
                demoGuard={demoGuard}
                label="Review recipient list"
                onSubmit={handleSignList}
                status={(hw || singleEncode) && submitError ? (
                    <StatusMessage variant="error">{submitError}</StatusMessage>
                ) : null}
                actions={(
                    <Button
                        type="submit"
                        variant="primary"
                        loading={submitting || actionConfirm.composing}
                        disabled={singleEncode
                            ? actionConfirm.composing
                            : (hw ? hwStatus !== 'available' : (!signerReady && password.length === 0))}
                    >
                        {hw
                            ? `Sign ${listNoun} on ${fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                            : `Sign ${listNoun}`}
                    </Button>
                )}
            >
                <p className={styles.summary}>{listDecoded?.summary}</p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={fromAddress.address} />
                    </dd>
                    {(listDecoded?.details || []).map((d) => (
                        <DetailRow key={d.label} label={d.label} value={d.value} />
                    ))}
                    <DetailRow
                        label={recipientPreview.kind === 'tick'
                            ? 'Holders (current, not final)'
                            : 'Recipients'}
                        value={recipientPreview.loading
                            ? 'Counting…'
                            : recipientPreview.error
                                ? `Unknown (${recipientPreview.error})`
                                : recipientPreview.count != null
                                    ? formatWithThousands(recipientPreview.count)
                                    : '?'}
                    />
                    {totalDistribution !== null ? (
                        <DetailRow
                            label={recipientPreview.volatile
                                ? 'Estimated distribution at current count'
                                : 'Total distribution'}
                            value={`~${formatWithThousands(totalDistribution)} ${token.trim()}`}
                        />
                    ) : null}
                    {roundingRemainder !== null ? (
                        <DetailRow
                            label="Rounding remainder"
                            value={`${formatWithThousands(roundingRemainder)} ${token.trim()} stays at the source address`}
                        />
                    ) : null}
                    <DetailRow
                        label="Estimated network fees (2 transactions)"
                        value={flowNetworkFee
                            ? `${formatWithThousands(flowNetworkFee)} ${coinTicker}${feeEstimate?.rate ? ` (${feeEstimate.rate} each)` : ''}`
                            : 'Estimate unavailable'}
                    />
                    <DetailRow
                        label="Airdrop protocol fee"
                        value="Calculated from the final recipient count when the airdrop executes"
                    />
                </dl>
                {listDecoded && listDecoded.warnings.length > 0 ? (
                    <FormNotice variant="warning" role="alert" lines={listDecoded.warnings} />
                ) : null}
                <p className={styles.hint}>
                    Airdrop is a two-transaction flow. Step 1 broadcasts the
                    {' '}{listNoun}; once the network has recorded it, step 2
                    signs the airdrop that references it. {hw
                        ? 'You will confirm on your hardware device twice.'
                        : signerReady ? 'You will approve each one; the wallet is unlocked, so no password is needed.' : 'You will enter your password twice.'}
                </p>
                {recipientPreview.volatile ? (
                    <p className={styles.hint}>
                        Holder counts can change before the airdrop confirms, so the
                        distribution and protocol fee remain estimates.
                    </p>
                ) : null}
                {accessListNotice ? (
                    <FormNotice variant="warning" role="alert">{accessListNotice}</FormNotice>
                ) : null}
                {holderPreview.failures.length > 0 ? (
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setHolderPreviewRetry((attempt) => attempt + 1)}
                        disabled={holderPreview.loading}
                    >
                        Retry holder counts
                    </Button>
                ) : null}
                {/* On the single-encode path the credentials live on
                    the confirm page, so this stage stays a pure recipient
                    review and the button opens that page. */}
                {singleEncode ? null : (
                    <SignCredentials
                        unlocked={signerReady}
                        fromAddress={fromAddress}
                        chainId={chainId}
                        password={password}
                        onPasswordChange={(v) => {
                            setPassword(v);
                            if (submitError) setSubmitError(null);
                        }}
                        onStatusChange={onHwStatusChange}
                        passwordRef={passwordRef}
                        submitError={submitError}
                        disabled={submitting}
                        getSignerStatus={messaging.getSignerStatus}
                    />
                )}
            </FormPage>,
        );
    }

    if (stage === 'review-airdrop') {
        return wrap(
            <FormPage
                demoGuard={demoGuard}
                label="Review airdrop"
                onSubmit={handleSignAirdrop}
                status={(hw || singleEncode) && submitError ? (
                    <StatusMessage variant="error">{submitError}</StatusMessage>
                ) : null}
                actions={(
                    <>
                        <Button type="button" variant="ghost" onClick={onBack} disabled={submitting}>
                            Close (resume later)
                        </Button>
                        <Button
                            type="submit"
                            variant="primary"
                            loading={submitting || actionConfirm.composing}
                            disabled={
                                !listActionIndex
                                || (singleEncode
                                    ? actionConfirm.composing
                                    : (hw ? hwStatus !== 'available' : (!signerReady && password.length === 0)))
                            }
                        >
                            {hw
                                ? `Sign airdrop on ${fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                                : 'Sign airdrop'}
                        </Button>
                    </>
                )}
            >
                <p className={styles.summary}>{airdropDecoded?.summary}</p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={fromAddress.address} />
                    </dd>
                    {(airdropDecoded?.details || []).map((d) => (
                        <DetailRow
                            key={d.label}
                            label={d.label}
                            value={d.label === 'Per-recipient amount'
                                ? `${d.value} ${token.trim()}`
                                : d.value}
                        />
                    ))}
                    <dt className={styles.detailsLabel}>
                        {recipientPreview.kind === 'tick' ? 'Holders (current, not final)' : 'Recipients'}
                    </dt>
                    <dd className={styles.detailsValue}>
                        {recipientPreview.loading
                            ? 'Counting…'
                            : recipientPreview.error
                                ? `Unknown (${recipientPreview.error})`
                                : recipientPreview.count != null
                                    ? formatWithThousands(recipientPreview.count)
                                    : '?'}
                    </dd>
                    {totalDistribution !== null ? (
                        <>
                            <dt className={styles.detailsLabel}>Total distribution</dt>
                            <dd className={styles.detailsValue}>
                                ~{formatWithThousands(totalDistribution)} {token.trim()}
                            </dd>
                        </>
                    ) : null}
                    {roundingRemainder !== null ? (
                        <DetailRow
                            label="Rounding remainder"
                            value={`${formatWithThousands(roundingRemainder)} ${token.trim()} stays at the source address`}
                        />
                    ) : null}
                    <DetailRow
                        label="Network fee"
                        value={feeEstimate
                            ? `${feeEstimate.coinAmount} ${coinTicker}${feeEstimate.rate ? ` (${feeEstimate.rate})` : ''}`
                            : 'Estimate unavailable'}
                    />
                    <DetailRow
                        label="Airdrop protocol fee"
                        value="Calculated from the final recipient count when the airdrop executes"
                    />
                </dl>
                <DiagnosticDetails
                    summary={`Holder count details (${holderPreview.failures.length})`}
                    items={holderPreview.failures}
                    className={styles.hint}
                />
                {holderPreview.failures.length > 0 ? (
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setHolderPreviewRetry((attempt) => attempt + 1)}
                        disabled={holderPreview.loading}
                    >
                        Retry holder counts
                    </Button>
                ) : null}
                {airdropDecoded && airdropDecoded.warnings.length > 0 ? (
                    <FormNotice variant="warning" role="alert" lines={airdropDecoded.warnings} />
                ) : null}
                {/* The chain kept fewer items than the wallet published.
                    Say so here, on the screen that prices step 2, because the
                    LIST was already paid for at the larger count and the AIRDROP
                    will only pay (and only be charged for) what survived. */}
                {listReconcile && listReconcile.missing.length > 0 ? (
                    <FormNotice variant="warning" role="alert">
                        {`The published list holds ${listReconcile.storedCount} of the ${listReconcile.expectedCount} addresses you submitted: `
                            + `${listReconcile.missing.length} ${listReconcile.missing.length === 1 ? 'was' : 'were'} rejected by the network, most often because `
                            + `${listReconcile.missing.length === 1 ? 'it does' : 'they do'} not belong to the active network. This airdrop pays `
                            + `${recipientPreview.count ?? listReconcile.storedCount}. The rejected ${listReconcile.missing.length === 1 ? 'address' : 'addresses'}: `
                            + `${listReconcile.missing.join(', ')}.`}
                    </FormNotice>
                ) : null}
                {accessListNotice ? (
                    <FormNotice variant="warning" role="alert">{accessListNotice}</FormNotice>
                ) : null}
                {/* PC-11 holder-snapshot honesty: a TICK list's holder set
                    binds at AIRDROP execution (when it confirms on-chain),
                    not at this review screen, so the count above is only
                    ever a preview and can be inflated between now and
                    settlement (e.g. by splitting a balance across more
                    addresses to collect more than one payout). */}
                {recipientPreview.volatile ? (
                    <FormNotice variant="warning" role="alert">
                            This airdrop pays every current holder of the underlying
                            token(s), not a fixed list of addresses. That holder set is
                            only locked in when the airdrop transaction confirms
                            on-chain; the count above is a snapshot taken now and can
                            change (and be inflated) before then. It is an estimate, not
                            a guarantee of who gets paid or the final cost.
                    </FormNotice>
                ) : null}
                <p className={styles.hint}>
                    Airdrops have a protocol fee that grows with the number of
                    recipients, and the network sets the exact amount when the
                    airdrop confirms. Make sure the source address holds enough
                    {' '}{token.trim() || 'of the token'} for the full
                    distribution, plus enough to pay the protocol fee.
                </p>
                {/* Credentials live on the confirm page for leg 2 too. */}
                {singleEncode ? null : (
                    <SignCredentials
                        unlocked={signerReady}
                        fromAddress={fromAddress}
                        chainId={chainId}
                        password={password}
                        onPasswordChange={(v) => {
                            setPassword(v);
                            if (submitError) setSubmitError(null);
                        }}
                        onStatusChange={onHwStatusChange}
                        passwordRef={passwordRef}
                        submitError={submitError}
                        disabled={submitting}
                        getSignerStatus={messaging.getSignerStatus}
                    />
                )}
            </FormPage>,
        );
    }

    if (sourcePickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="From address"
                walletId={walletId}
                chainId={chainId}
                onPick={(a) => {
                    setFromAddressId(a.id);
                    setSourcePickerOpen(false);
                }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    if (tokenPickerOpen) {
        return (
            <TokenPicker
                purpose="send"
                walletId={walletId}
                title="Select token"
                onSelect={(sel) => {
                    setToken(String(sel.tick || ''));
                    // Picking a token on ANOTHER chain re-targets the whole
                    // form, so the source address has to be re-defaulted with
                    // it: the default effect below returns early once
                    // fromAddressId is set, so a stale id from the old chain
                    // survives and resolves to nothing on the new one. See the
                    // NetworkField below for what that looks like on screen.
                    if (!lockedToken && sel.chainId) {
                        if (sel.chainId !== chainId) setFromAddressId(null);
                        setChainId(sel.chainId);
                    }
                    setTokenPickerOpen(false);
                }}
                onBack={() => setTokenPickerOpen(false)}
            />
        );
    }

    if (holderTicksPickerOpen) {
        return (
            <TokenPicker
                purpose="receive"
                walletId={walletId}
                title="Add a token"
                onSelect={(sel) => {
                    const t = String(sel.tick || '');
                    if (t) setTicksText((prev) => (prev.trim() ? `${prev}\n${t}` : t));
                    setHolderTicksPickerOpen(false);
                }}
                onBack={() => setHolderTicksPickerOpen(false)}
            />
        );
    }

    if (listPickerOpen) {
        return (
            <ExistingListPickerScreen
                variant={variant}
                messaging={messaging}
                chainId={chainId}
                addresses={currentChainAddresses}
                onSelect={(row) => {
                    setListActionIndex(String(row.action_index));
                    setListPickerOpen(false);
                }}
                onBack={() => setListPickerOpen(false)}
            />
        );
    }

    // stage === 'compose'
    return wrap(
        <FormPage
            demoGuard={demoGuard}
            label="Token airdrop"
            onSubmit={handleComposeSubmit}
            status={formError ? (
                <StatusMessage variant="error">{formError}</StatusMessage>
            ) : null}
            actions={(
                <Button
                    type="submit"
                    variant="primary"
                    disabled={sourceMode === 'paste' && (recipientsPending || listFit !== null)}
                >
                    {sourceMode === 'existing' ? 'Review airdrop' : 'Review recipients'}
                </Button>
            )}
        >
            {lockedToken && chainId ? (
                <LockedTokenContext chainId={chainId} tick={token} label="Token to drop" />
            ) : (
                <>
                    {/* Clearing the source address with the chain is load-
                        bearing, not tidiness: the default effect above returns
                        early while fromAddressId is set (so an explicit pick is
                        not clobbered by an unrelated address refresh), which
                        means a chain switch leaves an id belonging to the OLD
                        chain. It resolves to nothing on the new one, and the
                        form then renders "No address on this chain. Use Receive
                        to generate one first." over a wallet that has plenty -
                        with no source picker on screen to fix it with, because
                        that control only renders when an address IS resolved.
                        Same shape as ListCreateForm / ControllerBindForm, which
                        have always reset here. */}
                    <ChainPicker label="Network" value={chainId} onChange={(cid) => { setChainId(cid); setFromAddressId(null); }} chainIds={chainsWithAddresses.length ? chainsWithAddresses : (chainId ? [chainId] : [])} chainRegistry={chainRegistry} hideNetworkKind />
                </>
            )}

            {fromAddress ? (
                <AddressField
                    label="From"
                    icon="addresses"
                    value={fromAddress.address}
                    readOnly
                    onChange={() => {}}
                    onIconClick={() => setSourcePickerOpen(true)}
                    iconLabel="Choose source address"
                />
            ) : (
                <FormNotice variant="error">
                    {t('send.source.noAddress')}
                </FormNotice>
            )}

            <Select
                label="Airdrop to"
                value={sourceMode}
                onChange={(e) => {
                    const next = /** @type {'paste' | 'existing' | 'holders'} */ (e.target.value);
                    setSourceMode(next);
                    // Compose is the only stage these can be set from, so
                    // resetting on every mode change keeps a stale pick
                    // from a previous mode out of the AIRDROP params.
                    setListActionIndex(null);
                    setExistingListDetail(null);
                }}
                hint={sourceMode === 'paste'
                    ? 'Paste or upload addresses; publishes a new address list, then airdrops to it.'
                    : sourceMode === 'existing'
                        ? "Pick a list you've already published (address or token) and airdrop straight to it; no new list gets created."
                        : 'Pick one or more tokens; publishes a new token list, then airdrops to every current holder of those tokens.'}
            >
                <option value="paste">Paste addresses</option>
                <option value="existing">Existing list</option>
                <option value="holders">Token holders</option>
            </Select>

            {lockedToken ? null : (
                <TokenField
                    label="Token to drop"
                    value={token && chainId ? { chainId, tick: token } : null}
                    onOpenPicker={() => setTokenPickerOpen(true)}
                />
            )}
            {gatedDropNotice.gated ? (
                <FormNotice variant="warning" role="alert">
                    {gatedTickWarningCopy(token, 'airdrop recipients')}
                </FormNotice>
            ) : null}
            <AmountField
                label="Per-recipient amount"
                hint="Amount sent to each address (or, for a token-holder list, each holder)."
                amount={amountPer}
                tick={token}
                onAmountFieldChange={(rawValue) => {
                    const stripped = String(rawValue).replace(/,/g, '');
                    if (stripped !== '' && !/^\d*\.?\d*$/.test(stripped)) return;
                    setAmountPer(stripped);
                }}
                onMax={maxPayable ? () => setAmountPer(maxPerRecipient) : undefined}
                maxDisabled={!maxPayable}
                balanceText={tickAmtBalance != null && (token)
                    ? `${formatWithThousands(tickAmtBalance)} ${String(token)} available${
                        maxPayable ? ` · up to ${formatWithThousands(maxPerRecipient)} each` : ''}`
                    : null}
            />
            {roundingRemainder !== null ? (
                <p className={styles.hint}>
                    Rounding remainder: {formatWithThousands(roundingRemainder)}
                    {' '}{token.trim()} stays at the source address because
                    the per-recipient amount is limited to {dropInfo?.divisibility ?? 8}
                    {' '}decimal place{(dropInfo?.divisibility ?? 8) === 1 ? '' : 's'}.
                </p>
            ) : null}

            {sourceMode === 'paste' ? (
                <>
                    <div
                        {...recipientsDrop.rootProps}
                        data-drop-active={recipientsDrop.isDragOver ? 'true' : 'false'}
                    >
                        <Textarea
                            label="Recipients"
                            value={pasteText}
                            onChange={(e) => {
                                setImportedRecipientEntries(null);
                                setPasteText(e.target.value);
                            }}
                            placeholder={recipientsDrop.isDragOver
                                ? 'Drop the CSV / TXT file here'
                                : 'Paste addresses, one per line or comma-separated.'}
                            rows={8}
                            spellCheck={false}
                            autoCapitalize="off"
                            autoCorrect="off"
                            autoComplete="off"
                        />
                    </div>
                    {/* The browser's own file control sat in a grey box of
                        its own; it now opens from an outlined button, the
                        same pattern Publish file uses. */}
                    <div>
                        <Input
                            {...recipientsDrop.pickerProps}
                            aria-label="Upload CSV of addresses"
                            autoComplete="off"
                        />
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={recipientsDrop.openFilePicker}
                        >
                            Upload a CSV or text file
                        </Button>
                    </div>

                    {pasteText.trim() ? (
                        <p className={styles.hint}>
                            {recipients.valid.length} valid address
                            {recipients.valid.length === 1 ? '' : 'es'}
                            {recipients.duplicates > 0
                                ? ` · ${recipients.duplicates} duplicate${recipients.duplicates === 1 ? '' : 's'} removed`
                                : ''}
                            {recipients.invalid.length > 0
                                ? ` · ${recipients.invalid.length} invalid skipped`
                                : ''}
                            {totalDistribution !== null
                                ? ` · total ~${formatWithThousands(totalDistribution)} ${token.trim() || 'TOKEN'}`
                                : ''}
                        </p>
                    ) : null}

                    {/* One airdrop's LIST is capped in bytes, so the note names how
                        many of THESE addresses fit and offers to keep that many. */}
                    {listFit && sourceMode === 'paste' ? (
                        <FieldNote
                            variant="warning"
                            testId="airdrop-list-too-large"
                            action={(
                                <Button type="button" variant="secondary" onClick={keepFirstListBatch}>
                                    Keep the first {formatWithThousands(String(listFit.fits))} addresses
                                </Button>
                            )}
                        >
                            <p>{listTooLargeMessage(listFit, 'paste')}</p>
                        </FieldNote>
                    ) : null}
                    {setAsideRecipients.length > 0 ? (
                        <FieldNote
                            variant="info"
                            testId="airdrop-set-aside"
                            action={(
                                <CopyButton
                                    value={setAsideRecipients.join('\n')}
                                    label={`Copy the other ${formatWithThousands(String(setAsideRecipients.length))}`}
                                    appearance="outlined"
                                />
                            )}
                        >
                            <p>
                                {formatWithThousands(String(setAsideRecipients.length))} more
                                {setAsideRecipients.length === 1 ? ' address was' : ' addresses were'} set
                                aside for another airdrop. Copy them before leaving this screen.
                            </p>
                        </FieldNote>
                    ) : null}

                    {recipients.invalid.length > 0 ? (
                        <div className={styles.hint}>
                            <Button
                                type="button"
                                className={styles.back}
                                onClick={() => setShowInvalid((s) => !s)}
                            >
                                {showInvalid ? 'Hide' : 'Show'} {recipients.invalid.length} invalid
                            </Button>
                            {showInvalid ? (
                                <ul>
                                    {(recipients.invalidLines || recipients.invalid.map((address, index) => ({
                                        address,
                                        line: index + 1,
                                    }))).map(({ address, line }) => (
                                        <li key={`${line}:${address}`}>
                                            Line {line}: <code>{address}</code>
                                        </li>
                                    ))}
                                </ul>
                            ) : null}
                        </div>
                    ) : null}

                    {/* A well-formed address for the wrong chain is not a
                        typo, and calling it "invalid" hides what went wrong. Name
                        it, and name the chain this airdrop pays on. */}
                    {recipients.wrongNetwork.length > 0 ? (
                        <FieldNote variant="warning" role="alert">
                            <p>
                                {recipients.wrongNetwork.length} address
                                {recipients.wrongNetwork.length === 1 ? ' is' : 'es are'} for
                                another network and {recipients.wrongNetwork.length === 1 ? 'was' : 'were'}
                                {' '}skipped because this airdrop cannot deliver to
                                {' '}{recipients.wrongNetwork.length === 1 ? 'it' : 'them'}.
                            </p>
                            <DiagnosticDetails
                                summary={`Skipped addresses (${recipients.wrongNetwork.length})`}
                                keepAddresses
                                items={recipients.wrongNetwork.map((address) => ({
                                    subject: address,
                                    message: 'Does not belong to the active network.',
                                }))}
                            />
                        </FieldNote>
                    ) : null}

                    {/* A ^<index> entry is an address reference, not a typo. This
                        form needs the address itself, so say that instead of "invalid". */}
                    {addressRefs.length > 0 ? (
                        <FieldNote variant="warning" role="alert">
                            <p>{addressReferenceNote(addressRefs.length)}</p>
                            <DiagnosticDetails
                                summary={`Address references (${addressRefs.length})`}
                                keepAddresses
                                items={addressRefs.map((ref) => ({
                                    subject: ref,
                                    message: ADDRESS_REFERENCE_ITEM_MESSAGE,
                                }))}
                            />
                        </FieldNote>
                    ) : null}
                </>
            ) : null}

            {sourceMode === 'holders' ? (
                <>
                    <Textarea
                        id="airdrop-holder-ticks"
                        label="Tokens (one per line)"
                        value={ticksText}
                        onChange={(e) => setTicksText(e.target.value)}
                        rows={6}
                        spellCheck={false}
                        autoCapitalize="off"
                        placeholder="TICK1&#10;TICK2"
                    />
                    <div className={styles.fromLine}>
                        <Button type="button" variant="ghost" onClick={() => setHolderTicksPickerOpen(true)}>
                            Add from token picker
                        </Button>
                    </div>
                    {memberTicks.length > 0 ? (
                        <p className={styles.hint}>
                            {memberTicks.length} token{memberTicks.length === 1 ? '' : 's'}
                            {' · '}
                            {holderPreview.loading
                                ? 'counting holders…'
                                : holderPreview.error
                                    ? holderPreview.error
                                    : holderPreview.total != null
                                        ? `~${formatWithThousands(holderPreview.total)} holder${holderPreview.total === '1' ? '' : 's'} right now`
                                        : ''}
                        </p>
                    ) : null}
                    {invalidTicks.length > 0 ? (
                        <p className={styles.hint}>These don't look like token names: {invalidTicks.join(', ')}</p>
                    ) : null}
                    {/* PC-11 holder-snapshot honesty: this count is a preview,
                        not a promise. See the file-level doc comment. */}
                    <p className={styles.hint}>
                        This publishes a new token list, then airdrops to every current
                        holder of {memberTicks.length === 1 ? 'that token' : 'these tokens'}.
                        A wallet holding more than one listed token can receive more than
                        one payout. The holder set is only fixed when the airdrop
                        transaction confirms on-chain, not now; the count above is a
                        preview, not a guarantee of who gets paid.
                    </p>
                </>
            ) : null}

            {sourceMode === 'existing' ? (
                <>
                    <label className={styles.pickerLabel}>Existing list</label>
                    <div className={styles.fromLine}>
                        <span className={styles.hint}>
                            {listActionIndex
                                ? `${listLabel(listActionIndex, existingListDetail?.name)}${existingListDetail?.kind === 'tick' ? ' (token list)' : existingListDetail?.kind === 'address' ? ' (address list)' : ''}`
                                : 'No list chosen yet.'}
                        </span>
                        <Button type="button" variant="ghost" onClick={() => setListPickerOpen(true)}>
                            {listActionIndex ? 'Change list' : 'Choose list'}
                        </Button>
                    </div>
                    {existingListDetail?.error ? (
                        <p className={styles.hint}>Couldn't load this list: {existingListDetail.error}</p>
                    ) : existingListDetail?.kind === 'tick' ? (
                        <p className={styles.hint}>
                            This is a token list: the airdrop pays every current holder of
                            {existingListDetail.items.length === 1 ? ' the listed token' : ' each listed token'}
                            {' '}({existingListDetail.items.join(', ')}).
                            {' '}{holderPreview.loading
                                ? 'Counting holders…'
                                : holderPreview.error
                                    ? `${holderPreview.error}.`
                                    : holderPreview.total != null
                                        ? `~${formatWithThousands(holderPreview.total)} holder${holderPreview.total === '1' ? '' : 's'} right now.`
                                        : ''}
                            {' '}The holder set is only fixed when the airdrop transaction
                            confirms on-chain, not now; treat this as an estimate.
                        </p>
                    ) : existingListDetail?.kind === 'address' ? (
                        <p className={styles.hint}>
                            {existingListDetail.items.length} address{existingListDetail.items.length === 1 ? '' : 'es'} on this list.
                        </p>
                    ) : null}
                </>
            ) : null}

            <DiagnosticDetails
                summary={`Holder count details (${holderPreview.failures.length})`}
                items={holderPreview.failures}
                className={styles.hint}
            />
            {holderPreview.failures.length > 0 ? (
                <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setHolderPreviewRetry((attempt) => attempt + 1)}
                    disabled={holderPreview.loading}
                >
                    Retry holder counts
                </Button>
            ) : null}

            <Input
                label="Memo (optional)"
                hint={MEMO_HINT}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                autoComplete="off"
            />

            {feeTiers ? (
                <FeeSelector
                    label="Network fee"
                    coinTicker={coinTicker}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={feePick.mode === 'custom' ? feeCustomEstimate : null}
                />
            ) : null}
            <NativeFeeToggle {...nativeFee.toggleProps} coinTicker={coinTicker} />

        </FormPage>,
    );
}

/**
 * Why a list is too large for one airdrop, with the count of THESE items that
 * fit, since the limit is in bytes and address lengths vary.
 *
 * @param {{ fits: number, total: number, batches: number|null }} fit
 * @param {'paste' | 'holders'} mode
 * @returns {string}
 */
function listTooLargeMessage({ fits, total, batches }, mode) {
    const noun = mode === 'holders' ? ['token', 'tokens'] : ['address', 'addresses'];
    const count = (n) => `${formatWithThousands(String(n))} ${n === 1 ? noun[0] : noun[1]}`;
    const split = batches && batches > 1
        ? ` Split it into ${formatWithThousands(String(batches))} airdrops of up to ${count(fits)} each.`
        : ' Split it into several smaller airdrops.';
    return `This airdrop lists ${count(total)}, more than this wallet can verify in one airdrop: `
        + `up to ${formatWithThousands(String(fits))} of these fit.${split}`;
}

function DetailRow({ label, value }) {
    return (
        <>
            <dt className={styles.detailsLabel}>{label}</dt>
            <dd className={styles.detailsValue}>{value}</dd>
        </>
    );
}

// Resolve the ACTION_INDEX from whatever shape the explorer returns.
// Normalizes messaging.getListsForSource's response into a row array;
// same shape MyLists.jsx's extractRows already handles.
function extractListRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    return [];
}

/**
 * PC-11 'existing' mode picker: fans `messaging.getListsForSource` out
 * over every address the wallet holds on `chainId` (same shape MyLists
 * uses across every chain), merges + de-dupes by action_index, and lets
 * the caller pick one to airdrop straight to. Deliberately narrower than
 * MyLists (no search/network filter): the form already knows the chain,
 * and the picker's only job here is "which list", not "browse all my
 * lists".
 *
 * @param {object} props
 * @param {'full' | 'compact'} props.variant
 * @param {{ getListsForSource: (req: { chainId: string, address: string }) => Promise<unknown> }} props.messaging
 * @param {string} props.chainId
 * @param {any[]} props.addresses   the wallet's own addresses on chainId
 * @param {(row: any) => void} props.onSelect
 * @param {() => void} props.onBack
 */
function ExistingListPickerScreen({ variant, messaging, chainId, addresses, onSelect, onBack }) {
    const [rows, setRows] = useState(/** @type {any[] | null} */ (null));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [loadAttempt, setLoadAttempt] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setRows(null);
        setLoadError(null);
        const addrList = (addresses || []).map((a) => a.address);
        if (addrList.length === 0) {
            setRows([]);
            return undefined;
        }
        Promise.all(addrList.map((addr) => Promise.resolve()
            .then(() => messaging.getListsForSource({ chainId, address: addr }))
            .then((resp) => ({ rows: extractListRows(resp), error: null }))
            .catch((error) => ({ rows: [], error }))))
            .then((results) => {
                if (cancelled) return;
                const merged = results.flatMap((result) => result.rows);
                const seen = new Set();
                const uniq = merged.filter((row) => {
                    const key = String(row.action_index ?? row.tx_hash ?? JSON.stringify(row));
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
                uniq.sort((a, b) => Number(b.block_index || 0) - Number(a.block_index || 0));
                setRows(uniq);
                const failed = results.find((result) => result.error);
                if (failed && uniq.length === 0) {
                    setLoadError(readFailureMessage(failed.error, 'load your lists'));
                }
            });
        return () => { cancelled = true; };
    }, [chainId, addresses, messaging, loadAttempt]);

    useEffect(() => {
        if (!rows || loadAttempt > 0) return undefined;
        const timer = setTimeout(() => setLoadAttempt(1), OWNED_LIST_REVALIDATE_MS);
        return () => clearTimeout(timer);
    }, [rows, loadAttempt]);

    const header = <PageHeader onBack={onBack} title="Choose a list" />;
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            <ListPage>{children}</ListPage>
        </Screen>
    );

    if (loadError) {
        return wrap(
            <StatusMessage
                variant="error"
                recovery={{ label: 'Try again', onAction: () => setLoadAttempt((value) => value + 1) }}
            >
                {loadError}
            </StatusMessage>,
        );
    }
    if (!rows) return wrap(<p className={styles.hint}>Loading lists…</p>);
    if (rows.length === 0) {
        return wrap(
            <EmptyState
                title="No published lists yet"
                body="Address and token lists published from this network appear here."
            />,
        );
    }
    return wrap(
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {rows.map((row) => {
                const isTick = String(row.type) === '1';
                const statusWhy = row.status ? listStatusText(row.status) : 'status unknown';
                return (
                    <li
                        key={String(row.action_index)}
                        style={{ padding: 'var(--xc-space-2) 0', borderBottom: '1px solid var(--xc-border)' }}
                    >
                        <Button
                            type="button"
                            className={styles.back}
                            style={{ width: '100%', textAlign: 'left' }}
                            onClick={() => onSelect(row)}
                        >
                            {isTick ? 'Token' : 'Address'} list #{row.action_index ?? '?'}
                            {statusWhy ? ` (${statusWhy})` : ''}
                        </Button>
                    </li>
                );
            })}
        </ul>,
    );
}
