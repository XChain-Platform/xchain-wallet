// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { userFacingMessage } from '../utils/userFacingMessage.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusNoticeOnAttempt } from '../hooks/useFocusNoticeOnAttempt.js';
import { AddressField, AddressText, Button, ChainBadge, CopyButton, FormNotice, FormPage, Icon, ListPage, PageHeader, Screen, SectionHeader, StatusMessage } from '@xchain-wallet/core/ui';
import { ListField } from '../components/ListField.jsx';
import { ExpirationFields, expirationParam, expirationWithinFreePeriod } from '../components/expirationChoice.jsx';
// Cross-Chain Swap renders through the shared Give/Get standard, the
// same form as Swap plus Receive at on the get side. The give network sits in
// the standard's From section; the get token decides the get network.
import {
    GiveGetQuick,
    OwnershipToggle,
    QuickAddressRow,
    RateLine,
    useGiveGetView,
    ViewSwitch,
} from '../components/giveGet/index.js';
// The Wallet Form Standard frame (From, Cross-Chain Swap, Ownership, Swap Terms, Lists, Memo, Network fee, action).
import { FeeSection, FormAction, FormFrame, FormSection, FromSection, MemoSection, joinSummary } from '../components/formStandard/index.js';
import { ListPickerScreen } from '../components/ListPickerScreen.jsx';
import { decoder as decoderLib, registry as registryLib } from '@xchain-wallet/core';
import { actionDisplayLabel } from '../utils/actionDisplayLabel.js';
import { pickedListText } from '../utils/listLabel.js';
import { formatUnixSecondsLocal } from '../utils/dateTime.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { AmountField } from '../components/AmountField.jsx';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/crossChainSwap.js';
import { useTickBalance } from '../hooks/useTickBalance.js';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { MAX_MEMO_LENGTH, memoCharacterError, memoLengthError } from '../utils/memoLimit.js';
import { compareDecimalStrings, divideDecimalStrings, formatWithThousands, tokenAmountPrecisionError } from '../utils/amountFormat.js';
import { addressValidationError } from '../utils/addressValidation.js';
import { tickerReferenceError } from '../utils/tickerGrammar.js';
import { orderGiveParts } from '../utils/confirmSummaryParts.js';
import '../../i18n/locales/en/palette.js';
import { TokenField } from '../components/TokenField.jsx';
import { TokenPicker } from './TokenPicker.jsx';
import { useTokenInfo } from '../hooks/useTokenInfo.js';
import { useProtocolFeeQuote } from '../hooks/useProtocolFeeQuote.js';
import { coinFromChainId } from '../components/BalanceList.jsx';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useNetworkOffline } from '../hooks/useNetworkOffline.js';
import { useHideReachabilityNotice } from '../components/hideReachabilityNotice.js';
import { activeSourceId, externalIndexOf } from '../addressSelection.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { ConfirmActionModal } from '../components/ConfirmActionModal.jsx';
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

// Same ticker map SwapForm uses. descriptor.coin is long-form
// ('bitcoin' / 'litecoin' / 'dogecoin'); SWAP serializes the
// short-form tickers in GIVE_COIN / GET_COIN.
const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

// Maps descriptor.coin to the display ticker shown next to the fee
// estimate on the review screen.
const NATIVE_TICKER_BY_COIN = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };

const isPlainPositive = (value) => /^\d+(\.\d+)?$/.test(String(value).trim())
    && compareDecimalStrings(String(value).trim(), '0') === 1;

// The list-id rule Swap uses, for this form's allow and block lists.
const isPositiveActionIndex = (value) => /^[0-9]+$/.test(String(value).trim())
    && /[1-9]/.test(String(value));

function expirationValidationError(mode, input, nowSec = Math.floor(Date.now() / 1000)) {
    if (mode === 'default') return null;
    if (!input.trim()) return 'Pick an expiration date and time, or choose a common term.';
    const ms = Date.parse(input.trim());
    if (!Number.isFinite(ms)) return 'Pick a valid expiration date and time.';
    if (Math.floor(ms / 1000) <= nowSec) return 'Expiration must be in the future.';
    return null;
}

/**
 * §42.8.3 Cross-chain SWAP authoring surface.
 *
 * Same SWAP action as §41.5 with one structural difference:
 * `GIVE_COIN ≠ GET_COIN`. The wallet signs the offer on the give-
 * chain; a counterparty fills it on the get-chain. SDK 1.10's SWAP
 * encoder handles both same-chain and cross-chain variants; this
 * form is a separate route purely for clarity and so the §41.5
 * SwapForm doesn't grow a "cross-chain mode" toggle.
 *
 * Native-coin rejection still applies (GIVE_TICK / GET_TICK cannot
 * be a coin's native ticker (that's DISPENSER territory).
 *
 * Receiver address (`GET_ADDRESS`) defaults to the user's newest
 * address on the get-chain, surfaced via `messaging.getNewestAddress`.
 * Users can override to a different known address if they want the
 * SWAP fill to land at a different account.
 *
 * Custom expiration is entered as a wall-clock time and serialized as a
 * Unix timestamp. Omitting it lets the indexer apply its default window.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 */
