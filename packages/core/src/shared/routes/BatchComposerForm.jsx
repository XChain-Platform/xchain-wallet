// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// BatchComposerForm (PC-36): the batch composer, the counterpart to
// ParallelComposer (which submits independent actions as separate
// transactions, sequentially). A BATCH bundles every queued sub-action into
// ONE transaction on ONE chain from ONE source address, but that is not the
// same as all-or-nothing: each sub-action still validates and lands
// INDEPENDENTLY, so a sub-action that fails partway through (for example,
// running out of value to cover its fee) fails alone while sub-actions that
// pass still land. The user queues sub-actions as (action, JSON params)
// steps; the composer pre-checks the BATCH constraints live (one top-level
// ISSUE plus any number of its child ISSUEs, any number of MINTs as long as
// each names a different token, at most one contract DEPLOY and one FILE,
// up to 250 actions total, no nested BATCH), builds the canonical COMMAND
// host-side via the SDK, previews it, and signs the BATCH through the
// generic advancedAction path (action='BATCH', params={ COMMAND }), so
// software, hardware, and watcher signers all work exactly as they do for
// any other action.
//
// FILE is excluded from the picker: a FILE sub-action needs the tx's single
// rawData payload, which the dedicated file / gated publishers own (the two
// BATCH shapes users actually need). DEPLOY IS offered here, capped at one
// per batch by the same live constraint check that caps ISSUE and FILE: a
// DEPLOY sub-action's params (contract code, gas limit, optional
// constructor arguments) are plain JSON like any other action's, with no
// binary payload the way FILE needs, so this generic composer can build
// one - just without DeployContractForm's friendlier fields. This form
// targets power users comfortable typing action params by hand.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AddressText, Button, ChainPicker, FeeSelector, FormPage, FormSection, PageHeader, Screen, Select, StatusMessage, Textarea } from '@xchain-wallet/core/ui';
// A native select cannot middle-truncate, and a full address ran under the
// chevron at phone width, so options carry the wallet's usual first6...last6 form.
import { truncateAddress } from '../../ui/AddressText.jsx';
import { registry as registryLib, flows as flowsLib, decoder as decoderLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { WatcherResultPanel } from '../components/WatcherResultPanel.jsx';
import { QueuedResultPanel } from '../components/QueuedResultPanel.jsx';
import { actionDisplayLabel } from '../utils/actionDisplayLabel.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import styles from './IssueTokenForm.module.css';
import { preferredSourceId } from '../addressSelection.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import {
    AUTHORABLE_ACTIONS, isActionDataOfferedInBuild, isActionOfferedInBuild, isActionOfferedOnChain,
} from '../../registry/actions.js';
import { compareDecimalStrings, sumDecimalStrings } from '../utils/amountFormat.js';

const chainRegistry = registryLib.defaultRegistry();

// Actions this generic composer cannot queue: nested BATCH (the protocol
// forbids it outright) and FILE (needs the tx's one rawData payload; the
// file/gated publishers own that shape). DEPLOY is NOT excluded: the chain
// allows one per batch, its params are plain JSON, and the live constraint
// check below (validateBatchConstraints) already surfaces the one-per-batch
// cap the same way it surfaces ISSUE's and FILE's.
const EXCLUDED_ACTIONS = new Set(['BATCH', 'FILE']);

// Fall back to the registry's authorable set when SDK introspection fails,
// so the picker never drifts behind it; EXCLUDED_ACTIONS still applies.
const FALLBACK_ACTIONS = AUTHORABLE_ACTIONS;

let nextRowId = 0;
const newRowId = () => `brow-${++nextRowId}`;

// Default from-address for a chain: the same resolution Send uses (active
// address, else newest HD external), never a dispenser-delegated address,
// and the first remaining record when the chain holds no HD address at all
// (a hardware-only wallet).
function pickDefaultAddressId(addrs, activeEntry) {
    if (!Array.isArray(addrs) || addrs.length === 0) return null;
    const funding = addrs.filter((a) => a.role !== 'dispenser');
    return preferredSourceId(funding, activeEntry) || funding[0]?.id || addrs[0].id;
}

function blankRow() {
    return { id: newRowId(), action: '', paramsJson: '{\n  "VERSION": "0"\n}' };
}

/**
 * The raw error text for the collapsed details disclosure, or '' when the
 * shown sentence already carries it. The raw text never reaches the shown copy.
 */
