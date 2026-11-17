// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusNoticeOnAttempt } from '../hooks/useFocusNoticeOnAttempt.js';
import { AddressField, AddressText, Button, ChainBadge, FieldNote, FormNotice, FormPage, Icon, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { ListField } from '../components/ListField.jsx';
import { ExpirationFields, expirationParam, expirationWithinFreePeriod } from '../components/expirationChoice.jsx';
// Swap renders through the shared Give/Get standard (Quick and Full views of one state).
import {
    GiveGetQuick,
    OwnershipToggle,
    RateLine,
    useGiveGetView,
    ViewSwitch,
} from '../components/giveGet/index.js';
// The Wallet Form Standard frame (From, Swap, Ownership, Swap Terms, Network fee, action).
import { FeeSection, FormAction, FormFrame, FormSection, FromSection, MemoSection, joinSummary } from '../components/formStandard/index.js';
import { decoder as decoderLib, registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { useGatedTickNotice, gatedTickWarningCopy } from '../hooks/useGatedTickNotice.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { ConfirmActionModal } from '../components/ConfirmActionModal.jsx';
import { AmountField } from '../components/AmountField.jsx';
import { useTickBalance } from '../hooks/useTickBalance.js';
import { compareDecimalStrings, divideDecimalStrings, formatWithThousands, tokenAmountPrecisionError } from '../utils/amountFormat.js';
import { orderGiveParts } from '../utils/confirmSummaryParts.js';
import { addressValidationError } from '../utils/addressValidation.js';
import { TokenField } from '../components/TokenField.jsx';
import { TokenPicker } from './TokenPicker.jsx';
import { coinFromChainId } from '../components/BalanceList.jsx';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { ListPickerScreen } from '../components/ListPickerScreen.jsx';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useNetworkOffline } from '../hooks/useNetworkOffline.js';
import { useHideReachabilityNotice } from '../components/hideReachabilityNotice.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import { actionDisplayLabel } from '../utils/actionDisplayLabel.js';
import { pickedListText } from '../utils/listLabel.js';
import { t } from '../../i18n/index.js';
import { revealFormStatus } from '../../ui/FormErrorSummary.jsx';
import '../../i18n/locales/en/palette.js';
import { NATIVE_FEE_WARNING } from '../../sdk/nativeFeePreflight.js';
import { MAX_MEMO_LENGTH, memoCharacterError, memoLengthError } from '../utils/memoLimit.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import {
    hasAnyAddress,
    preferredSourceId,
    signingAddressesByChain,
    WATCH_ONLY_SIGNING_MESSAGE,
} from '../addressSelection.js';
import { pickDefaultChainId, recordLastUsedChain } from '../chainSelection.js';
import { formatLocalDateTime } from '../utils/dateTime.js';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { customFeeReviewStop } from '../../flows/feeEstimate.js';
import styles from './IssueTokenForm.module.css';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { useTokenInfo } from '../hooks/useTokenInfo.js';
import { useProtocolFeeQuote } from '../hooks/useProtocolFeeQuote.js';
import { normalizeProtocolFee } from '../../flows/protocolFeeRow.js';

const chainRegistry = registryLib.defaultRegistry();
const NO_ACKNOWLEDGMENTS = new Set();

// Protocol coin tickers per xchain-sdk VALID_COINS. `descriptor.coin` is
// long-form ('bitcoin' / 'litecoin' / 'dogecoin'); SWAP serializes the
// short-form tickers in GIVE_COIN / GET_COIN.
const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

const isPlainPositive = (value) => /^\d+(\.\d+)?$/.test(String(value).trim())
    && compareDecimalStrings(String(value).trim(), '0') === 1;

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

function withFormattedExpiration(confirmAction) {
    const decoded = confirmAction?.composed?.decoded;
    if (!decoded || !Array.isArray(decoded.details)) return confirmAction;
    const details = decoded.details.map((detail) => {
        if (!/expir/i.test(String(detail?.label || ''))) return detail;
        const unixSec = Number(detail.value);
        if (!Number.isFinite(unixSec) || unixSec <= 0 || unixSec >= 10_000_000_000) return detail;
        return { ...detail, value: formatLocalDateTime(unixSec) };
    });
    return {
        ...confirmAction,
        composed: {
            ...confirmAction.composed,
            decoded: { ...decoded, details },
        },
    };
}

