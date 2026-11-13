// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// Network, From and the fee selector come from the standard
// FromSection and FeeSection.
import { AddressText, Button, ChainBadge, FormNotice, FormPage, InfoTip, Input, ListPage, ListRow, PageHeader, Screen, StatusMessage, Textarea } from '@xchain-wallet/core/ui';
import inputStyles from '../../ui/Input.module.css';
// The Wallet Form Standard frame.
import {
    FeeSection,
    FormAction,
    FormFrame,
    FormSection,
    FromSection,
    useFormSections,
} from '../components/formStandard/index.js';
import * as Icon from '../../ui/icons/index.jsx';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { normalizeGenesisRow } from './ManageToken.jsx';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { customFeeReviewStop } from '../../flows/feeEstimate.js';
import styles from './IssueTokenForm.module.css';
import { preferredSourceId } from '../addressSelection.js';
import { extractActionIndex } from '../utils/actionIndexFromTx.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { TickerIcon } from '../components/TickerIcon.jsx';
import { coinFromChainId } from '../components/BalanceList.jsx';
import { MAX_MEMO_LENGTH, memoLengthError } from '../utils/memoLimit.js';
import { tokenIssuerEligibility } from '../utils/tokenIssuerEligibility.js';
import { nativeFeeForFeelessAction } from '../../flows/feeBearingActions.js';
import { listMetaSupported } from '../../flows/listFormatSupport.js';
import { findListOwner } from '../../flows/listMembership.js';
import {
    LIST_META_DESCRIPTION_MAX_BYTES,
    LIST_META_NAME_MAX_BYTES,
    listMetaInputError,
    utf8ByteLength,
} from '../../flows/listMetaInput.js';
import { TokenPicker } from './TokenPicker.jsx';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/projectRoster.js';
import '../../i18n/locales/en/ui.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/routes.js';
import rosterStyles from './ProjectRosterForm.module.css';

const chainRegistry = registryLib.defaultRegistry();
const POLL_INTERVAL_MS = 10_000;

// listMetaInputError codes to their copy, spelled out so every key is static.
const META_ERROR_KEYS = {
    pipe: 'projectRoster.metaError.pipe',
    semicolon: 'projectRoster.metaError.semicolon',
    unsafe: 'projectRoster.metaError.unsafe',
    length: 'projectRoster.metaError.length',
    format: 'projectRoster.metaError.format',
};

// A name or description refusal as the field shows it. A cleared value is
// sent as `-` by the save itself, so a typed `-` is refused like on create.
function metaFieldError(field, value) {
    const code = listMetaInputError(field, value, { isCreate: true });
    return code ? t(META_ERROR_KEYS[code]) : null;
}

// Token lists compare as sets: the roster is a membership, and the explorer
// returns it sorted rather than in published order.
function sameTickSet(a, b) {
    if (a.length !== b.length) return false;
    const seen = new Set(a.map((tick) => tick.toUpperCase()));
    return b.every((tick) => seen.has(tick.toUpperCase()));
}

// The v5 field for one value: empty leaves it as it is, `-` clears it.
function setMetaField(next, current) {
    if (next === current) return '';
    return next === '' ? '-' : next;
}

// Protocol coin tickers for the LINK serialization (same map as
// LinkForm / AttachContentForm).
const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

/**
 * Manage a project's token list (the project registry pattern,
 * Project_Registry.md): a TICK-type LIST of member tokens, paired with the
 * project's original ISSUE by a LINK. The indexer only honours a LINK
 * signed by the project's current owner, and the latest owner-valid link
 * replaces earlier ones.
 *
 * The page edits the project's one list rather than starting over:
 *
 *   - no list yet: LIST v4 (name, description, tokens), then the LINK
 *   - only the name or description changed: one LIST v5 SET META on the
 *     same list, no new LINK (v5 is owner-only, so a list this address
 *     does not own falls back to the republish below)
 *   - a token changed: the new full list as LIST v4 with its name and
 *     description, then a LINK to it
 *
 * Where the network does not take list metadata yet, the list goes out
 * as LIST v0 and the name and description fields are hidden.
 *
 * The two-transaction path is a stage machine:
 *
 *   compose      - name, description and token rows (prefilled from the current list)
 *   review-list  - confirm + sign the LIST
 *   wait-index   - poll the explorer for the LIST's ACTION_INDEX
 *   review-link  - confirm + sign the LINK (owner-validated)
 *   done         - the txids shown
 *
 * No crash-safe resume: if the wallet closes mid-flow the LIST is
 * already on-chain and the pairing can be finished manually via
 * Actions → Link. The wait screen says exactly that.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId          chain the project lives on
 * @param {string} props.tick             the project's ticker (uppercase)
 * @param {string | null} [props.issuerAddress]   the project's current owner (preferred signing address)
 * @param {() => void} props.onBack
 */