function technicalDetails(err, shown) {
    const raw = String(err?.message || '').trim();
    return raw && !String(shown || '').includes(raw) ? raw : '';
}

/** Parse one row's params; returns { params } or { error }. */
function parseRowParams(json) {
    if (typeof json !== 'string' || json.trim().length === 0) {
        return { error: 'params JSON cannot be empty' };
    }
    try {
        const parsed = JSON.parse(json);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { error: 'params must be a JSON object' };
        }
        return { params: parsed };
    } catch (err) {
        return {
            error: userFacingMessage(
                err,
                'Params JSON is not valid. Check the syntax and try again.',
            ),
        };
    }
}

function oneValidationErrorMessage(error) {
    if (typeof error === 'string' && error.trim()) {
        return userFacingMessage(new Error(error), 'Check this action\'s fields and try again.');
    }
    if (error && typeof error === 'object') {
        if (typeof error.message === 'string' && error.message.trim()) {
            return userFacingMessage(error, 'Check this action\'s fields and try again.');
        }
        if (typeof error.field === 'string' && error.field.trim()) {
            return `${error.field}: enter a valid value.`;
        }
    }
    return null;
}

function validationErrorMessage(result) {
    if (result?.valid) return null;
    const messages = (Array.isArray(result?.errors) ? result.errors : [])
        .map(oneValidationErrorMessage)
        .filter(Boolean);
    return messages.length > 0
        ? [...new Set(messages)].join(' ')
        : 'Check this action\'s fields and try again.';
}

function sendTotalsFor(parsedRows) {
    const amounts = new Map();
    for (const { row, params } of parsedRows) {
        if (String(row.action).toUpperCase() !== 'SEND' || !params) continue;
        const tick = String(params.TICK ?? '').trim().toUpperCase();
        const amount = String(params.AMOUNT ?? '').trim();
        if (!tick || !amount) continue;
        const values = amounts.get(tick) || [];
        values.push(amount);
        amounts.set(tick, values);
    }
    return [...amounts].map(([tick, values]) => ({ tick, amount: sumDecimalStrings(values) }));
}

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 * @param {boolean} [props.hasDexSurface] false only in a build that compiled the DEX surface out; ORDER and SWAP are then absent from the picker
 */
