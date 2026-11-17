// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { t } from '../../i18n/index.js';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AddressField, AddressText, Button, ChainBadge, CopyButton, FormNotice, FormPage, Icon, InfoTip, ListPage, PageHeader, Screen, SectionHeader, StatusMessage, useFormErrors } from '@xchain-wallet/core/ui';
import { ExpirationFields, expirationParam, expirationWithinFreePeriod } from '../components/expirationChoice.jsx';
// Cross-Chain Order renders through the shared Give/Get standard (Quick and
// Full views of one state), with Receive at beside the get side. The give
// network sits in From; the get token decides the get network.
import {
    GiveGetQuick,
    OwnershipToggle,
    RateLine,
    useGiveGetView,
    ViewSwitch,
} from '../components/giveGet/index.js';
// The Wallet Form Standard frame (From, Cross-Chain Order, Ownership, Order Terms, Network fee, action).
import { FeeSection, FormAction, FormFrame, FormSection, FromSection, MemoSection, joinSummary } from '../components/formStandard/index.js';
import { withAdvancedOptions } from '../components/formStandard/advancedOptions.js';
// The "Use typed name" option Create order's Asset picker offers, so
// a ^ID reference (or a ticker the list does not hold) can be the Get token.
import { TypedNameContext, TypedNameListPage } from './CreateOrderForm.jsx';
import { formatLocalDateTime } from '../utils/dateTime.js';
import { decoder as decoderLib, registry as registryLib } from '@xchain-wallet/core';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/crossChainOrder.js';
import '../../i18n/locales/en/crossChainSwap.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { useSettings } from '../hooks/useSettings.js';
import { useConfirmAction } from '../hooks/useConfirmAction.js';
import { prebuiltPsbtFromComposed } from '../../flows/prebuiltPsbtFromComposed.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { ConfirmActionModal } from '../components/ConfirmActionModal.jsx';
import { resolvePreflightPrivacy } from '../../schemas/settings.js';
import { humanizeError } from '../utils/humanizeError.js';
import { SignCredentials } from '../components/SignCredentials.jsx';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { useActionForm } from '../hooks/useActionForm.js';
import { useGetChainAddress } from '../hooks/useGetChainAddress.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { useProtocolFeeQuote } from '../hooks/useProtocolFeeQuote.js';
import { useTickBalance } from '../hooks/useTickBalance.js';
import { AmountField } from '../components/AmountField.jsx';
import { TokenField } from '../components/TokenField.jsx';
import { TokenPicker } from './TokenPicker.jsx';
import { MessagingContext } from '../MessagingContext.js';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
// divideDecimalStrings feeds the rate line Swap also shows.
import { compareDecimalStrings, divideDecimalStrings, formatWithThousands, tokenAmountPrecisionError } from '../utils/amountFormat.js';
import { addressValidationError } from '../utils/addressValidation.js';
import { tickerReferenceError } from '../utils/tickerGrammar.js';
import { orderGiveParts } from '../utils/confirmSummaryParts.js';
import { useTokenInfo } from '../hooks/useTokenInfo.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { MAX_MEMO_LENGTH, memoCharacterError, memoLengthError } from '../utils/memoLimit.js';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { customFeeReviewStop } from '../../flows/feeEstimate.js';
import { normalizeProtocolFee } from '../../flows/protocolFeeRow.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();
const NO_ACKNOWLEDGMENTS = new Set();

// descriptor.coin is long-form; ORDER serializes the short-form ticker in
// GIVE_COIN / GET_COIN.
const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

// The indexer compares ORDER EXPIRATION as a wall-clock Unix timestamp, not
// a block height. 'default' (3 months) sends none; every other choice needs
// a valid future Expires.
function expirationRefusal(mode, input, nowSec = Math.floor(Date.now() / 1000)) {
    if (mode === 'default') return null;
    if (!String(input || '').trim()) return 'Pick an expiration date and time, or choose a common term.';
    const unix = Number(expirationParam(mode, input));
    if (!unix || unix <= nowSec) return 'Expiration must be a future date and time.';
    return null;
}

const isPlainPositive = (v) => /^\d+(\.\d+)?$/.test(String(v).trim())
    && compareDecimalStrings(String(v).trim(), '0') === 1;

/**
 * Cross-chain ORDER authoring surface: GIVE_COIN != GET_COIN.
 *
 * The order is signed and broadcast on the give chain, where the GIVE side
 * is escrowed. It is not matched by that chain's DEX: the validator
 * federation matches it on a price-time book against orders resting on the
 * get chain, may fill it partially across several matches, and settles
 * each fill from escrow on both chains (CROSS_SETTLE), with no per-trade
 * transaction. GET_ADDRESS is mandatory here because the counterparty's
 * leg is released to it on the get chain.
 *
 * Token-only on both sides: a native-coin side has no escrow the
 * federation could release, so the same-chain CoinPay lane does not apply.
 * Same-chain orders (native sides, allow/block lists) stay on
 * CreateOrderForm.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 * @param {string} [props.initialChainId]
 * @param {string} [props.initialFromAddress]
 * @param {() => void} [props.onManageOrders]   optional deep-link to My Orders
 */
