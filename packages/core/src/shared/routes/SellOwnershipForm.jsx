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
// Network, From, the fee selector and the section frame come from the Form Standard.
import { IconSelect, AddressField, AddressText, Button, ChainBadge, FormPage, Icon, InfoTip, Input, ListPage, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import {
    FeeSection,
    FormAction,
    FormFrame,
    FormSection,
    FromSection,
    joinSummary,
    MemoSection,
    useFormSections,
} from '../components/formStandard/index.js';
import { decoder as decoderLib, registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import { TokenPicker } from './TokenPicker.jsx';
import { TokenField } from '../components/TokenField.jsx';
import { AmountField } from '../components/AmountField.jsx';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { useTokenInfo } from '../hooks/useTokenInfo.js';
import { coinFromChainId, formatFiat } from '../components/BalanceList.jsx';
import { useSettings } from '../hooks/useSettings.js';
import { useTickFiatRate } from '../hooks/useFiatRate.js';
import { coinToFiatExact } from '../../flows/priceLookup.js';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/send.js';
import { customFeeReviewStop } from '../../flows/feeEstimate.js';
import styles from './IssueTokenForm.module.css';
import inputStyles from '../../ui/Input.module.css';
import receivePickerStyles from './TokenPicker.module.css';
import { externalIndexOf, preferredSourceId } from '../addressSelection.js';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { useProtocolFeeQuote } from '../hooks/useProtocolFeeQuote.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { ConfirmActionModal } from '../components/ConfirmActionModal.jsx';
import { tokenAmountPrecisionError } from '../utils/amountFormat.js';
import { salePriceLimitError } from '../utils/salePriceLimit.js';
import {
    TOKEN_RECORD_GATE_KEYS, tokenRecordChangedMessage, tokenRecordChangedSince, tokenRecordsDiffer,
} from '../utils/tokenRecordDrift.js';
import { invalidateTokenInfo } from '../utils/tokenInfoCache.js';
import { tickerReferenceError } from '../utils/tickerGrammar.js';
import { MAX_MEMO_LENGTH, memoLengthError } from '../utils/memoLimit.js';
import { tokenIssuerEligibility, UNKNOWN_TOKEN_ISSUER_MESSAGE } from '../utils/tokenIssuerEligibility.js';
import { normalizeProtocolFee } from '../../flows/protocolFeeRow.js';

const chainRegistry = registryLib.defaultRegistry();
const NO_ACKNOWLEDGMENTS = new Set();

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

// Named so the form can tell which section a validation error is in.
const EXPIRATION_ERROR = 'Expiration must be a whole number of blocks.';
const MEMO_SEPARATOR_ERROR = 'Memo cannot contain "|" or ";".';

/**
 * Sell-ownership surface: lists a token's ownership (the asset name) for
 * sale with GIVE_OWNERSHIP=1, via either mechanism:
 *   - ORDER: an open offer matched by a counterparty; native-coin payment
 *     settles via COINPAY, token payment settles atomically;
 *   - DISPENSER: an instant fixed-price buy (single-shot for ownership).
 * Both take the same fields here; only the action + submit handler differ.
 * Either side of the price can be native coin (GET_TICK empty) or a token.
 *
 * Unlike SwapForm (SWAP-based, no native coin), this reaches native-coin
 * sales. Ownership sales are single-fill/indivisible; escrowed ownership
 * returns to SOURCE on cancel/expiry. Launched from ManageToken's "Sell
 * name" action with the token + chain prefilled.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 * @param {string} props.chainId           the token's chain
 * @param {string} props.tick              the token whose ownership is for sale
 * @param {string} [props.initialFromAddress]   preferred signing address (issuer)
 */
export function SellOwnershipForm({ walletId, onBack, chainId: initialChainId, tick, initialFromAddress }) {
    // Seeded from the launching context; the Network field lets the user retarget.
    const [chainId, setChainId] = useState(initialChainId);
    const { messaging, shell } = useMessaging();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);

    const [addressLoad, setAddressLoad] = useState({
        walletId: null,
        chainId: null,
        addressesByChain: null,
        error: null,
    });
    const addressLoadMatches = addressLoad.walletId === walletId
        && addressLoad.chainId === chainId;
    const addressesByChain = addressLoadMatches ? addressLoad.addressesByChain : null;
    const loadError = addressLoadMatches ? addressLoad.error : null;
    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const pendingFromPickRef = useRef(/** @type {{ chainId: string, id: string } | null} */ (null));
    const pickerChainRef = useRef(initialChainId);

    // 'order' → open ORDER (matched offer); 'dispenser' → DISPENSER (instant
    // fixed-price buy). Both escrow the name via GIVE_OWNERSHIP=1.
    const [mechanism, setMechanism] = useState(/** @type {'order' | 'dispenser'} */ ('order'));
    // 'coin' → sell for native coin (GET_TICK empty); 'token' → sell for a token.
    const [getMode, setGetMode] = useState(/** @type {'coin' | 'token'} */ ('coin'));
    const [getTick, setGetTick] = useState('');
    const [tokenPickerOpen, setTokenPickerOpen] = useState(false);
    const [price, setPrice] = useState('');
    // The name being sold: prefilled from the launching token, changeable to
    // any name this wallet owns on the network.
    const [selectedTick, setSelectedTick] = useState(String(tick || ''));
    const [ownedNames, setOwnedNames] = useState(
        /** @type {Array<{ tick: string, ownerAddressId: string }> | null} */ (null),
    );
    const [namePickerOpen, setNamePickerOpen] = useState(false);
    const { settings } = useSettings();
    const [expiration, setExpiration] = useState('');
    const [memo, setMemo] = useState('');
    const [password, setPassword] = useState('');
    // Open state per section, held here so it survives the picker pages.
    // Only the main section starts open.
    const formSections = useFormSections({ from: false, sale: true, expiry: false, memo: false, fee: false });
    // A refused review opens the section holding the refused field,
    // on every attempt, even after the user closed it.
    const [refusedIn, setRefusedIn] = useState({ section: null, attempt: 0 });
    const refuseIn = (section) => setRefusedIn((prev) => ({ section, attempt: prev.attempt + 1 }));
    const sectionReveal = (id) => (refusedIn.section === id ? refusedIn.attempt : 0);

    const changeChain = useCallback((nextChainId) => {
        pickerChainRef.current = nextChainId;
        pendingFromPickRef.current = null;
        setGetTick('');
        setFromAddressId(null);
        setChainId(nextChainId);
    }, []);

    const [stage, setStage] = useState(/** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'));
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const [hwStatus, setHwStatus] = useState('idle');
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const submitPendingRef = useRef(false);
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    useEffect(() => {
        let cancelled = false;
        const pendingLoad = {
            walletId,
            chainId,
            addressesByChain: null,
            error: null,
        };
        setAddressLoad(pendingLoad);
        const pendingPick = pendingFromPickRef.current?.chainId === chainId
            ? pendingFromPickRef.current
            : null;
        setFromAddressId(pendingPick?.id || null);
        Promise.all([
            messaging.getAddressesByChain(walletId),
            typeof messaging.getActiveAddresses === 'function'
                ? Promise.resolve(messaging.getActiveAddresses(walletId)).catch(() => ({}))
                : Promise.resolve({}),
        ])
            .then(([byChain, active]) => {
                if (cancelled) return;
                const nextByChain = byChain || {};
                const all = nextByChain[chainId] || [];
                if (all.length === 0) {
                    setAddressLoad({
                        ...pendingLoad,
                        addressesByChain: nextByChain,
                        error: 'No address on this network can sign the sale. Use Receive to create one first.',
                    });
                    return;
                }
                setAddressLoad({ ...pendingLoad, addressesByChain: nextByChain });
                const picked = pendingFromPickRef.current?.chainId === chainId
                    ? all.find((a) => a.id === pendingFromPickRef.current.id)
                    : null;
                if (picked) {
                    setFromAddressId(picked.id);
                    pendingFromPickRef.current = null;
                    return;
                }
                if (pendingFromPickRef.current?.chainId === chainId) {
                    pendingFromPickRef.current = null;
                }
                if (initialFromAddress) {
                    const match = all.find((a) => a.address === initialFromAddress);
                    if (match) { setFromAddressId(match.id); return; }
                }
                const hd = all.filter((a) => a.source === 'hd' && externalIndexOf(a.derivationPath) !== null);
                const pool = hd.length > 0 ? hd : all;
                setFromAddressId(preferredSourceId(pool, active?.[chainId]) || pool[0].id);
            })
            .catch(() => {
                if (!cancelled) {
                    setAddressLoad({
                        ...pendingLoad,
                        error: 'Could not load your addresses. Check your connection and try again.',
                    });
                }
            });
        return () => { cancelled = true; };
    }, [walletId, chainId, messaging, initialFromAddress]);

    // Names this wallet owns on the network, from every address that can sign;
    // a failed or missing read leaves the launching name as the only choice.
    useEffect(() => {
        if (!addressesByChain) return undefined;
        const sources = (addressesByChain[chainId] || []).filter((a) => a?.address);
        if (typeof messaging?.getOwnedTokens !== 'function' || sources.length === 0) {
            setOwnedNames([]);
            return undefined;
        }
        let cancelled = false;
        Promise.all(sources.map((source) => Promise.resolve(
            messaging.getOwnedTokens({ chainId, address: source.address }),
        ).then((rows) => ({ source, rows: Array.isArray(rows) ? rows : [] }))
            .catch(() => ({ source, rows: [] }))))
            .then((batches) => {
                if (cancelled) return;
                const seen = new Set();
                const merged = [];
                for (const { source, rows } of batches) {
                    for (const row of rows) {
                        const ownedTick = String(row?.tick || '').trim();
                        const key = ownedTick.toLowerCase();
                        if (!ownedTick || seen.has(key)) continue;
                        seen.add(key);
                        merged.push({ tick: ownedTick, ownerAddressId: source.id });
                    }
                }
                merged.sort((a, b) => a.tick.localeCompare(b.tick));
                setOwnedNames(merged);
                setSelectedTick((current) => current || merged[0]?.tick || '');
            });
        return () => { cancelled = true; };
    }, [addressesByChain, chainId, messaging]);

    // Focus the password field when entering review, matching DestroyForm convention.
    useEffect(() => {
        if (stage === 'review') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';
    // PC-51: the native-coin protocol fee is MANDATORY off Bitcoin
    //Without this the composed ORDER/DISPENSER carries no fee
    // output, the transaction confirms, and the indexer rejects the action
    // with "insufficient fee (native coin output required)" while this form
    // reports the sale as open. Every other ORDER/DISPENSER authoring surface
    // (CreateOrderForm, PlaceOrderPanel, DispenserForm) already does this.
    const nativeFee = useNativeFee(chainId);
    const fromAddress = useMemo(() => {
        if (!addressesByChain || !fromAddressId) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [addressesByChain, chainId, fromAddressId]);

    const hw = isHwSource(fromAddress);
    const hwSignerInfo = useSignerInfo({ walletId, signerId: hw ? fromAddress?.signerId : null });
    const { isWatcherMode } = useWalletMode();

    const tokenTick = selectedTick;
    const ownershipTokenInfo = useTokenInfo({ chainId, tick: tokenTick, skip: !tokenTick });
    const issuerEligibility = tokenIssuerEligibility({
        tokenInfo: ownershipTokenInfo,
        addressesByChain,
        chainId,
        tick: tokenTick,
        sourceAddress: fromAddress?.address,
    });
    const wantLabel = getMode === 'coin' ? coinTicker : (getTick.trim() || 'token');
    // Fiat worth of the price, from the shared price lookup (mainnet only, as
    // on Send); null when nothing can price the asset, which hides it.
    const fiatCurrency = settings?.fiatCurrency || 'USD';
    const priceFiatRate = useTickFiatRate({
        chainCoin: descriptor?.coin || null,
        tick: getMode === 'coin' ? '' : getTick.trim(),
        nativeTicker: coinTicker,
        fiatCurrency,
        allowCoingeckoFallback: settings?.privacy?.priceDataEnabled !== false,
        enabled: descriptor?.networkKind === 'mainnet',
    });
    const priceFiatValue = priceFiatRate && priceReadyForFiat(price)
        ? coinToFiatExact(price.trim(), priceFiatRate)
        : null;
    const priceFiatText = priceFiatValue != null
        ? `≈ ${formatFiat(priceFiatValue, String(priceFiatRate.fiatCurrency || fiatCurrency).toUpperCase())} ${String(priceFiatRate.fiatCurrency || fiatCurrency).toUpperCase()}`
        : null;

    const validationError = useMemo(() => {
        if (getMode === 'token') {
            const gt = getTick.trim();
            if (gt) {
                const tickError = tickerReferenceError(gt, { noun: 'Price token', allowRef: true });
                if (tickError) return tickError;
            }
            if (gt && gt === coinTicker) {
                return `Pick "Native coin" to sell for ${coinTicker}. The token field is for selling against another token.`;
            }
            if (gt && gt === tokenTick) {
                return 'The price token must differ from the token being sold.';
            }
        }
        if (expiration.trim() && !/^[0-9]+$/.test(expiration.trim())) {
            return EXPIRATION_ERROR;
        }
        if (memo.includes('|') || memo.includes(';')) {
            return MEMO_SEPARATOR_ERROR;
        }
        const memoError = memoLengthError(memo.trim());
        if (memoError) return memoError;
        return null;
    }, [getMode, getTick, coinTicker, tokenTick, expiration, memo]);
    // The section that holds the field validationError names, in the
    // same order the checks above run (price token, expiration, memo).
    const validationSection = !validationError
        ? null
        : validationError === EXPIRATION_ERROR
            ? 'expiry'
            : (validationError === MEMO_SEPARATOR_ERROR || validationError === memoLengthError(memo.trim()))
                ? 'memo'
                : 'sale';

    const priceReady = /^[0-9]+(\.[0-9]+)?$/.test(price.trim()) && Number(price.trim()) > 0;
    const getTickReady = getMode === 'coin' || getTick.trim().length > 0;
    const priceTokenInfo = useTokenInfo({
        chainId,
        tick: getTick.trim(),
        skip: getMode !== 'token' || !getTick.trim(),
    });
    const priceDivisibility = getMode === 'coin' ? 8 : priceTokenInfo?.divisibility;
    const pricePrecisionError = tokenAmountPrecisionError(price, {
        divisibility: priceDivisibility,
        tick: getMode === 'coin' ? coinTicker : getTick,
        noun: 'Price',
    });
    const priceLimitError = salePriceLimitError(price, getMode === 'token'
        ? { supplyCap: priceTokenInfo?.maxSupply, tick: getTick }
        : {});

    // Network fee: Low / Normal / Fast / Custom, editable via FeeSelector on
    // the form stage. `feeEstimate` backs the slider readout and the review
    // row; `feePerKb` prices the broadcast. Mirrors ComposeMessage.
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

    // ORDER and DISPENSER ownership sales take the same fields; only the
    // action name and the submit handler differ. GIVE_ESCROW is omitted (it
    // must be empty for an ownership dispenser). Named once here so the
    // confirm lane and the legacy watcher lane cannot drift apart.
    const saleAction = mechanism === 'dispenser' ? 'DISPENSER' : 'ORDER';
    const saleParams = useMemo(() => ({
        VERSION: '0',
        GIVE_COIN: coinTicker,
        GIVE_TICK: tokenTick,
        GIVE_OWNERSHIP: '1',
        GET_COIN: coinTicker,
        ...(getMode === 'token' ? { GET_TICK: getTick.trim() } : {}),
        GET_AMOUNT: String(price).trim(),
        ...(expiration.trim() ? { EXPIRATION: expiration.trim() } : {}),
        ...(memo.trim() ? { MEMO: memo.trim() } : {}),
    }), [coinTicker, tokenTick, getMode, getTick, price, expiration, memo]);
    const quoteActionData = useMemo(() => {
        const ready = Boolean(chainId && fromAddress?.address)
            && !issuerEligibility.pending
            && !issuerEligibility.error
            && !validationError
            && priceReady
            && getTickReady
            && !pricePrecisionError
            && !priceLimitError;
        return ready ? { action: saleAction, params: saleParams } : null;
    }, [price, getMode, priceTokenInfo, coinTicker, getTick, chainId, fromAddress,
        issuerEligibility, validationError, priceReady, getTickReady, pricePrecisionError,
        priceLimitError, saleAction, saleParams]);
    const { quote: protocolFeeQuote, pending: protocolFeePending } = useProtocolFeeQuote({
        messaging,
        chainId,
        source: fromAddress?.address,
        actionData: quoteActionData,
    });
    const legacyDecoded = useMemo(() => {
        if (stage !== 'review' && stage !== 'submitting') return null;
        const decoded = decoderLib.decodeAction({ action: saleAction, params: saleParams, chainId, chainRegistry });
        if (!expiration.trim()) return decoded;
        return {
            ...decoded,
            details: (decoded.details || []).map((detail) => (
                detail.label === 'Expiration'
                    ? { ...detail, label: 'Expires after', value: `${expiration.trim()} blocks` }
                    : detail
            )),
        };
    }, [chainId, expiration, saleAction, saleParams, stage]);
    const quotedProtocolFee = normalizeProtocolFee(protocolFeeQuote);
    const legacyComposed = legacyDecoded ? {
        action: saleAction,
        chainId,
        decoded: legacyDecoded,
        quote: protocolFeeQuote,
        protocolFeeKnownFree: quotedProtocolFee.known && quotedProtocolFee.free,
    } : null;

    // §5.6: the signing lanes compose ONE PSBT host-side and approve it on
    // the shared confirm page; watcher keeps the legacy review stage.
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const singleEncode = !isWatcherMode;
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    // Hardware signs the SAME prebuilt PSBT through the same host flow,
    // with the device standing in for the password.
    const submitOrder = useConfirmSubmit({
        messaging,
        isHw: hw,
        signerId: fromAddress?.signerId,
        passwordRef: passwordValueRef,
        software: 'orderAction',
        hardware: 'orderActionHw',
    });
    const submitDispenser = useConfirmSubmit({
        messaging,
        isHw: hw,
        signerId: fromAddress?.signerId,
        passwordRef: passwordValueRef,
        software: 'dispenserAction',
        hardware: 'dispenserActionHw',
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
        // The record the user reviewed the sale against.
        const reviewedRecord = ownershipTokenInfo;
        try {
            const dispatch = mechanism === 'dispenser' ? submitDispenser : submitOrder;
            const r = await actionConfirm.run({
                chainId,
                from,
                actionData: { action: saleAction, params: saleParams },
                // Read the owner once more at Approve. A sale signed by an
                // address that no longer owns the name pays its fees for a
                // refusal, so a moved name stops here, and so does an owner
                // the explorer cannot confirm, as it does when the form opens.
                recheckBeforeSign: async () => {
                    let fresh = null;
                    try {
                        // Fresh: the review read this record moments ago, and a
                        // reused or HTTP-cached answer would be that same record.
                        fresh = await messaging.getTokenInfo({ chainId, tick: tokenTick, demo: false, fresh: true });
                    } catch {
                        fresh = null;
                    }
                    const owner = fresh && !fresh.loadError && typeof fresh.creator === 'string'
                        ? fresh.creator.trim()
                        : '';
                    if (!owner) return UNKNOWN_TOKEN_ISSUER_MESSAGE;
                    if (owner.toLowerCase() !== String(from.address || '').toLowerCase()
                        || tokenRecordsDiffer(reviewedRecord, fresh, TOKEN_RECORD_GATE_KEYS)) {
                        invalidateTokenInfo(chainId, tokenTick);
                        return tokenRecordChangedMessage(tokenTick);
                    }
                    return null;
                },
                encoderOpts: {
                    payFeeInNativeCoin: nativeFee.flag || undefined,
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
                onApprove: (prebuiltPsbt) => dispatch({
                    walletId,
                    chainId,
                    from,
                    params: saleParams,
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
                chainId,
                coinTicker,
                mandatory: nativeFee.mandatory,
                fallback: err?.message || 'Sign failed.',
            }));
        } finally {
            submitPendingRef.current = false;
        }
    }

    // Validate form fields and advance to the review stage; real signing
    // happens only after the user confirms on the review screen.
    async function handleReview(event) {
        event.preventDefault();
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        // Each refusal below also opens the section that holds its field.
        if (feeStop) { setFormError(feeStop.formError); refuseIn('fee'); return; }
        if (submitPendingRef.current) return;
        if (!fromAddress || !chainId) {
            setFormError('Pick a source address first.');
            refuseIn('from');
            return;
        }
        if (issuerEligibility.pending) {
            setFormError(`Wait for the wallet to verify the current owner of ${tokenTick}.`);
            return;
        }
        if (issuerEligibility.error) {
            setFormError(issuerEligibility.error);
            refuseIn('from');
            return;
        }
        if (!tokenTick) {
            setFormError('Select the token you are selling.');
            refuseIn('sale');
            return;
        }
        if (getMode === 'token' && !getTick.trim()) {
            setFormError('Select a price token.');
            refuseIn('sale');
            return;
        }
        if (validationError) { refuseIn(validationSection); return; }
        if (!priceReady || !getTickReady) {
            setFormError(`Enter what you want in return and a price greater than 0.`);
            refuseIn('sale');
            return;
        }
        // Keep the sale price within the payment asset's on-chain decimal scale.
        if (pricePrecisionError) {
            setFormError(pricePrecisionError);
            refuseIn('sale');
            return;
        }
        // A price the network refuses spends the fees for nothing, and one above
        // the price token's maximum supply is a sale no buyer can ever take.
        if (priceLimitError) {
            setFormError(priceLimitError);
            refuseIn('sale');
            return;
        }
        // The owner check came from the record read when the form opened; a
        // sale or transfer of the name since then makes it stale. The pending
        // flag also holds a second press while the record is re-read.
        submitPendingRef.current = true;
        let moved = false;
        try {
            moved = await tokenRecordChangedSince({
                messaging, chainId, tick: tokenTick, current: ownershipTokenInfo, keys: TOKEN_RECORD_GATE_KEYS,
            });
        } catch {
            moved = false;
        }
        if (moved) {
            submitPendingRef.current = false;
            setFormError(tokenRecordChangedMessage(tokenTick));
            return;
        }
        setFormError(null);
        if (singleEncode) {
            void openConfirmScreen();
            return;
        }
        submitPendingRef.current = false;
        setStage('review');
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting' || submitPendingRef.current) return;
        if (!fromAddress || !chainId) return;
        if (!isWatcherMode && !hw && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && hw && hwStatus !== 'available') return;

        submitPendingRef.current = true;
        setStage('submitting');
        setSubmitError(null);
        try {
            const action = saleAction;
            const params = saleParams;
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
                params,
                payFeeInNativeCoin: nativeFee.flag,
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            let r;
            if (isWatcherMode) {
                r = await messaging.buildActionPsbtRequest({
                    chainId,
                    from: base.from,
                    actionData: { action, params },
                    // FOLLOW-UP: the watcher lane does NOT go through
                    // `base`, so the fee mode threaded onto the submit path
                    // above never reached it. Selling a name is priced
                    // (GAS_SCHEDULE.OWNERSHIP_ESCROW), so a watcher-mode sale
                    // off Bitcoin composed a PSBT with no FEE_DESTINATION
                    // output, the user approved it, and the indexer then
                    // rejected the action "insufficient fee (native coin output
                    // required)" while this form reported the sale as open -
                    // the exact bug a later change fixed, surviving on the one lane
                    // its fix did not touch.
                    encoderOpts: {
                        payFeeInNativeCoin: nativeFee.flag,
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                });
            } else if (mechanism === 'dispenser') {
                r = hw
                    ? await messaging.dispenserActionHw({ ...base, signerId: fromAddress.signerId })
                    : await messaging.dispenserAction({ ...base, password });
            } else {
                r = hw
                    ? await messaging.orderActionHw({ ...base, signerId: fromAddress.signerId })
                    : await messaging.orderAction({ ...base, password });
            }
            setResult(r);
            setStage('done');
        } catch (err) {
            const bad = err?.name === 'InvalidPasswordError';
            // A native-fee refusal arrives as wire wording ("native-coin
            // fee pre-flight failed (dust): ...") which is not a sentence anyone
            // can act on. Now that this form has a native-fee lane it
            // needs the same mapping every other swept form uses.
            setSubmitError(bad ? 'Incorrect password.' : submitFailureMessage(err, {
                chainId,
                coinTicker, mandatory: nativeFee.mandatory, fallback: err?.message || 'Sign failed.',
            }));
            setStage('review');
            if (!isWatcherMode && !hw) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        } finally {
            submitPendingRef.current = false;
        }
    }

    function handleBuildAnother() {
        setResult(null);
        setSubmitError(null);
        setStage('form');
    }

    // Header title switches to "Review sale" once the user leaves the form stage.
    const headerTitle = (stage === 'review' || stage === 'submitting')
        ? 'Review Sale'
        : 'Sell Ownership';
    const header = (
        <PageHeader
            nested={stage === 'review' || stage === 'submitting'}
            onBack={stage === 'review'
                ? () => { setSubmitError(null); setStage('form'); }
                : onBack}
            backDisabled={stage === 'submitting'}
            title={headerTitle}
        />
    );
    const wrap = (children) => (
        <Screen
            variant={variant}
            header={header}
            restoreScroll={!(stage === 'review' || stage === 'submitting')}
        >
            {children}
        </Screen>
    );

    if (loadError) {
        return wrap(<ListPage><StatusMessage variant="error">{loadError}</StatusMessage></ListPage>);
    }
    if (!addressesByChain) {
        return wrap(<ListPage><p className={styles.hint}>Loading your addresses.</p></ListPage>);
    }

    if (stage === 'done') {
        const txid = result?.txid;
        if (result?.psbtHex && !txid) {
            return wrap(
                <ListPage><ResultScreen state="unsigned" result={result} onBuildAnother={handleBuildAnother} onDone={onBack} /></ListPage>,
            );
        }
        // A queued result is SIGNED and not broadcast: the confirm lane
        // resolves a transient broadcast failure that way, and "Name listed
        // for sale" would tell the user an irreversible sale is open when it
        // is not.
        if (result?.queued) {
            return wrap(
                <ListPage><ResultScreen state="signed-not-broadcast" onDone={onBack} what="ownership sale" unsaved={result.unsaved} /></ListPage>,
            );
        }
        return wrap(
            <ListPage>
                <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>Ownership listed for sale</p>
                {txid ? <p style={{ margin: '0 0 0.5rem' }}>Transaction: <code>{txid}</code></p> : null}
                <p className={styles.hint}>
                    Your {mechanism === 'dispenser' ? 'dispenser' : 'offer'} to sell ownership of {tokenTick} for {price} {wantLabel} is open.
                    {mechanism === 'dispenser'
                        ? ' A buyer can purchase it instantly at this price; close the dispenser to reclaim ownership.'
                        : ' Ownership is escrowed until a buyer matches; cancel before then to reclaim it.'}
                </p>
                <div className={styles.actions}>
                    <Button variant="success" icon={<Icon.CheckIcon />} onClick={onBack}>Done</Button>
                </div>
            </ListPage>,
        );
    }

    if (stage === 'review' || stage === 'submitting') {
        const mechanismLabel = mechanism === 'dispenser' ? 'Dispenser' : 'Exchange';
        const priceLabel = `${saleParams.GET_AMOUNT} ${wantLabel}`;
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
                decoded={legacyDecoded}
                chainLabel={descriptor?.displayName || chainId}
                screenVariant={variant}
                error={submitError}
                sourceAddress={fromAddress?.address}
                nativeTicker={coinTicker}
                credentials={<p className={styles.hint}>{t('common.watcherBuildsUnsigned')}</p>}
                credentialsReady
                summary={{
                    verb: t('components.confirmSummary.verbSellOwnership'),
                    ticker: String(saleParams.GIVE_TICK || '').toUpperCase(),
                    direction: 'none',
                    chainId,
                    address: fromAddress?.address,
                    facts: [
                        { label: 'Mechanism', value: mechanismLabel },
                        { label: 'Price', value: priceLabel },
                        ...(priceFiatText ? [{ label: 'Price value', value: priceFiatText }] : []),
                    ],
                    ...(!nativeFee.flag && quotedProtocolFee.known ? {
                        protocolFee: {
                            amount: quotedProtocolFee.free ? '0' : String(quotedProtocolFee.amount ?? ''),
                            ticker: 'XCHAIN',
                        },
                    } : {}),
                }}
                networkFee={feeEstimate?.coinAmount ? {
                    amount: String(feeEstimate.coinAmount), ticker: coinTicker, estimate: true,
                } : null}
            />
        );
    }

    // Confirm page, rendered in place of the form; form state stays intact
    // behind it, exactly as the picker screens below do.
    if (actionConfirm.open) {
        // The token whose ownership goes up for sale is the hero.
        const saleSummary = {
            verb: t('components.confirmSummary.verbSellOwnership'),
            ...(saleParams.GIVE_TICK ? { ticker: String(saleParams.GIVE_TICK).toUpperCase() } : {}),
            direction: 'none',
            chainId,
            address: fromAddress?.address,
        };
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                summary={saleSummary}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId}
                feeEstimate={feeEstimate}
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
                hwSignerInfo={hwSignerInfo}
                chainId={chainId}
                getSignerStatus={messaging.getSignerStatus}
                hintClassName={styles.hint}
            />
        );
    }

    if (sourcePickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="From Address"
                walletId={walletId}
                chainId={chainId}
                onChainChange={changeChain}
                onPick={(address) => {
                    const pickedChainId = pickerChainRef.current || chainId;
                    if (pickedChainId === chainId) {
                        pendingFromPickRef.current = null;
                    } else {
                        pendingFromPickRef.current = { chainId: pickedChainId, id: address.id };
                    }
                    setFromAddressId(address.id);
                    setSourcePickerOpen(false);
                }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    // The standard picker, limited to the names this wallet owns on the
    // network; picking one also moves From to the address that owns it.
    if (namePickerOpen) {
        const pickable = ownedNames === null ? null : [
            ...ownedNames.map((n) => ({ chainId, tick: n.tick })),
            ...(tokenTick && !ownedNames.some((n) => n.tick.toLowerCase() === tokenTick.toLowerCase())
                ? [{ chainId, tick: tokenTick }]
                : []),
        ];
        return (
            <TokenPicker
                purpose="send"
                walletId={walletId}
                title="Token"
                kindFilter="tokens"
                kindLocked
                rows={pickable}
                emptyTitle="No owned tokens"
                emptyBody="Tokens owned by this wallet on this network appear here."
                networkFilter={coinFromChainId(chainId)}
                chainIdFilter={chainId}
                onSelect={(sel) => {
                    const owned = ownedNames?.find((n) => n.tick === sel.tick);
                    setSelectedTick(String(sel.tick || ''));
                    if (owned) {
                        pendingFromPickRef.current = null;
                        setFromAddressId(owned.ownerAddressId);
                    }
                    setNamePickerOpen(false);
                }}
                onBack={() => setNamePickerOpen(false)}
            />
        );
    }

    if (tokenPickerOpen) {
        return (
            <TokenPicker
                purpose="receive"
                walletId={walletId}
                title="Get Paid In"
                networkFilter={coinFromChainId(chainId)}
                chainIdFilter={chainId}
                onSelect={(sel) => {
                    if (sel.chainId !== chainId) return;
                    // The network coin means native payment; anything else is a token.
                    if (sel.kind === 'native') {
                        setGetMode('coin');
                        setGetTick('');
                    } else {
                        setGetMode('token');
                        setGetTick(String(sel.tick || ''));
                    }
                    setTokenPickerOpen(false);
                }}
                onBack={() => setTokenPickerOpen(false)}
            />
        );
    }

    // One-line summaries for the closed sections.
    const mechanismName = mechanism === 'dispenser' ? 'Dispenser' : 'Exchange';
    const saleSummary = joinSummary(
        price.trim() ? `${price.trim()} ${wantLabel}` : wantLabel,
        `via ${mechanismName}`,
    ).replace(', via ', ' via ');
    return wrap(
        <FormFrame
            demoGuard={demoGuard}
            label="Sell Ownership"
            onSubmit={handleReview}
            inert={actionConfirm.composing ? '' : undefined}
            aria-busy={actionConfirm.composing ? 'true' : undefined}
            onChangeCapture={() => { if (formError) setFormError(null); }}
            status={validationError || formError || issuerEligibility.error ? (
                <>
                    {validationError ? (
                        <StatusMessage variant="error">{validationError}</StatusMessage>
                    ) : null}
                    {formError ? (
                        <StatusMessage variant="error">{formError}</StatusMessage>
                    ) : null}
                    {!formError && issuerEligibility.error ? (
                        <StatusMessage variant="error">{issuerEligibility.error}</StatusMessage>
                    ) : null}
                </>
            ) : null}
            action={(
                <FormAction
                    icon={<Icon.MarketIcon />}
                    loading={actionConfirm.composing}
                    disabled={issuerEligibility.pending || !!issuerEligibility.error || actionConfirm.composing}
                >
                    {actionConfirm.composing
                        ? 'Preparing Review…'
                        : 'List Ownership for Sale'}
                </FormAction>
            )}
            from={(
                // The standard From section (Network + From address), closed,
                // first. The network stays changeable.
                <FromSection
                    {...formSections.bind('from')}
                    revealKey={sectionReveal('from')}
                    chainId={chainId}
                    chainIds={addressesByChain ? Object.keys(addressesByChain) : [chainId]}
                    chainRegistry={chainRegistry}
                    onNetworkChange={changeChain}
                    networkHelp="The chain the ownership is listed for sale on. The token, your From address and the fee are all on this network."
                    address={fromAddress?.address}
                    onOpenPicker={() => setSourcePickerOpen(true)}
                    pickerLabel="Choose source address"
                    addressHelp="The address that owns this token and signs the sale listing."
                />
            )}
            fee={(
                // On LTC/DOGE the native-coin protocol fee is mandatory and the
                // toggle renders as a disclosure rather than a choice, which is
                // the same treatment the other ORDER/DISPENSER forms give it.
                <FeeSection
                    {...formSections.bind('fee')}
                    revealKey={sectionReveal('fee')}
                    chainId={chainId}
                    coinTicker={coinTicker}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={feeCustomEstimate}
                    fees={{
                        quote: protocolFeeQuote,
                        pending: protocolFeePending,
                        nativeFeeProps: nativeFee.toggleProps,
                    }}
                />
            )}
        >
            {/* The main section, open: how it sells and for what. */}
            <FormSection
                id="sale"
                title="Sale"
                icon={Icon.MarketIcon}
                {...formSections.bind('sale')}
                revealKey={sectionReveal('sale')}
                summary={saleSummary}
            >
            {/* The name being sold comes first: this name, this way, paid like this. */}
            <TokenField
                id="sell-name-token"
                label="Token"
                placeholder={ownedNames === null ? 'Loading tokens' : 'Select a token'}
                help="The token you are selling ownership of. Tap to choose among the tokens this wallet owns on this network."
                value={chainId && tokenTick ? { chainId, tick: tokenTick } : null}
                onOpenPicker={() => setNamePickerOpen(true)}
            />

            {/* "Sell via" is a dropdown carrying the menu's DEX and Dispensers icons. */}
            <IconSelect
                label="Sell via"
                help="Exchange posts an offer that a buyer matches, and you can cancel it before it matches. Dispenser sells the token's ownership at once to the first buyer who pays your price."
                size="md"
                value={mechanism}
                onChange={(value) => setMechanism(/** @type {'order' | 'dispenser'} */ (value))}
                options={[
                    { value: 'order', label: 'Exchange', sub: 'A buyer matches your offer', icon: <Icon.MarketIcon /> },
                    { value: 'dispenser', label: 'Dispenser', sub: 'First buyer at your price gets it', icon: <Icon.DollarIcon /> },
                ]}
            />

            {/* One Get paid in field; the picker offers this network's
                coin and every token on it. */}
            <TokenField
                label="Get paid in"
                placeholder={t('send.selectAsset')}
                help={`The coin or token a buyer pays for its ownership: ${coinTicker || 'this network\'s coin'} or any token on this network. The price below is an amount of it.`}
                value={chainId ? { chainId, tick: getMode === 'coin' ? (coinTicker || '') : getTick } : null}
                onOpenPicker={() => setTokenPickerOpen(true)}
            />

            <AmountField
                key={`${getMode}:${chainId}:${getTick}:${priceDivisibility ?? 'unknown'}`}
                label="Price"
                help={getMode === 'coin'
                    ? `The amount of ${coinTicker || 'native coin'} a buyer pays for this token's ownership.`
                    : `The amount of ${getTick || 'the selected token'} a buyer transfers for this token's ownership.`}
                amount={price}
                tick={getMode === 'coin' ? coinTicker : getTick}
                divisibility={priceDivisibility}
                error={pricePrecisionError || undefined}
                onAmountFieldChange={setPrice}
            />
            {/* What the asking price is worth in the display currency; absent
                when nothing can price the payment asset. */}
            {priceFiatText ? (
                <p className={styles.hint} data-testid="sell-name-price-fiat">{priceFiatText}</p>
            ) : null}
            </FormSection>

            {/* The optional terms are closed standard sections; their fields
                carry no Optional tags of their own. */}
            <FormSection
                id="expiry"
                title="Expiration"
                icon={Icon.ClockIcon}
                optional
                {...formSections.bind('expiry')}
                revealKey={sectionReveal('expiry')}
                summary={expiration.trim() ? `After ${expiration.trim()} blocks` : 'Open until matched'}
            >
            <Input
                label="Expires after (blocks)"
                help="How many blocks this listing stays open. Leave it blank to keep the listing open until it is matched or cancelled."
                type="text"
                inputMode="numeric"
                value={expiration}
                onChange={(e) => setExpiration(e.target.value)}
                autoComplete="off"
            />
            </FormSection>

            {/* Memo holds only the memo: the section title names the field
                and carries its count. */}
            <MemoSection
                {...formSections.bind('memo')}
                revealKey={sectionReveal('memo')}
                maxLength={MAX_MEMO_LENGTH}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
            />
        </FormFrame>,
    );
}

function priceReadyForFiat(price) {
    return /^[0-9]+(\.[0-9]+)?$/.test(String(price).trim());
}

function DetailRow({ label, value }) {
    return (
        <>
            <dt className={styles.detailsLabel}>{label}</dt>
            <dd className={styles.detailsValue}>{value}</dd>
        </>
    );
}