export function CrossChainSwapForm({ walletId, onBack }) {
    const { messaging, shell } = useMessaging();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const { offline: networkOffline } = useNetworkOffline({ walletId });
    const networkAvailable = !networkOffline;
    useHideReachabilityNotice(networkOffline);
    const signerReady = useSignerReady(walletId);
    const variant = screenVariantFor(shell);

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [activeByChain, setActiveByChain] = useState(
        /** @type {Record<string, { id: string, address: string }>} */ ({}),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    // True when the load found too few networks, a requirement the page states
    // only while online: offline, the offline note is the page's one message.
    const [loadErrorIsRequirement, setLoadErrorIsRequirement] = useState(false);

    const [giveChainId, setGiveChainId] = useState(/** @type {string | null} */ (null));
    const [getChainId, setGetChainId] = useState(/** @type {string | null} */ (null));
    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));
    const [getAddress, setGetAddress] = useState('');
    const [getAddressTouched, setGetAddressTouched] = useState(false);
    const [giveTick, setGiveTick] = useState('');
    const [giveAmount, setGiveAmount] = useState('');
    const [getTick, setGetTick] = useState('');
    const [getAmount, setGetAmount] = useState('');
    // PC-18: EXPIRATION is a wall-clock Unix timestamp, NOT a block count
    // (the indexer rejects EXPIRATION <= BLOCK_TIME as "past", so the old
    // block-count value indexed every cross-chain swap invalid).
    // 'default' is 3 months; the presets fill expInput, which Expires shows.
    const [expMode, setExpMode] = useState(/** @type {'default' | '6m' | '9m' | '1y' | 'custom'} */ ('default'));
    const [expInput, setExpInput] = useState('');
    const [giveOwnership, setGiveOwnership] = useState(false);
    const [getOwnership, setGetOwnership] = useState(false);
    const [memo, setMemo] = useState('');
    // Allow and block lists, as on Swap. The SWAP is recorded and
    // validated on the give chain, so the lists are give-chain lists.
    const [allowListIdx, setAllowListIdx] = useState('');
    const [blockListIdx, setBlockListIdx] = useState('');
    // The picked lists' names, so the fields show a name (G114).
    const [allowListPick, setAllowListPick] = useState(/** @type {{ index: string, name: unknown } | null} */ (null));
    const [blockListPick, setBlockListPick] = useState(/** @type {{ index: string, name: unknown } | null} */ (null));
    const [listPickerFor, setListPickerFor] = useState(/** @type {'allow' | 'block' | null} */ (null));
    // The Quick | Full view and the section open state live here, above every
    // early return, so a picker page or the confirm screen never resets them.
    // Only the Cross-Chain Swap section starts open; the last view is remembered.
    const giveGetView = useGiveGetView('crossChainSwap', {
        sections: { from: false, swap: true, ownership: false, options: false, lists: false, memo: false, fee: false },
    });
    // Counts review attempts, so a section holding an error reopens on
    // every attempt even after the user closed it (the standard's revealKey).
    const [reviewAttempt, setReviewAttempt] = useState(0);
    const [password, setPassword] = useState('');
    const [givePickerOpen, setGivePickerOpen] = useState(false);
    const [getPickerOpen, setGetPickerOpen] = useState(false);
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const [receivePickerOpen, setReceivePickerOpen] = useState(false);

    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const markReviewAttempt = useFocusNoticeOnAttempt();
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const [hwStatus, setHwStatus] = useState('idle');
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const submitInFlightRef = useRef(false);
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            messaging.getAddressesByChain(walletId),
            typeof messaging.getActiveAddresses === 'function'
                ? messaging.getActiveAddresses(walletId)
                : Promise.resolve({}),
        ])
            .then(([byChain, active]) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
                setActiveByChain(active || {});
                const chains = Object.entries(byChain || {})
                    .filter(([, addrs]) => Array.isArray(addrs) && addrs.length > 0)
                    .map(([cid]) => cid);
                if (chains.length < 2) setLoadErrorIsRequirement(true);
                if (chains.length === 0) {
                    setLoadError(
                        'No addresses on any network yet. Use Receive to generate addresses on at least two networks before composing a cross-chain swap.',
                    );
                    return;
                }
                if (chains.length === 1) {
                    setLoadError(
                        'A cross-chain swap needs addresses on two different networks. Use Receive on a second network (e.g. DOGE or LTC) and try again.',
                    );
                    return;
                }
                setGiveChainId(chains[0]);
                setGetChainId(chains[1]);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(userFacingMessage(err, 'Failed to load wallet.'));
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    useEffect(() => {
        if (!addressesByChain || !giveChainId) {
            setFromAddressId(null);
            return;
        }
        const addrs = addressesByChain[giveChainId] || [];
        // A pick already on the give chain stays: a From picked on another
        // chain switches the give chain first, and this run must not replace
        // that pick with the new chain's default.
        const keep = (next) => setFromAddressId((current) => (
            addrs.some((a) => a.id === current) ? current : next
        ));
        // Prefer the give-chain's active address; fall back to the existing
        // newest-HD (or any-address) heuristic when none is set.
        const activeId = activeSourceId(addrs, activeByChain[giveChainId]);
        if (activeId) {
            keep(activeId);
            return;
        }
        const hd = addrs.filter(
            (a) => a.source === 'hd' && externalIndexOf(a.derivationPath) !== null,
        );
        const pool = hd.length > 0 ? hd : addrs;
        if (pool.length > 0) {
            const sorted = [...pool].sort((a, b) => {
                const ai = (externalIndexOf(a.derivationPath) ?? -1);
                const bi = (externalIndexOf(b.derivationPath) ?? -1);
                return bi - ai;
            });
            keep(sorted[0].id);
        } else {
            setFromAddressId(null);
        }
    }, [giveChainId, addressesByChain, activeByChain]);

    // Auto-fill receiver address on the get-chain (newest external HD
    // index). Only fills when the user hasn't typed something custom.
    useEffect(() => {
        if (!getChainId || getAddressTouched) return;
        if (typeof messaging.getNewestAddress !== 'function') return;
        let cancelled = false;
        messaging.getNewestAddress(walletId, getChainId)
            .then((rec) => {
                if (cancelled) return;
                if (rec?.address) setGetAddress(rec.address);
            })
            .catch(() => { /* non-fatal; user can enter manually */ });
        return () => { cancelled = true; };
    }, [walletId, getChainId, getAddressTouched, messaging]);

    // Focus the password field when entering review, matching the
    // DestroyForm convention for the confirmation stage.
    useEffect(() => {
        if (stage === 'review') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    const fromAddress = useMemo(() => {
        if (!addressesByChain || !fromAddressId || !giveChainId) return null;
        return (addressesByChain[giveChainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [addressesByChain, giveChainId, fromAddressId]);

    const giveDescriptor = giveChainId ? chainRegistry.get(giveChainId) : null;
    const getDescriptor = getChainId ? chainRegistry.get(getChainId) : null;
    const giveCoinTicker = giveDescriptor ? PROTOCOL_COIN_TICKER[giveDescriptor.coin] || '' : '';
    const getCoinTicker = getDescriptor ? PROTOCOL_COIN_TICKER[getDescriptor.coin] || '' : '';

    // Source balance of the give ticker on the give chain, backing the
    // give AmountField's Max button + "available" footer.
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
    const hw = isHwSource(fromAddress);

    const validationError = useMemo(() => {
        if (!giveCoinTicker || !getCoinTicker) return null;
        if (giveCoinTicker === getCoinTicker) {
            return 'Give and get networks must differ. For same-chain swaps use Swap tokens.';
        }
        if (giveTick.trim() && giveTick.trim().toUpperCase() === giveCoinTicker) {
            return `${actionDisplayLabel('SWAP')} cannot give ${giveCoinTicker}. Use ${actionDisplayLabel('DISPENSER')} for token to native coin.`;
        }
        if (getTick.trim() && getTick.trim().toUpperCase() === getCoinTicker) {
            return `${actionDisplayLabel('SWAP')} cannot get ${getCoinTicker}. Use ${actionDisplayLabel('DISPENSER')} for token to native coin.`;
        }
        if (giveTick.trim()) {
            const tickError = tickerReferenceError(giveTick, { noun: 'Give token', allowRef: true });
            if (tickError) return tickError;
        }
        if (getTick.trim()) {
            const tickError = tickerReferenceError(getTick, { noun: 'Get token', allowRef: true });
            if (tickError) return tickError;
        }
        if (!giveOwnership && giveAmount && !isPlainPositive(giveAmount)) {
            return 'Give amount must be a positive decimal number.';
        }
        if (!getOwnership && getAmount && !isPlainPositive(getAmount)) {
            return 'Get amount must be a positive decimal number.';
        }
        if (!giveOwnership && giveAmount) {
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
            const precisionError = tokenAmountPrecisionError(getAmount, {
                divisibility: getTokenInfo?.divisibility,
                tick: getTick,
                noun: 'Get amount',
            });
            if (precisionError) return precisionError;
        }
        if (getAddress.trim()) {
            const addressError = addressValidationError(getAddress, getDescriptor);
            if (addressError) return addressError;
        }
        if (allowListIdx && !isPositiveActionIndex(allowListIdx)) return 'Allow-list ID must be a positive whole number.';
        if (blockListIdx && !isPositiveActionIndex(blockListIdx)) return 'Block-list ID must be a positive whole number.';
        if (memo.includes('|') || memo.includes(';')) return 'Memo cannot contain "|" or ";".';
        const memoError = memoLengthError(memo.trim()) || memoCharacterError(memo.trim());
        if (memoError) return memoError;
        const expirationError = expirationValidationError(expMode, expInput);
        if (expirationError) return expirationError;
        return null;
    }, [giveCoinTicker, getCoinTicker, giveTick, getTick, giveOwnership, giveAmount,
        getOwnership, getAmount, giveTokenInfo?.divisibility, getTokenInfo?.divisibility,
        giveBalance, getAddress, getDescriptor, allowListIdx, blockListIdx, memo, expMode, expInput]);

    const rate = !giveOwnership && !getOwnership
        ? divideDecimalStrings(getAmount, giveAmount, 8)
        : null;
    const displayedRate = rate === '0' && isPlainPositive(getAmount) && isPlainPositive(giveAmount)
        ? '< 0.00000001'
        : rate;
    const rateText = displayedRate
        ? `1 ${giveTick.trim().toUpperCase()} = ${displayedRate} ${getTick.trim().toUpperCase()}`
        : 'Enter both amounts to see the rate';

    // Network fee for the give chain (the chain that pays the on-chain fee):
    // Low / Normal / Fast / Custom, editable via FeeSelector on the form
    // stage. `feeEstimate` backs both the slider readout and the review row;
    // `feePerKb` prices the broadcast. Mirrors ComposeMessage.
    const [feePick, setFeePick] = useState(
        /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: 'normal' }),
    );
    // PC-51: a cross-chain SWAP is composed and paid on the GIVE
    // chain, so that is the chain whose native-fee rule applies. Off Bitcoin
    // the native-coin output IS the protocol fee; without it the SWAP
    // confirms and the indexer rejects it "insufficient fee (native coin output
    // required)" while this form reports the swap as open.
    const nativeFee = useNativeFee(giveChainId);

    const feeTiers = useMemo(
        () => estimateNativeSendFeeTiers({ chainId: giveChainId, chainRegistry }),
        [giveChainId],
    );
    const feeCustomEstimate = useMemo(
        () => (feePick.mode === 'custom'
            ? customFeeEstimate({ chainId: giveChainId, chainRegistry, rate: Number(feePick.customRate) || 0 })
            : null),
        [giveChainId, feePick],
    );
    const feeEstimate = feePick.mode === 'custom'
        ? feeCustomEstimate
        : (feeTiers ? feeTiers[feePick.mode] : estimateNativeSendFee({ chainId: giveChainId, chainRegistry, speed: feePick.mode }));
    const feePerKb = (feeEstimate && feeEstimate.unit
        && Number.isFinite(feeEstimate.rateValue) && feeEstimate.rateValue > 0)
        ? displayRateToSettingsCustom(feeEstimate.unit, feeEstimate.rateValue)
        : null;
    const giveTicker = giveDescriptor?.coin
        ? NATIVE_TICKER_BY_COIN[giveDescriptor.coin] || giveDescriptor.coin.toUpperCase()
        : null;
    // §20 / Cluster W FOLLOWUP 5: watcher-mode encode-only branch.
    const { isWatcherMode } = useWalletMode();

    // The wire params, named once so the confirm lane and the watcher lane
    // encode the same SWAP. GET_ADDRESS is the field this migration is for:
    // it names a destination on ANOTHER chain, which only the confirm page's
    // output-set cross-check binds to the bytes that get signed.
    const swapParams = useMemo(() => ({
        VERSION: '0',
        GIVE_COIN: giveCoinTicker,
        GIVE_TICK: giveTick.trim(),
        ...(giveOwnership ? { GIVE_OWNERSHIP: '1' } : { GIVE_AMOUNT: String(giveAmount).trim() }),
        GET_COIN: getCoinTicker,
        GET_TICK: getTick.trim(),
        ...(getOwnership ? { GET_OWNERSHIP: '1' } : { GET_AMOUNT: String(getAmount).trim() }),
        GET_ADDRESS: (getAddress || '').trim(),
        ...((() => {
            const expiration = expirationParam(expMode, expInput);
            return expiration ? { EXPIRATION: expiration } : {};
        })()),
        ...(allowListIdx ? { ALLOW_LIST: allowListIdx } : {}),
        ...(blockListIdx ? { BLOCK_LIST: blockListIdx } : {}),
        ...(memo.trim() ? { MEMO: memo.trim() } : {}),
    }), [giveCoinTicker, giveTick, giveOwnership, giveAmount, getCoinTicker, getTick,
        getOwnership, getAmount, getAddress, expMode, expInput, allowListIdx, blockListIdx, memo]);
    const swapQuoteActionData = useMemo(() => {
        if (!fromAddress?.address || !giveChainId || !getChainId) return null;
        if (!giveTick.trim() || !getTick.trim() || !getAddress.trim()) return null;
        if ((!giveOwnership && !giveAmount) || (!getOwnership && !getAmount)) return null;
        if (validationError) return null;
        return { action: 'SWAP', params: swapParams };
    }, [fromAddress?.address, giveChainId, getChainId, giveTick, getTick, getAddress,
        giveOwnership, giveAmount, getOwnership, getAmount, validationError, swapParams]);
    const { quote: protocolFeeQuote, pending: protocolFeePending, waiting: protocolFeeWaiting } = useProtocolFeeQuote({
        messaging,
        chainId: giveChainId,
        source: fromAddress?.address,
        actionData: swapQuoteActionData,
    });
    const legacyDecoded = useMemo(() => (
        stage === 'review' || stage === 'submitting'
            ? decoderLib.decodeAction({ action: 'SWAP', params: swapParams, chainId: giveChainId, chainRegistry })
            : null
    ), [giveChainId, stage, swapParams]);
    const quotedProtocolFee = normalizeProtocolFee(protocolFeeQuote);
    const legacyComposed = legacyDecoded ? {
        action: 'SWAP',
        chainId: giveChainId,
        decoded: legacyDecoded,
        quote: protocolFeeQuote,
        protocolFeeKnownFree: quotedProtocolFee.known && quotedProtocolFee.free,
    } : null;

    // §5.6: SwapForm already composes one PSBT host-side and approves it on
    // the shared confirm page; the cross-chain variant now does the same.
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const singleEncode = !isWatcherMode;
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    const submitConfirmed = useConfirmSubmit({
        messaging,
        isHw: hw,
        signerId: fromAddress?.signerId,
        passwordRef: passwordValueRef,
        software: 'swapAction',
        hardware: 'swapActionHw',
    });

    // Compose, tamper-check and pre-flight run HOST-side; Approve signs the
    // byte-identical prebuilt PSBT. Reject is a calm no-op back to the form.
    async function openConfirmScreen() {
        if (!networkAvailable) return;
        if (submitInFlightRef.current) return;
        submitInFlightRef.current = true;
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
                chainId: giveChainId,
                from,
                actionData: { action: 'SWAP', params: swapParams },
                encoderOpts: {
                    payFeeInNativeCoin: nativeFee.flag || undefined,
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
                onApprove: (prebuiltPsbt) => {
                    if (swapParams.EXPIRATION
                        && Number(swapParams.EXPIRATION) <= Math.floor(Date.now() / 1000)) {
                        const error = new Error('Expiration must be a future date and time.');
                        error.code = 'EXPIRATION_STALE';
                        throw error;
                    }
                    return submitConfirmed({
                        walletId,
                        chainId: giveChainId,
                        from,
                        params: swapParams,
                        payFeeInNativeCoin: nativeFee.flag,
                        ...(feePerKb != null ? { feePerKb } : {}),
                        prebuiltPsbt,
                    });
                },
            });
            setResult(r);
            setPassword('');
            setStage('done');
        } catch (err) {
            if (isUserRejection(err)) return;
            setFormError(err?.code === 'EXPIRATION_STALE'
                ? err.message
                : submitFailureMessage(err, {
                    chainId: giveChainId,
                    coinTicker: giveTicker || '',
                    mandatory: nativeFee.mandatory,
                    fallback: err?.message || 'Sign failed.',
                }));
        } finally {
            submitInFlightRef.current = false;
        }
    }

    // Validate the form fields and advance to the review stage. The
    // actual sign/broadcast only fires from handleSubmit, which is
    // reachable only from the review screen.
    function handleReview(event) {
        event.preventDefault();
        setReviewAttempt((n) => n + 1);
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        if (feeStop) { setFormError(feeStop.formError); return; }
        if (!networkAvailable) return;
        markReviewAttempt();
        if (!fromAddress || !giveChainId || !getChainId) {
            setFormError('Pick a source address first.');
            return;
        }
        if (!giveTick.trim() || (!giveOwnership && !giveAmount)
            || !getTick.trim() || (!getOwnership && !getAmount)) {
            setFormError('Enter the give and get tickers and amounts, or select ownership, before reviewing.');
            return;
        }
        if (!getAddress.trim()) {
            setFormError('Enter a receive address on the get network.');
            return;
        }
        if (validationError) return;
        // The memoized check keeps the clock of the last edit, so ask again now.
        if (expirationValidationError(expMode, expInput)) {
            setFormError('Expiration must be a future date and time.');
            return;
        }
        setFormError(null);
        if (singleEncode) { void openConfirmScreen(); return; }
        setStage('review');
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (!networkAvailable) return;
        if (stage === 'submitting') return;
        if (!fromAddress || !giveChainId || !getChainId) return;
        const freshExpirationError = expirationValidationError(expMode, expInput);
        if (validationError) return;
        if (freshExpirationError) {
            setFormError('Expiration must be a future date and time.');
            setSubmitError(null);
            setStage('form');
            return;
        }
        if (!isWatcherMode && !hw && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && hw && hwStatus !== 'available') return;
        if (submitInFlightRef.current) return;

        submitInFlightRef.current = true;
        setStage('submitting');
        setSubmitError(null);
        try {
            const params = swapParams;
            const base = {
                walletId,
                chainId: giveChainId,
                from: {
                    address: fromAddress.address,
                    publicKey: fromAddress.publicKey,
                    derivationPath: fromAddress.derivationPath,
                    addressId: fromAddress.id,
                    source: fromAddress.source,
                    signerId: fromAddress.signerId,
                },
                params,
                ...(feePerKb != null ? { feePerKb } : {}),
                // PC-51: off Bitcoin the native-coin output IS the
                // protocol fee. `flag` is true or undefined, never
                // false, so this leaves the Bitcoin payload untouched.
                payFeeInNativeCoin: nativeFee.flag,
            };
            let r;
            if (isWatcherMode) {
                r = await messaging.buildActionPsbtRequest({
                    chainId: giveChainId,
                    from: base.from,
                    actionData: { action: 'SWAP', params },
                    // The flag must reach COMPOSE too, so the
                    // FEE_DESTINATION output sits inside the PSBT the user
                    // approves. This lane does NOT go through `base`, and a
                    // form that threads only the submit path silently drops
                    // the fee mode here - which is the whole reason
                    // useNativeFee exists rather than per-form state.
                    encoderOpts: {
                        payFeeInNativeCoin: nativeFee.flag,
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                });
            } else if (hw) {
                r = await messaging.swapActionHw({ ...base, signerId: fromAddress.signerId });
            } else {
                r = await messaging.swapAction({ ...base, password });
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
                chainId: giveChainId,
                coinTicker: giveTicker || '',
                mandatory: nativeFee.mandatory,
                fallback: err?.message || 'Sign failed.',
            }));
            setStage('review');
            if (!isWatcherMode && !hw) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        } finally {
            submitInFlightRef.current = false;
        }
    }

    function handleBuildAnother() {
        setResult(null);
        setSubmitError(null);
        setStage('form');
    }

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
            title={stage === 'review' || stage === 'submitting'
                ? 'Review Swap'
                : 'Cross-Chain Swap'}
        />
    );
    // Every state draws through a page template: the form and the review
    // through FormPage, the load error, the loading line and each result
    // through ListPage. The offline note leads each template's notices
    // instead of sitting bare in Screen.
    const offlineNote = !networkAvailable ? (
        <StatusMessage variant="warning">Swapping needs a network connection.</StatusMessage>
    ) : null;
    const wrap = (children) => (
        <Screen variant={variant} header={header} restoreScroll={!(stage === 'review' || stage === 'submitting')}>
            {children}
        </Screen>
    );
    const listPage = (children, notices = null) => wrap(
        <ListPage notices={offlineNote || notices ? <>{offlineNote}{notices}</> : null}>
            {children}
        </ListPage>,
    );

    if (loadError && networkOffline && loadErrorIsRequirement) return listPage(null);
    if (loadError) {
        return listPage(null, <StatusMessage variant="error">{loadError}</StatusMessage>);
    }

    if (stage === 'done') {
        const txid = result?.txid;
        if (result?.psbtHex && !txid) {
            return listPage(
                <ResultScreen
                    state="unsigned"
                    result={result}
                    onBuildAnother={handleBuildAnother}
                    onDone={onBack}
                />,
            );
        }
        // A queued result is SIGNED and not broadcast: the confirm lane
        // resolves a transient broadcast failure that way, and the success
        // copy below would report an escrow that is not open yet.
        if (result?.queued) {
            return listPage(<ResultScreen state="signed-not-broadcast" onDone={onBack} what="cross-chain swap" unsaved={result.unsaved} />);
        }
        return listPage(
            <>
                <SectionHeader title="Cross-chain swap broadcast" />
                {txid ? (
                    <>
                        <p className={styles.successLabel}>{t('crossChainSwap.success.giveTxLabel')}</p>
                        <code className={styles.txid}>{txid}</code>
                        <CopyButton value={txid} label="Copy Transaction ID" />
                    </>
                ) : null}
                <p className={styles.hint}>{t('crossChainSwap.success.hint')}</p>
                <div className={styles.actions}>
                    <Button variant="success" icon={<Icon.CheckIcon />} onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    if (!addressesByChain) {
        return listPage(<p className={styles.hint}>Loading wallet…</p>);
    }

    // Watch-only review uses the shared Confirm Standard body.
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
                nativeTicker={giveTicker || giveCoinTicker}
                credentials={<p className={styles.hint}>{t('common.watcherBuildsUnsigned')}</p>}
                credentialsReady
                summary={{
                    verb: t('palette.tradeSwap.title'),
                    ...orderGiveParts(swapParams, giveCoinTicker),
                    chainId: giveChainId,
                    address: fromAddress?.address,
                    facts: [
                        ...(!giveOwnership && !getOwnership ? [{ label: 'Rate', value: rateText }] : []),
                        {
                            label: 'Expiration',
                            value: swapParams.EXPIRATION
                                ? formatUnixSecondsLocal(swapParams.EXPIRATION)
                                : '3 months',
                        },
                    ],
                    ...(!nativeFee.flag && quotedProtocolFee.known ? {
                        protocolFee: {
                            amount: quotedProtocolFee.free ? '0' : String(quotedProtocolFee.amount ?? ''),
                            ticker: 'XCHAIN',
                        },
                    } : {}),
                }}
                networkFee={feeEstimate?.coinAmount ? {
                    amount: String(feeEstimate.coinAmount), ticker: giveTicker || giveCoinTicker, estimate: true,
                } : null}
            />
        );
    }

    const chainIds = Object.entries(addressesByChain)
        .filter(([, addrs]) => Array.isArray(addrs) && addrs.length > 0)
        .map(([cid]) => cid);

    // Confirm page, rendered in place of the form; form state stays intact
    // behind it, exactly as the picker screens below do.
    if (actionConfirm.open) {
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                summary={{
                    verb: t('palette.tradeSwap.title'),
                    ...orderGiveParts(swapParams, giveCoinTicker),
                    chainId: giveChainId,
                    address: fromAddress?.address,
                }}
                screenVariant={variant}
                chainLabel={giveDescriptor?.displayName || giveChainId}
                feeEstimate={giveTicker ? feeEstimate : null}
                feeText={feeEstimate?.coinAmount && giveTicker
                    ? `Network fee: ${feeEstimate.coinAmount} ${giveTicker}`
                    : undefined}
                coinTicker={giveTicker || ''}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hwSource={hw ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                chainId={giveChainId}
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
                chainId={giveChainId}
                // A picked give token holds From to its network, as on the
                // Network field; before that, an address on another chain
                // moves the give Network there first. The get network stays
                // apart from it, so its addresses cannot be picked here.
                lockNetwork={Boolean(giveTick.trim())}
                onChainChange={changeGiveChain}
                unavailableReason={(_address, cid) => (cid && cid === getChainId
                    ? 'This address is on the Get network. Give and Get use different networks.'
                    : null)}
                onPick={(a) => {
                    setFromAddressId(a.id);
                    setSourcePickerOpen(false);
                }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    if (receivePickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="Receive At"
                walletId={walletId}
                chainId={getChainId}
                lockNetwork
                onPick={(address) => {
                    setGetAddress(address.address);
                    setGetAddressTouched(true);
                    setReceivePickerOpen(false);
                    setFormError(null);
                }}
                onBack={() => setReceivePickerOpen(false)}
            />
        );
    }

    // The allow / block list picker page, on the give chain where the
    // SWAP is recorded and its lists are looked up.
    if (listPickerFor) {
        return (
            <ListPickerScreen
                variant={variant}
                messaging={messaging}
                chainId={giveChainId}
                addresses={addressesByChain?.[giveChainId] || []}
                filterType="2"
                title={listPickerFor === 'allow' ? 'Choose Allow-List' : 'Choose Block-List'}
                onSelect={(row) => {
                    const pick = { index: String(row.actionIndex), name: row.name };
                    if (listPickerFor === 'allow') { setAllowListIdx(row.actionIndex); setAllowListPick(pick); }
                    else { setBlockListIdx(row.actionIndex); setBlockListPick(pick); }
                    setListPickerFor(null);
                }}
                onBack={() => setListPickerFor(null)}
            />
        );
    }

    if (givePickerOpen) {
        return (
            <TokenPicker
                purpose="send"
                walletId={walletId}
                title="Select Give Token"
                // Lists every network; the picked asset's chain becomes
                // the give network (a new chain clears the give side first).
                onSelect={(sel) => {
                    if (sel.chainId && sel.chainId !== giveChainId) changeGiveChain(sel.chainId);
                    const nextTick = String(sel.tick || '').toUpperCase();
                    if (nextTick !== giveTick) setGiveAmount('');
                    setGiveTick(nextTick);
                    setGivePickerOpen(false);
                }}
                onBack={() => setGivePickerOpen(false)}
            />
        );
    }

    if (getPickerOpen) {
        return (
            <TokenPicker
                purpose="receive"
                walletId={walletId}
                title="Select Get Token"
                // Lists every network; the picked asset's chain becomes
                // the get network (a new chain clears the get side first).
                onSelect={(sel) => {
                    if (sel.chainId && sel.chainId !== getChainId) changeGetChain(sel.chainId);
                    const nextTick = String(sel.tick || '').toUpperCase();
                    if (nextTick !== getTick) setGetAmount('');
                    setGetTick(nextTick);
                    setGetPickerOpen(false);
                }}
                onBack={() => setGetPickerOpen(false)}
            />
        );
    }

    // One handler per side, called by that side's token picker when the picked
    // asset lives on another chain. Each clears only its own side's chain-scoped
    // values; the give chain also owns the list IDs.
    function changeGiveChain(cid) {
        if (cid === giveChainId) return;
        setGiveChainId(cid);
        setGiveTick('');
        setGiveAmount('');
        setGiveOwnership(false);
        setAllowListIdx('');
        setBlockListIdx('');
        setFormError(null);
    }
    function changeGetChain(cid) {
        if (cid === getChainId) return;
        setGetChainId(cid);
        setGetAddress('');
        setGetAddressTouched(false);
        setGetTick('');
        setGetAmount('');
        setGetOwnership(false);
        setFormError(null);
    }

    // The same digits-only rule for every amount input, Quick or Full.
    const amountInput = (setter) => (rawValue) => {
        const stripped = String(rawValue).replace(/,/g, '');
        if (stripped !== '' && !/^\d*\.?\d*$/.test(stripped)) return;
        setter(stripped);
    };

    // The flip button swaps the whole side, network included. The
    // receive address names a get-chain address, so it is cleared and refilled
    // by the auto-fill; list IDs name give-chain lists, so they clear too.
    function flipSides() {
        setGiveChainId(getChainId);
        setGetChainId(giveChainId);
        setGiveTick(getTick);
        setGetTick(giveTick);
        setGiveAmount(getAmount);
        setGetAmount(giveAmount);
        setGiveOwnership(getOwnership);
        setGetOwnership(giveOwnership);
        setGetAddress('');
        setGetAddressTouched(false);
        setAllowListIdx('');
        setBlockListIdx('');
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

    // Swap Terms reads the expiry ("3 months" or "Expires <time>"); Lists
    // names the lists set, else "None". Receive at stays on the get side here,
    // where it is required, so it is no part of the terms.
    const expParam = expirationParam(expMode, expInput);
    const termsSummary = expMode === 'default'
        ? '3 months'
        : (expParam ? `Expires ${formatUnixSecondsLocal(Number(expParam))}` : 'Custom expiry');
    const listsParts = [];
    if (allowListIdx) listsParts.push(`Allow list #${allowListIdx}`);
    if (blockListIdx) listsParts.push(`Block list #${blockListIdx}`);
    // The standard's summaries join their parts with ", ".
    const listsSummary = listsParts.length ? joinSummary(...listsParts) : 'None';

    const sideSummary = (tick, amount, ownership) => {
        const upper = tick.trim().toUpperCase();
        if (!upper) return 'No token yet';
        if (ownership) return `Ownership of ${upper}`;
        return amount ? `${formatWithThousands(amount)} ${upper}` : upper;
    };
    // The main section's closed summary, "100 DANKEST for 5 COOL".
    const swapSummary = giveTickUpper || getTickUpper
        ? `${sideSummary(giveTick, giveAmount, giveOwnership)} for ${sideSummary(getTick, getAmount, getOwnership)}`
        : 'No tokens yet';

    const { view, setView, sections, setSectionOpen } = giveGetView;
    // Spread onto a standard section; the open state lives in
    // useGiveGetView above the early returns, so a picker page keeps it.
    // `main` flags Swap as the form's main section (data-form-main).
    const bind = (id) => ({ open: Boolean(sections[id]), onOpenChange: (open) => setSectionOpen(id, open), main: id === 'swap' });
    // Which section holds an error, so each review attempt reopens it.
    const termsHasError = Boolean(expirationValidationError(expMode, expInput));
    const listsHasError = Boolean((allowListIdx && !isPositiveActionIndex(allowListIdx))
        || (blockListIdx && !isPositiveActionIndex(blockListIdx)));
    // The status slot carries the memo's message (validationError); this
    // flag only reopens the Memo section on each review attempt.
    const memoHasError = Boolean(memo.includes('|') || memo.includes(';')
        || memoLengthError(memo.trim()) || memoCharacterError(memo.trim()));
    const feeHasError = Boolean(customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate }));
    const swapHasError = Boolean(validationError || formError)
        && !termsHasError && !listsHasError && !memoHasError && !feeHasError;
    const revealOn = (hasError) => (hasError ? reviewAttempt : 0);

    const giveNetworkHelp = 'The chain you pay from. The token you give, your From address and the network fee are on this chain; changing it clears the give token.';
    const getNetworkHelp = 'The chain you want to be paid on. The token you get and your Receive at address are on this chain; changing it clears the get token.';
    const fromHelp = "The wallet address on the give network whose tokens are escrowed and that pays this swap's network fee.";
    const receiveHelp = 'The address on the get network that receives what the matcher gives. Type or paste any valid address, or choose one from this wallet.';
    const giveTokenHelp = 'The token you put up on the give network. It is held in escrow until the swap is matched, cancelled or expires.';
    const getTokenHelp = 'The token you want in return on the get network. It is paid to your Receive at address when someone matches the swap.';

    // The ownership switches (Swap's wording), built once and shown
    // in whichever view is open; the help keeps this form's cross-chain copy.
    const giveOwnershipToggle = (
        <OwnershipToggle
            label="Give this token's ownership instead of an amount"
            help={`Escrow the give token name's ownership record for this cross-chain swap instead of giving a token balance. Transfers the entire ownership of ${giveTickUpper || 'this token'} (single-fill, no partial matches).`}
            checked={giveOwnership}
            onChange={setGiveOwnership}
        />
    );
    const getOwnershipToggle = (
        <OwnershipToggle
            label="Require the matcher to give that token's ownership instead of an amount"
            help={`Require the matcher to transfer the get token name's ownership record across chains instead of providing a token balance. The matcher must currently own ${getTickUpper || 'this token'}; on match its ownership transfers to you.`}
            checked={getOwnership}
            onChange={setGetOwnership}
        />
    );
    const rateLine = <RateLine text={rateText} />;

    // The Quick body of the main section: the give and get cards
    // (Receive at stays on the get card), the flip and the rate.
    const quickSwap = (
        <GiveGetQuick
            give={{
                label: 'You give',
                help: giveTokenHelp,
                // No network control; the card shows the asset's network read-only.
                asset: giveTick && giveChainId ? { chainId: giveChainId, tick: giveTick } : null,
                assetLabel: 'Give token',
                onOpenAsset: () => setGivePickerOpen(true),
                amount: giveAmount,
                onAmountChange: amountInput(setGiveAmount),
                amountLabel: 'Give amount',
                ownership: giveOwnership,
                ownershipHint: 'Single fill, no partial matches.',
                balanceText: giveBalanceText,
                onMax: onGiveMax || null,
                maxDisabled: !giveBalance,
                // No From row in the card; From is the standard's first section.
            }}
            get={{
                label: 'You get',
                help: getTokenHelp,
                // No network control; the card shows the asset's network read-only.
                asset: getTick && getChainId ? { chainId: getChainId, tick: getTick } : null,
                assetLabel: 'Get token',
                onOpenAsset: () => setGetPickerOpen(true),
                amount: getAmount,
                onAmountChange: amountInput(setGetAmount),
                amountLabel: 'Get amount',
                ownership: getOwnership,
                ownershipHint: 'The matcher hands over this token name.',
                // Receive at is required here; Quick picks from the
                // wallet, Full also takes a typed or pasted address.
                address: (
                    <QuickAddressRow
                        label="Receive at"
                        help={receiveHelp}
                        address={getAddress.trim()}
                        placeholder="Choose a receive address"
                        onPick={() => setReceivePickerOpen(true)}
                        pickLabel="Choose receiving address"
                    />
                ),
            }}
            onFlip={flipSides}
            rate={rateLine}
        />
    );

    // The Full body of the main section: every give and get field in
    // one open section (Receive at with the get side), then the rate.
    const fullSwap = (
        <>
                        <TokenField
                            label="Give token"
                            help={giveTokenHelp}
                            value={giveTick && giveChainId ? { chainId: giveChainId, tick: giveTick } : null}
                            onOpenPicker={() => setGivePickerOpen(true)}
                        />
                        {giveOwnership ? null : (
                            <AmountField
                                label="Give amount"
                                help="How many of the give token to escrow for this cross-chain swap. The give side stays escrowed until a match, cancellation, or expiration."
                                amount={giveAmount}
                                tick={giveTick}
                                onAmountFieldChange={amountInput(setGiveAmount)}
                                onMax={onGiveMax}
                                maxDisabled={!giveBalance}
                                balanceText={giveBalanceText}
                            />
                        )}
                        {/* No Get network field; the get token decides it. */}
                        <AddressField
                            label="Receive at"
                            icon="addresses"
                            help={receiveHelp}
                            value={getAddress}
                            onChange={(e) => {
                                setGetAddress(e.target.value);
                                setGetAddressTouched(true);
                            }}
                            onIconClick={() => setReceivePickerOpen(true)}
                            iconLabel="Choose receiving address"
                            placeholder="Automatically filled from your wallet on the get network"
                            autoComplete="off"
                        />
                        <TokenField
                            label="Get token"
                            help={getTokenHelp}
                            value={getTick && getChainId ? { chainId: getChainId, tick: getTick } : null}
                            onOpenPicker={() => setGetPickerOpen(true)}
                        />
                        {getOwnership ? null : (
                            <AmountField
                                label="Get amount"
                                help="How many of the get token the matcher must provide on the get network in exchange for your escrowed tokens."
                                amount={getAmount}
                                tick={getTick}
                                onAmountFieldChange={amountInput(setGetAmount)}
                            />
                        )}
                        {rateLine}
        </>
    );

    // The Swap Terms fields, one optional section in both views, so Quick's
    // terms row expands in place and never switches to Full. The section
    // carries the Optional tag, so the fields carry none.
    const termsFields = (
        <>
                        {/* A choice among a few named options is the icon dropdown (G44);
                            Expires always shows and follows it (operator 2026-11-13). */}
                        <ExpirationFields
                            name="xswap-exp"
                            mode={expMode}
                            input={expInput}
                            onChange={(mode, input) => { setExpMode(mode); setExpInput(input); }}
                            help="How long this cross-chain swap stays open for matching. Cancel from My swaps or let the offer expire to return the escrow to the source address. Paid transaction fees are not refunded."
                            expiresHelp="The local date and time when this cross-chain swap stops accepting matches. Set by the Expiration choice, or pick a time to expire at a specific time."
                        />
        </>
    );

    // The Lists section: who may match the swap.
    const listsFields = (
        <>
                        {/* Allow and block lists (give-network lists, as on Swap) are
                            picker fields like Token, never grey buttons. */}
                        <ListField
                            label="Allow list"
                            help="Only addresses on this list can match the swap. Pick an address list you published in My Lists on the give network."
                            placeholder="None set"
                            valueText={pickedListText(allowListIdx, allowListPick)}
                            onOpenPicker={() => setListPickerFor('allow')}
                            onClear={() => setAllowListIdx('')}
                            clearLabel="Clear allow list"
                        />
                        <ListField
                            label="Block list"
                            help="Addresses on this list cannot match the swap. Pick an address list you published in My Lists on the give network."
                            placeholder="None set"
                            valueText={pickedListText(blockListIdx, blockListPick)}
                            onOpenPicker={() => setListPickerFor('block')}
                            onClear={() => setBlockListIdx('')}
                            clearLabel="Clear block list"
                        />
        </>
    );

    return wrap(
        <FormFrame
            demoGuard={demoGuard}
            label="Cross-chain swap"
            onSubmit={handleReview}
            data-form-standard="cross-chain-swap"
            // The review composes the terms as they stand at Review, so the
            // fields hold still until the confirm page opens.
            inert={actionConfirm.composing ? '' : undefined}
            aria-busy={actionConfirm.composing ? 'true' : undefined}
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
                    onNetworkChange={changeGiveChain}
                    networkHelp={giveNetworkHelp}
                    address={fromAddress?.address || null}
                    onOpenPicker={() => setSourcePickerOpen(true)}
                    pickerLabel="Choose source address"
                    addressHelp={fromHelp}
                    revealKey={revealOn(!fromAddress)}
                    // Only once loaded and the give network has no
                    // address, so a slow read never opens From for good.
                    missing={giveChainId && !(addressesByChain[giveChainId] || []).length ? (
                        <FormNotice variant="error">No address on the give network.</FormNotice>
                    ) : null}
                />
            )}
            fee={(
                /* Off Bitcoin the native-coin protocol fee is mandatory, so the
                   card's switch renders as a disclosure rather than a choice -
                   the same treatment every other ORDER/SWAP surface gives it. */
                <FeeSection
                    {...bind('fee')}
                    chainId={giveChainId}
                    coinTicker={giveTicker || ''}
                    tiers={feeTiers}
                    value={feePick}
                    onChange={setFeePick}
                    customEstimate={feeCustomEstimate}
                    revealKey={revealOn(feeHasError)}
                    fees={{
                        quote: protocolFeeQuote,
                        pending: protocolFeePending,
                        waiting: protocolFeeWaiting,
                        // A swap inside the free period costs no protocol fee.
                        free: expirationWithinFreePeriod(expMode, expInput),
                        nativeFeeProps: { ...nativeFee.toggleProps, coinTicker: giveTicker || '' },
                    }}
                />
            )}
            status={[
                offlineNote,
                validationError ? (
                    <StatusMessage key="validation" variant="error">{validationError}</StatusMessage>
                ) : null,
                formError ? (
                    <StatusMessage key="form" variant="error">{formError}</StatusMessage>
                ) : null,
            ]}
            action={(
                <FormAction
                    icon={<Icon.SwapIcon />}
                    loading={actionConfirm.composing}
                    disabled={actionConfirm.composing || !networkAvailable}
                    title={!networkAvailable ? 'Swapping needs a network connection' : undefined}
                >
                    {actionConfirm.composing
                        ? 'Preparing Cross-Chain Swap…'
                        : 'Create Cross-Chain Swap'}
                </FormAction>
            )}
        >
            {/* The main section, open, holds both sides in either view. */}
            <FormSection
                id="swap"
                title="Cross-Chain Swap"
                icon={Icon.SwapIcon}
                {...bind('swap')}
                revealKey={revealOn(swapHasError)}
                summary={swapSummary}
            >
                {/* One form either way (operator 2026-11-13): Quick | Full only
                    restyles this section's give and get inputs. */}
                <ViewSwitch value={view} onChange={setView} label="Swap input style" inSection />
                {view === 'quick' ? quickSwap : fullSwap}
            </FormSection>
            {/* Both ownership switches live in one optional section in both styles. */}
            <FormSection
                id="ownership"
                title="Ownership"
                icon={Icon.KeyIcon}
                optional
                {...bind('ownership')}
                summary={giveOwnership || getOwnership ? 'Single fill' : 'Amounts'}
            >
                {giveOwnershipToggle}
                {getOwnershipToggle}
            </FormSection>
            <FormSection
                id="options"
                title="Swap Terms"
                icon={Icon.FilterIcon}
                optional
                {...bind('options')}
                revealKey={revealOn(termsHasError)}
                summary={termsSummary}
            >
                {termsFields}
            </FormSection>
            <FormSection
                id="lists"
                title="Lists"
                icon={Icon.ListIcon}
                optional
                {...bind('lists')}
                revealKey={revealOn(listsHasError)}
                summary={listsSummary}
            >
                {listsFields}
            </FormSection>
            <MemoSection
                {...bind('memo')}
                revealKey={revealOn(memoHasError)}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                maxLength={MAX_MEMO_LENGTH}
            />
        </FormFrame>,
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