export function ProjectRosterForm({ walletId, chainId: initialChainId, tick, issuerAddress = null, onBack }) {
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
    const [chainId, setChainId] = useState(initialChainId);
    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);

    // The project's ISSUE action index (the LINK's second leg).
    const [issueActionIndex, setIssueActionIndex] = useState(/** @type {string | null} */ (null));
    const [genesisChecked, setGenesisChecked] = useState(false);
    const [genesisError, setGenesisError] = useState(false);

    // Current published roster (prefill + context line). null = still
    // loading; { members: [] } shape from the explorer; absent roster
    // resolves to null from the host.
    const [currentRoster, setCurrentRoster] = useState(/** @type {any | null} */ (null));
    const [rosterChecked, setRosterChecked] = useState(false);
    const [rosterLoadError, setRosterLoadError] = useState(/** @type {string | null} */ (null));

    // The current list's own name, description and owner, read from the
    // list the LINK pinned. `listDetailChecked` stays false until that read
    // settles (or there is no list to read).
    const [listDetail, setListDetail] = useState(
        /** @type {{ name: string, description: string, owner: string | null } | null} */ (null),
    );
    const [listDetailChecked, setListDetailChecked] = useState(false);
    const [listDetailError, setListDetailError] = useState(false);
    // Whether this network takes LIST v4/v5 (name and description).
    const [metaSupported, setMetaSupported] = useState(/** @type {boolean | null} */ (null));

    // The member tokens as rows, picked from the token picker.
    const [members, setMembers] = useState(/** @type {string[]} */ ([]));
    const [tokenPickerOpen, setTokenPickerOpen] = useState(false);
    // The list's own name and description (LIST v4/v5 NAME and DESCRIPTION).
    const [listName, setListName] = useState('');
    const [listDescription, setListDescription] = useState('');
    const [prefilled, setPrefilled] = useState(false);
    // The one-transaction save (LIST v5) has its own result.
    const [metaTxid, setMetaTxid] = useState(/** @type {string | null} */ (null));
    const [memo, setMemo] = useState('');
    const [password, setPassword] = useState('');
    // The standard sections' open state, held here so it survives
    // the address picker page. Only the Tokens section starts open. Each
    // Review attempt bumps the counter, so the section holding the refusal
    // reopens even after the user closed it.
    const formSections = useFormSections({ from: false, tokens: true, memo: false, fee: false });
    const [reviewAttempt, setReviewAttempt] = useState(0);
    const [feeRefused, setFeeRefused] = useState(false);

    const [stage, setStage] = useState(
        /** @type {'compose' | 'review-list' | 'wait-index' | 'review-link' | 'done'} */
        ('compose'),
    );
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [listTxid, setListTxid] = useState(/** @type {string | null} */ (null));
    const [listActionIndex, setListActionIndex] = useState(/** @type {string | null} */ (null));
    const [linkTxid, setLinkTxid] = useState(/** @type {string | null} */ (null));
    const [waitElapsed, setWaitElapsed] = useState(0);
    const [queuedLeg, setQueuedLeg] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    // The active map is best-effort: a host without `getActiveAddresses`, or
    // one whose call fails, still yields a usable form (newest-HD fallback).
    useEffect(() => {
        let cancelled = false;
        setAddressesByChain(null);
        setActiveByChain(null);
        setFromAddressId(null);
        setLoadError(null);
        Promise.all([
            messaging.getAddressesByChain(walletId),
            typeof messaging.getActiveAddresses === 'function'
                ? Promise.resolve(messaging.getActiveAddresses(walletId)).catch(() => ({}))
                : Promise.resolve({}),
        ])
            .then(([byChain, active]) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
                setActiveByChain(active || {});
                if (!byChain || !Object.values(byChain).some((rows) => Array.isArray(rows) && rows.length > 0)) {
                    setLoadError('No address on this network yet. Use Receive to generate one first.');
                }
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    // Resolve the project's ISSUE action index.
    useEffect(() => {
        setIssueActionIndex(null);
        setGenesisChecked(false);
        setGenesisError(false);
        if (typeof messaging?.getGenesisForToken !== 'function') {
            setGenesisChecked(true);
            setGenesisError(true);
            return undefined;
        }
        let cancelled = false;
        messaging.getGenesisForToken({ chainId, tick })
            .then((row) => {
                if (cancelled) return;
                const info = normalizeGenesisRow(row);
                if (info?.actionIndex) setIssueActionIndex(String(info.actionIndex));
                setGenesisChecked(true);
            })
            .catch(() => {
                if (cancelled) return;
                setGenesisError(true);
                setGenesisChecked(true);
            });
        return () => { cancelled = true; };
    }, [messaging, chainId, tick]);

    // Fetch the current roster for prefill. A project with no published
    // list yet resolves to null (normal for first-time publishing).
    useEffect(() => {
        setCurrentRoster(null);
        setRosterChecked(false);
        setRosterLoadError(null);
        setMembers([]);
        setListName('');
        setListDescription('');
        setPrefilled(false);
        if (typeof messaging?.getProjectForToken !== 'function') {
            setRosterLoadError('Current official-token list lookup is unavailable.');
            setRosterChecked(true);
            return undefined;
        }
        let cancelled = false;
        messaging.getProjectForToken({ chainId, tick })
            .then((project) => {
                if (cancelled) return;
                setCurrentRoster(project || null);
                setRosterChecked(true);
            })
            .catch(() => {
                if (cancelled) return;
                setRosterLoadError('Failed to load the current official-token list. Try again in a moment.');
                setRosterChecked(true);
            });
        return () => { cancelled = true; };
    }, [messaging, chainId, tick]);

    // The pinned list's name, description and owner. The project lookup
    // carries only the list's index, so the list itself is read once.
    const rosterListIndex = currentRoster?.roster_action_index != null
        && /^[1-9][0-9]*$/.test(String(currentRoster.roster_action_index))
        ? String(currentRoster.roster_action_index)
        : null;
    useEffect(() => {
        setListDetail(null);
        setListDetailError(false);
        setListDetailChecked(false);
        if (!rosterChecked) return undefined;
        if (!rosterListIndex || typeof messaging?.getListByActionIndex !== 'function') {
            setListDetailChecked(true);
            return undefined;
        }
        let cancelled = false;
        const readList = (actionIndex) => messaging.getListByActionIndex({ chainId, actionIndex });
        readList(rosterListIndex)
            .then(async (detail) => {
                const owner = detail ? await findListOwner({ detail, readList }) : null;
                if (cancelled) return;
                setListDetail({
                    name: typeof detail?.name === 'string' ? detail.name : '',
                    description: typeof detail?.description === 'string' ? detail.description : '',
                    owner,
                });
                setListDetailChecked(true);
            })
            .catch(() => {
                if (cancelled) return;
                setListDetailError(true);
                setListDetailChecked(true);
            });
        return () => { cancelled = true; };
    }, [messaging, chainId, rosterChecked, rosterListIndex]);

    useEffect(() => {
        let cancelled = false;
        setMetaSupported(null);
        if (typeof messaging?.getActionFormats !== 'function') {
            setMetaSupported(false);
            return undefined;
        }
        const sdkRegistry = {
            get: () => ({
                getActionFormats: (action) => messaging.getActionFormats({ chainId, action }),
            }),
        };
        Promise.resolve().then(() => listMetaSupported({ sdkRegistry, chainId }))
            .then((supported) => { if (!cancelled) setMetaSupported(supported === true); })
            .catch(() => { if (!cancelled) setMetaSupported(false); });
        return () => { cancelled = true; };
    }, [chainId, messaging]);

    // Prefill the rows, name and description once, from the current list.
    useEffect(() => {
        if (prefilled || !rosterChecked || !listDetailChecked) return;
        const rows = Array.isArray(currentRoster?.members) ? currentRoster.members : [];
        const ticks = rows.map((m) => (m && typeof m.tick === 'string' ? m.tick : null)).filter(Boolean);
        setMembers(ticks);
        setListName(listDetail?.name || '');
        setListDescription(listDetail?.description || '');
        setPrefilled(true);
    }, [prefilled, rosterChecked, listDetailChecked, currentRoster, listDetail]);

    // Signing address: prefer the project's owner (the LINK is only
    // honoured from the owner), else the same default as Send and every
    // other spend-from-balance form: the chain's active address, else the
    // newest HD external, else the first remaining record (a hardware-only
    // wallet). A dispenser-delegated address is never the default.
    useEffect(() => {
        if (!addressesByChain || !activeByChain || fromAddressId) return;
        const all = addressesByChain[chainId] || [];
        if (issuerAddress) {
            const match = all.find((a) => a.address === issuerAddress);
            if (match) { setFromAddressId(match.id); return; }
        }
        const funding = all.filter((a) => a.role !== 'dispenser');
        const picked = preferredSourceId(funding, activeByChain[chainId]) || funding[0]?.id || all[0]?.id;
        if (picked) setFromAddressId(picked);
    }, [addressesByChain, activeByChain, chainId, fromAddressId, issuerAddress]);

    useEffect(() => {
        if (stage === 'review-list' || stage === 'review-link') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    // Wait-index polling: same shape as AttachContentForm.
    useEffect(() => {
        if (stage !== 'wait-index' || !listTxid) return undefined;
        let cancelled = false;
        const started = Date.now();
        const tick_ = async () => {
            if (cancelled) return;
            setWaitElapsed(Math.floor((Date.now() - started) / 1000));
            if (typeof document !== 'undefined'
                && document.visibilityState === 'hidden') return;
            try {
                const resp = await messaging.getActionByTxid({ chainId, txid: listTxid });
                if (cancelled) return;
                const idx = extractActionIndex(resp);
                if (idx) {
                    setListActionIndex(idx);
                    setStage('review-link');
                }
            } catch (err) {
                // Keep polling through transient network errors.
            }
        };
        tick_();
        const handle = setInterval(tick_, POLL_INTERVAL_MS);
        return () => { cancelled = true; clearInterval(handle); };
    }, [stage, listTxid, chainId, messaging]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] || '' : '';
    // Keep the chain-required native flag on every leg without offering a
    // protocol-fee choice; a LIST v5 on a shared list is the one leg that
    // can carry a fee, and on Litecoin and Dogecoin it is paid in the coin.
    const nativeFee = nativeFeeForFeelessAction(coinTicker);
    const chainsWithAddresses = useMemo(
        () => Object.entries(addressesByChain || {})
            .filter(([, rows]) => Array.isArray(rows) && rows.length > 0)
            .map(([id]) => id),
        [addressesByChain],
    );

    // Network fee: Low / Normal / Fast / Custom via FeeSelector; feePerKb
    // prices both broadcasts (the LIST and the LINK).
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

    const fromAddress = useMemo(() => {
        if (!fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);
    const issuerEligibility = tokenIssuerEligibility({
        tokenInfo: { creator: issuerAddress },
        addressesByChain,
        chainId,
        tick,
        sourceAddress: fromAddress?.address,
    });
    const ownerMismatch = !!issuerEligibility.error;

    const hw = isHwSource(fromAddress);
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);
    const { isWatcherMode } = useWalletMode();
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const submitting = actionConfirm.composing;
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    const confirmDispatch = {
        messaging,
        isHw: hw,
        signerId: fromAddress?.signerId,
        passwordRef: passwordValueRef,
    };
    const submitList = useConfirmSubmit({
        ...confirmDispatch, software: 'createList', hardware: 'createListHw',
    });
    const submitLink = useConfirmSubmit({
        ...confirmDispatch, software: 'linkAction', hardware: 'linkActionHw',
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

    const memberTicks = members;
    const hasRoster = rosterChecked && Array.isArray(currentRoster?.members) && currentRoster.members.length > 0;
    // The explorer returns at most a page of members while `total` counts
    // them all; republishing the loaded page would drop the rest.
    const rosterTruncated = hasRoster && Number(currentRoster?.total) > currentRoster.members.length;
    const originalTicks = useMemo(
        () => (hasRoster ? currentRoster.members.map((m) => m?.tick).filter((x) => typeof x === 'string') : []),
        [hasRoster, currentRoster],
    );
    const originalName = listDetail?.name || '';
    const originalDescription = listDetail?.description || '';
    const showMeta = metaSupported === true;
    const trimmedName = showMeta ? listName.trim() : '';
    const trimmedDescription = showMeta ? listDescription.trim() : '';
    const nameError = showMeta ? metaFieldError('name', trimmedName) : null;
    const descriptionError = showMeta ? metaFieldError('description', trimmedDescription) : null;
    const tokensChanged = !hasRoster || !sameTickSet(memberTicks, originalTicks);
    const metaChanged = showMeta && hasRoster
        && (trimmedName !== originalName || trimmedDescription !== originalDescription);
    // LIST v5 is accepted only from the list's current owner; any other
    // signer republishes the list and links it instead.
    const ownsList = Boolean(listDetail?.owner && fromAddress?.address
        && listDetail.owner === fromAddress.address);
    /** @type {'publish' | 'meta' | 'none'} */
    const saveKind = tokensChanged ? 'publish'
        : metaChanged ? (ownsList && rosterListIndex ? 'meta' : 'publish')
            : 'none';
    // LIST v4 carries the name and description with the tokens; with
    // neither (or on a network without list metadata) the list is v0.
    const withMeta = showMeta && (trimmedName !== '' || trimmedDescription !== '');
    const listParams = useMemo(() => (withMeta ? {
        VERSION: '4',
        TYPE: '1',
        NAME: trimmedName,
        DESCRIPTION: trimmedDescription,
        ITEM: memberTicks,
    } : {
        VERSION: '0',
        TYPE: '1',
        ITEM: memberTicks,
    }), [withMeta, trimmedName, trimmedDescription, memberTicks]);
    const metaParams = useMemo(() => ({
        VERSION: '5',
        LIST_ACTION_INDEX: rosterListIndex || '',
        NAME: setMetaField(trimmedName, originalName),
        DESCRIPTION: setMetaField(trimmedDescription, originalDescription),
        MEMO: memo.trim(),
    }), [rosterListIndex, trimmedName, originalName, trimmedDescription, originalDescription, memo]);

    function addMember(sel) {
        const next = String(sel?.tick || '').trim();
        setTokenPickerOpen(false);
        if (!next) return;
        if (sel?.chainId && sel.chainId !== chainId) {
            setFormError(t('projectRoster.otherNetwork', { network: descriptor?.displayName || chainId }));
            return;
        }
        if (memberTicks.some((existing) => existing.toUpperCase() === next.toUpperCase())) {
            setFormError(t('projectRoster.duplicate', { tick: next }));
            return;
        }
        setFormError(null);
        setMembers((prev) => [...prev, next]);
    }

    function removeMember(index) {
        setFormError(null);
        setMembers((prev) => prev.filter((_, i) => i !== index));
    }

    function handleReviewList(event) {
        event.preventDefault();
        setReviewAttempt((n) => n + 1);
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        setFeeRefused(Boolean(feeStop));
        if (feeStop) { setFormError(feeStop.formError); return; }
        if (!fromAddress) {
            setFormError('No signing address available on this network.');
            return;
        }
        if (issuerEligibility.pending) {
            setFormError(`Wait for the wallet to verify the current owner of ${tick}.`);
            return;
        }
        if (issuerEligibility.error) {
            setFormError(issuerEligibility.error);
            return;
        }
        if (!rosterChecked || !listDetailChecked || metaSupported === null) {
            setFormError('Still loading the current official-token list. One moment.');
            return;
        }
        if (nameError || descriptionError) {
            setFormError(t('projectRoster.fixDetails'));
            return;
        }
        if (memberTicks.length === 0) {
            setFormError(t('projectRoster.noTokensRefusal'));
            return;
        }
        if (saveKind === 'none') {
            setFormError(t('projectRoster.noChange'));
            return;
        }
        if (saveKind === 'publish' && rosterTruncated) {
            setFormError(t('projectRoster.truncatedRefusal'));
            return;
        }
        if (memo && /[|;]/.test(memo)) {
            setFormError('Memo cannot contain | or ; characters.');
            return;
        }
        const memoTooLong = memoLengthError(memo.trim());
        if (memoTooLong) {
            setFormError(memoTooLong);
            return;
        }
        if (saveKind === 'meta') {
            setFormError(null);
            handleSaveMeta();
            return;
        }
        if (!issueActionIndex) {
            setFormError(
                genesisError
                    ? `Couldn't load the creation record for ${tick}. Try again in a moment.`
                    : genesisChecked
                    ? `The creation record for ${tick} isn't indexed yet. Try again in a minute.`
                    : 'Still looking up the project\'s creation record. One moment.',
            );
            return;
        }
        setFormError(null);
        setStage('review-list');
    }

    // The encoder options every leg carries: the chain-required native
    // flag and the picked network fee rate.
    function legEncoderOpts() {
        return {
            ...(nativeFee.flag ? { payFeeInNativeCoin: true } : {}),
            ...(feePerKb != null ? { feePerKb } : {}),
        };
    }

    // One transaction: LIST v5 SET META on the list the LINK already pins.
    // The confirm page is the review, so it opens straight from the form.
    async function handleSaveMeta() {
        if (submitting) return;
        setSubmitError(null);
        const from = sourceDescriptor();
        const params = metaParams;
        try {
            const res = await actionConfirm.run({
                chainId,
                from,
                actionData: { action: 'LIST', params },
                encoderOpts: legEncoderOpts(),
                onApprove: (prebuiltPsbt) => submitList({
                    walletId,
                    chainId,
                    from,
                    params,
                    ...legEncoderOpts(),
                    prebuiltPsbt,
                }),
            });
            if (res?.queued) { setQueuedLeg(res); return; }
            const txid = res?.txid || res?.broadcast?.txid;
            if (!txid) throw new Error('List broadcast did not return a transaction ID.');
            setMetaTxid(txid);
            setStage('done');
        } catch (err) {
            if (isUserRejection(err)) return;
            setFormError(
                err?.name === 'InvalidPasswordError'
                    ? 'Incorrect password.'
                    : submitFailureMessage(err, {
                        chainId, coinTicker, mandatory: nativeFee.mandatory, fallback: err?.message || 'List broadcast failed.',
                    }),
            );
        } finally {
            setPassword('');
        }
    }

    async function handleSignList(event) {
        event.preventDefault();
        if (submitting) return;
        if (!hw && (!signerReady && password.length === 0)) return;
        if (hw && hwStatus !== 'available') return;
        setSubmitError(null);
        const from = sourceDescriptor();
        const params = listParams;
        try {
            const res = await actionConfirm.run({
                chainId,
                from,
                actionData: { action: 'LIST', params },
                encoderOpts: legEncoderOpts(),
                onApprove: (prebuiltPsbt) => submitList({
                    walletId,
                    chainId,
                    from,
                    params,
                    ...legEncoderOpts(),
                    prebuiltPsbt,
                }),
            });
            // A transient broadcast failure resolves as queued: signed, not on the network.
            if (res?.queued) { setQueuedLeg(res); return; }
            const txid = res?.txid || res?.broadcast?.txid;
            if (!txid) throw new Error('List broadcast did not return a transaction ID.');
            setListTxid(txid);
            setStage('wait-index');
        } catch (err) {
            if (isUserRejection(err)) return;
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : submitFailureMessage(err, {
                        chainId, coinTicker, fallback: err?.message || 'List broadcast failed.',
                    }),
            );
            if (!hw) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        } finally {
            setPassword('');
        }
    }

    async function handleSignLink(event) {
        event.preventDefault();
        if (submitting || !listActionIndex || !issueActionIndex) return;
        if (!hw && (!signerReady && password.length === 0)) return;
        if (hw && hwStatus !== 'available') return;
        setSubmitError(null);
        const from = sourceDescriptor();
        const params = {
            VERSION: '0',
            COIN1: coinTicker,
            COIN1_ACTION_INDEX: listActionIndex,
            COIN2: coinTicker,
            COIN2_ACTION_INDEX: issueActionIndex,
            MEMO: memo.trim() || '',
        };
        try {
            const res = await actionConfirm.run({
                chainId,
                from,
                actionData: { action: 'LINK', params },
                encoderOpts: legEncoderOpts(),
                onApprove: (prebuiltPsbt) => submitLink({
                    walletId,
                    chainId,
                    from,
                    coin1: coinTicker,
                    coin1ActionIndex: listActionIndex,
                    coin2: coinTicker,
                    coin2ActionIndex: issueActionIndex,
                    ...(memo.trim() ? { memo: memo.trim() } : {}),
                    ...legEncoderOpts(),
                    prebuiltPsbt,
                }),
            });
            if (res?.queued) { setQueuedLeg(res); return; }
            const txid = res?.txid || res?.broadcast?.txid;
            if (!txid) throw new Error('Link broadcast did not return a transaction ID.');
            setLinkTxid(txid);
            setStage('done');
        } catch (err) {
            if (isUserRejection(err)) return;
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : submitFailureMessage(err, {
                        chainId, coinTicker, fallback: err?.message || 'Link broadcast failed.',
                    }),
            );
            if (!hw) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        } finally {
            setPassword('');
        }
    }

    const header = (
        <PageHeader
            onBack={onBack}
            backLabel="Back"
            // Plain name for what this page edits.
            title="Project Tokens"
            subtitle={tick}
        />
    );
    const wrap = (children) => (
        <Screen
            variant={variant}
            header={header}
            restoreScroll={stage !== 'review-list' && stage !== 'review-link'}
        >
            {children}
        </Screen>
    );

    if (isWatcherMode) {
        return wrap(
            <ListPage>
                <h2 className={styles.successTitle}>Not available in watcher mode</h2>
                <p className={styles.hint}>
                    Publishing an official-token list is a two-phase action:
                    the wallet broadcasts the list, waits for it to be
                    indexed, then broadcasts the link that makes it official.
                    A watcher-mode wallet can't observe the list landing
                    on-chain, so this flow can't be split across an
                    air-gapped boundary today.
                </p>
            </ListPage>,
        );
    }

    if (loadError) {
        return wrap(
            <ListPage>
                <StatusMessage variant="error">{loadError}</StatusMessage>
            </ListPage>,
        );
    }
    if (!addressesByChain) {
        return wrap(<ListPage><p className={styles.hint}>Loading wallet…</p></ListPage>);
    }
    if (rosterLoadError) {
        return wrap(
            <ListPage>
                <StatusMessage variant="error">{rosterLoadError}</StatusMessage>
            </ListPage>,
        );
    }
    // Without the current name and description a save cannot tell what
    // changed, and a republish would drop them, so the page stops here.
    if (listDetailError) {
        return wrap(
            <ListPage>
                <StatusMessage variant="error">{t('projectRoster.detailsLoadError')}</StatusMessage>
            </ListPage>,
        );
    }

    if (actionConfirm.open) {
        // One leg is in flight: the roster list, its link to the token, or
        // the list details saved from the form.
        const rosterSummary = {
            verb: stage === 'review-link'
                ? t('components.confirmSummary.verbLinkList')
                : stage === 'review-list'
                    ? t('components.confirmSummary.verbCreateList')
                    : t('components.confirmSummary.verbUpdateListDetails'),
            ...(tick ? { ticker: String(tick).toUpperCase() } : {}),
            direction: 'none',
            chainId,
            address: fromAddress?.address,
        };
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                summary={rosterSummary}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId}
                feeText={feeEstimate?.coinAmount
                    ? `Network fee: ${feeEstimate.coinAmount} ${coinTicker}`.trim()
                    : undefined}
                coinTicker={coinTicker}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hwSource={hw ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                chainId={chainId}
                getSignerStatus={messaging.getSignerStatus}
                hintClassName={styles.hint}
            />
        );
    }

    // A leg signed but not broadcast stops the flow: the panel offers no retry,
    // because signing again while a signed copy is queued double-broadcasts.
    if (queuedLeg) {
        return wrap(
            <ListPage>
                <ResultScreen state="signed-not-broadcast" onDone={onBack} what="official token list" unsaved={queuedLeg?.unsaved} />
            </ListPage>,
        );
    }

    if (stage === 'done' && metaTxid) {
        return wrap(
            <ListPage>
                <h2 className={styles.successTitle}>{t('projectRoster.savedTitle')}</h2>
                <p className={styles.successLabel}>{t('projectRoster.metaTransaction')}</p>
                <code className={styles.txid}>{metaTxid}</code>
                <p className={styles.hint}>{t('projectRoster.savedHint', { tick })}</p>
                <div className={styles.actions}>
                    <Button variant="success" icon={<Icon.CheckIcon />} onClick={onBack}>Done</Button>
                </div>
            </ListPage>,
        );
    }

    if (stage === 'done') {
        return wrap(
            <ListPage>
                <h2 className={styles.successTitle}>Official list published</h2>
                <p className={styles.successLabel}>List transaction</p>
                <code className={styles.txid}>{listTxid}</code>
                <p className={styles.successLabel}>Link transaction</p>
                <code className={styles.txid}>{linkTxid}</code>
                <p className={styles.hint}>
                    Once the link confirms, every token on the list is marked
                    as an official token of the {tick} project in the explorer
                    and wallets. Publishing a new list later replaces this one.
                </p>
                <div className={styles.actions}>
                    <Button variant="success" icon={<Icon.CheckIcon />} onClick={onBack}>Done</Button>
                </div>
            </ListPage>,
        );
    }

    if (stage === 'wait-index') {
        const minutes = Math.floor(waitElapsed / 60);
        const slow = minutes >= 5;
        return wrap(
            <ListPage>
                <h2 className={styles.successTitle}>List is on its way</h2>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>List transaction</dt>
                    <dd className={styles.detailsValue}>
                        <code className={styles.txid}>{listTxid}</code>
                    </dd>
                    <dt className={styles.detailsLabel}>Elapsed</dt>
                    <dd className={styles.detailsValue}>
                        {minutes > 0 ? `${minutes} min ${waitElapsed % 60}s` : `${waitElapsed}s`}
                    </dd>
                </dl>
                <p className={styles.hint}>
                    Waiting for the list to be confirmed and indexed.
                    usually one or two blocks. Then one more signature links
                    it to {tick} and makes it official.
                </p>
                {slow ? (
                    <p className={styles.hint}>
                        This is taking longer than usual. If you close this
                        screen the list stays on-chain. You can finish the
                        pairing later from Actions → Link.
                    </p>
                ) : null}
                <div className={styles.actions}>
                    <Button variant="ghost" icon={<Icon.XIcon />} onClick={onBack}>Close (Keep Waiting)</Button>
                </div>
            </ListPage>,
        );
    }

    if (stage === 'review-list' && fromAddress) {
        return wrap(
            <FormPage
                demoGuard={demoGuard}
                label="Review official token list"
                onSubmit={handleSignList}
                status={hw && submitError ? (
                    <StatusMessage variant="error">{submitError}</StatusMessage>
                ) : null}
                actions={(
                    <>
                        {/* Prevent the reconciled button from submitting the compose form. */}
                        <Button variant="ghost" type="button" icon={<Icon.PencilIcon />} onClick={(event) => { event.preventDefault(); setStage('compose'); }} disabled={submitting}>
                            Back to Edit
                        </Button>
                        <Button
                            type="submit"
                            variant="success"
                            icon={<Icon.UploadIcon />}
                            loading={submitting}
                            disabled={hw ? hwStatus !== 'available' : (!signerReady && password.length === 0)}
                        >
                            Publish List
                        </Button>
                    </>
                )}
            >
                <p className={styles.summary}>
                    Publish the official-token list for {tick}
                    {' '}({memberTicks.length} token{memberTicks.length === 1 ? '' : 's'}).
                </p>
                <dl className={styles.detailsList}>
                    {descriptor ? (
                        <>
                            <dt className={styles.detailsLabel}>Network</dt>
                            <dd className={styles.detailsValue}><ChainBadge descriptor={descriptor} size="sm" showName={false} /></dd>
                        </>
                    ) : null}
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={fromAddress.address} />
                    </dd>
                    {listParams.NAME ? (
                        <>
                            <dt className={styles.detailsLabel}>{t('projectRoster.listName')}</dt>
                            <dd className={styles.detailsValue}>{listParams.NAME}</dd>
                        </>
                    ) : null}
                    {listParams.DESCRIPTION ? (
                        <>
                            <dt className={styles.detailsLabel}>{t('routes.manageToken.description')}</dt>
                            <dd className={styles.detailsValue}>{listParams.DESCRIPTION}</dd>
                        </>
                    ) : null}
                </dl>
                <div className={rosterStyles.rosterList} role="list" aria-label="Tokens">
                    {memberTicks.map((memberTick) => (
                        <ListRow
                            role="listitem"
                            key={memberTick.toLowerCase()}
                            leading={<TickerIcon tick={memberTick} chainId={chainId} size={28} />}
                            title={memberTick}
                        />
                    ))}
                </div>
                <p className={styles.hint}>
                    This is step 1 of 2. The list goes on-chain first; once
                    it's indexed you'll sign one more transaction linking it
                    to {tick}. {hw
                        ? 'You will confirm on your hardware device twice.'
                        : !signerReady ? 'You will enter your password twice.' : null}
                </p>
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
            </FormPage>,
        );
    }

    if (stage === 'review-link' && fromAddress) {
        return wrap(
            <FormPage
                demoGuard={demoGuard}
                label="Review official token link"
                onSubmit={handleSignLink}
                status={hw && submitError ? (
                    <StatusMessage variant="error">{submitError}</StatusMessage>
                ) : null}
                actions={(
                    <Button
                        type="submit"
                        variant="success"
                        icon={<Icon.LinkIcon />}
                        loading={submitting}
                        disabled={hw ? hwStatus !== 'available' : (!signerReady && password.length === 0)}
                    >
                        Make It Official
                    </Button>
                )}
            >
                <p className={styles.summary}>
                    Link the published list to {tick}. This makes it the
                    project's official-token list.
                </p>
                <dl className={styles.detailsList}>
                    {descriptor ? (
                        <>
                            <dt className={styles.detailsLabel}>Network</dt>
                            <dd className={styles.detailsValue}><ChainBadge descriptor={descriptor} size="sm" showName={false} /></dd>
                        </>
                    ) : null}
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={fromAddress.address} />
                    </dd>
                    <dt className={styles.detailsLabel}>Token-list record</dt>
                    <dd className={styles.detailsValue}>
                        On-chain
                        <span className={styles.detailsRef}>#{listActionIndex}</span>
                    </dd>
                    <dt className={styles.detailsLabel}>Project creation record</dt>
                    <dd className={styles.detailsValue}>
                        On-chain
                        <span className={styles.detailsRef}>#{issueActionIndex}</span>
                    </dd>
                </dl>
                {ownerMismatch ? (
                    <FormNotice variant="error" role="alert">
                        {issuerEligibility.error}
                    </FormNotice>
                ) : null}
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
            </FormPage>,
        );
    }

    if (sourcePickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="From Address"
                walletId={walletId}
                chainId={chainId}
                onChainChange={(nextChainId) => {
                    setChainId(nextChainId);
                    setFromAddressId(null);
                }}
                onPick={(address) => {
                    setFromAddressId(address.id);
                    setSourcePickerOpen(false);
                }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    // Tokens join the list only from the picker, locked to the project's
    // network: the roster counts only tokens on its own chain.
    if (tokenPickerOpen) {
        return (
            <TokenPicker
                purpose="receive"
                walletId={walletId}
                title={t('projectRoster.pickerTitle')}
                networkFilter={coinFromChainId(chainId)}
                chainIdFilter={chainId}
                kindFilter="tokens"
                kindLocked
                onSelect={addMember}
                onBack={() => setTokenPickerOpen(false)}
            />
        );
    }

    // stage === 'compose'
    // The section a refusal belongs to, so Review reopens it.
    const errorSection = !formError ? null
        : feeRefused ? 'fee'
            : /memo/i.test(formError) ? 'memo'
                : /signing address|current owner/i.test(formError) ? 'from'
                    : 'tokens';
    const revealFor = (id) => (errorSection === id ? reviewAttempt : 0);
    const noSourceOnChain = !((addressesByChain?.[chainId]) || []).length;
    // Closed-section summaries.
    const tokensSummary = [
        trimmedName || null,
        memberTicks.length
            ? `${memberTicks.length} token${memberTicks.length === 1 ? '' : 's'}`
            : 'None yet',
    ].filter(Boolean).join(' · ');
    // One line under the fields saying how many transactions the save is.
    const planText = !prefilled ? null
        : !hasRoster ? t('projectRoster.planCreate')
            : saveKind === 'meta' ? t('projectRoster.planMeta')
                : saveKind === 'publish' && !tokensChanged ? t('projectRoster.planMetaNotOwner')
                    : saveKind === 'publish' ? t('projectRoster.planRepublish')
                        : null;

    // The standard order: From (closed) holds Network and the owner address;
    // List (open) the name, description and token rows; then Memo and the one
    // Network fee row, which prices every transaction the save makes.
    return wrap(
        <FormFrame
            demoGuard={demoGuard}
            label="Project tokens"
            onSubmit={handleReviewList}
            status={formError || issuerEligibility.error ? (
                <StatusMessage variant="error">{formError || issuerEligibility.error}</StatusMessage>
            ) : null}
            action={(
                <FormAction
                    icon={hasRoster ? <Icon.SaveIcon /> : <Icon.PlusIcon />}
                    loading={submitting}
                    disabled={issuerEligibility.pending || !!issuerEligibility.error || submitting}
                >
                    {hasRoster ? t('projectRoster.save') : t('projectRoster.create')}
                </FormAction>
            )}
            from={(
                <FromSection
                    {...formSections.bind('from')}
                    chainId={chainId}
                    chainIds={chainsWithAddresses.length ? chainsWithAddresses : [chainId]}
                    chainRegistry={chainRegistry}
                    onNetworkChange={(nextChainId) => {
                        setChainId(nextChainId);
                        setFromAddressId(null);
                    }}
                    networkHelp={t('projectRoster.networkHelp')}
                    address={fromAddress?.address || null}
                    addressHelp={`Only the current owner of ${tick} can publish its official-token list.`}
                    onOpenPicker={() => setSourcePickerOpen(true)}
                    pickerLabel="Choose source address"
                    revealKey={revealFor('from')}
                    missing={noSourceOnChain ? (
                        <FormNotice variant="error">No address on this network. Use Receive to generate one first.</FormNotice>
                    ) : null}
                />
            )}
            fee={(
                <FeeSection
                    {...formSections.bind('fee')}
                    chainId={chainId}
                    coinTicker={coinTicker}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={feeCustomEstimate}
                    revealKey={revealFor('fee')}
                />
            )}
        >
            <FormSection
                id="tokens"
                title={t('projectRoster.listSection')}
                icon={Icon.TokenListIcon}
                {...formSections.bind('tokens')}
                revealKey={revealFor('tokens')}
                summary={tokensSummary}
            >
            {!prefilled ? (
                <p className={styles.hint}>{t('projectRoster.loadingList')}</p>
            ) : (
                <p className={styles.hint}>
                    {hasRoster ? t('projectRoster.currentList') : t('projectRoster.noListYet')}
                </p>
            )}
            {/* The list's name and description come first, then its tokens.
                Both are optional and LIST v4/v5 carry them, so a network
                without list metadata hides them. */}
            {showMeta ? (
                <>
                    <Input
                        label={t('projectRoster.listName')}
                        optional
                        help={t('projectRoster.listNameHelp', { tick })}
                        hint={t('projectRoster.byteCount', { used: utf8ByteLength(trimmedName), max: LIST_META_NAME_MAX_BYTES })}
                        error={nameError || undefined}
                        value={listName}
                        onChange={(e) => { setListName(e.target.value); setFormError(null); }}
                        autoComplete="off"
                    />
                    <Textarea
                        label={t('routes.manageToken.description')}
                        optional
                        help={t('projectRoster.descriptionHelp')}
                        hint={t('projectRoster.byteCount', { used: utf8ByteLength(trimmedDescription), max: LIST_META_DESCRIPTION_MAX_BYTES })}
                        error={descriptionError || undefined}
                        value={listDescription}
                        onChange={(e) => { setListDescription(e.target.value); setFormError(null); }}
                        rows={2}
                    />
                </>
            ) : null}
            {metaSupported === false ? (
                <p className={styles.hint}>{t('projectRoster.metaUnsupported')}</p>
            ) : null}
            {/* The token rows are not one input, so their label row is drawn
                here with the same help tip a field label carries. */}
            <div className={inputStyles.labelRow}>
                <span id="roster-tokens-label" className={inputStyles.label}>{t('components.tickItemsEditor.tokens')}</span>
                <InfoTip
                    className={inputStyles.labelHelp}
                    label={t('projectRoster.tokensHelp', { tick })}
                    aria={t('ui.field.about', { label: t('components.tickItemsEditor.tokens') })}
                />
            </div>
            {memberTicks.length > 0 ? (
                <div className={rosterStyles.rosterList} role="list" aria-labelledby="roster-tokens-label">
                    {memberTicks.map((memberTick, index) => (
                        <ListRow
                            role="listitem"
                            key={memberTick.toLowerCase()}
                            leading={<TickerIcon tick={memberTick} chainId={chainId} size={28} />}
                            title={memberTick}
                            trailing={(
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    icon={<Icon.TrashIcon />}
                                    aria-label={t('projectRoster.removeToken', { tick: memberTick })}
                                    disabled={rosterTruncated}
                                    onClick={() => removeMember(index)}
                                >
                                    {t('projectRoster.removeTokenButton')}
                                </Button>
                            )}
                        />
                    ))}
                </div>
            ) : (
                prefilled ? <p className={styles.hint}>{t('projectRoster.noTokens')}</p> : null
            )}
            {rosterTruncated ? (
                <FormNotice variant="warning">
                    {t('projectRoster.truncated', { total: Number(currentRoster.total), loaded: currentRoster.members.length })}
                </FormNotice>
            ) : null}
            <div className={styles.actions}>
                <Button
                    type="button"
                    variant="ghost"
                    icon={<Icon.PlusIcon />}
                    disabled={!prefilled || rosterTruncated}
                    onClick={() => { setFormError(null); setTokenPickerOpen(true); }}
                >
                    {t('projectRoster.addToken')}
                </Button>
            </div>
            {planText ? <p className={styles.hint}>{planText}</p> : null}
            </FormSection>
            <FormSection
                id="memo"
                title="Memo"
                icon={Icon.MessageIcon}
                optional
                {...formSections.bind('memo')}
                revealKey={revealFor('memo')}
                summary={memo.trim() || 'None'}
            >
                <Input
                    label="Memo"
                    maxLength={MAX_MEMO_LENGTH}
                    help="An optional public note stored on the chain with this save: on the link when the list is published, or on the name and description change."
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    autoComplete="off"
                />
            </FormSection>
        </FormFrame>,
    );
}