export function BatchComposerForm({ walletId, onBack, hasDexSurface = true }) {
    const { messaging, shell } = useMessaging();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const signerReady = useSignerReady(walletId);
    const { isWatcherMode } = useWalletMode();
    const variant = screenVariantFor(shell);

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    // getActiveAddresses()[chainId]; `{}` when the host has none.
    const [activeByChain, setActiveByChain] = useState(
        /** @type {Record<string, any>} */ ({}),
    );
    const [actionsList, setActionsList] = useState(/** @type {string[]} */ ([]));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [chainId, setChainId] = useState(/** @type {string | null} */ (null));
    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));
    const [rows, setRows] = useState(/** @type {Array<{id:string,action:string,paramsJson:string}>} */ ([blankRow()]));

    const [stage, setStage] = useState(/** @type {'compose'|'review'|'submitting'|'done'} */ ('compose'));
    const [composed, setComposed] = useState(/** @type {{command:string,subStrings:string[]}|null} */ (null));
    const [buildError, setBuildError] = useState(/** @type {string | null} */ (null));
    const [buildErrorDetails, setBuildErrorDetails] = useState('');
    const [rowValidationErrors, setRowValidationErrors] = useState(/** @type {Record<string, string>} */ ({}));
    // Rows the user has edited, or every row once Review was pressed. A row
    // with no action picked yet only says so after one of those.
    const [touchedRows, setTouchedRows] = useState(/** @type {Record<string, boolean>} */ ({}));
    const [preReviewError, setPreReviewError] = useState(/** @type {string | null} */ (null));
    const [validatingRows, setValidatingRows] = useState(false);
    const [password, setPassword] = useState('');
    const [hwStatus, setHwStatus] = useState('idle');
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [submitErrorDetails, setSubmitErrorDetails] = useState('');
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    // HwSignBlock reports `{ status, detail, refresh }`, so the raw setter
    // stored the object and every `hwStatus === 'available'` gate stayed
    // false. Unwrap it, the way every other signing form does.
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            messaging.getAddressesByChain(walletId),
            messaging.listActions
                ? messaging.listActions({ chainId: chainRegistry.supportedChains()[0]?.id }).catch(() => null)
                : Promise.resolve(null),
            // Best-effort: a host without the call still yields a usable form.
            typeof messaging.getActiveAddresses === 'function'
                ? Promise.resolve(messaging.getActiveAddresses(walletId)).catch(() => ({}))
                : Promise.resolve({}),
        ]).then(([byChain, actions, active]) => {
            if (cancelled) return;
            setAddressesByChain(byChain || {});
            setActiveByChain(active || {});
            const raw = (Array.isArray(actions) && actions.length > 0) ? actions : FALLBACK_ACTIONS;
            setActionsList(raw.filter((a) => !EXCLUDED_ACTIONS.has(String(a).toUpperCase())
                && isActionOfferedInBuild(a, { hasDexSurface })));
            const chains = Object.entries(byChain || {})
                .filter(([, addrs]) => Array.isArray(addrs) && addrs.length > 0)
                .map(([cid]) => cid);
            if (chains.length === 0) {
                setLoadError('No addresses on any chain yet. Use Receive to generate one before composing a batch.');
                return;
            }
            setChainId(chains[0]);
            setFromAddressId(pickDefaultAddressId(byChain[chains[0]] || [], active?.[chains[0]]));
        }).catch((err) => {
            if (!cancelled) setLoadError(userFacingMessage(err, 'Failed to load wallet.'));
        });
        return () => { cancelled = true; };
    }, [walletId, messaging, hasDexSurface]);

    useEffect(() => {
        if (stage === 'review') setTimeout(() => passwordRef.current?.focus(), 0);
    }, [stage]);

    const chainsWithAddresses = useMemo(() => (
        addressesByChain
            ? Object.entries(addressesByChain).filter(([, a]) => Array.isArray(a) && a.length > 0).map(([cid]) => cid)
            : []
    ), [addressesByChain]);

    const fromAddress = useMemo(() => {
        if (!chainId || !fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const coinTicker = descriptor
        ? ({ bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' }[descriptor.coin] || '')
        : '';
    const hwSource = isHwSource(fromAddress);

    // Network fee: Low / Normal / Fast / Custom (mirrors BroadcastForm).
    const [feePick, setFeePick] = useState(
        /** @type {{ mode: 'low'|'normal'|'fast'|'custom', customRate?: number }} */ ({ mode: 'normal' }),
    );
    const feeTiers = useMemo(() => estimateNativeSendFeeTiers({ chainId, chainRegistry }), [chainId]);
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

    // Resolve each row's params; the first parse error blocks compose.
    const parsedRows = useMemo(() => rows.map((r) => ({ row: r, ...parseRowParams(r.paramsJson) })), [rows]);

    const rowErrors = useMemo(() => parsedRows.map((pr, i) => {
        if (!pr.row.action) return `Step ${i + 1}: pick an action.`;
        if (pr.error) return `Step ${i + 1}: ${pr.error}`;
        // A chain switch keeps queued rows, so every row is checked against
        // the chain that will receive the batch.
        if (!isActionOfferedOnChain(chainRegistry, chainId, pr.row.action)) {
            return `Step ${i + 1}: ${actionDisplayLabel(pr.row.action)} is not available on the selected chain.`;
        }
        if (!isActionDataOfferedInBuild({ action: pr.row.action, params: pr.params }, { hasDexSurface })) {
            return `Step ${i + 1}: ${actionDisplayLabel(pr.row.action)} is not available in this build.`;
        }
        if (rowValidationErrors[pr.row.id]) return `Step ${i + 1}: ${rowValidationErrors[pr.row.id]}`;
        return null;
    }), [parsedRows, hasDexSurface, chainId, rowValidationErrors]);

    const constraintError = useMemo(() => {
        if (rowErrors.some(Boolean)) return null;
        // Params stay attached because ISSUE constraints distinguish a parent
        // ticker from its child tickers.
        const subActions = parsedRows.map((pr) => ({ action: pr.row.action, params: pr.params }));
        const constraintErrors = flowsLib.validateBatchConstraints(subActions);
        return constraintErrors.length > 0 ? constraintErrors[0] : null;
    }, [parsedRows, rowErrors]);

    const composeError = useMemo(() => {
        for (let i = 0; i < parsedRows.length; i += 1) {
            if (rowErrors[i]) return rowErrors[i];
        }
        return constraintError;
    }, [parsedRows, rowErrors, constraintError]);

    // The error shown beside each row: an unpicked action waits until the row
    // is touched or Review is pressed; every other row error shows at once.
    const shownRowErrors = rows.map((row, i) => (
        rowErrors[i] && (row.action || touchedRows[row.id]) ? rowErrors[i] : null
    ));

    const draftKey = JSON.stringify({ chainId, fromAddressId, rows });
    const draftKeyRef = useRef(draftKey);
    draftKeyRef.current = draftKey;

    const clearPreReviewErrors = (rowId = null) => {
        setPreReviewError(null);
        if (rowId) {
            setRowValidationErrors((errors) => {
                if (!errors[rowId]) return errors;
                const next = { ...errors };
                delete next[rowId];
                return next;
            });
        }
    };
    const updateRow = (i, patch) => {
        clearPreReviewErrors(rows[i]?.id);
        const id = rows[i]?.id;
        if (id) setTouchedRows((t) => (t[id] ? t : { ...t, [id]: true }));
        setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    };
    const addRow = () => {
        clearPreReviewErrors();
        setRows((rs) => (rs.length >= flowsLib.BATCH_MAX_COMMANDS ? rs : [...rs, blankRow()]));
    };
    const removeRow = (i) => {
        clearPreReviewErrors(rows[i]?.id);
        setRows((rs) => rs.filter((_, idx) => idx !== i));
    };

    const sendTotals = useMemo(() => sendTotalsFor(parsedRows), [parsedRows]);

    async function goReview() {
        setTouchedRows(Object.fromEntries(rows.map((row) => [row.id, true])));
        if (composeError) return;
        const validatedDraftKey = draftKey;
        setValidatingRows(true);
        setPreReviewError(null);
        const validations = await Promise.all(parsedRows.map(async (pr) => {
            try {
                const result = await messaging.validateAction({
                    chainId,
                    action: pr.row.action,
                    params: pr.params,
                });
                return [pr.row.id, validationErrorMessage(result), false];
            } catch {
                return [pr.row.id, null, true];
            }
        }));
        if (draftKeyRef.current !== validatedDraftKey) {
            setValidatingRows(false);
            return;
        }
        const validationErrors = Object.fromEntries(validations.filter(([, error]) => error));
        setRowValidationErrors(validationErrors);
        if (validations.some(([, , unavailable]) => unavailable)) {
            setPreReviewError('Couldn\'t validate every action. Check your connection and try again.');
            setValidatingRows(false);
            return;
        }
        if (Object.keys(validationErrors).length > 0) {
            setValidatingRows(false);
            return;
        }

        if (sendTotals.length > 0) {
            try {
                const fresh = await messaging.getAddressBalances(chainId, fromAddress.address);
                if (draftKeyRef.current !== validatedDraftKey) {
                    setValidatingRows(false);
                    return;
                }
                if (!fresh || typeof fresh !== 'object'
                    || (!fresh.native && !Array.isArray(fresh.tokens))) {
                    throw new Error('balances unavailable');
                }
                const balances = decoderLib.balancesFromSdk(fresh) || [];
                for (const total of sendTotals) {
                    const balance = balances.find(
                        (entry) => String(entry.tick || '').trim().toUpperCase() === total.tick,
                    );
                    if (compareDecimalStrings(total.amount, String(balance?.amount ?? '0')) === 1) {
                        setPreReviewError(
                            `These steps send ${total.amount} ${total.tick} in total, more than the ${balance?.amount ?? '0'} ${total.tick} this address holds.`,
                        );
                        setValidatingRows(false);
                        return;
                    }
                }
            } catch {
                setPreReviewError('Couldn\'t refresh this address\'s balances. Check your connection and try again.');
                setValidatingRows(false);
                return;
            }
        }

        setBuildError(null);
        setBuildErrorDetails('');
        setStage('review');
        setComposed(null);
        try {
            const subActions = parsedRows.map((pr) => ({ action: pr.row.action, params: pr.params }));
            const res = await messaging.buildBatchCommand({ chainId, subActions });
            if (typeof res?.command !== 'string' || !res.command) throw new Error('batch.buildCommand: empty command');
            setComposed({ command: res.command, subStrings: res.command.split(';') });
        } catch (err) {
            // Show a sentence, never the composer's own error text; that text moves to the collapsed details.
            const shown = submitFailureMessage(err, {
                chainId, coinTicker, verb: 'build this batch',
                fallback: 'Couldn\'t build this batch. Check each step\'s action and parameters, then try again.',
            });
            setBuildError(shown);
            setBuildErrorDetails(technicalDetails(err, shown));
        } finally {
            setValidatingRows(false);
        }
    }

    // §5.6: a BATCH is the highest-leverage payload the wallet signs, N
    // sub-actions under one signature, and the review list is a decode of
    // what the host SAID it built. The confirm lane composes the one PSBT
    // host-side and Approve signs those exact bytes. AdvancedActionsForm,
    // the other caller of this same host method, is already on it.
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const singleEncode = !isWatcherMode;
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    const submitConfirmed = useConfirmSubmit({
        messaging,
        isHw: hwSource,
        signerId: fromAddress?.signerId,
        passwordRef: passwordValueRef,
        software: 'advancedAction',
        hardware: 'advancedActionHw',
    });

    async function openConfirmScreen(from, params) {
        setSubmitError(null);
        setSubmitErrorDetails('');
        try {
            const res = await actionConfirm.run({
                chainId,
                from,
                actionData: { action: 'BATCH', params },
                ...(feePerKb != null ? { encoderOpts: { feePerKb } } : {}),
                onApprove: (prebuiltPsbt) => submitConfirmed({
                    walletId, chainId, from, action: 'BATCH', params,
                    ...(feePerKb != null ? { feePerKb } : {}),
                    prebuiltPsbt,
                }),
            });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            if (isUserRejection(err)) return;
            // Keep the generic fallback independent of caught provider text so
            // the shared message filters remain the only display boundary.
            setSubmitError(submitFailureMessage(err, {
                chainId, coinTicker, fallback: 'Batch failed.',
            }));
            setStage('review');
        }
    }

    async function handleSign(event) {
        event.preventDefault();
        if (stage === 'submitting' || !composed) return;
        const hw = hwSource;
        if (!isWatcherMode && !hw && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && hw && hwStatus !== 'available') return;
        setStage('submitting');
        setSubmitError(null);
        setSubmitErrorDetails('');
        const from = {
            address: fromAddress.address,
            publicKey: fromAddress.publicKey,
            derivationPath: fromAddress.derivationPath,
            addressId: fromAddress.id,
            source: fromAddress.source,
            signerId: fromAddress.signerId,
        };
        const params = { VERSION: '0', COMMAND: composed.command };
        if (singleEncode) { setStage('review'); openConfirmScreen(from, params); return; }
        try {
            let res;
            if (isWatcherMode) {
                res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from,
                    actionData: { action: 'BATCH', params },
                    ...(feePerKb != null ? { encoderOpts: { feePerKb } } : {}),
                });
            } else if (hw) {
                res = await messaging.advancedActionHw({
                    walletId, chainId, from, action: 'BATCH', params,
                    signerId: fromAddress.signerId,
                    ...(feePerKb != null ? { feePerKb } : {}),
                });
            } else {
                res = await messaging.advancedAction({
                    walletId, chainId, from, action: 'BATCH', params, password,
                    ...(feePerKb != null ? { feePerKb } : {}),
                });
            }
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            const bad = err?.name === 'InvalidPasswordError';
            const shown = bad ? 'Incorrect password.' : submitFailureMessage(err, {
                chainId, coinTicker, fallback: 'Batch failed.',
            });
            setSubmitError(shown);
            setSubmitErrorDetails(bad ? '' : technicalDetails(err, shown));
            setStage('review');
            if (!isWatcherMode && !isHwSource(fromAddress)) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        }
    }

    const returnToCompose = () => {
        setBuildError(null);
        setBuildErrorDetails('');
        setSubmitError(null);
        setStage('compose');
    };
    const header = (
        <PageHeader
            onBack={stage === 'review' || stage === 'submitting' ? returnToCompose : onBack}
            backDisabled={stage === 'submitting'}
            title={stage === 'compose' ? 'Batch' : 'Review batch'}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header} restoreScroll={!(stage === 'review' || stage === 'submitting')}>{children}</Screen>
    );

    if (loadError) return wrap(<StatusMessage variant="error" className={styles.error}>{loadError}</StatusMessage>);
    if (!addressesByChain || !chainId) return wrap(<p className={styles.hint}>Loading wallet…</p>);

    // Confirm page, rendered in place of the review stage; the queued rows
    // stay intact behind it, so Reject lands back on the step list.
    if (actionConfirm.open) {
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                screenVariant={variant}
                feeText={feeEstimate?.coinAmount
                    ? `Network fee: ${feeEstimate.coinAmount} ${coinTicker}`.trim()
                    : undefined}
                coinTicker={coinTicker}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hwSource={hwSource ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                chainId={chainId}
                getSignerStatus={messaging.getSignerStatus}
                hintClassName={styles.hint}
            />
        );
    }

    if (stage === 'done') {
        const txid = result?.txid || result?.broadcast?.txid;
        if (result?.psbtHex && !txid) {
            return wrap(
                <WatcherResultPanel
                    result={result}
                    onBuildAnother={() => { setResult(null); setComposed(null); setStage('compose'); }}
                    onDone={onBack}
                />,
            );
        }
        // A queued result is SIGNED and not broadcast: the confirm lane
        // resolves a transient broadcast failure that way, and "Batch
        // broadcast" would report N sub-actions as sent when none are.
        if (result?.queued) {
            return wrap(
                <QueuedResultPanel onDone={onBack} what="batch" unsaved={result?.unsaved} />,
            );
        }
        return wrap(
            <>
                <h2 className={styles.successTitle}>Batch broadcast</h2>
                <p className={styles.hint}>All {rows.length} action{rows.length === 1 ? '' : 's'} were sent in one transaction. Each one confirms or fails on its own.</p>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>Transaction ID</p>
                        <code className={styles.txid}>{txid}</code>
                    </>
                ) : null}
                <div className={styles.actions}><Button variant="primary" onClick={onBack}>Done</Button></div>
            </>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        const hw = isHwSource(fromAddress);
        return wrap(
            <FormPage
                demoGuard={demoGuard}
                label="Review batch"
                onSubmit={handleSign}
                status={buildError || (submitError && (hw || isWatcherMode)) ? (
                    <>
                        {buildError ? (
                            <StatusMessage variant="error" className={styles.error} details={buildErrorDetails || undefined}>
                                {buildError}
                            </StatusMessage>
                        ) : null}
                        {submitError && (hw || isWatcherMode) ? (
                            <StatusMessage variant="error" className={styles.error} details={submitErrorDetails || undefined}>
                                {submitError}
                            </StatusMessage>
                        ) : null}
                    </>
                ) : null}
                actions={(
                    <>
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={(event) => {
                                event.preventDefault();
                                returnToCompose();
                            }}
                            disabled={stage === 'submitting'}
                        >
                            Back
                        </Button>
                        <Button
                            type="submit"
                            variant="primary"
                            loading={stage === 'submitting'}
                            disabled={!composed || (!isWatcherMode && (hw ? hwStatus !== 'available' : (!signerReady && password.length === 0)))}
                        >
                            {isWatcherMode ? 'Create unsigned transaction' : hw ? `Sign on ${fromAddress?.source === 'trezor' ? 'Trezor' : 'Ledger'}` : 'Sign batch'}
                        </Button>
                    </>
                )}
            >
                <p className={styles.summary} style={{ textAlign: 'left' }}>
                    All {rows.length} action{rows.length === 1 ? '' : 's'} are bundled into one transaction and sent
                    together, but each still confirms on its own: if one runs out of what it needs (for example fee
                    coverage), it fails alone and the others still land. This is different from the parallel
                    composer, where each action is its own transaction from the start.
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}><AddressText address={fromAddress?.address} /></dd>
                </dl>

                {!composed && !buildError ? <p className={styles.hint}>Composing…</p> : null}
                {composed ? (
                    <>
                        <p className={styles.successLabel}>Batch steps ({composed.subStrings.length})</p>
                        <ol style={{ paddingLeft: '1rem', margin: 'var(--xc-space-2) 0' }}>
                            {composed.subStrings.map((s, i) => (
                                <li key={i} style={{ margin: 'var(--xc-space-1) 0' }}>
                                    <code style={{ fontSize: 'var(--xc-text-xs)', wordBreak: 'break-all' }}>{s}</code>
                                </li>
                            ))}
                        </ol>
                    </>
                ) : null}

                {sendTotals.length > 0 ? (
                    <>
                        <p className={styles.successLabel}>Send totals</p>
                        <ul>
                            {sendTotals.map((total) => (
                                <li key={total.tick}>{total.amount} {total.tick}</li>
                            ))}
                        </ul>
                    </>
                ) : null}

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

                {!isWatcherMode ? (
                    <SignCredentials
                        unlocked={signerReady}
                        fromAddress={fromAddress}
                        chainId={chainId}
                        password={password}
                        onPasswordChange={(v) => { setPassword(v); if (submitError) setSubmitError(null); }}
                        onStatusChange={onHwStatusChange}
                        passwordRef={passwordRef}
                        submitError={submitError}
                        disabled={stage === 'submitting'}
                        getSignerStatus={messaging.getSignerStatus}
                    />
                ) : null}
            </FormPage>,
        );
    }

    // stage === 'compose'
    return wrap(
        <FormPage
            demoGuard={demoGuard}
            label="Batch composer"
            sectioned
            status={preReviewError || constraintError ? (
                <StatusMessage variant="error" className={styles.error}>{preReviewError || constraintError}</StatusMessage>
            ) : null}
            actions={(
                <Button type="button" variant="primary" onClick={goReview} loading={validatingRows} disabled={validatingRows}>
                    Review
                </Button>
            )}
        >
            <details>
                <summary>Batch limits</summary>
                <p className={styles.hint}>
                    Queue up to 250 actions from one address. A batch can issue one new token plus its sub-tokens,
                    mint different tokens once each, and deploy one contract. It cannot contain another batch.
                    Use the dedicated publisher for FILE-gated content.
                </p>
            </details>
            <FormSection title="Batch settings">
                <ChainPicker
                    label="Chain"
                    value={chainId || ''}
                    onChange={(cid) => {
                        clearPreReviewErrors();
                        setRowValidationErrors({});
                        setChainId(cid);
                        setFromAddressId(pickDefaultAddressId(addressesByChain[cid] || [], activeByChain[cid]));
                    }}
                    chainIds={chainsWithAddresses}
                    chainRegistry={chainRegistry}
                    hideNetworkKind
                />
                <Select
                    label="From address"
                    value={fromAddressId || ''}
                    onChange={(e) => { clearPreReviewErrors(); setFromAddressId(e.target.value); }}
                >
                    {(addressesByChain[chainId] || []).map((a) => (
                        <option key={a.id} value={a.id}>{truncateAddress(a.address)}</option>
                    ))}
                </Select>
            </FormSection>

            {rows.map((row, i) => (
                <FormSection key={row.id} title={`Step ${i + 1}`} headingLevel="h3">
                    <Select
                        label="Action"
                        value={row.action || ''}
                        onChange={(e) => updateRow(i, { action: e.target.value })}
                    >
                        <option value="">Select action</option>
                        {/* One SDK list serves every chain; drop what the picked chain refuses at every version. */}
                        {actionsList.filter((a) => isActionOfferedOnChain(chainRegistry, chainId, a)).map((a) => (
                            <option key={a} value={a}>{actionDisplayLabel(a)} ({a})</option>
                        ))}
                    </Select>
                    <Textarea
                        label="Params (JSON object)"
                        rows={4}
                        value={row.paramsJson}
                        onChange={(e) => updateRow(i, { paramsJson: e.target.value })}
                        placeholder='{"VERSION":"0", ...}'
                        spellCheck={false}
                    />
                    {shownRowErrors[i] ? (
                        <StatusMessage variant="error" className={styles.error}>
                            {shownRowErrors[i]}
                        </StatusMessage>
                    ) : null}
                    <div className={styles.actions} style={{ justifyContent: 'flex-end' }}>
                        <Button type="button" variant="ghost" onClick={() => removeRow(i)} disabled={rows.length <= 1}>
                            Remove
                        </Button>
                    </div>
                </FormSection>
            ))}
            <div className={styles.actions} style={{ justifyContent: 'flex-start' }}>
                <Button
                    type="button"
                    variant="secondary"
                    onClick={addRow}
                    disabled={rows.length >= flowsLib.BATCH_MAX_COMMANDS}
                >
                    + Add action
                </Button>
            </div>
            {rows.length >= flowsLib.BATCH_MAX_COMMANDS ? (
                <p className={styles.hint}>
                    {flowsLib.BATCH_MAX_COMMANDS} actions is the most one batch carries.
                </p>
            ) : null}
        </FormPage>,
    );
}
