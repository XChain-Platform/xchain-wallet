// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
// The From address and the fee selector render inside the
// standard FromSection and FeeSection.
import { AddressText, Button, FormPage, Icon, Input, ListPage, NetworkField, PageHeader, Screen, Spinner, StatusMessage } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { isHwSource } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';
import { nativeFeeForFeelessAction } from '../../flows/feeBearingActions.js';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { customFeeReviewStop } from '../../flows/feeEstimate.js';
import { actionDisplayLabel } from '../utils/actionDisplayLabel.js';
import { explorerErrorCode } from '../../sdk/explorerErrors.js';
import { flattenActionDetails } from '../utils/historyRow.js';
import styles from './IssueTokenForm.module.css';
import facts from './FactRows.module.css';
import { preferredSourceId } from '../addressSelection.js';
import { pickDefaultChainId } from '../chainSelection.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { ConfirmActionModal } from '../components/ConfirmActionModal.jsx';
import { MAX_MEMO_LENGTH, memoLengthError } from '../utils/memoLimit.js';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
// Link actions is laid out on the Wallet Form Standard frame.
import {
    FeeSection,
    FormAction,
    FormFrame,
    FormSection,
    FromSection,
    MemoSection,
    useFormSections,
} from '../components/formStandard/index.js';

const chainRegistry = registryLib.defaultRegistry();
const NO_ACKNOWLEDGMENTS = new Set();

// Protocol coin tickers for the LINK serialization. The chain
// descriptor's `coin` is long-form ('bitcoin' / 'litecoin' /
// 'dogecoin'); the LINK action serializes COIN1 / COIN2 as
// short-form tickers ('BTC' / 'LTC' / 'DOGE').
const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

// Human-readable coin ticker for display in the Network fee row.
// Mirrors the keys used by the fee-estimate table.
const COIN_DISPLAY_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

// An action number is looked up once the user stops typing for this long, or
// at once when the field loses focus, so a number typed digit by digit costs
// one explorer read rather than one per keystroke.
const LOOKUP_DEBOUNCE_MS = 350;
const WHOLE_NUMBER = /^\d+$/;

// The field error for a number no action on that network holds.
const NO_SUCH_ACTION = 'No action with this number';

/**
 * §42.8.1 LINK creation: two-action composer.
 *
 * Anchors a pair of existing actions across two chains. The form
 * builds a LINK action with `COIN1 / COIN1_ACTION_INDEX / COIN2 /
 * COIN2_ACTION_INDEX / MEMO` and submits it on the form network. The LINK
 * itself is a single on-chain action; both sides are still recorded
 * in the indexer's `links` table so the §23.5 cross-chain thread
 * rendering on History works regardless of which side the user
 * opens.
 *
 * Action lookup: once an action number is complete (the field loses
 * focus, or the user pauses typing) the form reads that side's action
 * through `messaging.getActionByIndex`, the explorer read every other
 * action view uses, once per (chainId, actionIndex) pair. A found
 * action shows a read-only summary under its fields (what it is, its
 * subject, its block and its sender) so the user can see they are
 * linking, say, an image to a token; a number no action holds gets the
 * field's own error.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 */