/**
 * §41.5 SWAP authoring surface.
 *
 * Builds a v0 Create SWAP: atomic token-pair swap that settles in one
 * transaction with no COINPAY follow-up. The v0 form is deliberately
 * single-chain in the default UX (GIVE_COIN = GET_COIN = current
 * chain's native ticker) because the common case is "swap MYTOKEN for
 * COOLCOIN on Bitcoin". Cross-chain swaps use the same SWAP primitive
 * but are out-of-scope for the Phase 3 form.
 *
 * SWAP does NOT work with native coin (BTC / LTC / DOGE). That's
 * what DISPENSER is for. The form rejects inputs where GIVE_TICK or
 * GET_TICK match the chain's native ticker.
 *
 * Ownership trading: either side can trade the token's *ownership
 * record* (the asset name) instead of a balance via the give/get
 * ownership toggles (GIVE_OWNERSHIP / GET_OWNERSHIP). Ownership trades
 * carry no amount and are single-fill; ownership-for-ownership swaps set
 * both toggles.
 *
 * Cancel (v1) and Edit (v2) share the same `swapAction` core flow
 * but route through a future "My swaps" surface; not built here.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 * @param {string} [props.initialChainId]       seed the chain (e.g. launched from ManageToken)
 * @param {string} [props.initialGiveTick]      prefill the give ticker
 * @param {boolean} [props.initialGiveOwnership] open in give-ownership mode (sell a token name)
 */
