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
// any other action. The page groups actions by transaction: each card is
// one BATCH on its own network from its own From address, and several cards
// are signed one after another as separate transactions.
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
// Network and From come from the standard FromSection.
import { AddressText, Button, ChainBadge, FeeSelector, FieldNote, FormPage, Icon, ListPage, ListRow, PageHeader, Screen, Select, StatusMessage, Textarea } from '@xchain-wallet/core/ui';
import { FeesCard } from '../components/FeesCard.jsx';
import { registry as registryLib, flows as flowsLib, decoder as decoderLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { actionDisplayLabel } from '../utils/actionDisplayLabel.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { customFeeReviewStop } from '../../flows/feeEstimate.js';
import styles from './IssueTokenForm.module.css';
import { preferredSourceId } from '../addressSelection.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import {
    AUTHORABLE_ACTIONS, isActionDataOfferedInBuild, isActionOfferedInBuild, isActionOfferedOnChain,
} from '../../registry/actions.js';
import { compareDecimalStrings, sumDecimalStrings } from '../utils/amountFormat.js';
import { useProtocolFeeQuote } from '../hooks/useProtocolFeeQuote.js';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { TokenListIcon } from '../../ui/icons/index.jsx';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/batch.js';
import '../../i18n/locales/en/components.js';
// The compose stage sits on the Wallet Form Standard frame.
import {
    FeeSection,
    FormAction,
    FormFrame,
    FormSection as StandardSection,
    FromSection,
    joinSummary,
    summaryAddress,
    useFormSections,
} from '../components/formStandard/index.js';
import batchStyles from './BatchComposerForm.module.css';
import { normalizeProtocolFee } from '../../flows/protocolFeeRow.js';

const chainRegistry = registryLib.defaultRegistry();

// The protocol fee joins the Network fee row's summary, as the
// standard asks of forms with a protocol fee. Nothing while it is unknown.
// BATCH never pays it in the native coin (no pay-in-native switch).
function protocolFeeSummary(quote, pending) {
    if (pending) return undefined;
    const fee = normalizeProtocolFee(quote);
    if (!fee.known || fee.free) return undefined;
    return fee.amount ? `${fee.amount} XCHAIN protocol fee` : undefined;
}

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

// The page holds one card per transaction. The first card always signs on
// the page's Network and From (the defaults); every later card carries its
// own network and From address, picked when it is added.
let nextTxId = 0;
const newTxId = () => `btx-${++nextTxId}`;

function blankTx(extra = {}) {
    return { id: newTxId(), chainId: null, fromAddressId: null, rows: [blankRow()], ...extra };
}

/**
 * One queued action as a sentence: "Send 250 MYGAME" over "to bc1q...9cb2".
 * @param {{action: string}} row
 * @param {Record<string, unknown> | undefined} params
 */