export function LinkForm({ walletId, onBack }) {
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

    const [formChainId, setFormChainId] = useState(/** @type {string | null} */ (null));
    const [chain1Id, setChain1Id] = useState(/** @type {string | null} */ (null));
    const [chain2Id, setChain2Id] = useState(/** @type {string | null} */ (null));
    const [actionIndex1, setActionIndex1] = useState('');
    const [actionIndex2, setActionIndex2] = useState('');
    const [memo, setMemo] = useState('');
    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const [password, setPassword] = useState('');

    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    // Which standard section the last Review refusal points at, and a
    // counter bumped on every Review, so that section reopens on each attempt.
    const [formErrorSection, setFormErrorSection] = useState(/** @type {'from' | 'link' | 'fee' | null} */ (null));
    const [reviewAttempt, setReviewAttempt] = useState(0);
    // The sections' open state, held above the picker and review
    // early returns. From starts closed, Link open, Memo and the fee closed.
    const formSections = useFormSections({ from: false, link: true, memo: false, fee: false });
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const [hwStatus, setHwStatus] = useState('idle');
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const [previewCache, setPreviewCache] = useState(
        /** @type {Record<string, { loading: boolean, action: any | null, error: string | null }>} */ ({}),
    );
    // The same map, readable synchronously, so a debounce timer and a blur
    // that both fire for one number see the read the other started.
    const previewCacheRef = useRef(/** @type {Record<string, { loading: boolean, action: any | null, error: string | null }>} */ ({}));
    const putPreview = useCallback((key, entry) => {
        previewCacheRef.current = { ...previewCacheRef.current, [key]: entry };
        setPreviewCache(previewCacheRef.current);
    }, []);

    // One explorer read per (network, number): a number already being read,
    // found or known missing is never read again; only a failed read retries.
    const lookUpAction = useCallback((chainId, actionIndex) => {
        if (!chainId || !WHOLE_NUMBER.test(actionIndex)) return;
        const key = `${chainId}:${actionIndex}`;
        const known = previewCacheRef.current[key];
        if (known && !known.error) return;
        putPreview(key, { loading: true, action: null, error: null });
        messaging.getActionByIndex({ chainId, actionIndex })
            .then((action) => {
                if (!mountedRef.current) return;
                putPreview(key, { loading: false, action: action || null, error: null });
            })
            .catch((err) => {
                if (!mountedRef.current) return;
                // The explorer answers 404 for a number no action holds: that is a
                // missing action, not a failed lookup.
                const missing = explorerErrorCode(err) === 'EXPLORER_HTTP_404';
                putPreview(key, { loading: false, action: null, error: missing ? null : (err?.message || String(err)) });
            });
    }, [messaging, putPreview]);

    const fieldIdBase = useId();
    const actionInputId1 = `${fieldIdBase}-action-1`;
    const actionInputId2 = `${fieldIdBase}-action-2`;

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
                setAddressesByChain(byChain || {});
                setActiveByChain(active || {});
                const chains = Object.entries(byChain || {})
                    .filter(([, addrs]) => Array.isArray(addrs) && addrs.length > 0)
                    .map(([cid]) => cid);
                if (chains.length === 0) {
                    setLoadError(
                        'No addresses on any network yet. Use Receive to generate one before creating a link.',
                    );
                    return;
                }
                // `chains` is in address-creation order, so opening COIN1 on
                // its first entry opened every link on the wallet's OLDEST
                // chain forever. COIN1 defaults to the last-used chain
                // instead (restricted to chains with addresses, so the
                // fallback still lands on `chains[0]` exactly as before);
                // COIN2 still just needs to be the OTHER side of the pair,
                // so it takes the next distinct chain.
                const restricted = Object.fromEntries(chains.map((cid) => [cid, byChain[cid]]));
                const chain1 = pickDefaultChainId(restricted, { settings }) || chains[0];
                setFormChainId(chain1);
                setChain1Id(chain1);
                setChain2Id(chains.find((cid) => cid !== chain1) || chain1);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    const submitChainId = formChainId;

    // The signing address must belong to the chain we're submitting
    // the LINK on. Reset fromAddressId when the form network changes, to the
    // same default as Send and every other spend-from-balance form: the
    // chain's active address, else the newest HD external, else the first
    // remaining record (a hardware-only wallet). A dispenser-delegated
    // address is never the default; it vends rather than funds. An address
    // already on the new network is kept: picking an own address on another
    // chain switches the network and fills the address in the same step.
    useEffect(() => {
        if (!addressesByChain || !activeByChain || !submitChainId) {
            setFromAddressId(null);
            return;
        }
        const all = addressesByChain[submitChainId] || [];
        const funding = all.filter((a) => a.role !== 'dispenser');
        setFromAddressId((current) => (current && all.some((a) => a.id === current)
            ? current
            : preferredSourceId(funding, activeByChain[submitChainId]) || funding[0]?.id || all[0]?.id || null));
    }, [submitChainId, addressesByChain, activeByChain]);

    const fromAddress = useMemo(() => {
        if (!addressesByChain || !fromAddressId || !submitChainId) return null;
        return (addressesByChain[submitChainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [addressesByChain, submitChainId, fromAddressId]);

    const descriptor1 = chain1Id ? chainRegistry.get(chain1Id) : null;
    const descriptor2 = chain2Id ? chainRegistry.get(chain2Id) : null;
    const ticker1 = descriptor1 ? PROTOCOL_COIN_TICKER[descriptor1.coin] || '' : '';
    const ticker2 = descriptor2 ? PROTOCOL_COIN_TICKER[descriptor2.coin] || '' : '';
    const hw = isHwSource(fromAddress);

    // Each keystroke restarts its side's timer, so only the number the user
    // stops on is read; a blur reads it at once (see ActionCard).
    useEffect(() => {
        if (!chain1Id || !WHOLE_NUMBER.test(actionIndex1)) return undefined;
        const timer = setTimeout(() => lookUpAction(chain1Id, actionIndex1), LOOKUP_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [chain1Id, actionIndex1, lookUpAction]);

    useEffect(() => {
        if (!chain2Id || !WHOLE_NUMBER.test(actionIndex2)) return undefined;
        const timer = setTimeout(() => lookUpAction(chain2Id, actionIndex2), LOOKUP_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [chain2Id, actionIndex2, lookUpAction]);

    // Focus the password field when we land on the review stage so the
    // user can sign without reaching for the mouse.
    useEffect(() => {
        if (stage === 'review') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    const trimmedMemo = memo.trim();
    const memoTooLong = memoLengthError(trimmedMemo);
    const preview1 = chain1Id && /^\d+$/.test(actionIndex1)
        ? previewCache[`${chain1Id}:${actionIndex1}`]
        : null;
    const preview2 = chain2Id && /^\d+$/.test(actionIndex2)
        ? previewCache[`${chain2Id}:${actionIndex2}`]
        : null;
    const previewPending = Boolean(
        actionIndex1 && actionIndex2
        && /^\d+$/.test(actionIndex1) && /^\d+$/.test(actionIndex2)
        && (!preview1 || preview1.loading || !preview2 || preview2.loading),
    );

    const validationError = useMemo(() => {
        if (memoTooLong) return memoTooLong;
        if (!ticker1 || !ticker2) return null;
        if (!actionIndex1 || !actionIndex2) return null;
        if (!/^\d+$/.test(actionIndex1)) return 'The number for Action 1 must be a whole number.';
        if (!/^\d+$/.test(actionIndex2)) return 'The number for Action 2 must be a whole number.';
        if (ticker1 === ticker2 && BigInt(actionIndex1) === BigInt(actionIndex2)) {
            return 'Cannot link an action to itself.';
        }
        if (preview1?.error) return 'Could not verify Action 1. Check the number and try again.';
        if (preview2?.error) return 'Could not verify Action 2. Check the number and try again.';
        return null;
    }, [ticker1, ticker2, actionIndex1, actionIndex2, memoTooLong, preview1, preview2]);

    // A number the explorer holds no action for is the field's own error
    // (shown under that field, never repeated in the banner), and it still
    // stops Review.
    const missing1 = isMissingAction(preview1);
    const missing2 = isMissingAction(preview2);

    const { isWatcherMode } = useWalletMode();

    // Network fee: Low / Normal / Fast / Custom via FeeSelector on the
    // submit chain; feePerKb prices the broadcast.
    const [feePick, setFeePick] = useState(
        /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: 'normal' }),
    );
    const feeTiers = useMemo(
        () => estimateNativeSendFeeTiers({ chainId: submitChainId, chainRegistry }),
        [submitChainId],
    );
    const feeCustomEstimate = useMemo(
        () => (feePick.mode === 'custom'
            ? customFeeEstimate({ chainId: submitChainId, chainRegistry, rate: Number(feePick.customRate) || 0 })
            : null),
        [submitChainId, feePick],
    );
    const feeEstimate = feePick.mode === 'custom'
        ? feeCustomEstimate
        : (feeTiers ? feeTiers[feePick.mode] : estimateNativeSendFee({ chainId: submitChainId, chainRegistry, speed: feePick.mode }));
    const feePerKb = (feeEstimate && feeEstimate.unit
        && Number.isFinite(feeEstimate.rateValue) && feeEstimate.rateValue > 0)
        ? displayRateToSettingsCustom(feeEstimate.unit, feeEstimate.rateValue)
        : null;

    // Derive the submit-chain coin ticker for the fee row display.
    const submitDescriptor = submitChainId ? chainRegistry.get(submitChainId) : null;
    const feeCoinTicker = submitDescriptor
        ? (COIN_DISPLAY_TICKER[submitDescriptor.coin] || submitDescriptor.coin)
        : null;

    // Keep the chain-required flag in every submit path without presenting a
    // protocol-fee choice for this feeless action.
    const nativeFee = nativeFeeForFeelessAction(submitDescriptor);

    // The wire params, mirroring linkAction's own build. What is signed is a
    // BINDING between two on-chain records, and the confirm page's action-byte
    // cross-check is the only thing that proves the COIN/index pair the user
    // read is the pair encoded into the transaction.
    const linkParams = useMemo(() => ({
        VERSION: '0',
        COIN1: String(ticker1).toUpperCase(),
        COIN1_ACTION_INDEX: actionIndex1,
        COIN2: String(ticker2).toUpperCase(),
        COIN2_ACTION_INDEX: actionIndex2,
        MEMO: memo.trim() || '',
    }), [ticker1, actionIndex1, ticker2, actionIndex2, memo]);
    const legacyComposed = useMemo(() => ({
        action: 'LINK',
        chainId: submitChainId,
        protocolFeeKnownFree: true,
    }), [submitChainId]);

    // §5.6: the signing lanes compose ONE PSBT host-side and approve it on
    // the shared confirm page; watcher keeps the legacy review stage.
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const singleEncode = !isWatcherMode;
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    const submitConfirmed = useConfirmSubmit({
        messaging,
        isHw: hw,
        signerId: fromAddress?.signerId,
        passwordRef: passwordValueRef,
        software: 'linkAction',
        hardware: 'linkActionHw',
    });

    // Compose, tamper-check and pre-flight run HOST-side; Approve signs the
    // byte-identical prebuilt PSBT. Reject is a calm no-op back to the form.
    async function openConfirmScreen() {
        const from = {
            address: fromAddress.address,
            publicKey: fromAddress.publicKey,
            derivationPath: fromAddress.derivationPath,
            addressId: fromAddress.id,
            source: fromAddress.source,
            signerId: fromAddress.signerId,
        };
        setSubmitError(null);
        try {
            const r = await actionConfirm.run({
                chainId: submitChainId,
                from,
                actionData: { action: 'LINK', params: linkParams },
                encoderOpts: {
                    payFeeInNativeCoin: nativeFee.flag || undefined,
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
                onApprove: (prebuiltPsbt) => submitConfirmed({
                    walletId,
                    chainId: submitChainId,
                    from,
                    coin1: ticker1,
                    coin1ActionIndex: actionIndex1,
                    coin2: ticker2,
                    coin2ActionIndex: actionIndex2,
                    ...(memo.trim() ? { memo: memo.trim() } : {}),
                    payFeeInNativeCoin: nativeFee.flag,
                    ...(feePerKb != null ? { feePerKb } : {}),
                    prebuiltPsbt,
                }),
            });
            setResult(r);
            setPassword('');
            setStage('done');
        } catch (err) {
            if (isUserRejection(err)) return;
            setFormError(submitFailureMessage(err, {
                chainId: submitChainId,
                coinTicker: feeCoinTicker || '',
                mandatory: nativeFee.mandatory,
                fallback: err?.message || 'Sign failed.',
            }));
        }
    }

    // Form submit goes to the review stage, not directly to broadcast.
    // Runs the same guards that previously gated signing so nothing
    // reachable from the review screen is in an invalid state.
    function handleReview(event) {
        event.preventDefault();
        // Every Review attempt may reopen the section that holds the error.
        setReviewAttempt((n) => n + 1);
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        if (feeStop) { setFormError(feeStop.formError); setFormErrorSection('fee'); return; }
        if (!chain1Id || !chain2Id) {
            setFormError('Pick both networks before reviewing.');
            setFormErrorSection('link');
            return;
        }
        if (!fromAddress || !submitChainId) {
            setFormError('Pick a source address first.');
            setFormErrorSection('from');
            return;
        }
        // The live banner above the form already states this problem; copying it
        // into formError printed the same sentence twice.
        if (validationError) return;
        // The field already shows "No action with this number"; Review only
        // reopens the Link section and puts the cursor in that field.
        if (missing1 || missing2) {
            setFormErrorSection('link');
            const fieldId = missing1 ? actionInputId1 : actionInputId2;
            setTimeout(() => document.getElementById(fieldId)?.focus(), 0);
            return;
        }
        if (previewPending) {
            setFormError('Wait for both action previews to finish loading.');
            setFormErrorSection('link');
            return;
        }
        if (!actionIndex1 || !actionIndex2) {
            setFormError('Provide both action indices before reviewing.');
            setFormErrorSection('link');
            return;
        }
        setFormError(null);
        setFormErrorSection(null);
        if (singleEncode) { openConfirmScreen(); return; }
        setStage('review');
    }

    // Sign and broadcast; only reachable from the review stage.
    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        if (!fromAddress || !submitChainId) return;
        if (!chain1Id || !chain2Id) return;
        if (validationError) return;
        if (!isWatcherMode && !hw && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && hw && hwStatus !== 'available') return;

        setStage('submitting');
        setSubmitError(null);
        try {
            const base = {
                walletId,
                chainId: submitChainId,
                from: {
                    address: fromAddress.address,
                    publicKey: fromAddress.publicKey,
                    derivationPath: fromAddress.derivationPath,
                    addressId: fromAddress.id,
                    source: fromAddress.source,
                    signerId: fromAddress.signerId,
                },
                coin1: ticker1,
                coin1ActionIndex: actionIndex1,
                coin2: ticker2,
                coin2ActionIndex: actionIndex2,
                ...(memo.trim() ? { memo: memo.trim() } : {}),
                payFeeInNativeCoin: nativeFee.flag,
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            let r;
            if (isWatcherMode) {
                r = await messaging.buildActionPsbtRequest({
                    chainId: submitChainId,
                    from: base.from,
                    actionData: { action: 'LINK', params: linkParams },
                    encoderOpts: {
                        payFeeInNativeCoin: nativeFee.flag,
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                });
            } else if (hw) {
                r = await messaging.linkActionHw({ ...base, signerId: fromAddress.signerId });
            } else {
                r = await messaging.linkAction({ ...base, password });
            }
            setResult(r);
            setStage('done');
        } catch (err) {
            const bad = err?.name === 'InvalidPasswordError';
            setSubmitError(bad ? 'Incorrect password.' : submitFailureMessage(err, {
                chainId: submitChainId,
                coinTicker: feeCoinTicker || '',
                mandatory: nativeFee.mandatory,
                fallback: err?.message || 'Sign failed.',
            }));
            setStage('review');
            if (!isWatcherMode && !hw) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        }
    }

    function handleBuildAnother() {
        setResult(null);
        setSubmitError(null);
        setStage('form');
    }

    const isReviewOrSubmitting = stage === 'review' || stage === 'submitting';
    const header = (
        <PageHeader
            onBack={onBack}
            title={isReviewOrSubmitting ? 'Review Link' : 'Link Actions'}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            <ListPage>{children}</ListPage>
        </Screen>
    );
    const wrapForm = (form) => <Screen variant={variant} header={header} restoreScroll={!isReviewOrSubmitting}>{form}</Screen>;

    if (loadError) {
        return wrap(
            <>
                <StatusMessage variant="error">{loadError}</StatusMessage>
                <div className={styles.actions}>
                </div>
            </>,
        );
    }

    if (stage === 'done') {
        const txid = result?.txid;
        if (result?.psbtHex && !txid) {
            return wrap(
                <ResultScreen
                    state="unsigned"
                    result={result}
                    onBuildAnother={handleBuildAnother}
                    onDone={onBack}
                />,
            );
        }
        // A queued result is SIGNED and not broadcast: the confirm lane
        // resolves a transient broadcast failure that way, and the copy
        // below would report a link that is not on any chain yet.
        if (result?.queued) {
            return wrap(
                <ResultScreen state="signed-not-broadcast" onDone={onBack} what="link" unsaved={result.unsaved} />,
            );
        }
        return wrap(
            <>
                <p className={styles.successTitle}>
                    {String(ticker1).toUpperCase() !== String(ticker2).toUpperCase()
                        ? 'Cross-chain link broadcast'
                        : 'Link broadcast'}
                </p>
                {result?.txid ? (
                    <>
                        <p className={styles.successLabel}>Transaction</p>
                        <code className={styles.txid}>{result.txid}</code>
                    </>
                ) : null}
                <p className={styles.hint}>
                    Once mined, History shows both actions as linked.
                </p>
                <div className={styles.actions}>
                    <Button variant="success" icon={<Icon.CheckIcon />} onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (!addressesByChain) {
        return wrap(<p className={styles.hint}>Loading wallet…</p>);
    }

    if (sourcePickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="From Address"
                walletId={walletId}
                chainId={formChainId}
                onChainChange={(value) => { setFormChainId(value); setFormError(null); }}
                onPick={(address) => {
                    setFromAddressId(address.id);
                    setSourcePickerOpen(false);
                }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    // Confirm page, rendered in place of the form; form state stays intact
    // behind it, so Reject lands back on the composer.
    if (actionConfirm.open) {
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                summary={{
                    verb: t('components.confirmSummary.verbLink'),
                    target: t('components.confirmSummary.linkTarget', {
                        coin1: linkParams.COIN1,
                        index1: linkParams.COIN1_ACTION_INDEX,
                        coin2: linkParams.COIN2,
                        index2: linkParams.COIN2_ACTION_INDEX,
                    }),
                    direction: 'none',
                    chainId: submitChainId,
                    address: fromAddress?.address,
                }}
                screenVariant={variant}
                chainLabel={null}
                feeEstimate={feeCoinTicker ? feeEstimate : null}
                feeText={feeEstimate?.coinAmount && feeCoinTicker
                    ? `Network fee: ${feeEstimate.coinAmount} ${feeCoinTicker}`
                    : undefined}
                coinTicker={feeCoinTicker || ''}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hwSource={hw ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                chainId={submitChainId}
                getSignerStatus={messaging.getSignerStatus}
                hintClassName={styles.hint}
            />
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        return (
            <ConfirmActionModal
                phase={stage === 'submitting' ? 'signing' : 'ready'}
                composed={legacyComposed}
                report={null}
                reportLoading={false}
                acknowledged={NO_ACKNOWLEDGMENTS}
                onAcknowledge={() => {}}
                canApprove={stage === 'review'}
                onApprove={() => handleSubmit({ preventDefault() {} })}
                onReject={() => { setStage('form'); setSubmitError(null); }}
                decoded={null}
                chainLabel={submitDescriptor?.displayName || submitChainId}
                screenVariant={variant}
                error={submitError}
                sourceAddress={fromAddress?.address}
                nativeTicker={feeCoinTicker || ''}
                credentials={<p className={styles.hint}>{t('common.watcherBuildsUnsigned')}</p>}
                credentialsReady
                summary={{
                    verb: t('components.confirmSummary.verbLink'),
                    target: t('components.confirmSummary.linkTarget', {
                        coin1: linkParams.COIN1,
                        index1: linkParams.COIN1_ACTION_INDEX,
                        coin2: linkParams.COIN2,
                        index2: linkParams.COIN2_ACTION_INDEX,
                    }),
                    direction: 'none',
                    chainId: submitChainId,
                    address: fromAddress?.address,
                    facts: [
                        {
                            label: 'Action 1',
                            value: `${ticker1} #${actionIndex1}: ${preview1?.action ? decodePreview(preview1.action) : 'Details unavailable'}`,
                        },
                        {
                            label: 'Action 2',
                            value: `${ticker2} #${actionIndex2}: ${preview2?.action ? decodePreview(preview2.action) : 'Details unavailable'}`,
                        },
                        ...(memo.trim() ? [{ label: 'Memo', value: memo.trim() }] : []),
                    ],
                }}
                networkFee={feeEstimate?.coinAmount && feeCoinTicker ? {
                    amount: String(feeEstimate.coinAmount), ticker: feeCoinTicker, estimate: true,
                } : null}
            />
        );
    }

    const chainIds = Object.entries(addressesByChain)
        .filter(([, addrs]) => Array.isArray(addrs) && addrs.length > 0)
        .map(([cid]) => cid);

    // The closed summaries and the reveal keys of the standard sections.
    const sectionErrorKey = (hasError) => (hasError && reviewAttempt > 0 ? reviewAttempt : 0);
    const sideSummary = (ticker, index) => [ticker, index ? `#${index}` : ''].filter(Boolean).join(' ');
    const linkSummary = [sideSummary(ticker1, actionIndex1), sideSummary(ticker2, actionIndex2)]
        .filter(Boolean).join(' to ') || null;
    const linkHasError = Boolean((validationError && !memoTooLong) || missing1 || missing2
        || (formError && formErrorSection === 'link'));

    return wrapForm(
        <FormFrame
            demoGuard={demoGuard}
            label="Link actions"
            onSubmit={handleReview}
            onChangeCapture={() => { if (formError) setFormError(null); }}
            status={[
                validationError ? (
                    <StatusMessage key="validation" variant="error">
                        {validationError}
                    </StatusMessage>
                ) : null,
                formError ? (
                    <StatusMessage key="form" variant="error">{formError}</StatusMessage>
                ) : null,
            ]}
            action={(
                <FormAction
                    icon={<Icon.LinkIcon />}
                    loading={actionConfirm.composing || previewPending}
                    disabled={actionConfirm.composing || previewPending}
                >
                    {actionConfirm.composing
                        ? 'Preparing Review…'
                        : previewPending ? 'Looking Up Actions…'
                        : 'Link Actions'}
                </FormAction>
            )}
            from={(
                <FromSection
                    {...formSections.bind('from')}
                    chainId={formChainId}
                    chainIds={chainIds}
                    chainRegistry={chainRegistry}
                    onNetworkChange={(value) => { setFormChainId(value); setFormError(null); }}
                    networkHelp="The chain the link is recorded on. Your From address and the fee are on this network."
                    address={fromAddress?.address || null}
                    addressLabel="From"
                    addressHelp="The address that signs and pays for the link. The link is recorded on the network chosen above."
                    onOpenPicker={() => setSourcePickerOpen(true)}
                    pickerLabel="Choose source address"
                    revealKey={sectionErrorKey(formError && formErrorSection === 'from')}
                />
            )}
            fee={(
                <FeeSection
                    {...formSections.bind('fee')}
                    chainId={submitChainId}
                    coinTicker={feeCoinTicker || ''}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={feeCustomEstimate}
                    revealKey={sectionErrorKey(formError && formErrorSection === 'fee')}
                />
            )}
        >
            {/* The main section holds both action cards; each card
                keeps its own Network field, since the network an action was
                recorded on is part of what is linked, not the source. */}
            <FormSection
                id="link"
                title="Link"
                icon={Icon.LinkIcon}
                {...formSections.bind('link')}
                revealKey={sectionErrorKey(linkHasError)}
                summary={linkSummary}
            >
            <div className={styles.linkActions} data-xc-preserve-nested-cards>
                <ActionCard
                    number="1"
                    inputId={actionInputId1}
                    chainIds={chainIds}
                    chainId={chain1Id}
                    onChainChange={(value) => { setChain1Id(value); setFormError(null); }}
                    actionIndex={actionIndex1}
                    onActionIndexChange={(value) => { setActionIndex1(value); setFormError(null); }}
                    onLookup={() => lookUpAction(chain1Id, actionIndex1)}
                    preview={preview1}
                />
                {/* A link-only marker sits fully in the gap. It has no arrows
                    or control behaviour, and names the pair for a screen reader. */}
                <div className={styles.linkConnector}>
                    <span
                        className={styles.linkConnectorBadge}
                        role="img"
                        aria-label="Action 1 is linked to Action 2"
                        title="Action 1 is linked to Action 2"
                    >
                        <Icon.LinkIcon />
                    </span>
                </div>
                <ActionCard
                    number="2"
                    inputId={actionInputId2}
                    chainIds={chainIds}
                    chainId={chain2Id}
                    onChainChange={(value) => { setChain2Id(value); setFormError(null); }}
                    actionIndex={actionIndex2}
                    onActionIndexChange={(value) => { setActionIndex2(value); setFormError(null); }}
                    onLookup={() => lookUpAction(chain2Id, actionIndex2)}
                    preview={preview2}
                />
            </div>
            </FormSection>

            {/* Memo is its own optional closed section holding only the memo:
                the section title names the field and carries its count. */}
            <MemoSection
                {...formSections.bind('memo')}
                revealKey={sectionErrorKey(Boolean(memoTooLong))}
                summary={trimmedMemo || 'None'}
                maxLength={MAX_MEMO_LENGTH}
                error={memoTooLong || undefined}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
            />
        </FormFrame>,
    );
}

/**
 * One referenced action: its network, its number, and what the explorer holds
 * at that number. The number field shows the standard loading spinner while
 * the read runs and the standard field error when no action has that number;
 * a found action is summarised under the fields.
 */
function ActionCard({ number, inputId, chainIds, chainId, onChainChange, actionIndex, onActionIndexChange, onLookup, preview }) {
    const loading = Boolean(preview?.loading);
    const missing = isMissingAction(preview);

    return (
        <fieldset className={styles.linkActionCard}>
            <legend className={styles.linkActionTitle}>
                <span className={styles.linkActionNumber}>{number}</span>
                Action {number}
            </legend>

            <div className={styles.linkActionFields}>
                <div className={styles.linkActionNetwork}>
                    <NetworkField
                        label="Network"
                        help={`The chain Action ${number} was recorded on. The action number is looked up on this network.`}
                        value={chainId}
                        onChange={onChainChange}
                        chainIds={chainIds}
                        chainRegistry={chainRegistry}
                        // Link data (where the action lives), not the source network.
                        notSource
                    />
                </div>

                <Input
                    id={inputId}
                    className={styles.linkActionIndex}
                    label="Action number"
                    help="The number shown next to the action on the explorer."
                    value={actionIndex}
                    onChange={(e) => onActionIndexChange(e.target.value.replace(/\D/g, ''))}
                    // Leaving the field is the user saying the number is complete.
                    onBlur={onLookup}
                    inputMode="numeric"
                    placeholder="e.g. 12345"
                    aria-busy={loading ? 'true' : undefined}
                    fieldAction={loading ? (
                        <Spinner size="sm" role="status" aria-label={`Looking up Action ${number}`} />
                    ) : null}
                    error={missing ? NO_SUCH_ACTION : undefined}
                    // Keyed to the number, so a second missing number shows the
                    // error again after typing dismissed the first.
                    errorKey={`${chainId}:${actionIndex}`}
                />
            </div>

            {preview?.action ? <ActionSummary number={number} action={preview.action} /> : null}
        </fieldset>
    );
}

/** True once a finished lookup found nothing at that number (a failed read is not "missing"). */
function isMissingAction(preview) {
    return Boolean(preview && !preview.loading && !preview.action && !preview.error);
}

// What an action is, in the words a person would use. The few that a link
// most often ties together get a fuller name than the History label; every
// other action falls back to that shared label.
const ACTION_TYPE_WORDS = /** @type {Record<string, string>} */ ({
    ISSUE: 'Token issuance',
    MINT: 'Token mint',
    SEND: 'Token send',
    DESTROY: 'Token destroy',
    DIVIDEND: 'Dividend payment',
});

/** The first non-empty value of a field, read lower-case or upper-case. */
function actionField(row, ...names) {
    for (const name of names) {
        const value = row?.[name] ?? row?.[name.toUpperCase()];
        if (value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
    return undefined;
}

function actionTypeWords(row) {
    const name = String(actionField(row, 'action') || '').toUpperCase();
    if (!name) return 'Action details unavailable';
    // A FILE's `type` is its media type, so an image says so.
    if (name === 'FILE') {
        return /^image\//i.test(String(actionField(row, 'type') || '')) ? 'Image upload' : 'File upload';
    }
    return ACTION_TYPE_WORDS[name] || actionDisplayLabel(name);
}

/**
 * The one thing the action is about: a file's name, a token (with the amount
 * for a send), a broadcast's text, or the address it went to.
 *
 * @returns {{ label: string, text?: string, address?: string } | null}
 */
function actionSubject(row) {
    const name = String(actionField(row, 'action') || '').toUpperCase();
    if (name === 'FILE') {
        const file = actionField(row, 'name', 'title');
        return file ? { label: 'File', text: String(file) } : null;
    }
    const tick = actionField(row, 'tick');
    if (tick) {
        const amount = actionField(row, 'amount');
        return { label: 'Token', text: name === 'SEND' && amount ? `${amount} ${tick}` : String(tick) };
    }
    const text = actionField(row, 'message', 'text', 'title', 'name');
    if (text && typeof text !== 'object') return { label: 'Text', text: String(text) };
    const destination = actionField(row, 'destination');
    if (typeof destination === 'string') return { label: 'To', address: destination };
    return null;
}

/**
 * The found action as read-only facts in one standard card (G121: no help
 * icons, one line per fact, a long value truncating with its full text in a
 * title), so the user can see what Action 1 and Action 2 actually are.
 */
function ActionSummary({ number, action }) {
    const row = flattenActionDetails(action);
    const type = actionTypeWords(row);
    const subject = actionSubject(row);
    const block = formatBlockIndex(actionField(row, 'block_index', 'blockIndex'));
    const seconds = Number(actionField(row, 'timestamp', 'block_time'));
    const time = !block && Number.isFinite(seconds) && seconds > 0
        ? new Date(seconds * 1000).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
        : '';
    const sender = actionField(row, 'source');

    return (
        <dl
            className={`${facts.list} ${styles.linkActionSummary}`}
            aria-label={`Action ${number} details`}
            data-link-action-summary=""
        >
            <dt className={facts.label} title="Type">Type</dt>
            <dd className={facts.value} title={type}>{type}</dd>
            {subject ? (
                <>
                    <dt className={facts.label} title={subject.label}>{subject.label}</dt>
                    <dd className={facts.value} title={subject.address || subject.text}>
                        {subject.address ? <AddressText address={subject.address} /> : subject.text}
                    </dd>
                </>
            ) : null}
            {block ? (
                <>
                    <dt className={facts.label} title="Block">Block</dt>
                    <dd className={facts.value} title={block}>{block}</dd>
                </>
            ) : time ? (
                <>
                    <dt className={facts.label} title="Time">Time</dt>
                    <dd className={facts.value} title={time}>{time}</dd>
                </>
            ) : null}
            {typeof sender === 'string' ? (
                <>
                    <dt className={facts.label} title="Sent by">Sent by</dt>
                    <dd className={facts.value} title={sender}><AddressText address={sender} /></dd>
                </>
            ) : null}
        </dl>
    );
}

function formatBlockIndex(block) {
    if (block === undefined || block === null || String(block).trim() === '') return '';
    const text = String(block).trim();
    // A block number is an identifier: shown raw, never grouped (G123).
    return text;
}

function decodePreview(action) {
    if (!action) return '(empty)';
    const a = action.action || action.ACTION;
    // Never show raw row JSON to a person; a row with no action name says so plainly.
    if (!a) return 'Action details unavailable';
    // Show the humanized action label, never the raw all-caps opcode.
    const label = actionDisplayLabel(a);
    if (a === 'ISSUE') {
        const t = action.tick || action.TICK;
        const amt = action.amount || action.AMOUNT;
        return `${label} ${t || ''}${amt ? ` (${amt})` : ''}`.trim();
    }
    if (a === 'SEND') {
        const t = action.tick || action.TICK;
        const amt = action.amount || action.AMOUNT;
        return `${label} ${amt || ''} ${t || ''}`.trim();
    }
    if (a === 'BROADCAST') {
        const txt = action.text || action.TEXT || action.message;
        return txt ? `${label} "${String(txt).slice(0, 40)}"` : label;
    }
    return label;
}