export function SwapForm({ walletId, onBack, initialChainId, initialGiveTick, initialGiveOwnership }) {
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

    const [chainId, setChainId] = useState(/** @type {string | null} */ (initialChainId || null));
    const [fromAddressId, setFromAddressId] = useState(
        /** @type {string | null} */ (null),
    );
    const [giveTick, setGiveTick] = useState((initialGiveTick || '').toUpperCase());
    // PC-26: swap settlement carries no gated-key handoff; warn when the
    // give-side token has gated content.
    const gatedGiveNotice = useGatedTickNotice({ messaging, chainId, tick: giveTick });
    const [giveAmount, setGiveAmount] = useState('');
    const [giveOwnership, setGiveOwnership] = useState(!!initialGiveOwnership);
    const [getTick, setGetTick] = useState('');
    const [getAmount, setGetAmount] = useState('');
    const [getOwnership, setGetOwnership] = useState(false);
    const [memo, setMemo] = useState('');
    // PC-18: the rest of the SWAP v0 field set the same-chain form was missing.
    // 'default' is 3 months; the presets fill expInput, which Expires shows.
    const [expMode, setExpMode] = useState(/** @type {'default' | '6m' | '9m' | '1y' | 'custom'} */ ('default'));
    const [expInput, setExpInput] = useState('');
    const [allowListIdx, setAllowListIdx] = useState('');
    const [blockListIdx, setBlockListIdx] = useState('');
    // The picked lists' names, so the fields show a name (G114).
    const [allowListPick, setAllowListPick] = useState(/** @type {{ index: string, name: unknown } | null} */ (null));
    const [blockListPick, setBlockListPick] = useState(/** @type {{ index: string, name: unknown } | null} */ (null));
    const [getAddress, setGetAddress] = useState('');
    const [listPickerFor, setListPickerFor] = useState(/** @type {'allow' | 'block' | null} */ (null));
    // View and section open state live above every early return, so a picker
    // page or the confirm screen never resets them. From, Ownership, Swap
    // Terms (options) and Network fee start closed; Swap starts open.
    const giveGetView = useGiveGetView('swap', {
        sections: { from: false, swap: true, ownership: false, options: false, lists: false, memo: false, fee: false },
    });
    // Counts review attempts, so a section holding an error reopens on
    // every attempt even after the user closed it (the standard's revealKey).
    const [reviewAttempt, setReviewAttempt] = useState(0);
    const { payFeeInNativeCoin, setPayFeeInNativeCoin, mandatory: nativeFeeMandatory } =
        useNativeFee(chainId);
    const [password, setPassword] = useState('');
    const [givePickerOpen, setGivePickerOpen] = useState(false);
    const [getPickerOpen, setGetPickerOpen] = useState(false);
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);

    const [stage, setStage] = useState(
        /** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'),
    );
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const markReviewAttempt = useFocusNoticeOnAttempt();
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const [hwStatus, setHwStatus] = useState('idle');
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const submitPendingRef = useRef(false);
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);
    // §20: the active wallet's mode decides which addresses can swap, and a
    // watch-only wallet takes the encode-only branch.
    const { walletMode, isWatcherMode } = useWalletMode();

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            messaging.getAddressesByChain(walletId),
            typeof messaging.getActiveAddresses === 'function'
                ? messaging.getActiveAddresses(walletId)
                : Promise.resolve({}),
            // Best-effort, like useActionForm: the last-used chain default
            // needs the settings in the same load, never a beat later.
            typeof messaging.getSettings === 'function'
                ? Promise.resolve(messaging.getSettings()).catch(() => null)
                : Promise.resolve(null),
        ])
            .then(([byChain, active, settings]) => {
                if (cancelled) return;
                const signingByChain = signingAddressesByChain(byChain, walletMode);
                setAddressesByChain(signingByChain);
                setActiveByChain(active || {});
                if (!Object.keys(signingByChain)[0]) {
                    setLoadError(hasAnyAddress(byChain)
                        ? WATCH_ONLY_SIGNING_MESSAGE
                        : 'No addresses on any network yet. Use Receive to generate one before creating a swap.');
                    return;
                }
                // Don't clobber a caller-seeded chain (ManageToken sell flow).
                setChainId((c) => pickDefaultChainId(signingByChain, { explicitChainId: c, settings }));
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging, walletMode]);

    useEffect(() => {
        if (!chainId || !addressesByChain) return;
        // Default the from-address to the chain's active address (else newest
        // HD external), matching Send. A pick already on this chain stays: a
        // From picked on another chain switches the chain first, and this
        // run must not replace that pick with the new chain's default.
        const addrs = addressesByChain[chainId] || [];
        setFromAddressId((current) => (
            addrs.some((a) => a.id === current)
                ? current
                : preferredSourceId(addrs, activeByChain[chainId])
        ));
    }, [chainId, addressesByChain, activeByChain]);

    // Focus password field immediately on entering review so the user can
    // sign without reaching for the mouse (mirrors DestroyForm behaviour).
    useEffect(() => {
        if (stage === 'review') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    const fromAddress = useMemo(() => {
        if (!addressesByChain || !fromAddressId || !chainId) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [addressesByChain, chainId, fromAddressId]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';

    // Source balance of the give ticker, backing the give AmountField's
    // Max button + "available" footer.
    const giveBalance = useTickBalance({
        messaging,
        walletId,
        chainId,
        address: fromAddress?.address,
        tick: giveTick,
    });
    const giveTokenInfo = useTokenInfo({
        chainId,
        tick: giveTick,
        skip: giveOwnership || !giveTick.trim(),
    });
    const getTokenInfo = useTokenInfo({
        chainId,
        tick: getTick,
        skip: getOwnership || !getTick.trim(),
    });
    const hw = isHwSource(fromAddress);
    const hwSignerInfo = useSignerInfo({
        walletId,
        signerId: hw ? fromAddress?.signerId : null,
    });

    const expError = useMemo(() => {
        return expirationValidationError(expMode, expInput);
    }, [expMode, expInput]);

    const validationError = useMemo(() => {
        if (!giveTick) return null;
        if (!getTick) return null;
        // SWAP does NOT work with native coin per protocol rules.
        if (coinTicker && giveTick.toUpperCase() === coinTicker) {
            return `${actionDisplayLabel('SWAP')} cannot give ${coinTicker}. Use ${actionDisplayLabel('DISPENSER')} for token to native coin.`;
        }
        if (coinTicker && getTick.toUpperCase() === coinTicker) {
            return `${actionDisplayLabel('SWAP')} cannot get ${coinTicker}. Use ${actionDisplayLabel('DISPENSER')} for token to native coin.`;
        }
        if (giveTick.toUpperCase() === getTick.toUpperCase()) {
            return 'Give and get tickers must differ.';
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
            const addressError = addressValidationError(getAddress, descriptor);
            if (addressError) return addressError;
        }
        if (allowListIdx && !isPositiveActionIndex(allowListIdx)) return 'Allow-list ID must be a positive whole number.';
        if (blockListIdx && !isPositiveActionIndex(blockListIdx)) return 'Block-list ID must be a positive whole number.';
        if (memo.includes('|') || memo.includes(';')) return 'Memo cannot contain "|" or ";".';
        const memoError = memoLengthError(memo.trim()) || memoCharacterError(memo.trim());
        if (memoError) return memoError;
        return null;
    }, [giveTick, getTick, coinTicker, giveOwnership, giveAmount, getOwnership, getAmount,
        giveTokenInfo?.divisibility, getTokenInfo?.divisibility, giveBalance, getAddress,
        descriptor, allowListIdx, blockListIdx, memo]);

    const rate = !giveOwnership && !getOwnership
        ? divideDecimalStrings(getAmount, giveAmount, 8)
        : null;
    const displayedRate = rate === '0' && isPlainPositive(getAmount) && isPlainPositive(giveAmount)
        ? '< 0.00000001'
        : rate;
    const rateText = displayedRate
        ? `1 ${giveTick.trim().toUpperCase()} = ${displayedRate} ${getTick.trim().toUpperCase()}`
        : 'Enter both amounts to see the rate';

    // §20 / Cluster W FOLLOWUP 5: watcher-mode encode-only branch
    // (`isWatcherMode` is read above, with the address load).

    // Network fee: Low / Normal / Fast / Custom, editable via FeeSelector on
    // the form stage. `feeEstimate` is the estimate for the current pick and
    // backs both the slider readout and the review row; `feePerKb` prices the
    // broadcast. Mirrors ComposeMessage / DispenserDetail.
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

    // Wire-format SWAP v0 params: the one definition the confirm compose and
    // the legacy submit both use.
    const swapParams = useMemo(() => ({
        VERSION: '0',
        GIVE_COIN: coinTicker,
        GIVE_TICK: giveTick.trim(),
        // Ownership side escrows the token's ownership record. No amount;
        // otherwise serialize the balance amount.
        ...(giveOwnership
            ? { GIVE_OWNERSHIP: '1' }
            : { GIVE_AMOUNT: String(giveAmount).trim() }),
        GET_COIN: coinTicker,
        GET_TICK: getTick.trim(),
        ...(getOwnership
            ? { GET_OWNERSHIP: '1' }
            : { GET_AMOUNT: String(getAmount).trim() }),
        ...(getAddress.trim() ? { GET_ADDRESS: getAddress.trim() } : {}),
        // EXPIRATION is a wall-clock Unix timestamp (not blocks); 'default'
        // omits it so the indexer applies its standard window.
        ...((() => {
            const expiration = expirationParam(expMode, expInput);
            return expiration ? { EXPIRATION: expiration } : {};
        })()),
        ...(allowListIdx ? { ALLOW_LIST: allowListIdx } : {}),
        ...(blockListIdx ? { BLOCK_LIST: blockListIdx } : {}),
        ...(memo.trim() ? { MEMO: memo.trim() } : {}),
    }), [coinTicker, giveTick, giveOwnership, giveAmount, getTick, getOwnership, getAmount, getAddress, expMode, expInput, allowListIdx, blockListIdx, memo]);
    const swapQuoteActionData = useMemo(() => {
        if (!fromAddress?.address || !chainId || !giveTick.trim() || !getTick.trim()) return null;
        if ((!giveOwnership && !giveAmount) || (!getOwnership && !getAmount)) return null;
        if (validationError || expError) return null;
        return { action: 'SWAP', params: swapParams };
    }, [fromAddress?.address, chainId, giveTick, getTick, giveOwnership, giveAmount,
        getOwnership, getAmount, validationError, expError, swapParams]);
    const { quote: protocolFeeQuote, pending: protocolFeePending, waiting: protocolFeeWaiting } = useProtocolFeeQuote({
        messaging,
        chainId,
        source: fromAddress?.address,
        actionData: swapQuoteActionData,
    });
    const legacyDecoded = useMemo(() => {
        if (stage !== 'review' && stage !== 'submitting') return null;
        const decoded = decoderLib.decodeAction({ action: 'SWAP', params: swapParams, chainId, chainRegistry });
        if (!payFeeInNativeCoin) return decoded;
        return { ...decoded, warnings: [...(decoded.warnings || []), NATIVE_FEE_WARNING] };
    }, [chainId, payFeeInNativeCoin, stage, swapParams]);
    const quotedProtocolFee = normalizeProtocolFee(protocolFeeQuote);
    const legacyComposed = legacyDecoded ? {
        action: 'SWAP',
        chainId,
        decoded: legacyDecoded,
        quote: protocolFeeQuote,
        protocolFeeKnownFree: quotedProtocolFee.known && quotedProtocolFee.free,
    } : null;

    // (§5.6 slice 2): the software path composes ONE PSBT
    // host-side and confirms it on the shared confirm page; hardware +
    // watcher keep the legacy review stage.
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    const singleEncode = !isWatcherMode;
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    // Hardware signs the SAME prebuilt PSBT through the same host
    // flow, with the device standing in for the password.
    const submitConfirmed = useConfirmSubmit({
        messaging,
        isHw: hw,
        signerId: fromAddress?.signerId,
        passwordRef: passwordValueRef,
        software: 'swapAction',
        hardware: 'swapActionHw',
    });

    // Compose + tamper-check + pre-flight all run HOST-side; Approve signs the
    // byte-identical prebuilt PSBT. Reject is a calm no-op back to the form.
    async function openConfirmScreen() {
        if (!networkAvailable) return;
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
            const res = await actionConfirm.run({
                chainId,
                from,
                actionData: { action: 'SWAP', params: swapParams },
                encoderOpts: {
                    payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
                onApprove: (prebuiltPsbt) => submitConfirmed({
                    walletId,
                    chainId,
                    from,
                    params: swapParams,
                    payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                    ...(feePerKb != null ? { feePerKb } : {}),
                    prebuiltPsbt,
                }),
            });
            setResult(res);
            setPassword('');
            setStage('done');
            recordLastUsedChain(messaging, chainId);
        } catch (err) {
            if (isUserRejection(err)) return;
            // Same mapping the sign path already does: NativeFeeForfeitError's own message is
            // wire wording, and this confirm path is the one the flow actually takes.
            setFormError(submitFailureMessage(err, {
                chainId,
                coinTicker,
                mandatory: nativeFeeMandatory,
                fallback: err?.message || 'Swap failed.',
            }));
        } finally {
            submitPendingRef.current = false;
        }
    }

    // handleReview validates the form then moves to the review stage.
    // No signing happens here: the actual flow calls live in handleSubmit
    // and are only reachable after the user confirms on the review screen.
    function handleReview(event) {
        event.preventDefault();
        setReviewAttempt((n) => n + 1);
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        if (feeStop) { setFormError(feeStop.formError); return; }
        // G130: Create Swap is never disabled; offline, the tap brings the
        // form's one offline notice into view and focuses it.
        if (!networkAvailable) {
            if (!revealFormStatus(event.currentTarget)) setFormError('Swapping needs a network connection.');
            return;
        }
        markReviewAttempt();
        if (!fromAddress || !chainId) {
            setFormError('Pick a source address first.');
            return;
        }
        if (!giveTick || !getTick
            || (!giveOwnership && !giveAmount)
            || (!getOwnership && !getAmount)) {
            setFormError('Enter the give and get tickers and amounts before reviewing.');
            return;
        }
        if (validationError || expError) return;
        // The memoized check keeps the clock of the last edit, so ask again now.
        if (expirationValidationError(expMode, expInput)) {
            setFormError('Expiration must be a future date and time.');
            return;
        }
        setFormError(null);
        if (singleEncode) {
            if (submitPendingRef.current) return;
            submitPendingRef.current = true;
            void openConfirmScreen();
            return;
        }
        setStage('review');
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (!networkAvailable) return;
        if (stage === 'submitting' || submitPendingRef.current) return;
        if (!fromAddress || !chainId) return;
        const freshExpirationError = expirationValidationError(expMode, expInput);
        if (validationError || freshExpirationError) {
            if (freshExpirationError) setSubmitError(freshExpirationError);
            return;
        }
        if (!isWatcherMode && !hw && (!signerReady && password.length === 0)) return;
        if (!isWatcherMode && hw && hwStatus !== 'available') return;

        submitPendingRef.current = true;
        setStage('submitting');
        setSubmitError(null);
        try {
            const params = swapParams;
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
                payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                ...(feePerKb != null ? { feePerKb } : {}),
            };
            let r;
            if (isWatcherMode) {
                r = await messaging.buildActionPsbtRequest({
                    chainId,
                    from: base.from,
                    actionData: { action: 'SWAP', params },
                    encoderOpts: {
                        payFeeInNativeCoin: payFeeInNativeCoin || undefined,
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
            recordLastUsedChain(messaging, chainId);
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : submitFailureMessage(err, {
                        chainId,
                        coinTicker,
                        mandatory: nativeFeeMandatory,
                        fallback: err?.message || 'Sign failed.',
                    }),
            );
            // Stay on review rather than dropping back to the form so the
            // user can correct their password without re-entering swap terms.
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
    const header = (
        <PageHeader
            nested={stage === 'review'}
            onBack={stage === 'review'
                ? () => { setStage('form'); setSubmitError(null); }
                : onBack}
            title={stage === 'review' || stage === 'submitting'
                ? 'Review Swap'
                : `Swap Tokens`}
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
    // Every state lays out through FormPage, so the offline notice joins the
    // FormPage status of whichever state shows instead of sitting in Screen.
    const offlineNotice = !networkAvailable ? (
        <StatusMessage key="offline" variant="warning">Swapping needs a network connection.</StatusMessage>
    ) : null;

    if (loadError) {
        return wrap(
            <FormPage
                label="Swap tokens"
                status={[offlineNotice, <StatusMessage key="load-error" variant="error">{loadError}</StatusMessage>]}
            />,
        );
    }

    if (stage === 'done') {
        const txid = result?.txid;
        // A queued result is SIGNED and not broadcast. The confirm
        // pipeline resolves that case rather than throwing, so without this
        // branch the done screen below reports it as a completed action.
        if (result?.queued) {
            return wrap(
                <FormPage as="div" label="Swap result" status={[offlineNotice]}>
                    <ResultScreen state="signed-not-broadcast" onDone={onBack} unsaved={result.unsaved} />
                </FormPage>,
            );
        }
        if (result?.psbtHex && !txid) {
            return wrap(
                <FormPage as="div" label="Swap result" status={[offlineNotice]}>
                    <ResultScreen
                        state="unsigned"
                        result={result}
                        onBuildAnother={handleBuildAnother}
                        onDone={onBack}
                    />
                </FormPage>,
            );
        }
        return wrap(
            <FormPage
                as="div"
                label="Swap result"
                status={[offlineNotice]}
                actions={<Button variant="success" icon={<Icon.CheckIcon />} onClick={onBack}>Done</Button>}
            >
                <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>Swap sent</p>
                {txid ? (
                    <p style={{ margin: '0 0 0.5rem' }}>
                        Transaction: <code>{txid}</code>
                    </p>
                ) : null}
                <p className={styles.hint}>
                    Your swap is now open. It settles automatically when a
                    counterparty matches it; until then you can cancel or edit
                    it from its entry in your activity.
                </p>
            </FormPage>,
        );
    }

    if (!addressesByChain) {
        // The same frame as the form, so the offline notice keeps its
        // node when the addresses arrive instead of being drawn twice.
        return wrap(
            <FormFrame label="Swap tokens" status={[offlineNotice]} action={null}>
                <p className={styles.hint}>Loading wallet…</p>
            </FormFrame>,
        );
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
                chainLabel={descriptor?.displayName || chainId}
                screenVariant={variant}
                error={submitError}
                sourceAddress={fromAddress?.address}
                nativeTicker={coinTicker}
                credentials={<p className={styles.hint}>{t('common.watcherBuildsUnsigned')}</p>}
                credentialsReady
                summary={{
                    verb: t('palette.tradeSwap.title'),
                    ...orderGiveParts(swapParams, coinTicker),
                    chainId,
                    address: fromAddress?.address,
                    facts: [
                        ...(!giveOwnership && !getOwnership ? [{ label: 'Rate', value: rateText }] : []),
                        {
                            label: 'Expiration',
                            value: swapParams.EXPIRATION
                                ? formatLocalDateTime(Number(swapParams.EXPIRATION))
                                : '3 months',
                        },
                    ],
                    ...(!payFeeInNativeCoin && quotedProtocolFee.known ? {
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

    // --- Form screen ----------------------------------------------------
    const chainIds = Object.keys(addressesByChain || {});

    // confirm page, rendered in place of the form (the overlay modal
    // didn't fit small/mobile viewports); form state stays intact behind it.
    if (actionConfirm.open) {
        return (
            <ActionConfirmScreen
                confirmAction={withFormattedExpiration(actionConfirm.confirmAction)}
                summary={{
                    verb: t('palette.tradeSwap.title'),
                    ...orderGiveParts(swapParams, coinTicker),
                    chainId,
                    address: fromAddress?.address,
                }}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId}
                feeEstimate={feeEstimate}
                feeText={feeEstimate?.coinAmount
                    ? `Network fee: ${feeEstimate.coinAmount} ${coinTicker}`.trim()
                    : undefined}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                // Hardware swaps the password field for the device block
                // and gates Approve on the device being available (§5.1).
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
                // A picked token holds the swap to its network, as on the
                // Network field; before that, an address on another chain
                // moves the swap's Network there first.
                lockNetwork={Boolean(giveTick.trim() || getTick.trim())}
                onChainChange={changeChain}
                onPick={(a) => {
                    setFromAddressId(a.id);
                    setSourcePickerOpen(false);
                }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    if (listPickerFor) {
        return (
            <ListPickerScreen
                variant={variant}
                messaging={messaging}
                chainId={chainId}
                addresses={addressesByChain?.[chainId] || []}
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
                // The give picker lists every network the wallet holds
                // assets on; the picked asset's chain becomes the swap's network
                // (a new chain clears the chain-scoped values first).
                onSelect={(sel) => {
                    if (sel.chainId && sel.chainId !== chainId) changeChain(sel.chainId);
                    setGiveTick(String(sel.tick || '').toUpperCase());
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
                // A swap settles on one chain, so once a give token is
                // picked the get list holds to its network; with no give token
                // yet it lists every network and the pick sets the network.
                networkFilter={giveTick ? coinFromChainId(chainId) : undefined}
                chainIdFilter={giveTick ? chainId : undefined}
                onSelect={(sel) => {
                    if (sel.chainId && sel.chainId !== chainId) changeChain(sel.chainId);
                    setGetTick(String(sel.tick || '').toUpperCase());
                    setGetPickerOpen(false);
                }}
                onBack={() => setGetPickerOpen(false)}
            />
        );
    }

    // The network-change handler the token pickers call when the picked asset
    // lives on another chain. It clears every chain-scoped value (tokens,
    // receive address, list IDs), since each names something on one chain.
    function changeChain(cid) {
        if (cid === chainId) return;
        setChainId(cid);
        setGiveTick('');
        setGiveAmount('');
        setGiveOwnership(false);
        setGetTick('');
        setGetAmount('');
        setGetOwnership(false);
        setGetAddress('');
        setAllowListIdx('');
        setBlockListIdx('');
        setFormError(null);
    }

    // The same digits-only rule for every amount input, Quick or Full.
    const amountInput = (setter) => (rawValue) => {
        const stripped = String(rawValue).replace(/,/g, '');
        if (stripped !== '' && !/^\d*\.?\d*$/.test(stripped)) return;
        setter(stripped);
    };

    // The flip button swaps the whole side (token, amount, ownership).
    function flipSides() {
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

    // Swap Terms reads the expiry ("3 months" or "Expires <time>"), then any
    // Receive at; Lists names the lists set, else "None".
    const termsParts = [];
    const expParam = expirationParam(expMode, expInput);
    if (expMode === 'default') termsParts.push('3 months');
    else termsParts.push(expParam ? `Expires ${formatLocalDateTime(Number(expParam))}` : 'Custom expiry');
    if (getAddress.trim()) termsParts.push('Receive at set');
    // The standard's summaries join their parts with ", ".
    const termsSummary = joinSummary(...termsParts);
    const listsParts = [];
    if (allowListIdx) listsParts.push(`Allow list #${allowListIdx}`);
    if (blockListIdx) listsParts.push(`Block list #${blockListIdx}`);
    const allowListText = pickedListText(allowListIdx, allowListPick);
    const blockListText = pickedListText(blockListIdx, blockListPick);
    const listsSummary = listsParts.length ? joinSummary(...listsParts) : 'None';

    const sideSummary = (tick, amount, ownership) => {
        const upper = tick.trim().toUpperCase();
        if (!upper) return 'No token yet';
        if (ownership) return `Ownership of ${upper}`;
        return amount ? `${formatWithThousands(amount)} ${upper}` : upper;
    };
    // The Swap section's closed summary, "100 DANKEST for 5 COOL".
    const swapSummary = giveTickUpper || getTickUpper
        ? `${sideSummary(giveTick, giveAmount, giveOwnership)} for ${sideSummary(getTick, getAmount, getOwnership)}`
        : 'No tokens yet';

    const { view, setView, sections, setSectionOpen } = giveGetView;
    // Spread onto a standard section; the open state lives in
    // useGiveGetView above the early returns, so a picker page keeps it.
    // `main` flags Swap as the form's main section (data-form-main).
    const bind = (id) => ({ open: Boolean(sections[id]), onOpenChange: (open) => setSectionOpen(id, open), main: id === 'swap' });
    // A custom-expiry error lives beside its field; while Swap Terms
    // is closed it joins the status slot too, so Create Swap never fails silently.
    const expErrorHidden = expError && !sections.options;
    // Which section holds an error, so each review attempt reopens it.
    const termsHasError = Boolean(expError
        || (getAddress.trim() && addressValidationError(getAddress, descriptor)));
    const listsHasError = Boolean((allowListIdx && !isPositiveActionIndex(allowListIdx))
        || (blockListIdx && !isPositiveActionIndex(blockListIdx)));
    const memoError = memo.includes('|') || memo.includes(';')
        ? 'Memo cannot contain "|" or ";".'
        : (memoLengthError(memo.trim()) || memoCharacterError(memo.trim()) || null);
    const feeHasError = Boolean(customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate }));
    const swapHasError = Boolean(validationError || formError) && !termsHasError && !listsHasError && !memoError && !feeHasError;
    const revealOn = (hasError) => (hasError ? reviewAttempt : 0);

    // The ownership switches, built once and shown in whichever view is open.
    const giveOwnershipToggle = (
        <OwnershipToggle
            label="Give this token's ownership instead of an amount"
            help={`Escrow the token name's ownership record as a single-fill swap instead of giving a token balance. Transfers the entire ownership of ${giveTickUpper || 'this token'} (single-fill, no partial matches).`}
            checked={giveOwnership}
            onChange={setGiveOwnership}
        />
    );
    const getOwnershipToggle = (
        <OwnershipToggle
            label="Require the matcher to give that token's ownership instead of an amount"
            help={`Require the matcher to transfer the get token name's ownership record instead of providing a token balance. The matcher must currently own ${getTickUpper || 'this token'}; on match its ownership transfers to you.`}
            checked={getOwnership}
            onChange={setGetOwnership}
        />
    );
    const gatedNotice = gatedGiveNotice.gated && !giveOwnership ? (
        <FormNotice variant="warning" role="alert">
            {gatedTickWarningCopy(giveTick, 'the swap counterparty')}
        </FormNotice>
    ) : null;
    const rateLine = <RateLine text={rateText} />;
    const fromHelp = 'The address whose tokens are escrowed for this swap and that receives the token from the matched offer.';

    // The Quick body of the Swap section: the give and get cards, the
    // flip and the rate. From, Ownership and the terms are standard sections.
    const quickSwap = (
        <GiveGetQuick
            give={{
                label: 'You give',
                help: 'The token you put up in this swap. It is held in escrow until the offer is matched, cancelled or expires.',
                // No network control; the card shows the asset's network read-only.
                asset: giveTick && chainId ? { chainId, tick: giveTick } : null,
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
                help: 'The token you want in return. It is paid to your receive address when someone matches the offer.',
                asset: getTick && chainId ? { chainId, tick: getTick } : null,
                assetLabel: 'Get token',
                onOpenAsset: () => setGetPickerOpen(true),
                amount: getAmount,
                onAmountChange: amountInput(setGetAmount),
                amountLabel: 'Get amount',
                ownership: getOwnership,
                ownershipHint: 'The matcher hands over this token name.',
            }}
            onFlip={flipSides}
            notice={gatedNotice}
            rate={rateLine}
        />
    );

    // The Full body of the Swap section: every give and get field in
    // one open section, then the rate (the standard's Full drawing).
    const fullSwap = (
        <>
                        <TokenField
                            label="Give token"
                            help="The token you put up in this swap. It is held in escrow until the offer is matched, cancelled or expires."
                            value={giveTick && chainId ? { chainId, tick: giveTick } : null}
                            onOpenPicker={() => setGivePickerOpen(true)}
                        />
                        {gatedNotice}
                        {giveOwnership ? null : (
                            <AmountField
                                label="Give amount"
                                help="How many of the give token to escrow for this swap. The tokens stay escrowed until a match, cancellation, or expiration."
                                amount={giveAmount}
                                tick={giveTick}
                                onAmountFieldChange={amountInput(setGiveAmount)}
                                onMax={onGiveMax}
                                maxDisabled={!giveBalance}
                                balanceText={giveBalanceText}
                            />
                        )}
                        <TokenField
                            label="Get token"
                            help="The token you want in return. It is paid to your receive address when someone matches the offer."
                            value={getTick && chainId ? { chainId, tick: getTick } : null}
                            onOpenPicker={() => setGetPickerOpen(true)}
                        />
                        {getOwnership ? null : (
                            <AmountField
                                label="Get amount"
                                help="How many of the get token the matcher must provide in exchange for your escrowed tokens."
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
                            name="swap-exp"
                            mode={expMode}
                            input={expInput}
                            onChange={(mode, input) => { setExpMode(mode); setExpInput(input); }}
                            help="How long this swap stays open for matching. The tokens you give stay escrowed until a match, cancellation, or expiration. Cancel from My swaps or let the offer expire to return the escrow to the source address. Paid transaction fees are not refunded."
                            expiresHelp="When the swap offer stops being valid. Set by the Expiration choice, or pick a time to expire at a specific time."
                        />
                        {expError ? <FieldNote variant="error">{expError}</FieldNote> : null}
                        <AddressField
                            label="Receive at"
                            help="Address where you receive the get side. Defaults to your source address."
                            value={getAddress}
                            onChange={(e) => setGetAddress(e.target.value)}
                            // Blank means the source address; the Swap Terms
                            // section carries the Optional tag, so the field
                            // shows none but stays optional to assistive tech.
                            aria-required="false"
                            autoComplete="off"
                            autoCorrect="off"
                            spellCheck={false}
                        />
        </>
    );

    // The Lists section: who may match the swap.
    const listsFields = (
        <>
                        {/* Allow and block lists are picker fields like Token, never grey buttons. */}
                        <ListField
                            label="Allow list"
                            help="Only addresses on this list can match the swap. Pick an address list you published in My Lists."
                            placeholder="None set"
                            valueText={allowListText}
                            onOpenPicker={() => setListPickerFor('allow')}
                            onClear={() => setAllowListIdx('')}
                            clearLabel="Clear allow list"
                        />
                        <ListField
                            label="Block list"
                            help="Addresses on this list cannot match the swap. Pick an address list you published in My Lists."
                            placeholder="None set"
                            valueText={blockListText}
                            onOpenPicker={() => setListPickerFor('block')}
                            onClear={() => setBlockListIdx('')}
                            clearLabel="Clear block list"
                        />
        </>
    );

    return wrap(
        <FormFrame
            demoGuard={demoGuard}
            label="Swap tokens"
            onSubmit={handleReview}
            data-form-standard="swap"
            inert={actionConfirm.composing ? '' : undefined}
            aria-busy={actionConfirm.composing ? 'true' : undefined}
            onChangeCapture={() => { if (formError) setFormError(null); }}
            from={(
                <FromSection
                    {...bind('from')}
                    chainId={chainId}
                    chainIds={chainIds}
                    chainRegistry={chainRegistry}
                    // A picked token decides the network; before one
                    // is picked the network can still change here.
                    lockNetwork={Boolean(giveTickUpper || getTickUpper)}
                    onNetworkChange={changeChain}
                    networkHelp="The give token decides the network. A swap settles on one network."
                    address={fromAddress?.address || null}
                    onOpenPicker={() => setSourcePickerOpen(true)}
                    pickerLabel="Choose source address"
                    addressHelp={fromHelp}
                    revealKey={revealOn(!fromAddress)}
                    // Only once the addresses have loaded and this
                    // network has none, so a slow read never opens From for good.
                    missing={chainId && !(addressesByChain[chainId] || []).length ? (
                        <FormNotice variant="error">No signing address on this network.</FormNotice>
                    ) : null}
                />
            )}
            fee={(
                <FeeSection
                    {...bind('fee')}
                    chainId={chainId}
                    coinTicker={coinTicker}
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
                        nativeFeeProps: {
                            checked: payFeeInNativeCoin,
                            onChange: setPayFeeInNativeCoin,
                            coinTicker,
                            mandatory: nativeFeeMandatory,
                        },
                    }}
                />
            )}
            status={[
                offlineNotice,
                validationError || formError || expErrorHidden ? (
                    <Fragment key="form-errors">
                        {validationError ? (
                            <StatusMessage variant="error">
                                {validationError}
                            </StatusMessage>
                        ) : null}
                        {expErrorHidden && !validationError ? (
                            <StatusMessage variant="error">
                                {expError}
                            </StatusMessage>
                        ) : null}
                        {formError ? (
                            <StatusMessage variant="error">
                                {formError}
                            </StatusMessage>
                        ) : null}
                    </Fragment>
                ) : null,
            ]}
            action={(
                <FormAction
                    icon={<Icon.SwapIcon />}
                    loading={actionConfirm.composing}
                    title={!networkAvailable ? 'Swapping needs a network connection' : undefined}
                >
                    {actionConfirm.composing
                        ? 'Preparing Swap…'
                        : 'Create Swap'}
                </FormAction>
            )}
        >
            {/* The main section, open, holds the give and get fields in either view. */}
            <FormSection
                id="swap"
                title="Swap"
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
                inputId="swap-memo"
                {...bind('memo')}
                revealKey={revealOn(Boolean(memoError))}
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