function rowSentence(row, params) {
    if (!row.action) return { title: t('batch.chooseAction'), subtitle: '' };
    const p = params || {};
    const amount = p.AMOUNT ?? p.QUANTITY;
    const title = [actionDisplayLabel(row.action), amount, p.TICK]
        .filter((part) => part !== undefined && part !== null && String(part).trim() !== '')
        .map(String)
        .join(' ');
    const destination = p.DESTINATION ?? p.ADDRESS;
    const subtitle = typeof destination === 'string' && destination.trim()
        ? t('batch.rowTo', { address: summaryAddress(destination.trim()) })
        : (p.SUPPLY !== undefined && p.SUPPLY !== null && String(p.SUPPLY).trim()
            ? t('batch.rowSupply', { supply: String(p.SUPPLY) })
            : '');
    return { title, subtitle };
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
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    // One entry per transaction card; the first one's network and From are
    // the page's own (chainId / fromAddressId above).
    const [txs, setTxs] = useState(() => [blankTx()]);
    // The own-address picker for a later card ({ txId }) or for the card
    // "Add another network" is about to create ({ txId: null }), with the
    // network the picker currently shows.
    const [cardPicker, setCardPicker] = useState(/** @type {{ txId: string | null, chainId: string | null } | null} */ (null));
    // The picker's network as of the latest switch: a pick can follow a
    // network switch in the same event, before the state update lands.
    const cardPickerChainRef = useRef(/** @type {string | null} */ (null));
    // Rows whose editor the user folded back into its sentence.
    const [closedRows, setClosedRows] = useState(/** @type {Record<string, boolean>} */ ({}));
    // Which transaction the confirm page is signing, and the per-transaction
    // results once signing ends.
    const [signingIndex, setSigningIndex] = useState(0);
    const signingRef = useRef(false);
    // The standard sections' open state, held above the early returns so it
    // survives the From picker and the review stage. Each Create Batch attempt
    // bumps the counter so a section holding an error reopens.
    const formSections = useFormSections({ from: false, actions: true, fee: false });
    const [reviewAttempt, setReviewAttempt] = useState(0);

    const [stage, setStage] = useState(/** @type {'compose'|'review'|'submitting'|'done'} */ ('compose'));
    // One composed BATCH per transaction card, in card order.
    const [composed, setComposed] = useState(/** @type {Array<{txId:string,chainId:string,from:any,command:string,subStrings:string[],sendTotals:any[]}>|null} */ (null));
    const [draftCommand, setDraftCommand] = useState(/** @type {{key:string,command:string}|null} */ (null));
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
    const [results, setResults] = useState(/** @type {any[]} */ ([]));
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
                setLoadError('No addresses on any network yet. Use Receive to generate one before composing a batch.');
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

    // Each card with its resolved network, From record and parsed rows. The
    // first card signs on the page's Network and From.
    const txList = useMemo(() => txs.map((tx, i) => {
        const txChainId = i === 0 ? chainId : tx.chainId;
        const txFromId = i === 0 ? fromAddressId : tx.fromAddressId;
        const from = txChainId && txFromId && addressesByChain
            ? (addressesByChain[txChainId] || []).find((a) => a.id === txFromId) || null
            : null;
        return {
            ...tx,
            chainId: txChainId,
            fromAddressId: txFromId,
            from,
            parsed: tx.rows.map((r) => ({ row: r, ...parseRowParams(r.paramsJson) })),
        };
    }), [txs, chainId, fromAddressId, addressesByChain]);
    const multiTx = txList.length > 1;
    const allRows = useMemo(() => txList.flatMap((tx) => tx.rows), [txList]);

    // Every row's error, keyed by row id. Steps are numbered inside their card.
    const rowErrors = useMemo(() => {
        const out = {};
        for (const tx of txList) {
            tx.parsed.forEach((pr, i) => {
                let error = null;
                if (!pr.row.action) error = `Step ${i + 1}: pick an action.`;
                else if (pr.error) error = `Step ${i + 1}: ${pr.error}`;
                // A chain switch keeps queued rows, so every row is checked
                // against the chain its own transaction goes to.
                else if (!isActionOfferedOnChain(chainRegistry, tx.chainId, pr.row.action)) {
                    error = `Step ${i + 1}: ${actionDisplayLabel(pr.row.action)} is not available on the selected network.`;
                } else if (!isActionDataOfferedInBuild({ action: pr.row.action, params: pr.params }, { hasDexSurface })) {
                    error = `Step ${i + 1}: ${actionDisplayLabel(pr.row.action)} is not available in this build.`;
                } else if (rowValidationErrors[pr.row.id]) {
                    error = `Step ${i + 1}: ${rowValidationErrors[pr.row.id]}`;
                }
                out[pr.row.id] = error;
            });
        }
        return out;
    }, [txList, hasDexSurface, rowValidationErrors]);

    // With several cards, a page-level message names its transaction.
    const inTx = (index, message) => (multiTx && message ? `${t('batch.transactionNumber', { number: index + 1 })}: ${message}` : message);

    const constraintError = useMemo(() => {
        if (Object.values(rowErrors).some(Boolean)) return null;
        for (let i = 0; i < txList.length; i += 1) {
            // Params stay attached because ISSUE constraints distinguish a
            // parent ticker from its child tickers.
            const subActions = txList[i].parsed.map((pr) => ({ action: pr.row.action, params: pr.params }));
            const constraintErrors = flowsLib.validateBatchConstraints(subActions);
            if (constraintErrors.length > 0) return inTx(i, constraintErrors[0]);
        }
        // Two cards on one network and From would be one transaction.
        const seen = new Map();
        for (let i = 0; i < txList.length; i += 1) {
            if (!txList[i].from) return t('batch.pickFrom', { number: i + 1 });
            const key = `${txList[i].chainId}|${txList[i].fromAddressId}`;
            if (seen.has(key)) return t('batch.duplicate', { number: i + 1, first: seen.get(key) + 1 });
            seen.set(key, i);
        }
        return null;
    }, [txList, rowErrors, multiTx]);

    const composeError = useMemo(() => {
        for (let i = 0; i < txList.length; i += 1) {
            for (const pr of txList[i].parsed) {
                if (rowErrors[pr.row.id]) return inTx(i, rowErrors[pr.row.id]);
            }
        }
        return constraintError;
    }, [txList, rowErrors, constraintError, multiTx]);

    // The error shown beside each row: an unpicked action waits until the row
    // is touched or Review is pressed; every other row error shows at once.
    const shownRowError = (row) => (
        rowErrors[row.id] && (row.action || touchedRows[row.id]) ? rowErrors[row.id] : null
    );
    const anyShownRowError = allRows.some((row) => Boolean(shownRowError(row)));

    const draftKey = JSON.stringify({ chainId, fromAddressId, txs });
    const draftKeyRef = useRef(draftKey);
    draftKeyRef.current = draftKey;

    // BATCH quotes need the canonical COMMAND. Build the first card's from
    // every locally valid draft so the compose-stage Fees card follows it.
    const firstTx = txList[0];
    useEffect(() => {
        let cancelled = false;
        let timer = null;
        setDraftCommand(null);
        if (stage !== 'compose' || composeError || !chainId || !fromAddress?.address) {
            return () => { cancelled = true; };
        }
        const subActions = firstTx.parsed.map((pr) => ({ action: pr.row.action, params: pr.params }));
        timer = setTimeout(() => {
            Promise.resolve(messaging.buildBatchCommand({ chainId, subActions }))
                .then((res) => {
                    if (!cancelled && typeof res?.command === 'string' && res.command) {
                        setDraftCommand({ key: draftKey, command: res.command });
                    }
                })
                .catch(() => {});
        }, 250);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [chainId, composeError, draftKey, fromAddress?.address, messaging, firstTx, stage]);

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
    const handleChainChange = (cid) => {
        clearPreReviewErrors();
        setRowValidationErrors({});
        setChainId(cid);
        setFromAddressId(pickDefaultAddressId(addressesByChain[cid] || [], activeByChain[cid]));
    };
    const updateTx = (txId, update) => setTxs((list) => list.map((tx) => (tx.id === txId ? update(tx) : tx)));
    const updateRow = (txId, rowId, patch) => {
        clearPreReviewErrors(rowId);
        setTouchedRows((t) => (t[rowId] ? t : { ...t, [rowId]: true }));
        updateTx(txId, (tx) => ({ ...tx, rows: tx.rows.map((r) => (r.id === rowId ? { ...r, ...patch } : r)) }));
    };
    const addRow = (txId) => {
        clearPreReviewErrors();
        updateTx(txId, (tx) => (tx.rows.length >= flowsLib.BATCH_MAX_COMMANDS
            ? tx
            : { ...tx, rows: [...tx.rows, blankRow()] }));
    };
    // Removing the last action of a later card removes that card; the first
    // card always keeps one action.
    const removeRow = (txId, rowId) => {
        clearPreReviewErrors(rowId);
        setTxs((list) => list.flatMap((tx, i) => {
            if (tx.id !== txId) return [tx];
            const rest = tx.rows.filter((r) => r.id !== rowId);
            if (rest.length > 0) return [{ ...tx, rows: rest }];
            return i === 0 ? [tx] : [];
        }));
    };
    const toggleRow = (rowId) => setClosedRows((closed) => ({ ...closed, [rowId]: !closed[rowId] }));
    // "Add another network" proposes the first network no card uses yet.
    const openNewCardPicker = () => {
        const used = new Set(txList.map((tx) => tx.chainId));
        openCardPicker(null, chainsWithAddresses.find((cid) => !used.has(cid)) || chainId);
    };
    const openCardPicker = (txId, pickerChainId) => {
        cardPickerChainRef.current = pickerChainId;
        setCardPicker({ txId, chainId: pickerChainId });
    };
    const switchCardPickerChain = (cid) => {
        cardPickerChainRef.current = cid;
        setCardPicker((p) => (p ? { ...p, chainId: cid } : p));
    };
    const pickCardSource = (address) => {
        const target = cardPicker ? { ...cardPicker, chainId: cardPickerChainRef.current } : null;
        setCardPicker(null);
        if (!target?.chainId) return;
        clearPreReviewErrors();
        setRowValidationErrors({});
        if (target.txId) {
            updateTx(target.txId, (tx) => ({ ...tx, chainId: target.chainId, fromAddressId: address.id }));
        } else {
            setTxs((list) => [...list, blankTx({ chainId: target.chainId, fromAddressId: address.id })]);
        }
    };

    const txSendTotals = useMemo(() => txList.map((tx) => sendTotalsFor(tx.parsed)), [txList]);

    async function goReview() {
        setReviewAttempt((n) => n + 1);
        setTouchedRows(Object.fromEntries(allRows.map((row) => [row.id, true])));
        if (composeError) return;
        const validatedDraftKey = draftKey;
        setValidatingRows(true);
        setPreReviewError(null);
        const validations = await Promise.all(txList.flatMap((tx) => tx.parsed.map(async (pr) => {
            try {
                const result = await messaging.validateAction({
                    chainId: tx.chainId,
                    action: pr.row.action,
                    params: pr.params,
                });
                return [pr.row.id, validationErrorMessage(result), false];
            } catch {
                return [pr.row.id, null, true];
            }
        })));
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

        // Each card's sends are checked against its own From address.
        for (let i = 0; i < txList.length; i += 1) {
            const totals = txSendTotals[i];
            if (totals.length === 0) continue;
            try {
                const fresh = await messaging.getAddressBalances(txList[i].chainId, txList[i].from.address);
                if (draftKeyRef.current !== validatedDraftKey) {
                    setValidatingRows(false);
                    return;
                }
                if (!fresh || typeof fresh !== 'object'
                    || (!fresh.native && !Array.isArray(fresh.tokens))) {
                    throw new Error('balances unavailable');
                }
                const balances = decoderLib.balancesFromSdk(fresh) || [];
                for (const total of totals) {
                    const balance = balances.find(
                        (entry) => String(entry.tick || '').trim().toUpperCase() === total.tick,
                    );
                    if (compareDecimalStrings(total.amount, String(balance?.amount ?? '0')) === 1) {
                        setPreReviewError(inTx(
                            i,
                            `These steps send ${total.amount} ${total.tick} in total, more than the ${balance?.amount ?? '0'} ${total.tick} this address holds.`,
                        ));
                        setValidatingRows(false);
                        return;
                    }
                }
            } catch {
                setPreReviewError(inTx(i, 'Couldn\'t refresh this address\'s balances. Check your connection and try again.'));
                setValidatingRows(false);
                return;
            }
        }

        setBuildError(null);
        setBuildErrorDetails('');
        setStage('review');
        setComposed(null);
        try {
            const built = [];
            for (let i = 0; i < txList.length; i += 1) {
                const tx = txList[i];
                const subActions = tx.parsed.map((pr) => ({ action: pr.row.action, params: pr.params }));
                const res = i === 0 && draftCommand?.key === validatedDraftKey
                    ? { command: draftCommand.command }
                    : await messaging.buildBatchCommand({ chainId: tx.chainId, subActions });
                if (typeof res?.command !== 'string' || !res.command) throw new Error('batch.buildCommand: empty command');
                built.push({
                    txId: tx.id,
                    chainId: tx.chainId,
                    from: tx.from,
                    command: res.command,
                    subStrings: res.command.split(';'),
                    sendTotals: txSendTotals[i],
                });
            }
            setComposed(built);
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
    // The Fees card quotes the first transaction, the one on the page's network.
    const quoteCommand = composed?.[0]?.command || (draftCommand?.key === draftKey ? draftCommand.command : null);
    const quoteActionData = useMemo(() => (quoteCommand ? {
        action: 'BATCH',
        params: { VERSION: '0', COMMAND: quoteCommand },
    } : null), [quoteCommand]);
    const { quote: protocolFeeQuote, pending: protocolFeePending } = useProtocolFeeQuote({
        messaging,
        chainId,
        source: fromAddress?.address,
        actionData: quoteActionData,
    });
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

    // The fee rate for one transaction. The page's network takes the picked
    // speed or custom rate; another network takes the same speed, and Normal
    // when the pick is a custom rate, since that rate is in this network's unit.
    function feePerKbFor(txChainId) {
        if (txChainId === chainId) return feePerKb;
        const mode = feePick.mode === 'custom' ? 'normal' : feePick.mode;
        const tiers = estimateNativeSendFeeTiers({ chainId: txChainId, chainRegistry });
        const estimate = tiers ? tiers[mode] : estimateNativeSendFee({ chainId: txChainId, chainRegistry, speed: mode });
        return estimate && estimate.unit && Number.isFinite(estimate.rateValue) && estimate.rateValue > 0
            ? displayRateToSettingsCustom(estimate.unit, estimate.rateValue)
            : null;
    }
    function feeEstimateFor(txChainId) {
        if (txChainId === chainId) return feeEstimate;
        const mode = feePick.mode === 'custom' ? 'normal' : feePick.mode;
        const tiers = estimateNativeSendFeeTiers({ chainId: txChainId, chainRegistry });
        return tiers ? tiers[mode] : estimateNativeSendFee({ chainId: txChainId, chainRegistry, speed: mode });
    }
    const tickerFor = (txChainId) => {
        const d = txChainId ? chainRegistry.get(txChainId) : null;
        return d ? ({ bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' }[d.coin] || '') : '';
    };
    const fromPayload = (record) => ({
        address: record.address,
        publicKey: record.publicKey,
        derivationPath: record.derivationPath,
        addressId: record.id,
        source: record.source,
        signerId: record.signerId,
    });

    // Sign the transactions one after another on the confirm page. A reject
    // or a failure stops the run; the ones already sent stay sent and the
    // done page says how many went through.
    async function signAll() {
        const sent = [];
        for (let k = 0; k < composed.length; k += 1) {
            const c = composed[k];
            const from = fromPayload(c.from);
            const params = { VERSION: '0', COMMAND: c.command };
            const txFeePerKb = feePerKbFor(c.chainId);
            const txHw = isHwSource(c.from);
            setSigningIndex(k);
            try {
                const res = await actionConfirm.run({
                    chainId: c.chainId,
                    from,
                    actionData: { action: 'BATCH', params },
                    ...(txFeePerKb != null ? { encoderOpts: { feePerKb: txFeePerKb } } : {}),
                    onApprove: (prebuiltPsbt) => {
                        const base = {
                            walletId, chainId: c.chainId, from, action: 'BATCH', params,
                            ...(txFeePerKb != null ? { feePerKb: txFeePerKb } : {}),
                            prebuiltPsbt,
                        };
                        return k === 0
                            ? submitConfirmed(base)
                            : (txHw
                                ? messaging.advancedActionHw({ ...base, signerId: c.from.signerId })
                                : messaging.advancedAction({ ...base, password: passwordValueRef.current }));
                    },
                });
                sent.push(res);
            } catch (err) {
                if (!isUserRejection(err)) {
                    // Keep the generic fallback independent of caught provider text so
                    // the shared message filters remain the only display boundary.
                    setSubmitError(submitFailureMessage(err, {
                        chainId: c.chainId, coinTicker: tickerFor(c.chainId), fallback: 'Batch failed.',
                    }));
                }
                if (sent.length > 0) {
                    setResults(sent);
                    setPassword('');
                    setStage('done');
                }
                return;
            }
        }
        setResults(sent);
        setPassword('');
        setStage('done');
    }

    async function handleSign(event) {
        event.preventDefault();
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        if (feeStop) { setBuildError(feeStop.formError); return; }
        // A second submit while a run is in flight is ignored, not composed twice.
        if (signingRef.current || stage === 'submitting' || !composed) return;
        const hw = hwSource;
        if (!isWatcherMode && !hw && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && hw && hwStatus !== 'available') return;
        setSubmitError(null);
        setSubmitErrorDetails('');
        signingRef.current = true;
        if (singleEncode) {
            try { await signAll(); } finally { signingRef.current = false; }
            return;
        }
        setStage('submitting');
        const built = [];
        try {
            for (const c of composed) {
                const params = { VERSION: '0', COMMAND: c.command };
                const txFeePerKb = feePerKbFor(c.chainId);
                built.push(await messaging.buildActionPsbtRequest({
                    chainId: c.chainId,
                    from: fromPayload(c.from),
                    actionData: { action: 'BATCH', params },
                    ...(txFeePerKb != null ? { encoderOpts: { feePerKb: txFeePerKb } } : {}),
                }));
            }
            setResults(built);
            setPassword('');
            setStage('done');
        } catch (err) {
            const shown = submitFailureMessage(err, {
                chainId, coinTicker, fallback: 'Batch failed.',
            });
            setSubmitError(shown);
            setSubmitErrorDetails(technicalDetails(err, shown));
            setStage('review');
        } finally {
            signingRef.current = false;
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
            title={stage === 'compose' ? 'Compose Batch' : 'Review Batch'}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header} restoreScroll={!(stage === 'review' || stage === 'submitting')}>{children}</Screen>
    );
    const feeCard = (
        // No pay-in-native switch: xchain-indexer refuses native-fee quotes for BATCH (its fee is
        // the sum of state-dependent sub-action fees), so the wallet cannot size that output.
        <FeesCard chainId={chainId} quote={protocolFeeQuote} pending={protocolFeePending} nativeSwitch={false} feeSelector={feeTiers ? (
            <FeeSelector
                chainId={chainId}
                label="Network fee"
                coinTicker={coinTicker}
                tiers={feeTiers}
                value={feePick}
                onChange={setFeePick}
                customEstimate={feePick.mode === 'custom' ? feeCustomEstimate : null}
            />
        ) : null} />
    );

    // The load error, the loading line and every done-stage panel lay out
    // through ListPage inside the Screen, the same template rhythm the
    // review and compose stages get from FormPage.
    if (loadError) {
        return wrap(
            <ListPage>
                <StatusMessage variant="error">{loadError}</StatusMessage>
            </ListPage>,
        );
    }
    if (!addressesByChain || !chainId) return wrap(<ListPage><p className={styles.hint}>Loading wallet…</p></ListPage>);

    if (sourcePickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="From Address"
                walletId={walletId}
                chainId={chainId}
                onChainChange={handleChainChange}
                onPick={(address) => {
                    clearPreReviewErrors();
                    setFromAddressId(address.id);
                    setSourcePickerOpen(false);
                }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    // A later card's network and From: picked together on one screen, as the
    // page's own From picker does.
    if (cardPicker) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="From Address"
                walletId={walletId}
                chainId={cardPicker.chainId}
                onChainChange={switchCardPickerChain}
                onPick={pickCardSource}
                onBack={() => setCardPicker(null)}
            />
        );
    }

    // Confirm page, rendered in place of the review stage; the queued rows
    // stay intact behind it, so Reject lands back on the step list. It shows
    // the transaction being signed now.
    if (actionConfirm.open) {
        const signing = composed?.[signingIndex] || { chainId, from: fromAddress };
        const signingTicker = tickerFor(signing.chainId);
        const signingFee = feeEstimateFor(signing.chainId);
        // One batch transaction is signed at a time; with several queued, the
        // hero says which one this is.
        const batchCount = Array.isArray(composed) ? composed.length : 0;
        const batchSummary = {
            verb: t('components.confirmSummary.verbBatch'),
            ...(batchCount > 1
                ? { target: t('components.confirmSummary.batchTarget', { index: String(signingIndex + 1), total: String(batchCount) }) }
                : {}),
            direction: 'none',
            chainId: signing.chainId,
            address: signing.from?.address,
        };
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                summary={batchSummary}
                screenVariant={variant}
                feeText={signingFee?.coinAmount
                    ? `Network fee: ${signingFee.coinAmount} ${signingTicker}`.trim()
                    : undefined}
                coinTicker={signingTicker}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hwSource={isHwSource(signing.from) ? signing.from : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                chainId={signing.chainId}
                getSignerStatus={messaging.getSignerStatus}
                hintClassName={styles.hint}
            />
        );
    }

    if (stage === 'done') {
        const startOver = () => { setResults([]); setComposed(null); setStage('compose'); };
        const totalTxs = composed?.length || results.length;
        // A run that stopped part way says so first; the ones sent stay sent.
        const partial = results.length < totalTxs ? (
            <StatusMessage variant="error">
                {t('batch.partialSent', { sent: results.length })}
                {submitError ? ` ${submitError}` : ''}
            </StatusMessage>
        ) : null;
        const resultBlock = (result, i) => {
            const txid = result?.txid || result?.broadcast?.txid;
            const rowCount = composed?.[i]?.subStrings.length ?? allRows.length;
            if (result?.psbtHex && !txid) {
                return (
                    <ResultScreen
                        key={i}
                        state="unsigned"
                        result={result}
                        onBuildAnother={startOver}
                        onDone={onBack}
                    />
                );
            }
            // A queued result is SIGNED and not broadcast: the confirm lane
            // resolves a transient broadcast failure that way, and "Batch
            // broadcast" would report N sub-actions as sent when none are.
            if (result?.queued) {
                return <ResultScreen key={i} state="signed-not-broadcast" onDone={onBack} what="batch" unsaved={result?.unsaved} />;
            }
            return (
                <section key={i}>
                    {results.length > 1 ? (
                        <h3 className={styles.successLabel}>{t('batch.transactionNumber', { number: i + 1 })}</h3>
                    ) : null}
                    <p className={styles.hint}>All {rowCount} action{rowCount === 1 ? '' : 's'} were sent in one transaction. Each one confirms or fails on its own.</p>
                    {txid ? (
                        <>
                            <p className={styles.successLabel}>Transaction ID</p>
                            <code className={styles.txid}>{txid}</code>
                        </>
                    ) : null}
                </section>
            );
        };
        if (results.length === 1 && !partial) {
            const only = results[0];
            const onlyTxid = only?.txid || only?.broadcast?.txid;
            if (only?.psbtHex && !onlyTxid) {
                return wrap(
                    <ListPage>
                        <ResultScreen state="unsigned" result={only} onBuildAnother={startOver} onDone={onBack} />
                    </ListPage>,
                );
            }
            if (only?.queued) {
                return wrap(
                    <ListPage>
                        <ResultScreen state="signed-not-broadcast" onDone={onBack} what="batch" unsaved={only?.unsaved} />
                    </ListPage>,
                );
            }
        }
        // Watcher runs end with unsigned transactions only; nothing was sent.
        const allUnsigned = results.every((r) => r?.psbtHex && !(r?.txid || r?.broadcast?.txid));
        return wrap(
            <ListPage>
                {partial}
                {allUnsigned ? null : (
                    <h2 className={styles.successTitle}>
                        {results.length > 1 ? t('batch.allSent', { count: results.length }) : <>Batch broadcast</>}
                    </h2>
                )}
                {results.map(resultBlock)}
                <div className={styles.actions}><Button variant="primary" icon={<Icon.CheckIcon />} onClick={onBack}>Done</Button></div>
            </ListPage>,
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
                            <StatusMessage variant="error" details={buildErrorDetails || undefined}>
                                {buildError}
                            </StatusMessage>
                        ) : null}
                        {submitError && (hw || isWatcherMode) ? (
                            <StatusMessage variant="error" details={submitErrorDetails || undefined}>
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
                            variant="success"
                            icon={<Icon.SignIcon />}
                            loading={stage === 'submitting'}
                            disabled={!composed || (!isWatcherMode && (hw ? hwStatus !== 'available' : (!signerReady && password.length === 0)))}
                        >
                            {isWatcherMode ? 'Create Batch' : 'Sign Batch'}
                        </Button>
                    </>
                )}
            >
                <p className={styles.summary} style={{ textAlign: 'left' }}>
                    Each transaction bundles its actions and sends them
                    together, but each action still confirms on its own: if one runs out of what it needs (for example fee
                    coverage), it fails alone and the others still land. This is different from the parallel
                    composer, where each action is its own transaction from the start.
                </p>
                {multiTx ? (
                    <StatusMessage variant="warning">{t('batch.notAtomic', { count: txList.length })}</StatusMessage>
                ) : null}

                {!composed && !buildError ? <p className={styles.hint}>Composing…</p> : null}
                {(composed || []).map((c, txIndex) => {
                    const txFee = feeEstimateFor(c.chainId);
                    const txDescriptor = chainRegistry.get(c.chainId);
                    return (
                        <section key={c.txId} className={batchStyles.reviewTx} aria-label={t('batch.transactionNumber', { number: txIndex + 1 })}>
                            {composed.length > 1 ? (
                                <h3 className={batchStyles.reviewTxTitle}>
                                    {t('batch.transactionNumber', { number: txIndex + 1 })}
                                    {txDescriptor ? <ChainBadge descriptor={txDescriptor} size="sm" showName={false} /> : null}
                                </h3>
                            ) : null}
                            <dl className={styles.detailsList}>
                                <dt className={styles.detailsLabel}>From</dt>
                                <dd className={styles.detailsValue}><AddressText address={c.from?.address} /></dd>
                            </dl>
                            <p className={styles.successLabel}>Batch steps ({c.subStrings.length})</p>
                            <ol style={{ paddingLeft: '1rem', margin: 'var(--xc-space-2) 0' }}>
                                {c.subStrings.map((s, i) => (
                                    <li key={i} style={{ margin: 'var(--xc-space-1) 0' }}>
                                        <code style={{ fontSize: 'var(--xc-text-xs)', wordBreak: 'break-all' }}>{s}</code>
                                    </li>
                                ))}
                            </ol>
                            {c.sendTotals.length > 0 ? (
                                <>
                                    <p className={styles.successLabel}>Send totals</p>
                                    <ul>
                                        {c.sendTotals.map((total) => (
                                            <li key={total.tick}>{total.amount} {total.tick}</li>
                                        ))}
                                    </ul>
                                </>
                            ) : null}
                            {/* The first transaction's fee sits in the Fees card below. */}
                            {txIndex > 0 && txFee?.coinAmount ? (
                                <p className={styles.hint}>
                                    {t('batch.networkFeeFor', { amount: txFee.coinAmount, ticker: tickerFor(c.chainId) })}
                                </p>
                            ) : null}
                        </section>
                    );
                })}

                {isWatcherMode ? (
                    <p className={styles.hint}>{t('common.watcherBuildsUnsigned')}</p>
                ) : null}

                {feeCard}

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
    // The Actions summary names each queued action ("Send, Broadcast").
    const actionsSummary = joinSummary(...allRows.map((row) => (row.action ? actionDisplayLabel(row.action) : null)))
        || `${allRows.length} action${allRows.length === 1 ? '' : 's'}`;
    const actionsHaveError = anyShownRowError || Boolean(constraintError);
    return wrap(
        <FormFrame
            demoGuard={demoGuard}
            label="Batch composer"
            onSubmit={(event) => { event.preventDefault(); goReview(); }}
            status={preReviewError || constraintError ? (
                <StatusMessage variant="error">{preReviewError || constraintError}</StatusMessage>
            ) : null}
            action={(
                // Names how many transactions the review will hold; it leads
                // to the review stage, then one confirm screen per transaction.
                <FormAction icon={<TokenListIcon />} loading={validatingRows} disabled={anyShownRowError || Boolean(constraintError) || validatingRows}>
                    {t('batch.review', { count: txList.length })}
                </FormAction>
            )}
            /* The standard order: From (the default Network and address),
               Actions (one card per transaction), then the Network fee row
               with the Fees card. */
            from={(
                <FromSection
                    {...formSections.bind('from')}
                    chainId={chainId}
                    chainIds={chainsWithAddresses}
                    chainRegistry={chainRegistry}
                    onNetworkChange={handleChainChange}
                    networkHelp="The chain the whole batch is sent on. Every action in it is signed by the From address and recorded on this network."
                    address={fromAddress?.address || null}
                    onOpenPicker={() => setSourcePickerOpen(true)}
                    pickerLabel="Choose from address"
                    addressHelp="The address that signs and pays for the whole batch."
                />
            )}
            fee={(
                // No pay-in-native switch: xchain-indexer refuses native-fee quotes for BATCH (its fee is
                // the sum of state-dependent sub-action fees), so the wallet cannot size that output.
                <FeeSection
                    {...formSections.bind('fee')}
                    chainId={chainId}
                    coinTicker={coinTicker}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={feeCustomEstimate}
                    protocolSummary={protocolFeeSummary(protocolFeeQuote, protocolFeePending)}
                    fees={{ quote: protocolFeeQuote, pending: protocolFeePending, nativeSwitch: false }}
                />
            )}
        >
            <StandardSection
                id="actions"
                title="Actions"
                icon={TokenListIcon}
                {...formSections.bind('actions')}
                revealKey={actionsHaveError ? reviewAttempt + 1 : 0}
                summary={actionsSummary}
            >
            {/* One card per transaction: its header names the network, the
                From address and the transaction number; each action reads as a
                sentence with a remove button and opens its editor below it.
                No Batch limits text; the cap shows only once a card reaches it. */}
            <ol className={batchStyles.cards} aria-label={t('batch.transactionsLabel')} data-xc-preserve-nested-cards>
                {txList.map((tx, txIndex) => {
                    const number = txIndex + 1;
                    const descriptor = tx.chainId ? chainRegistry.get(tx.chainId) : null;
                    const full = tx.rows.length >= flowsLib.BATCH_MAX_COMMANDS;
                    return (
                        <li key={tx.id} className={batchStyles.card}>
                            <ListRow
                                className={batchStyles.cardHeader}
                                aria-label={t('batch.changeSource', { number })}
                                onClick={() => (txIndex === 0
                                    ? setSourcePickerOpen(true)
                                    : openCardPicker(tx.id, tx.chainId))}
                                leading={descriptor ? <ChainBadge descriptor={descriptor} size="sm" showName={false} /> : null}
                                title={<span className={batchStyles.cardFrom}>{summaryAddress(tx.from?.address || '')}</span>}
                                trailing={<span className={batchStyles.cardNumber}>{t('batch.transactionNumber', { number })}</span>}
                            />
                            <ul className={batchStyles.rows} aria-label={t('batch.actionsOf', { number })}>
                                {tx.parsed.map((pr, i) => {
                                    const row = pr.row;
                                    const sentence = rowSentence(row, pr.params);
                                    const open = !closedRows[row.id];
                                    const rowError = shownRowError(row);
                                    return (
                                        <li key={row.id}>
                                            <section className={batchStyles.row} aria-label={`Action ${i + 1}`}>
                                                <div className={batchStyles.rowLine}>
                                                    <ListRow
                                                        className={batchStyles.rowSentence}
                                                        aria-expanded={open}
                                                        tooltip={t('batch.editRow', { number: i + 1 })}
                                                        onClick={() => toggleRow(row.id)}
                                                        title={sentence.title}
                                                        subtitle={sentence.subtitle || null}
                                                    />
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        icon={<Icon.XIcon />}
                                                        aria-label={t('batch.removeRow')}
                                                        title={t('batch.removeRow')}
                                                        onClick={() => removeRow(tx.id, row.id)}
                                                        disabled={txIndex === 0 && tx.rows.length <= 1}
                                                    />
                                                </div>
                                                {open ? (
                                                    <div className={batchStyles.rowEditor}>
                                                        <Select
                                                            label="Action"
                                                            help="One sub-action included in this single BATCH transaction."
                                                            value={row.action || ''}
                                                            onChange={(e) => updateRow(tx.id, row.id, { action: e.target.value })}
                                                        >
                                                            <option value="">Select action</option>
                                                            {/* One SDK list serves every chain; drop what this card's chain refuses at every version. */}
                                                            {actionsList.filter((a) => isActionOfferedOnChain(chainRegistry, tx.chainId, a)).map((a) => (
                                                                <option key={a} value={a}>{actionDisplayLabel(a)} ({a})</option>
                                                            ))}
                                                        </Select>
                                                        <Textarea
                                                            label="Params (JSON object)"
                                                            help="This action's fields, entered as a JSON object."
                                                            rows={4}
                                                            value={row.paramsJson}
                                                            onChange={(e) => updateRow(tx.id, row.id, { paramsJson: e.target.value })}
                                                            placeholder='{"VERSION":"0", ...}'
                                                            spellCheck={false}
                                                        />
                                                    </div>
                                                ) : null}
                                                {rowError ? (
                                                    <FieldNote variant="error">
                                                        {rowError}
                                                    </FieldNote>
                                                ) : null}
                                            </section>
                                        </li>
                                    );
                                })}
                            </ul>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                icon={<Icon.PlusIcon />}
                                className={batchStyles.addToTx}
                                onClick={() => addRow(tx.id)}
                                disabled={full}
                            >
                                {t('batch.addToTransaction')}
                            </Button>
                            {full ? (
                                <p className={styles.hint}>
                                    {flowsLib.BATCH_MAX_COMMANDS} actions is the most one batch carries.
                                </p>
                            ) : null}
                        </li>
                    );
                })}
            </ol>
            {chainsWithAddresses.length > 1 ? (
                <Button
                    type="button"
                    variant="secondary"
                    icon={<Icon.PlusIcon />}
                    className={batchStyles.addNetwork}
                    onClick={openNewCardPicker}
                >
                    {t('batch.addNetwork')}
                </Button>
            ) : null}
            </StandardSection>
        </FormFrame>,
    );
}