export function CrossChainOrderForm({ walletId, onBack, initialChainId, initialFromAddress, onManageOrders }) {
    const { messaging, shell, locale } = useMessaging();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const variant = screenVariantFor(shell);

    // The give chain is the one chain this form signs on; useActionForm owns
    // it, the source address on it and the three-way signer dispatch.
    const {
        addressesByChain,
        loadError,
        chainId: giveChainId,
        setChainId: setGiveChainId,
        chainsWithAddresses,
        fromAddress,
        setFromAddressId,
        descriptor: giveDescriptor,
        signerReady,
        isWatcherMode,
        isHwSource,
        hwStatus,
        onHwStatusChange,
        buildFrom,
        submit,
    } = useActionForm({
        walletId,
        action: 'ORDER',
        submitMethods: { hw: 'orderActionHw', software: 'orderAction' },
        initialChainId,
        initialFromAddress,
        noAddressMessage: 'No addresses on any network yet. Use Receive to generate addresses on at least two networks before creating a cross-chain order.',
    });

    const [getChainId, setGetChainId] = useState(/** @type {string | null} */ (null));
    const getDescriptor = getChainId ? chainRegistry.get(getChainId) : null;
    const giveCoinTicker = giveDescriptor ? (PROTOCOL_COIN_TICKER[giveDescriptor.coin] || '') : '';
    const getCoinTicker = getDescriptor ? (PROTOCOL_COIN_TICKER[getDescriptor.coin] || '') : '';

    // Default the get chain to the first chain whose coin differs from the
    // give chain's, once the address load has settled.
    useEffect(() => {
        if (getChainId || !giveChainId || chainsWithAddresses.length === 0) return;
        const other = chainsWithAddresses.find((cid) => {
            const d = chainRegistry.get(cid);
            return d && d.coin !== giveDescriptor?.coin;
        });
        if (other) setGetChainId(other);
    }, [giveChainId, giveDescriptor, chainsWithAddresses, getChainId]);

    const { getAddress, setGetAddress, resetGetAddress } = useGetChainAddress({ messaging, walletId, getChainId });

    const [giveTick, setGiveTick] = useState('');
    const [giveAmount, setGiveAmount] = useState('');
    const [giveOwnership, setGiveOwnership] = useState(false);
    const [getTick, setGetTick] = useState('');
    const [getAmount, setGetAmount] = useState('');
    const [getOwnership, setGetOwnership] = useState(false);
    // 'default' is 3 months; the presets fill expInput, which Expires shows.
    const [expMode, setExpMode] = useState(/** @type {'default' | '6m' | '9m' | '1y' | 'custom'} */ ('default'));
    const [expInput, setExpInput] = useState('');
    const [memo, setMemo] = useState('');
    const [password, setPassword] = useState('');
    const [givePickerOpen, setGivePickerOpen] = useState(false);
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    // The Quick card's get-token chip and Receive at book open these
    // pages; the Full view keeps the typed Get token and Receive at fields.
    const [getPickerOpen, setGetPickerOpen] = useState(false);
    const [receivePickerOpen, setReceivePickerOpen] = useState(false);
    // The Quick | Full view and the section open state live here, above every
    // early return, so a picker page or the confirm screen never resets them.
    // Only the Cross-Chain Order section starts open; the last view is remembered.
    const giveGetView = useGiveGetView('crossChainOrder', {
        sections: { from: false, order: true, ownership: false, options: false, memo: false, fee: false },
    });
    // Counts review attempts, so a section holding an error reopens on
    // every attempt even after the user closed it (the standard's revealKey).
    const [reviewAttempt, setReviewAttempt] = useState(0);
    // What the Get token picker's search box holds, for its
    // "Use typed name" option (a ^ID reference or an unlisted ticker).
    const [getTypedQuery, setGetTypedQuery] = useState('');

    const giveBalance = useTickBalance({
        messaging,
        walletId,
        chainId: giveChainId,
        address: fromAddress?.address,
        tick: giveTick,
    });
    const giveTokenInfo = useTokenInfo({
        chainId: giveChainId,
        tick: giveTick,
        skip: giveOwnership || !giveTick.trim(),
    });
    const getTokenInfo = useTokenInfo({
        chainId: getChainId,
        tick: getTick,
        skip: getOwnership || !getTick.trim(),
    });

    const givePickerMessaging = useMemo(() => {
        const sourceAddress = fromAddress?.address;
        if (!giveChainId || !sourceAddress) return messaging;
        // The give picker lists every network (the picked asset sets
        // the give network); on the current give network it still lists only
        // what the From address holds, since that address escrows the give side.
        return new Proxy(messaging, {
            get(target, property, receiver) {
                if (property === 'getAddressesByChain') {
                    return async (...args) => {
                        const all = await target.getAddressesByChain(...args);
                        return { ...(all || {}), [giveChainId]: [fromAddress] };
                    };
                }
                if (property === 'getWalletBalances') {
                    return async (...args) => {
                        const balances = await target.getWalletBalances(...args);
                        return {
                            ...(balances || {}),
                            [giveChainId]: (balances?.[giveChainId] || [])
                                .filter((entry) => entry?.address === sourceAddress),
                        };
                    };
                }
                const value = Reflect.get(target, property, receiver);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        });
    }, [messaging, giveChainId, fromAddress]);

    // The protocol fee is paid on the give chain, the chain that is signed.
    const nativeFee = useNativeFee(giveCoinTicker);
    const [feePick, setFeePick] = useState(
        /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: 'normal' }),
    );
    const feeTiers = useMemo(() => estimateNativeSendFeeTiers({ chainId: giveChainId, chainRegistry }), [giveChainId]);
    const feeCustomEstimate = useMemo(
        () => (feePick.mode === 'custom' ? customFeeEstimate({ chainId: giveChainId, chainRegistry, rate: Number(feePick.customRate) || 0 }) : null),
        [giveChainId, feePick],
    );
    const feeEstimate = feePick.mode === 'custom'
        ? feeCustomEstimate
        : (feeTiers ? feeTiers[feePick.mode] : estimateNativeSendFee({ chainId: giveChainId, chainRegistry, speed: feePick.mode }));
    const feePerKb = (feeEstimate && feeEstimate.unit && Number.isFinite(feeEstimate.rateValue) && feeEstimate.rateValue > 0)
        ? displayRateToSettingsCustom(feeEstimate.unit, feeEstimate.rateValue)
        : null;
    const [stage, setStage] = useState(/** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'));
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const formErrors = useFormErrors();
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const submitInFlightRef = useRef(false);

    const { settings } = useSettings();
    const confirmAction = useConfirmAction();
    const singleEncode = !isWatcherMode;
    const CONFIRM_MODAL_PHASES = ['preflighting', 'ready', 'signing', 'rechecking'];
    const confirmModalOpen = CONFIRM_MODAL_PHASES.includes(confirmAction.phase);
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;

    useEffect(() => {
        if (stage === 'review') setTimeout(() => passwordRef.current?.focus(), 0);
    }, [stage]);

    // Give and get name different coins; GET_ADDRESS is required because the
    // fill is released on the get chain, where the source address does not
    // exist.
    const actionParams = useMemo(() => {
        /** @type {Record<string, string>} */
        const p = { VERSION: '0', GIVE_COIN: giveCoinTicker, GIVE_TICK: giveTick.trim().toUpperCase() };
        if (giveOwnership) p.GIVE_OWNERSHIP = '1'; else p.GIVE_AMOUNT = giveAmount.trim();
        p.GET_COIN = getCoinTicker;
        p.GET_TICK = getTick.trim().toUpperCase();
        if (getOwnership) p.GET_OWNERSHIP = '1'; else p.GET_AMOUNT = getAmount.trim();
        p.GET_ADDRESS = getAddress.trim();
        const expiration = expirationParam(expMode, expInput);
        if (expiration) p.EXPIRATION = expiration;
        if (memo.trim()) p.MEMO = memo.trim();
        return p;
    }, [giveCoinTicker, giveTick, giveAmount, giveOwnership, getCoinTicker, getTick, getAmount, getOwnership, getAddress, expMode, expInput, memo]);

    const receiveAddressError = useMemo(
        () => (getAddress.trim() ? addressValidationError(getAddress, getDescriptor) : null),
        [getAddress, getDescriptor],
    );

    const validationError = useMemo(() => {
        if (!giveCoinTicker || !getCoinTicker) return null;
        if (giveCoinTicker === getCoinTicker) {
            return 'Give and get networks must differ. For a same-chain order use Create order.';
        }
        if (giveTick && giveTick.trim().toUpperCase() === giveCoinTicker) {
            return `A cross-chain order cannot give native ${giveCoinTicker}. Pick a token to offer.`;
        }
        if (getTick && getTick.trim().toUpperCase() === getCoinTicker) {
            return `A cross-chain order cannot get native ${getCoinTicker}; ask for a token on the get network.`;
        }
        if (giveTick.trim()) {
            const tickError = tickerReferenceError(giveTick, { noun: 'Give token', allowRef: true });
            if (tickError) return tickError;
        }
        if (getTick.trim()) {
            const tickError = tickerReferenceError(getTick, { noun: 'Get token', allowRef: true });
            if (tickError) return tickError;
        }
        if (!giveOwnership && giveAmount) {
            if (!isPlainPositive(giveAmount)) return 'Give amount must be a positive decimal number.';
            const precisionError = tokenAmountPrecisionError(giveAmount, {
                divisibility: giveTokenInfo?.divisibility,
                tick: giveTick,
                noun: 'Give amount',
            });
            if (precisionError) return precisionError;
            if (giveBalance !== null && compareDecimalStrings(giveAmount, giveBalance) === 1) {
                return `Give amount is above your available ${giveTick.trim().toUpperCase()} balance.`;
            }
        }
        if (!getOwnership && getAmount) {
            if (!isPlainPositive(getAmount)) return 'Get amount must be a positive decimal number.';
            const precisionError = tokenAmountPrecisionError(getAmount, {
                divisibility: getTokenInfo?.divisibility,
                tick: getTick,
                noun: 'Get amount',
            });
            if (precisionError) return precisionError;
        }
        if (receiveAddressError) return receiveAddressError;
        if (memo.includes('|') || memo.includes(';')) return 'Memo cannot contain "|" or ";".';
        const memoError = memoLengthError(memo.trim()) || memoCharacterError(memo.trim());
        if (memoError) return memoError;
        return null;
    }, [giveCoinTicker, getCoinTicker, giveTick, getTick, getDescriptor, getChainId,
        giveOwnership, giveAmount, giveTokenInfo?.divisibility, giveBalance,
        getOwnership, getAmount, getTokenInfo?.divisibility, receiveAddressError, memo]);

    const missingRequiredTerm = !giveTick.trim() || (!giveOwnership && !giveAmount)
        || !getTick.trim() || (!getOwnership && !getAmount) || !getAddress.trim();
    const quoteActionData = useMemo(() => {
        if (!giveChainId || !fromAddress || !getChainId || missingRequiredTerm
            || validationError || expirationRefusal(expMode, expInput)) return null;
        return { action: 'ORDER', params: actionParams };
    }, [actionParams, expInput, expMode, fromAddress, getChainId, giveChainId,
        missingRequiredTerm, validationError]);
    const { quote: protocolFeeQuote, pending: protocolFeePending, waiting: protocolFeeWaiting } = useProtocolFeeQuote({
        messaging,
        chainId: giveChainId,
        source: fromAddress?.address,
        actionData: quoteActionData,
    });
    const legacyDecoded = useMemo(() => (
        stage === 'review' || stage === 'submitting'
            ? decoderLib.decodeAction({ action: 'ORDER', params: actionParams, chainId: giveChainId, chainRegistry })
            : null
    ), [actionParams, giveChainId, stage]);
    const quotedProtocolFee = normalizeProtocolFee(protocolFeeQuote);
    const legacyComposed = legacyDecoded ? {
        action: 'ORDER',
        chainId: giveChainId,
        decoded: legacyDecoded,
        quote: protocolFeeQuote,
        protocolFeeKnownFree: quotedProtocolFee.known && quotedProtocolFee.free,
    } : null;

    function guardBeforeSign() {
        const expRefusal = expirationRefusal(expMode, expInput);
        const m = memo.trim();
        const memoError = memoLengthError(m);
        const validationField = /^Give amount/i.test(validationError || '')
            ? 'cross-chain-order-give-amount'
            : /^Give|cannot give/i.test(validationError || '')
                ? 'cross-chain-order-give-token'
                : /^Get amount/i.test(validationError || '')
                    ? 'cross-chain-order-get-amount'
                    : /^Get|cannot get|networks must differ/i.test(validationError || '')
                        ? 'cross-chain-order-get-token'
                        : /address/i.test(validationError || '')
                            ? 'cross-chain-order-receive'
                            : /Memo/i.test(validationError || '')
                                ? 'xorder-memo'
                                : 'form:order';
        const problems = {
            'cross-chain-order-from': (!giveChainId || !fromAddress) ? 'Pick a source address first.' : null,
            'cross-chain-order-give-token': !giveTick.trim() ? 'Enter the ticker to give.' : null,
            'cross-chain-order-give-amount': !giveOwnership && !isPlainPositive(giveAmount) ? 'Enter a positive amount to give.' : null,
            'cross-chain-order-get-token': !getChainId
                ? 'Pick the network where you want to get assets.'
                : (!getTick.trim() ? 'Enter the ticker to get.' : null),
            'cross-chain-order-get-amount': !getOwnership && !isPlainPositive(getAmount) ? 'Enter a positive amount to get.' : null,
            'cross-chain-order-receive': !getAddress.trim()
                ? `Receive address on ${getDescriptor?.displayName || 'the get network'} is required.`
                : null,
            'xorder-expires': expRefusal,
            'xorder-memo': m.includes('|') || m.includes(';') ? 'Memo cannot contain "|" or ";".' : memoError,
        };
        if (validationError && !problems[validationField]) problems[validationField] = validationError;
        return formErrors.validate(problems);
    }

    const extraBaseFor = (composed) => ({
        payFeeInNativeCoin: nativeFee.flag,
        ...(feePerKb != null ? { feePerKb } : {}),
        // The shared mapping, envelope and deferred outputs included.
        ...(composed ? { prebuiltPsbt: prebuiltPsbtFromComposed(composed) } : {}),
    });

    async function openConfirmModal() {
        if (submitInFlightRef.current) return;
        submitInFlightRef.current = true;
        try {
            const from = buildFrom();
            if (!giveChainId || !from) return;
            setSubmitError(null);
            const res = await confirmAction.confirm({
                chainId: giveChainId,
                source: from.address,
                preflightOpts: { mode: resolvePreflightPrivacy(settings) === 'local' ? 'local' : 'report' },
                compose: () => messaging.composeForConfirm(withAdvancedOptions({
                    walletId, chainId: giveChainId, from,
                    actionData: { action: 'ORDER', params: actionParams },
                    // The opt-in must reach COMPOSE so the FEE_DESTINATION
                    // output sits inside the PSBT the user approves.
                    encoderOpts: {
                        payFeeInNativeCoin: nativeFee.flag,
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                })),
                preflight: (o) => messaging.preflight({ chainId: giveChainId, ...o }),
                // §4.6: the input-liveness half of the Approve-time re-check,
                // the same one useActionConfirmFlow.run gives every migrated form.
                checkInputs: (psbtHex) => messaging.checkInputLiveness({ chainId: giveChainId, psbtHex }),
                releaseEncoderInputs: (token) => messaging.releaseEncoderInputs({ token }),
                // §4.7: reserve the debited balance on the host-shared ledger,
                // so two windows cannot both approve against the same balance.
                reservationLedger: {
                    reserve: (e) => messaging.reserve(e),
                    release: (id) => messaging.releaseReservation({ id }),
                },
                // Re-price the native-coin protocol fee at Approve: the amount
                // consensus requires moves with the coin price while the
                // confirm screen sits open.
                requoteNativeFee: ({ actionString, source }) => messaging.requoteNativeFee({
                    chainId: giveChainId, actionString, source,
                }),
                onApprove: (_creds, composed) => {
                    if (actionParams.EXPIRATION
                        && Number(actionParams.EXPIRATION) <= Math.floor(Date.now() / 1000)) {
                        const error = new Error('Expiration must be a future date and time.');
                        error.code = 'EXPIRATION_STALE';
                        throw error;
                    }
                    return submit({
                        params: actionParams,
                        password: passwordValueRef.current,
                        extraBase: extraBaseFor(composed),
                    });
                },
            });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            if (err && (err.reason === 'user-rejected' || err.name === 'UserRejectedError')) return;
            if (err?.code !== 'EXPIRATION_STALE') {
                console.error('Cross-chain order (confirm) failed:', err); // eslint-disable-line no-console
            }
            setFormError(err?.code === 'EXPIRATION_STALE'
                ? err.message
                : submitFailureMessage(err, {
                    chainId: giveChainId,
                    coinTicker: giveCoinTicker,
                    mandatory: nativeFee.mandatory,
                    fallback: humanizeError(err, 'order').message,
                }));
        } finally {
            submitInFlightRef.current = false;
        }
    }

    // Each review attempt bumps the counter; every section holding an
    // error reopens through its own revealKey.
    function handleReview(event) {
        event.preventDefault();
        setReviewAttempt((n) => n + 1);
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        if (feeStop && !formErrors.validate({ 'form:cross-chain-order-fee': feeStop.formError })) return;
        if (!guardBeforeSign()) return;
        setFormError(null);
        if (singleEncode) { void openConfirmModal(); return; }
        setStage('review');
    }

    const hwSignerInfo = useSignerInfo({ walletId, signerId: isHwSource ? fromAddress?.signerId : null });

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting' || submitInFlightRef.current) return;
        if (!guardBeforeSign()) {
            setSubmitError(null);
            setStage('form');
            return;
        }
        if (!isWatcherMode && !isHwSource && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && isHwSource && hwStatus !== 'available') return;
        submitInFlightRef.current = true;
        setStage('submitting');
        setSubmitError(null);
        try {
            const res = await submit({
                params: actionParams,
                password,
                extraBase: extraBaseFor(null),
                encoderOpts: {
                    payFeeInNativeCoin: nativeFee.flag,
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
            });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(isBadPassword ? 'Incorrect password.' : submitFailureMessage(err, {
                chainId: giveChainId,
                coinTicker: giveCoinTicker, mandatory: nativeFee.mandatory, fallback: err?.message || 'Order failed.',
            }));
            setStage('review');
            if (!isWatcherMode && !isHwSource) { passwordRef.current?.focus(); passwordRef.current?.select(); }
        } finally {
            submitInFlightRef.current = false;
        }
    }

    function clearGiveAsset() {
        setGiveTick('');
        setGiveAmount('');
        setGiveOwnership(false);
    }

    function clearGetAsset() {
        setGetTick('');
        setGetAmount('');
        setGetOwnership(false);
    }

    function handleGiveChainChange(nextChainId) {
        if (nextChainId === giveChainId) return;
        setGiveChainId(nextChainId);
        clearGiveAsset();
    }

    function handleGetChainChange(nextChainId) {
        if (nextChainId === getChainId) return;
        setGetChainId(nextChainId);
        resetGetAddress();
        clearGetAsset();
    }

    function handleBuildAnother() { setResult(null); setSubmitError(null); setStage('form'); }

    function handleBack() {
        if (stage === 'review') {
            setSubmitError(null);
            setStage('form');
            return;
        }
        onBack();
    }

    const header = (
        <PageHeader
            nested={stage === 'review' || stage === 'submitting'}
            onBack={handleBack}
            backDisabled={stage === 'submitting'}
            title={stage === 'review' || stage === 'submitting' ? 'Review Order' : 'Cross-Chain Order'}
            /* No My orders button on the form: the standard allows one action,
               and My orders has its own page and nav entry. The broadcast panel
               still links to it. */
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header} restoreScroll={!(stage === 'review' || stage === 'submitting')}>
            {children}
        </Screen>
    );

    if (loadError) return wrap(<ListPage><StatusMessage variant="error">{loadError}</StatusMessage></ListPage>);
    if (!addressesByChain || !giveChainId) return wrap(<ListPage><p className={styles.hint}>Loading…</p></ListPage>);

    const chainIds = chainsWithAddresses.length ? chainsWithAddresses : [giveChainId];
    const distinctCoins = new Set(chainIds.map((cid) => chainRegistry.get(cid)?.coin).filter(Boolean));
    if (distinctCoins.size < 2) {
        return wrap(
            <ListPage>
                <StatusMessage variant="error">
                    A cross-chain order needs addresses on two different networks. Use Receive on a second network and try again.
                </StatusMessage>
            </ListPage>,
        );
    }

    if (stage === 'done') {
        const txid = result?.txid || result?.broadcast?.txid;
        if (result?.psbtHex && !txid) {
            return wrap(<ListPage><ResultScreen state="unsigned" result={result} onBuildAnother={handleBuildAnother} onDone={onBack} /></ListPage>);
        }
        if (result?.queued) {
            return wrap(<ListPage><ResultScreen state="signed-not-broadcast" onDone={onBack} what="cross-chain order" unsaved={result.unsaved} /></ListPage>);
        }
        return wrap(
            <ListPage>
                <SectionHeader title="Cross-chain order broadcast" />
                {txid ? (
                    <>
                        <p className={styles.successLabel}>{t('crossChainSwap.success.giveTxLabel')}</p>
                        <code className={styles.txid}>{txid}</code>
                        <CopyButton value={txid} label="Copy Transaction ID" />
                    </>
                ) : <p className={styles.hint}>Broadcast complete.</p>}
                <p className={styles.hint}>{t('crossChainOrder.success.hint', { tick: giveTick.trim().toUpperCase() })}</p>
                <div className={styles.actions}>
                    {onManageOrders ? <Button variant="secondary" icon={<Icon.MarketIcon />} onClick={onManageOrders}>My Orders</Button> : null}
                    <Button variant="success" icon={<Icon.CheckIcon />} onClick={onBack}>Done</Button>
                </div>
            </ListPage>,
        );
    }

    if (confirmModalOpen) {
        return (
            <ActionConfirmScreen
                confirmAction={confirmAction}
                summary={{
                    verb: t('components.confirmSummary.verbPlaceOrder'),
                    ...orderGiveParts(actionParams, giveCoinTicker),
                    chainId: giveChainId,
                    address: fromAddress?.address,
                }}
                screenVariant={variant}
                chainLabel={giveDescriptor?.displayName || giveChainId}
                feeEstimate={feeEstimate}
                feeText={feeEstimate?.coinAmount ? `Network fee: ${feeEstimate.coinAmount} ${giveCoinTicker}`.trim() : undefined}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hintClassName={styles.hint}
                credentialsReady={isHwSource ? hwStatus === 'available' : (signerReady || password.length > 0)}
                hwSource={isHwSource ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                hwSignerInfo={hwSignerInfo}
                chainId={giveChainId}
                getSignerStatus={messaging.getSignerStatus}
            />
        );
    }

    if (sourcePickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="From Address"
                walletId={walletId}
                chainId={giveChainId}
                // A picked give token holds From to its network, as on the
                // Network field; before that, an address on another chain
                // moves the give Network there first. The get network stays
                // apart from it, so its addresses cannot be picked here.
                lockNetwork={Boolean(giveTick.trim())}
                onChainChange={handleGiveChainChange}
                unavailableReason={(_address, cid) => (cid && cid === getChainId
                    ? 'This address is on the Get network. Give and Get use different networks.'
                    : null)}
                onPick={(a) => { setFromAddressId(a.id); setSourcePickerOpen(false); }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    if (givePickerOpen) {
        return (
            <MessagingContext.Provider value={{ messaging: givePickerMessaging, shell, locale }}>
                <TokenPicker
                    purpose="send"
                    walletId={walletId}
                    title="Select Give Token"
                    kindFilter="tokens"
                    kindLocked
                    onSelect={(selection) => {
                        // The picked token's chain becomes the give network.
                        if (selection.chainId && selection.chainId !== giveChainId) handleGiveChainChange(selection.chainId);
                        setGiveTick(String(selection.tick || '').toUpperCase());
                        setGivePickerOpen(false);
                    }}
                    onBack={() => setGivePickerOpen(false)}
                />
            </MessagingContext.Provider>
        );
    }

    // The Get token picker page, in both views. Receive discovery lists tokens
    // the wallet has never held; a ^123 reference or unlisted ticker is typed
    // and taken with "Use typed name". A typed name names no chain, so it is
    // used on the current get network.
    if (getPickerOpen) {
        const pickGetTick = (tick) => {
            const nextTick = String(tick || '').trim().toUpperCase();
            if (nextTick !== getTick) setGetAmount('');
            setGetTick(nextTick);
            setGetTypedQuery('');
            setGetPickerOpen(false);
        };
        return (
            <TypedNameContext.Provider value={{ query: getTypedQuery, onUse: pickGetTick }}>
                <TokenPicker
                    purpose="receive"
                    walletId={walletId}
                    title="Select Get Token"
                    kindFilter="tokens"
                    kindLocked
                    tokenQuery={getTypedQuery}
                    onTokenQueryChange={setGetTypedQuery}
                    listPageComponent={TypedNameListPage}
                    onSelect={(selection) => {
                        // Lists every network; the picked token's chain becomes the get network.
                        if (selection.chainId && selection.chainId !== getChainId) handleGetChainChange(selection.chainId);
                        pickGetTick(selection.tick);
                    }}
                    onBack={() => { setGetTypedQuery(''); setGetPickerOpen(false); }}
                />
            </TypedNameContext.Provider>
        );
    }

    // The Quick Receive at book picks one of the wallet's own
    // addresses on the get chain; an outside address is typed in Full.
    if (receivePickerOpen && getChainId) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="Receive At"
                walletId={walletId}
                chainId={getChainId}
                lockNetwork
                onPick={(a) => {
                    setGetAddress(a.address);
                    setReceivePickerOpen(false);
                    setFormError(null);
                }}
                onBack={() => setReceivePickerOpen(false)}
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
                decoded={legacyDecoded}
                chainLabel={giveDescriptor?.displayName || giveChainId}
                screenVariant={variant}
                error={submitError}
                sourceAddress={fromAddress?.address}
                nativeTicker={giveCoinTicker}
                credentials={<p className={styles.hint}>{t('common.watcherBuildsUnsigned')}</p>}
                credentialsReady
                summary={{
                    verb: t('components.confirmSummary.verbPlaceOrder'),
                    ...orderGiveParts(actionParams, giveCoinTicker),
                    chainId: giveChainId,
                    address: fromAddress?.address,
                    ...(!nativeFee.flag && quotedProtocolFee.known ? {
                        protocolFee: {
                            amount: quotedProtocolFee.free ? '0' : String(quotedProtocolFee.amount ?? ''),
                            ticker: 'XCHAIN',
                        },
                    } : {}),
                }}
                networkFee={feeEstimate?.coinAmount ? {
                    amount: String(feeEstimate.coinAmount), ticker: giveCoinTicker, estimate: true,
                } : null}
            />
        );
    }

    // The same digits-only rule for every amount input, Quick or Full.
    const amountInput = (setter) => (rawValue) => {
        const stripped = String(rawValue).replace(/,/g, '');
        if (stripped !== '' && !/^\d*\.?\d*$/.test(stripped)) return;
        setter(stripped);
    };

    // The flip button swaps the whole side, network included. Receive at
    // re-resolves on the new get chain, since an address on the old one is
    // not valid there.
    function flipSides() {
        if (!getChainId || !giveChainId) return;
        setGiveChainId(getChainId);
        setGetChainId(giveChainId);
        resetGetAddress();
        setGiveTick(getTick);
        setGetTick(giveTick);
        setGiveAmount(getAmount);
        setGetAmount(giveAmount);
        setGiveOwnership(getOwnership);
        setGetOwnership(giveOwnership);
        setFormError(null);
    }

    const giveTickUpper = giveTick.trim().toUpperCase();
    const getTickUpper = getTick.trim().toUpperCase();
    const giveBalanceText = giveBalance != null && giveTick.trim()
        ? `${formatWithThousands(giveBalance)} ${giveTickUpper} available`
        : null;
    const onGiveMax = giveBalance && Number(giveBalance) > 0
        ? () => setGiveAmount(giveBalance)
        : undefined;

    // The rate line Swap shows, from the two amounts as typed.
    const rate = !giveOwnership && !getOwnership && isPlainPositive(giveAmount) && isPlainPositive(getAmount)
        ? divideDecimalStrings(getAmount, giveAmount, 8)
        : null;
    const displayedRate = rate === '0' ? '< 0.00000001' : rate;
    const rateText = displayedRate && giveTickUpper && getTickUpper
        ? `1 ${giveTickUpper} = ${displayedRate} ${getTickUpper}`
        : 'Enter both amounts to see the rate';
    const rateLine = <RateLine text={rateText} />;

    // Order Terms reads the expiry: "3 months" or "Expires <time>".
    const termsParts = [];
    const expParam = expirationParam(expMode, expInput);
    if (expMode === 'default') termsParts.push('3 months');
    else termsParts.push(expParam ? `Expires ${formatLocalDateTime(Number(expParam))}` : 'Custom expiry');
    // The standard's summaries join their parts with ", ".
    const termsSummary = joinSummary(...termsParts);

    const sideSummary = (tick, amount, ownership) => {
        const upper = tick.trim().toUpperCase();
        if (!upper) return 'No token yet';
        if (ownership) return `Ownership of ${upper}`;
        return amount ? `${formatWithThousands(amount)} ${upper}` : upper;
    };
    // The main section's closed summary, "100 DANKEST for 5 COOL".
    const orderSummary = giveTickUpper || getTickUpper
        ? `${sideSummary(giveTick, giveAmount, giveOwnership)} for ${sideSummary(getTick, getAmount, getOwnership)}`
        : 'No tokens yet';

    const { view, setView, sections, setSectionOpen } = giveGetView;
    // Spread onto a standard section; the open state lives in
    // useGiveGetView above the early returns, so a picker page keeps it.
    // `main` flags Order as the form's main section (data-form-main).
    const bind = (id) => ({ open: Boolean(sections[id]), onOpenChange: (open) => setSectionOpen(id, open), main: id === 'order' });

    // Which section holds an error, so each review attempt reopens it.
    const termsHasError = Boolean(expirationRefusal(expMode, expInput));
    const memoError = memo.includes('|') || memo.includes(';')
        ? 'Memo cannot contain "|" or ";".'
        : (memoLengthError(memo.trim()) || memoCharacterError(memo.trim()) || null);
    const feeHasError = Boolean(customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate }));
    const orderHasError = Boolean(validationError || formError) && !termsHasError && !memoError && !feeHasError;
    const revealOn = (hasError) => (hasError ? reviewAttempt : 0);

    // The ownership switches, built once and shown in whichever view is open.
    // Flipping one clears that side's amount.
    const giveOwnershipToggle = (
        <OwnershipToggle
            label="Give this token's ownership (not a balance)"
            help={`Offer control of the whole token instead of a quantity. Transfers the entire ownership of ${giveTickUpper || 'this token'} when the order fills.`}
            checked={giveOwnership}
            onChange={(checked) => {
                if (checked !== giveOwnership) setGiveAmount('');
                setGiveOwnership(checked);
            }}
        />
    );
    const getOwnershipToggle = (
        <OwnershipToggle
            label="Require the matcher to give that token's ownership"
            help={`Ask for control of the whole token instead of a quantity. The matcher must currently own ${getTickUpper || 'this token'}; on a fill its ownership is released to your Receive at address.`}
            checked={getOwnership}
            onChange={(checked) => {
                if (checked !== getOwnership) setGetAmount('');
                setGetOwnership(checked);
            }}
        />
    );

    const giveNetworkHelp = 'The chain you pay from. The token you give, your From address and the network fee are on this chain.';
    const getNetworkHelp = 'The chain you want to be paid on. The token you get and your Receive at address are on this chain.';
    const fromHelp = 'The wallet address that offers the give token and signs this cross-chain order.';
    const receiveHelp = 'Your address on the get network. Each fill is released to it.';
    // Shown inside From, and only when the give network has no
    // address at all, so the first default pick never opens From for good.
    const noAddressNotice = !(addressesByChain[giveChainId] || []).length ? (
        <FormNotice variant="error">No address on this network. Use Receive to generate one first.</FormNotice>
    ) : null;

    // Receive at: a standard address field right under You get in both views.
    // It holds this wallet's address on the get chain until edited. A typed
    // address that is not valid on that chain errors at once (it also holds
    // Place Order); an empty one errors once a review attempt has refused it.
    const receiveFieldError = receiveAddressError
        || (reviewAttempt > 0 && !getAddress.trim() && getChainId
            ? `Receive address on ${getDescriptor?.displayName || 'the get network'} is required.`
            : null);
    const receiveField = (
        <AddressField
            id="cross-chain-order-receive"
            label="Receive at"
            help={receiveHelp}
            value={getAddress}
            onChange={(e) => setGetAddress(e.target.value)}
            error={receiveFieldError || undefined}
            icon={getChainId ? 'addresses' : undefined}
            iconLabel="Choose receive address"
            onIconClick={getChainId ? () => setReceivePickerOpen(true) : undefined}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
        />
    );

    // The Quick body of the main section: the give and get cards, the
    // flip, then Receive at and the rate.
    const quickOrder = (
        <GiveGetQuick
            give={{
                label: 'You give',
                help: 'The token you offer on the give network. It is held in escrow while the order rests on the book, and may fill in parts.',
                // No network control; the card shows the asset's network read-only.
                asset: giveTick && giveChainId ? { chainId: giveChainId, tick: giveTick } : null,
                assetLabel: 'Give token',
                onOpenAsset: () => setGivePickerOpen(true),
                amount: giveAmount,
                onAmountChange: amountInput(setGiveAmount),
                amountLabel: 'Give amount',
                ownership: giveOwnership,
                ownershipHint: 'Moves as one piece when the order fills.',
                balanceText: giveBalanceText,
                onMax: onGiveMax || null,
                maxDisabled: !giveBalance,
                // No From row or no-address notice in the card; both
                // live in From, the standard's first section.
            }}
            get={{
                label: 'You get',
                help: 'The token you want on the get network. Each fill is released to your Receive at address there.',
                // No network control; the card shows the asset's network read-only.
                asset: getTick && getChainId ? { chainId: getChainId, tick: getTick } : null,
                assetLabel: 'Get token',
                onOpenAsset: () => setGetPickerOpen(true),
                amount: getAmount,
                onAmountChange: amountInput(setGetAmount),
                amountLabel: 'Get amount',
                ownership: getOwnership,
                ownershipHint: 'The matcher hands over this token name.',
            }}
            onFlip={getChainId ? flipSides : undefined}
            flipLabel="Flip give and get, networks included"
            rate={<>{receiveField}{rateLine}</>}
        />
    );

    // The Full body of the main section: every give and get field in
    // one open section (Receive at with the get side), then the rate.
    const fullOrder = (
        <>
                        <TokenFieldWithHelp
                            id="cross-chain-order-give-token"
                            label="Give token"
                            help="The token ticker or token reference you are offering on the give network."
                            value={giveTick && giveChainId ? { chainId: giveChainId, tick: giveTick } : null}
                            onOpenPicker={() => setGivePickerOpen(true)}
                        />
                        {!giveOwnership ? (
                            <AmountField
                                id="cross-chain-order-give-amount"
                                label="Give amount"
                                help="The amount of the give token placed in escrow. The order waits on the network's order book and may fill in parts. Use Cross-chain swap for one all-or-nothing fill."
                                amount={giveAmount}
                                tick={giveTick}
                                divisibility={giveTokenInfo?.divisibility}
                                onAmountFieldChange={amountInput(setGiveAmount)}
                                onMax={onGiveMax}
                                maxDisabled={!giveBalance}
                                balanceText={giveBalanceText}
                            />
                        ) : null}
                        {/* No Get network field; the picked get token sets it. */}
                        {/* Get token opens the same picker as Quick, so its
                            chain decides the get network; a typed name named no chain. */}
                        <TokenFieldWithHelp
                            id="cross-chain-order-get-token"
                            label="Get token"
                            help="The token you want to receive. Its network is the get network."
                            value={getTick && getChainId ? { chainId: getChainId, tick: getTick } : null}
                            onOpenPicker={() => setGetPickerOpen(true)}
                        />
                        {!getOwnership ? (
                            <AmountField
                                id="cross-chain-order-get-amount"
                                label="Get amount"
                                help="The total amount of the get token required in exchange for the offered asset."
                                amount={getAmount}
                                tick={getTick}
                                divisibility={getTokenInfo?.divisibility}
                                onAmountFieldChange={amountInput(setGetAmount)}
                            />
                        ) : null}
                        {/* The receive address sits right under the get side. */}
                        {receiveField}
                        {rateLine}
        </>
    );

    // The Order Terms fields, one optional section in both views, so Quick's
    // terms row expands in place and never switches to Full. The section
    // carries the Optional tag, so the fields carry none. Receive at stays
    // with the get side in the Cross-Chain Order section.
    const termsFields = (
        <>
                        {/* A choice among a few named options is the icon dropdown (G44);
                            Expires always shows and follows it (operator 2026-11-13). */}
                        <ExpirationFields
                            name="xorder-exp"
                            id="xorder-expires"
                            mode={expMode}
                            input={expInput}
                            onChange={(mode, input) => { setExpMode(mode); setExpInput(input); }}
                            help="Pick a common term or set the exact date and time when this order stops accepting fills."
                            expiresHelp="When the order stops accepting fills. Set by the Expiration choice, or pick a time to expire at a specific time."
                        />
        </>
    );

    return wrap(
        <FormFrame
            demoGuard={demoGuard}
            label="Create cross-chain order"
            onSubmit={handleReview}
            errors={formErrors}
            data-form-standard="cross-chain-order"
            // The review composes the terms as they stand at Review, so the
            // fields hold still until the confirm page opens.
            inert={confirmAction.composing ? '' : undefined}
            aria-busy={confirmAction.composing ? 'true' : undefined}
            status={[
                formError ? <StatusMessage key="form" variant="error">{formError}</StatusMessage> : null,
            ]}
            from={(
                <FromSection
                    {...bind('from')}
                    chainId={giveChainId}
                    // The get network is never offered as the give network.
                    chainIds={chainIds.filter((cid) => cid !== getChainId)}
                    chainRegistry={chainRegistry}
                    // The give network. A picked give token decides it;
                    // before one is picked it can change here.
                    lockNetwork={Boolean(giveTickUpper)}
                    onNetworkChange={handleGiveChainChange}
                    networkHelp={giveNetworkHelp}
                    address={fromAddress?.address || null}
                    addressId="cross-chain-order-from"
                    formErrorKey="cross-chain-order-from"
                    onOpenPicker={() => setSourcePickerOpen(true)}
                    pickerLabel="Choose source address"
                    addressHelp={fromHelp}
                    revealKey={revealOn(!fromAddress)}
                    missing={noAddressNotice}
                />
            )}
            fee={(
                <FeeSection
                    {...bind('fee')}
                    chainId={giveChainId}
                    coinTicker={giveCoinTicker}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={feeCustomEstimate}
                    revealKey={revealOn(feeHasError)}
                    fees={{
                        quote: protocolFeeQuote,
                        pending: protocolFeePending,
                        waiting: protocolFeeWaiting,
                        // An order inside the free period costs no protocol fee.
                        free: expirationWithinFreePeriod(expMode, expInput),
                        nativeFeeProps: { ...nativeFee.toggleProps, coinTicker: giveCoinTicker },
                    }}
                />
            )}
            action={(
                <FormAction
                    icon={<Icon.MarketIcon />}
                    loading={confirmAction.composing}
                >
                    Place Order
                </FormAction>
            )}
        >
            {/* The main section, open, holds both sides in either view. */}
            <FormSection
                id="order"
                title="Cross-Chain Order"
                icon={Icon.MarketIcon}
                {...bind('order')}
                revealKey={revealOn(orderHasError)}
                summary={orderSummary}
            >
                {/* One form either way (operator 2026-11-13): Quick | Full only
                    restyles this section's give and get inputs. */}
                <ViewSwitch value={view} onChange={setView} label="Order input style" inSection />
                {view === 'quick' ? quickOrder : fullOrder}
            </FormSection>
            {/* Both ownership switches live in one optional section in both styles. */}
            <FormSection
                id="ownership"
                title="Ownership"
                icon={Icon.KeyIcon}
                optional
                {...bind('ownership')}
                summary={giveOwnership || getOwnership ? 'Ownership' : 'Amounts'}
            >
                {giveOwnershipToggle}
                {getOwnershipToggle}
            </FormSection>
            <FormSection
                id="options"
                title="Order Terms"
                icon={Icon.FilterIcon}
                optional
                {...bind('options')}
                revealKey={revealOn(termsHasError)}
                summary={termsSummary}
            >
                {termsFields}
            </FormSection>
            <MemoSection
                inputId="xorder-memo"
                {...bind('memo')}
                revealKey={revealOn(Boolean(memoError))}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                maxLength={MAX_MEMO_LENGTH}
            />
        </FormFrame>,
    );
}

function TokenFieldWithHelp({ help, ...props }) {
    const rootRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    const [labelHost, setLabelHost] = useState(/** @type {HTMLElement | null} */ (null));

    useLayoutEffect(() => {
        const button = rootRef.current?.querySelector('button');
        setLabelHost(button?.previousElementSibling || null);
    }, []);

    return (
        <div ref={rootRef}>
            <TokenField {...props} />
            {labelHost ? createPortal(
                <InfoTip label={help} aria={`About ${props.label}`} />,
                labelHost,
            ) : null}
        </div>
    );
}

function DetailRow({ label, value }) {
    return (
        <>
            <dt className={styles.detailsLabel}>{label}</dt>
            <dd className={styles.detailsValue}>{value}</dd>
        </>
    );
}
