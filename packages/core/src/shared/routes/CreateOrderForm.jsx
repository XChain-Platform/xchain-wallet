// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AddressField, Button, FormNotice, FormPage, Icon, ListPage, PageHeader, Screen, StatusMessage, Switch } from '@xchain-wallet/core/ui';
import { ListField } from '../components/ListField.jsx';
import { WarningCard, WarningLine } from '../components/WarningCard.jsx';
import { ExpirationFields, expirationWithinFreePeriod } from '../components/expirationChoice.jsx';
// Create order renders through the shared Give/Get standard (Quick and Full views of one state).
import {
    GiveGetQuick,
    OwnershipToggle,
    RateLine,
    useGiveGetView,
    ViewSwitch,
} from '../components/giveGet/index.js';
// The Wallet Form Standard frame (From, Order, Ownership, Order Terms, Network fee, action).
import { FeeSection, FormAction, FormFrame, FormSection, FromSection, MemoSection, joinSummary } from '../components/formStandard/index.js';
import { withAdvancedOptions } from '../components/formStandard/advancedOptions.js';
import { TokenField } from '../components/TokenField.jsx';
import { MobileAutopayNotice } from '../components/MobileAutopayNotice.jsx';
import { TokenPicker } from './TokenPicker.jsx';
import { coinFromChainId } from '../components/BalanceList.jsx';
import { divideDecimalStrings, formatWithThousands } from '../utils/amountFormat.js';
import { formatLocalDateTime } from '../utils/dateTime.js';
import {
    registry as registryLib,
    decoder as decoderLib,
} from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { useSettings } from '../hooks/useSettings.js';
import { useConfirmAction } from '../hooks/useConfirmAction.js';
import { prebuiltPsbtFromComposed } from '../../flows/prebuiltPsbtFromComposed.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { ConfirmActionModal } from '../components/ConfirmActionModal.jsx';
import {
    resolvePreflightPrivacy,
} from '../../schemas/settings.js';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { useActionForm } from '../hooks/useActionForm.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { useProtocolFeeQuote } from '../hooks/useProtocolFeeQuote.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { customFeeReviewStop } from '../../flows/feeEstimate.js';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { ListPickerScreen } from '../components/ListPickerScreen.jsx';
import styles from './IssueTokenForm.module.css';
import { humanizeError } from '../utils/humanizeError.js';
import { pickedListText } from '../utils/listLabel.js';
import { MAX_MEMO_LENGTH, memoCharacterError, memoLengthError } from '../utils/memoLimit.js';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';
import { useTickBalance } from '../hooks/useTickBalance.js';
import { AmountField } from '../components/AmountField.jsx';
import { useTokenInfo } from '../hooks/useTokenInfo.js';
import { compareAmounts, multiplyAmounts } from '../../market/orderMath.js';
import { tokenAmountPrecisionError } from '../utils/amountFormat.js';
import { addressValidationError } from '../utils/addressValidation.js';
import { tickerReferenceError } from '../utils/tickerGrammar.js';
import { orderGiveParts } from '../utils/confirmSummaryParts.js';
import { normalizeProtocolFee } from '../../flows/protocolFeeRow.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';

// A classified failure (offline, rejected fee) keeps its own copy; an unclassified one gets plain order copy.
function orderFailureFallback(err) {
    const humanized = humanizeError(err, 'order');
    return humanized.cause === 'unknown'
        ? 'Could not create the order. Check the details and try again.'
        : humanized.message;
}
const chainRegistry = registryLib.defaultRegistry();
const NO_ACKNOWLEDGMENTS = new Set();

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

// datetime-local string -> Unix seconds (the indexer compares ORDER
// EXPIRATION as a wall-clock Unix timestamp, NOT a block height).
function localInputToUnix(localStr) {
    const ms = Date.parse(String(localStr));
    if (!Number.isFinite(ms)) return null;
    return Math.floor(ms / 1000);
}

// The indexer reads a coin-named ticker as an unknown token and marks the order
// invalid, so the native coin is chosen with the Native option, not typed.
const isNativeCoinName = (tick, coinTicker) => Boolean(coinTicker) && String(tick).trim().toUpperCase() === coinTicker;
// The Asset picker lists the coin itself, so the copy points there.
const nativeCoinTickMessage = (coinTicker) => `${coinTicker} is the network coin. Pick ${coinTicker} from the coin list in the Asset picker instead of typing it as a token.`;

// The amount as the order spells it: consensus reads 00012 as 12 and 2.50 as
// 2.5, so the plain form is what the confirm shows and the chain credits.
const wireAmount = (v) => multiplyAmounts(v, '1') ?? String(v).trim();

const isPlainPositive = (v) => /^\d+(\.\d+)?$/.test(String(v).trim()) && Number(String(v).trim()) > 0;
const isCanonicalActionIndex = (value, { allowZero = false } = {}) => (
    allowZero ? /^(?:0|[1-9]\d*)$/ : /^[1-9]\d*$/
).test(String(value ?? '').trim());

/**
 * Standalone Create Order form (PC-17). Composes a full ORDER v0 across
 * arbitrary same-chain pairs, including native-coin sides:
 *   VERSION|GIVE_COIN|GIVE_TICK|GIVE_AMOUNT|GIVE_OWNERSHIP|GET_COIN|GET_TICK|GET_AMOUNT|GET_OWNERSHIP|GET_ADDRESS|EXPIRATION|ALLOW_LIST|BLOCK_LIST|MEMO
 * An empty tick on a side = the chain's native coin (the COINPay-settled
 * lane); at least one side must carry a token (coin-for-coin is a regular
 * payment, matching the SDK validator). When the GIVE side is native coin,
 * the PC-16 auto-pay checkbox arms unattended settlement of the resulting
 * obligation (software signers only). Signs through the shared
 * software/HW/watcher lanes (orderAction / orderActionHw / watcher
 * encode-only) with the single-encode confirm page for software.
 *
 * Same-chain only (GIVE_COIN = GET_COIN = the posting chain's coin),
 * matching PlaceOrderPanel. An order whose GET side settles on another
 * chain is authored by CrossChainOrderForm.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 * @param {string} [props.initialChainId]
 * @param {string} [props.initialFromAddress]
 * @param {() => void} [props.onManageOrders]   optional deep-link to My Orders
 */
export function CreateOrderForm({ walletId, onBack, initialChainId, initialFromAddress, onManageOrders }) {
    const { messaging, shell } = useMessaging();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const variant = screenVariantFor(shell);
    const { isWatcherMode } = useWalletMode();

    const {
        addressesByChain,
        loadError,
        chainId,
        setChainId,
        chainsWithAddresses,
        fromAddress,
        setFromAddressId,
        descriptor,
        signerReady,
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
        noAddressMessage: 'No addresses on any network yet. Use Receive to generate one first.',
    });

    const coinTicker = descriptor ? (PROTOCOL_COIN_TICKER[descriptor.coin] || '') : '';

    // PC-51: native-coin protocol fee (ORDER is quotable); the
    // authoritative price check runs at submit via applyNativeFeePreflight.
    const nativeFee = useNativeFee(coinTicker);

    // GIVE / GET side state. type: 'token' (a tick) or 'coin' (native).
    const [giveType, setGiveType] = useState(/** @type {'token' | 'coin'} */ ('token'));
    const [giveTick, setGiveTick] = useState('');
    const [giveAmount, setGiveAmount] = useState('');
    const [giveOwnership, setGiveOwnership] = useState(false);
    const [getType, setGetType] = useState(/** @type {'token' | 'coin'} */ ('coin'));
    const [getTick, setGetTick] = useState('');
    const [getAmount, setGetAmount] = useState('');
    const [getOwnership, setGetOwnership] = useState(false);

    // Receive at shows the From address until the user edits it; an empty
    // edited value falls back to From, so no GET_ADDRESS is sent for it.
    const [getAddress, setGetAddress] = useState('');
    const [receiveEdited, setReceiveEdited] = useState(false);
    const [receiveError, setReceiveError] = useState(/** @type {string | null} */ (null));
    // 'default' is 3 months; the presets fill expInput, which Expires shows.
    const [expMode, setExpMode] = useState(/** @type {'default' | '6m' | '9m' | '1y' | 'custom'} */ ('default'));
    const [expInput, setExpInput] = useState('');
    const [allowListIdx, setAllowListIdx] = useState('');
    const [allowListCount, setAllowListCount] = useState(/** @type {number | null} */ (null));
    const [blockListIdx, setBlockListIdx] = useState('');
    const [blockListCount, setBlockListCount] = useState(/** @type {number | null} */ (null));
    // The picked lists' names, so the fields show a name (G114).
    const [allowListPick, setAllowListPick] = useState(/** @type {{ index: string, name: unknown } | null} */ (null));
    const [blockListPick, setBlockListPick] = useState(/** @type {{ index: string, name: unknown } | null} */ (null));
    const [memo, setMemo] = useState('');

    const [password, setPassword] = useState('');
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    const [listPickerFor, setListPickerFor] = useState(/** @type {'allow' | 'block' | null} */ (null));
    // The Asset picker page (coin plus tokens) and the Quick card's
    // Receive at picker; both open as pages in place of the form.
    const [assetPickerFor, setAssetPickerFor] = useState(/** @type {'give' | 'get' | null} */ (null));
    const [receivePickerOpen, setReceivePickerOpen] = useState(false);
    // The Quick | Full view and the section open state live here, above every
    // early return, so a picker page or the confirm screen never resets them.
    // From, Ownership, Order Terms (options) and Network fee start closed.
    const giveGetView = useGiveGetView('order', {
        sections: { from: false, order: true, ownership: false, options: false, lists: false, memo: false, fee: false },
    });

    const giveAssetTick = giveType === 'coin' ? coinTicker : giveTick;
    const giveBalance = useTickBalance({
        messaging,
        walletId,
        chainId,
        address: fromAddress?.address,
        tick: giveAssetTick,
    });
    const giveTokenInfo = useTokenInfo({
        chainId,
        tick: giveTick,
        skip: giveType !== 'token' || giveOwnership || !giveTick.trim(),
    });
    const getTokenInfo = useTokenInfo({
        chainId,
        tick: getTick,
        skip: getType !== 'token' || getOwnership || !getTick.trim(),
    });

    // Only a native-coin GIVE settles via COINPay and can arm auto pay.
    // Device and remote signers stay off because they cannot sign unattended.
    const [autopayEnabled, setAutopayEnabled] = useState(true);
    const [exposure, setExposure] = useState(/** @type {any | null} */ (null));
    const giveIsNative = giveType === 'coin';
    const autopayEligible = giveIsNative && !isWatcherMode && !isHwSource;
    const autopayArm = autopayEligible && autopayEnabled;
    // The web wallet has no background watcher, so an armed order pays only
    // while the wallet is open; the confirm screen says so on every order.
    const confirmNotice = shell === 'web' && autopayArm
        ? t('components.placeOrderPanel.autoPayConfirmNotice')
        : undefined;

    // Read on eligibility, not on the switch: the exposure note under Auto pay
    // is a static note (G120), so flipping the switch never shows or hides it.
    useEffect(() => {
        if (!autopayEligible || typeof messaging.getAutopayExposure !== 'function') { setExposure(null); return undefined; }
        let cancelled = false;
        messaging.getAutopayExposure({ walletId })
            .then((e) => { if (!cancelled) setExposure(e || {}); })
            .catch(() => { if (!cancelled) setExposure(null); });
        return () => { cancelled = true; };
    }, [messaging, walletId, autopayEligible]);

    const [feePick, setFeePick] = useState(
        /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: 'normal' }),
    );
    const feeTiers = useMemo(() => estimateNativeSendFeeTiers({ chainId, chainRegistry }), [chainId]);
    const feeCustomEstimate = useMemo(
        () => (feePick.mode === 'custom' ? customFeeEstimate({ chainId, chainRegistry, rate: Number(feePick.customRate) || 0 }) : null),
        [chainId, feePick],
    );
    const feeEstimate = feePick.mode === 'custom'
        ? feeCustomEstimate
        : (feeTiers ? feeTiers[feePick.mode] : estimateNativeSendFee({ chainId, chainRegistry, speed: feePick.mode }));
    const feePerKb = (feeEstimate && feeEstimate.unit && Number.isFinite(feeEstimate.rateValue) && feeEstimate.rateValue > 0)
        ? displayRateToSettingsCustom(feeEstimate.unit, feeEstimate.rateValue)
        : null;

    const [stage, setStage] = useState(/** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'));
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
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

    // Build the ORDER v0 params. Blank optional fields are omitted (the
    // wire encodes an omitted positional field as "unset").
    const actionParams = useMemo(() => {
        /** @type {Record<string, string>} */
        const p = { VERSION: '0', GIVE_COIN: coinTicker, GET_COIN: coinTicker };
        if (giveType === 'token') {
            p.GIVE_TICK = giveTick.trim().toUpperCase();
            if (giveOwnership) p.GIVE_OWNERSHIP = '1'; else p.GIVE_AMOUNT = wireAmount(giveAmount);
        } else {
            p.GIVE_TICK = '';
            p.GIVE_AMOUNT = wireAmount(giveAmount);
        }
        if (getType === 'token') {
            p.GET_TICK = getTick.trim().toUpperCase();
            if (getOwnership) p.GET_OWNERSHIP = '1'; else p.GET_AMOUNT = wireAmount(getAmount);
        } else {
            p.GET_TICK = '';
            p.GET_AMOUNT = wireAmount(getAmount);
        }
        if (getAddress.trim()) p.GET_ADDRESS = getAddress.trim();
        if (expMode !== 'default' && expInput.trim()) {
            const unix = localInputToUnix(expInput.trim());
            if (unix) p.EXPIRATION = String(unix);
        }
        if (allowListIdx) p.ALLOW_LIST = allowListIdx;
        if (blockListIdx) p.BLOCK_LIST = blockListIdx;
        if (memo.trim()) p.MEMO = memo.trim();
        return p;
    }, [coinTicker, giveType, giveTick, giveAmount, giveOwnership, getType, getTick, getAmount, getOwnership, getAddress, expMode, expInput, allowListIdx, blockListIdx, memo]);

    const quoteActionData = useMemo(() => {
        if (!chainId || !fromAddress || !coinTicker) return null;
        if (giveType === 'coin' && getType === 'coin') return null;
        if (giveType === 'token') {
            if (!giveTick.trim()
                || tickerReferenceError(giveTick, { noun: 'Give ticker', allowRef: true })
                || isNativeCoinName(giveTick, coinTicker)
                || (!giveOwnership && !isPlainPositive(giveAmount))) return null;
        } else if (!isPlainPositive(giveAmount)) return null;
        if (!giveOwnership) {
            if (tokenAmountPrecisionError(wireAmount(giveAmount), {
                divisibility: giveType === 'coin' ? 8 : giveTokenInfo?.divisibility,
                tick: giveAssetTick,
                noun: 'Give amount',
            })) return null;
            if (giveBalance !== null && compareAmounts(wireAmount(giveAmount), giveBalance) === 1) return null;
        }
        if (getType === 'token') {
            if (!getTick.trim()
                || tickerReferenceError(getTick, { noun: 'Get ticker', allowRef: true })
                || isNativeCoinName(getTick, coinTicker)
                || (!getOwnership && !isPlainPositive(getAmount))) return null;
        } else if (!isPlainPositive(getAmount)) return null;
        if (!getOwnership && tokenAmountPrecisionError(wireAmount(getAmount), {
            divisibility: getType === 'coin' ? 8 : getTokenInfo?.divisibility,
            tick: getType === 'coin' ? coinTicker : getTick,
            noun: 'Get amount',
        })) return null;
        if (giveType === 'token' && getType === 'token'
            && giveTick.trim().toUpperCase() === getTick.trim().toUpperCase()) return null;
        if (getAddress.trim() && addressValidationError(getAddress.trim(), descriptor)) return null;
        if (expMode !== 'default') {
            const expiration = localInputToUnix(expInput.trim());
            if (!expiration || expiration <= Math.floor(Date.now() / 1000)) return null;
        }
        const trimmedMemo = memo.trim();
        if (/[|;]/.test(trimmedMemo) || memoLengthError(trimmedMemo)
            || memoCharacterError(trimmedMemo)) return null;
        if ((allowListIdx && !isCanonicalActionIndex(allowListIdx))
            || (blockListIdx && !isCanonicalActionIndex(blockListIdx))) return null;
        return { action: 'ORDER', params: actionParams };
    }, [actionParams, allowListIdx, blockListIdx, chainId, coinTicker, descriptor,
        expInput, expMode, fromAddress, getAddress, getAmount, getOwnership, getTick,
        getTokenInfo?.divisibility, getType, giveAmount, giveAssetTick, giveBalance,
        giveOwnership, giveTick, giveTokenInfo?.divisibility, giveType, memo]);
    const { quote: protocolFeeQuote, pending: protocolFeePending, waiting: protocolFeeWaiting } = useProtocolFeeQuote({
        messaging,
        chainId,
        source: fromAddress?.address,
        actionData: quoteActionData,
    });

    const decoded = useMemo(() => {
        // residual (§5.6 slice 5): the confirm page renders the intent
        // the HOST described from the composed action string
        // (`composed.decoded`), so this local describer serves the LEGACY
        // review stage only - the watcher, demo and locked-ECDH path. It used
        // to also recompute while the confirm page was open, which was work
        // nothing read and, worse, read like the confirm surface still
        // depended on form state.
        if (stage !== 'review' && stage !== 'submitting') return null;
        return decoderLib.decodeAction({
            action: 'ORDER', params: actionParams, chainId: chainId || undefined, chainRegistry,
        });
    }, [stage, confirmModalOpen, actionParams, chainId]);
    const quotedProtocolFee = normalizeProtocolFee(protocolFeeQuote);
    const legacyComposed = useMemo(() => (decoded ? {
        action: 'ORDER',
        chainId,
        decoded,
        quote: protocolFeeQuote,
        protocolFeeKnownFree: quotedProtocolFee.known && quotedProtocolFee.free,
    } : null), [chainId, decoded, protocolFeeQuote, quotedProtocolFee.free, quotedProtocolFee.known]);
    const orderFacts = [{
        label: 'Expiration',
        value: expMode === 'default'
            ? '3 months'
            : (localInputToUnix(expInput.trim())
                ? formatLocalDateTime(localInputToUnix(expInput.trim()))
                : 'Custom expiry'),
    }];

    function guardBeforeSign() {
        if (!chainId || !fromAddress) { setFormError('Pick a source address first.'); revealSection('from'); return false; }
        if (giveType === 'coin' && getType === 'coin') {
            setFormError('At least one side must be a token; coin-for-coin is a regular payment, not an order.');
            return false;
        }
        // GIVE side.
        if (giveType === 'token') {
            if (!giveTick.trim()) { setFormError('Enter the ticker to give.'); return false; }
            const tickError = tickerReferenceError(giveTick, { noun: 'Give ticker', allowRef: true });
            if (tickError) { setFormError(tickError); return false; }
            if (isNativeCoinName(giveTick, coinTicker)) { setFormError(nativeCoinTickMessage(coinTicker)); return false; }
            if (!giveOwnership && !isPlainPositive(giveAmount)) { setFormError('Enter a positive amount to give.'); return false; }
        } else if (!isPlainPositive(giveAmount)) {
            setFormError(`Enter a positive amount of ${coinTicker} to give.`); return false;
        }
        if (!giveOwnership) {
            const precisionError = tokenAmountPrecisionError(wireAmount(giveAmount), {
                divisibility: giveType === 'coin' ? 8 : giveTokenInfo?.divisibility,
                tick: giveAssetTick,
                noun: 'Give amount',
            });
            if (precisionError) { setFormError(precisionError); return false; }
            if (giveBalance !== null && compareAmounts(wireAmount(giveAmount), giveBalance) === 1) {
                setFormError(`Give amount exceeds your available ${giveAssetTick.toUpperCase()} balance of ${giveBalance}.`);
                return false;
            }
        }
        // GET side.
        if (getType === 'token') {
            if (!getTick.trim()) { setFormError('Enter the ticker to get.'); return false; }
            const tickError = tickerReferenceError(getTick, { noun: 'Get ticker', allowRef: true });
            if (tickError) { setFormError(tickError); return false; }
            if (isNativeCoinName(getTick, coinTicker)) { setFormError(nativeCoinTickMessage(coinTicker)); return false; }
            if (!getOwnership && !isPlainPositive(getAmount)) { setFormError('Enter a positive amount to get.'); return false; }
        } else if (!isPlainPositive(getAmount)) {
            setFormError(`Enter a positive amount of ${coinTicker} to get.`); return false;
        }
        if (!getOwnership) {
            const getAssetTick = getType === 'coin' ? coinTicker : getTick;
            const precisionError = tokenAmountPrecisionError(wireAmount(getAmount), {
                divisibility: getType === 'coin' ? 8 : getTokenInfo?.divisibility,
                tick: getAssetTick,
                noun: 'Get amount',
            });
            if (precisionError) { setFormError(precisionError); return false; }
        }
        // Consensus accepts the same token on both sides, and at any price
        // other than one the difference goes to whoever matches the order.
        if (giveType === 'token' && getType === 'token'
            && giveTick.trim().toUpperCase() === getTick.trim().toUpperCase()) {
            setFormError('You give and get the same token. Choose a different token for one side.');
            return false;
        }
        // Receive at sits in the Order section; reveal it so the field is in sight.
        const ga = getAddress.trim();
        const receiveFailure = ga ? addressValidationError(ga, descriptor) : null;
        if (receiveFailure) {
            setFormError(receiveFailure); setReceiveError(receiveFailure); revealSection('get'); return false;
        }
        // The order terms below live in Options; a failure there opens it so the field is in sight.
        if (expMode !== 'default') {
            const raw = expInput.trim();
            if (!raw) { setFormError('Pick an expiration date and time, or choose a common term.'); revealSection('options'); return false; }
            const unix = localInputToUnix(raw);
            if (!unix || unix <= Math.floor(Date.now() / 1000)) { setFormError('Expiration must be a future date and time.'); revealSection('options'); return false; }
        }
        const m = memo.trim();
        if (m.includes('|') || m.includes(';')) { setFormError('Memo cannot contain "|" or ";".'); revealSection('memo'); return false; }
        const memoError = memoLengthError(m) || memoCharacterError(m);
        if (memoError) { setFormError(memoError); revealSection('memo'); return false; }
        if (allowListIdx && !isCanonicalActionIndex(allowListIdx)) {
            setFormError('Allow-list ID must be a positive whole number.'); revealSection('lists'); return false;
        }
        if (blockListIdx && !isCanonicalActionIndex(blockListIdx)) {
            setFormError('Block-list ID must be a positive whole number.'); revealSection('lists'); return false;
        }
        return true;
    }

    // Open the standard section that holds the refused field, in
    // place: Receive at sits in the Order section in both views and the terms
    // in Order Terms, so neither needs a switch to Full.
    function revealSection(id) {
        giveGetView.setSectionOpen(id === 'get' ? 'order' : id, true);
    }

    const extraBaseFor = (composed) => ({
        payFeeInNativeCoin: nativeFee.flag,
        ...(feePerKb != null ? { feePerKb } : {}),
        ...(autopayArm ? { autopay: { enabled: true } } : {}),
        // The shared mapping, envelope and deferred outputs included.
        ...(composed ? { prebuiltPsbt: prebuiltPsbtFromComposed(composed) } : {}),
    });

    async function openConfirmModal() {
        if (submitInFlightRef.current) return;
        submitInFlightRef.current = true;
        try {
            const from = buildFrom();
            if (!chainId || !from) return;
            setSubmitError(null);
            const res = await confirmAction.confirm({
                chainId,
                source: from.address,
                preflightOpts: { mode: resolvePreflightPrivacy(settings) === 'local' ? 'local' : 'report' },
                compose: () => messaging.composeForConfirm(withAdvancedOptions({
                    walletId, chainId, from,
                    actionData: { action: 'ORDER', params: actionParams },
                    // PC-51: the opt-in must reach COMPOSE so the FEE_DESTINATION
                    // output sits inside the PSBT the user approves.
                    encoderOpts: {
                        payFeeInNativeCoin: nativeFee.flag,
                        ...(feePerKb != null ? { feePerKb } : {}),
                    },
                })),
                preflight: (o) => messaging.preflight({ chainId, ...o }),
                // §4.6: the input-liveness half of the Approve-time re-check,
                // the same one useActionConfirmFlow.run gives every migrated form.
                checkInputs: (psbtHex) => messaging.checkInputLiveness({ chainId, psbtHex }),
                releaseEncoderInputs: (token) => messaging.releaseEncoderInputs({ token }),
                // §4.7: reserve the debited balance on the host-shared ledger,
                // so two windows cannot both approve against the same balance.
                reservationLedger: {
                    reserve: (e) => messaging.reserve(e),
                    release: (id) => messaging.releaseReservation({ id }),
                },
                // Re-price the native-coin protocol fee at Approve.
                // The output was sized at compose, and the amount consensus
                // requires moves inversely with the coin price, so a move while
                // the confirm screen sits open leaves it short - which the
                // chain rejects while keeping the fee.
                requoteNativeFee: ({ actionString, source }) => messaging.requoteNativeFee({
                    chainId, actionString, source,
                }),
                onApprove: (_creds, composed) => submit({
                    params: actionParams,
                    password: passwordValueRef.current,
                    extraBase: extraBaseFor(composed),
                }),
            });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            if (err && (err.reason === 'user-rejected' || err.name === 'UserRejectedError')) return;
            console.error('Create order (confirm) failed:', err); // eslint-disable-line no-console
            setFormError(submitFailureMessage(err, {
                chainId,
                coinTicker,
                mandatory: nativeFee.mandatory,
                fallback: orderFailureFallback(err),
            }));
        } finally {
            submitInFlightRef.current = false;
        }
    }

    function handleReview(event) {
        event.preventDefault();
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        // A refusal opens the section that holds its field; the main
        // Order section (open by default) reopens for its own fields.
        if (feeStop) { setFormError(feeStop.formError); revealSection('fee'); return; }
        if (!guardBeforeSign()) { revealSection('order'); return; }
        setFormError(null);
        if (singleEncode) { void openConfirmModal(); return; }
        setStage('review');
    }

    const hwSignerInfo = useSignerInfo({ walletId, signerId: isHwSource ? fromAddress?.signerId : null });

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting' || submitInFlightRef.current) return;
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
                chainId, coinTicker, mandatory: nativeFee.mandatory,
                fallback: orderFailureFallback(err),
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

    function handleChainChange(nextChainId) {
        if (nextChainId === chainId) return;
        setChainId(nextChainId);
        // A custom receive address belongs to the old network; From leads again.
        setGetAddress(''); setReceiveEdited(false); setReceiveError(null);
        clearGiveAsset();
        clearGetAsset();
    }

    function handleGiveTypeChange(nextType) {
        if (nextType === giveType) return;
        setGiveType(nextType);
        clearGiveAsset();
    }

    function handleGetTypeChange(nextType) {
        if (nextType === getType) return;
        setGetType(nextType);
        clearGetAsset();
    }

    // One Asset pick sets the side. A coin row selects the native side; a
    // token row (or a typed name) selects that token. A type change clears
    // the side, a new ticker clears its amount.
    function pickGiveAsset(pick) {
        if (pick.native) { handleGiveTypeChange('coin'); return; }
        const nextTick = String(pick.tick || '').trim().toUpperCase();
        if (giveType !== 'token') { setGiveType('token'); clearGiveAsset(); }
        else if (nextTick !== giveTick) setGiveAmount('');
        setGiveTick(nextTick);
    }

    function pickGetAsset(pick) {
        if (pick.native) { handleGetTypeChange('coin'); return; }
        const nextTick = String(pick.tick || '').trim().toUpperCase();
        if (getType !== 'token') { setGetType('token'); clearGetAsset(); }
        else if (nextTick !== getTick) setGetAmount('');
        setGetTick(nextTick);
    }

    // An ownership switch change clears that side's amount.
    function changeGiveOwnership(next) {
        if (next !== giveOwnership) setGiveAmount('');
        setGiveOwnership(next);
    }

    function changeGetOwnership(next) {
        if (next !== getOwnership) setGetAmount('');
        setGetOwnership(next);
    }

    // The flip button swaps the whole side (coin or token, ticker,
    // amount, ownership) without the clearing the pickers apply.
    function flipSides() {
        setGiveType(getType);
        setGetType(giveType);
        setGiveTick(getTick);
        setGetTick(giveTick);
        setGiveAmount(getAmount);
        setGetAmount(giveAmount);
        setGiveOwnership(getOwnership);
        setGetOwnership(giveOwnership);
        setFormError(null);
    }

    function handleBuildAnother() { setResult(null); setSubmitError(null); setStage('form'); }

    const header = (
        <PageHeader
            onBack={onBack}
            title={stage === 'review' || stage === 'submitting' ? 'Review Order' : 'Create Order'}
            /* No My orders button on the form: the standard allows one action,
               and My orders has its own page and nav entry. The broadcast
               panel still links to it. */
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header} restoreScroll={!(stage === 'review' || stage === 'submitting')}>{children}</Screen>
    );

    // The load error, the loading line and the broadcast panel lay out
    // through FormPage like the form and review stages, so every state keeps
    // the same page edge and rhythm.
    if (loadError) {
        return wrap(
            <FormPage
                label="Create order"
                status={<StatusMessage variant="error">{loadError}</StatusMessage>}
            />,
        );
    }
    if (!addressesByChain || !chainId) {
        return wrap(
            <FormPage as="div" label="Create order">
                <p className={styles.hint}>Loading…</p>
            </FormPage>,
        );
    }

    if (stage === 'done') {
        const txid = result?.txid || result?.broadcast?.txid;
        if (result?.psbtHex && !txid) {
            return wrap(<ResultScreen state="unsigned" result={result} onBuildAnother={handleBuildAnother} onDone={onBack} />);
        }
        // Signed but not broadcast. No order exists to match yet, so
        // the auto-pay note below would be describing a thing that is not
        // on the chain.
        if (result?.queued) {
            return wrap(<ResultScreen state="signed-not-broadcast" onDone={onBack} what="order" unsaved={result.unsaved} />);
        }
        const autopayNote = autopayArm
            ? (result?.autopayArmed === false
                ? 'Auto pay could not be armed for this order; you will be prompted to pay any match manually.'
                : 'Auto pay is armed: matches on this order will be paid automatically while a wallet holding it is unlocked.')
            : null;
        return wrap(
            <FormPage
                as="div"
                label="Order broadcast"
                actions={(
                    <>
                        {onManageOrders ? <Button variant="secondary" icon={<Icon.TokenListIcon />} onClick={onManageOrders}>My Orders</Button> : null}
                        <Button variant="success" icon={<Icon.CheckIcon />} onClick={onBack}>Done</Button>
                    </>
                )}
            >
                <h2 className={styles.successTitle}>Order broadcast</h2>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>Transaction ID</p>
                        <code className={styles.txid}>{txid}</code>
                    </>
                ) : <p className={styles.hint}>Broadcast complete.</p>}
                {autopayNote ? <p className={styles.hint}>{autopayNote}</p> : null}
            </FormPage>,
        );
    }

    if (confirmModalOpen) {
        return (
            <ActionConfirmScreen
                confirmAction={confirmAction}
                summary={{
                    verb: t('components.confirmSummary.verbPlaceOrder'),
                    ...orderGiveParts(actionParams, coinTicker),
                    chainId,
                    address: fromAddress?.address,
                    facts: orderFacts,
                    ...(confirmNotice ? { notice: confirmNotice } : {}),
                }}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId}
                feeEstimate={feeEstimate}
                feeText={feeEstimate?.coinAmount ? `Network fee: ${feeEstimate.coinAmount} ${coinTicker}`.trim() : undefined}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hintClassName={styles.hint}
                credentialsReady={isHwSource ? hwStatus === 'available' : (signerReady || password.length > 0)}
                hwSource={isHwSource ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                hwSignerInfo={hwSignerInfo}
                chainId={chainId}
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
                chainId={chainId}
                // A picked token holds the order to its network, as on the
                // Network field; before that, an address on another chain
                // moves the order's Network there first.
                lockNetwork={Boolean((giveType === 'token' && giveTick.trim()) || (getType === 'token' && getTick.trim()))}
                onChainChange={handleChainChange}
                onPick={(a) => { setFromAddressId(a.id); setSourcePickerOpen(false); }}
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
                    if (listPickerFor === 'allow') { setAllowListIdx(row.actionIndex); setAllowListCount(row.memberCount); setAllowListPick(pick); }
                    else { setBlockListIdx(row.actionIndex); setBlockListCount(row.memberCount); setBlockListPick(pick); }
                    setListPickerFor(null);
                }}
                onBack={() => setListPickerFor(null)}
            />
        );
    }

    // The Asset picker page. The coin and the tokens on this chain are one
    // list; a typed name (a ticker or a ^ID) stays available for a token the
    // list does not hold.
    if (assetPickerFor) {
        const side = assetPickerFor;
        // The give list spans every network; the picked asset's chain
        // becomes the order's network. An order settles on one chain, so the
        // get list holds to the give asset's network once one is picked.
        const giveChosen = giveType === 'coin' || Boolean(giveTick.trim());
        return (
            <OrderAssetPicker
                purpose={side === 'give' ? 'send' : 'receive'}
                coinTicker={coinTicker}
                walletId={walletId}
                title={side === 'give' ? 'Select Give Asset' : 'Select Get Asset'}
                chainId={chainId}
                scoped={side === 'get' && giveChosen}
                onPick={(pick) => {
                    if (pick.chainId && pick.chainId !== chainId) handleChainChange(pick.chainId);
                    if (side === 'give') pickGiveAsset(pick); else pickGetAsset(pick);
                    setAssetPickerFor(null);
                }}
                onBack={() => setAssetPickerFor(null)}
            />
        );
    }

    // The Quick card's Receive at book opens this wallet's addresses on the order's chain.
    if (receivePickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="Receive At"
                walletId={walletId}
                chainId={chainId}
                lockNetwork
                onPick={(a) => { setGetAddress(a.address); setReceiveEdited(true); setReceiveError(null); setReceivePickerOpen(false); }}
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
                decoded={decoded}
                chainLabel={descriptor?.displayName || chainId}
                screenVariant={variant}
                error={submitError}
                sourceAddress={fromAddress?.address}
                nativeTicker={coinTicker}
                credentials={<p className={styles.hint}>{t('common.watcherBuildsUnsigned')}</p>}
                credentialsReady
                summary={{
                    verb: t('components.confirmSummary.verbPlaceOrder'),
                    ...orderGiveParts(actionParams, coinTicker),
                    chainId,
                    address: fromAddress?.address,
                    facts: orderFacts,
                    ...(confirmNotice ? { notice: confirmNotice } : {}),
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

    // --- Form screen (Quick and Full views of one state) -----------------
    const { view, setView, sections, setSectionOpen } = giveGetView;
    const chainChoices = chainsWithAddresses.length ? chainsWithAddresses : (chainId ? [chainId] : []);
    const getAssetTick = getType === 'coin' ? coinTicker : getTick;
    const giveTickUpper = String(giveAssetTick || '').trim().toUpperCase();
    const getTickUpper = String(getAssetTick || '').trim().toUpperCase();
    const giveDivisibility = giveType === 'coin' ? 8 : giveTokenInfo?.divisibility;
    const getDivisibility = getType === 'coin' ? 8 : getTokenInfo?.divisibility;

    // The same digits-only rule for every amount input, Quick or Full.
    // The Quick card's plain input also refuses digits past the
    // asset's decimals, as AmountField does in the Full view.
    const amountInput = (setter, divisibility) => (rawValue) => {
        const stripped = String(rawValue).replace(/,/g, '');
        if (stripped !== '' && !/^\d*\.?\d*$/.test(stripped)) return;
        const places = Number(divisibility);
        if (divisibility != null && String(divisibility).trim() !== '' && Number.isInteger(places) && places >= 0) {
            const fraction = stripped.includes('.') ? stripped.split('.')[1] : '';
            if (fraction.length > places) return;
        }
        setter(stripped);
    };

    const giveMax = giveType === 'token' && !giveOwnership && giveBalance && Number(giveBalance) > 0
        ? () => setGiveAmount(giveBalance)
        : undefined;
    const giveBalanceText = giveType === 'token' && giveBalance != null && giveTick.trim()
        ? `${formatWithThousands(giveBalance) || giveBalance} ${giveTick.trim().toUpperCase()} available`
        : null;

    const giveAssetValue = chainId && giveTickUpper ? { chainId, tick: giveTickUpper } : null;
    const getAssetValue = chainId && getTickUpper ? { chainId, tick: getTickUpper } : null;

    const amountsPriced = !giveOwnership && !getOwnership
        && isPlainPositive(giveAmount) && isPlainPositive(getAmount) && giveTickUpper && getTickUpper;
    const rate = amountsPriced ? divideDecimalStrings(wireAmount(getAmount), wireAmount(giveAmount), 8) : null;
    const rateText = rate
        ? `1 ${giveTickUpper} = ${rate === '0' ? '< 0.00000001' : rate} ${getTickUpper}`
        : 'Enter both amounts to see the rate';
    const rateLine = <RateLine text={rateText} help="The price this order asks: how much of the get asset you want for one of the give asset." />;

    // Order Terms reads the expiry ("3 months" or "Expires <time>") and
    // auto-pay; Lists names the lists set, else "None".
    const termsParts = [];
    if (expMode === 'default') termsParts.push('3 months');
    else {
        const unix = localInputToUnix(expInput.trim());
        termsParts.push(expInput.trim() && unix ? `Expires ${formatLocalDateTime(unix)}` : 'Custom expiry');
    }
    if (giveIsNative) termsParts.push(autopayArm ? 'Auto pay on' : 'Auto pay off');
    // The standard's summaries join their parts with ", ".
    const termsSummary = joinSummary(...termsParts);
    const listsParts = [];
    if (allowListIdx) listsParts.push(`Allow list #${allowListIdx}`);
    if (blockListIdx) listsParts.push(`Block list #${blockListIdx}`);
    const listsSummary = listsParts.length ? joinSummary(...listsParts) : 'None';

    const sideSummary = (type, tickUpper, amount, ownership) => {
        if (!tickUpper) return 'No asset yet';
        if (type === 'token' && ownership) return `Ownership of ${tickUpper}`;
        return amount ? `${formatWithThousands(amount)} ${tickUpper}` : tickUpper;
    };
    // The Order section's closed summary, "100 DANKEST for 0.001 BTC".
    const orderSummary = `${sideSummary(giveType, giveTickUpper, giveAmount, giveOwnership)} for ${sideSummary(getType, getTickUpper, getAmount, getOwnership)}`;
    // Spread onto a standard section; the open state lives in
    // useGiveGetView above the early returns, so a picker page keeps it.
    // `main` flags Order as the form's main section (data-form-main).
    const bind = (id) => ({ open: Boolean(sections[id]), onOpenChange: (open) => setSectionOpen(id, open), main: id === 'order' });
    // A picked token decides the network; a coin side follows it.
    const assetLocksNetwork = Boolean((giveType === 'token' && giveTick.trim()) || (getType === 'token' && getTick.trim()));

    const giveHelp = {
        asset: `Offer a token this address holds, or ${coinTicker || 'the network coin'}. Native ${coinTicker || 'coin'} is not escrowed: when the order matches you pay it in a follow-up payment. A token is escrowed from this address when the order confirms and returns to you if the order expires or you cancel it.`,
        amount: 'How much you give in total. A match can fill part of it; the rest stays open until it fills, expires or you cancel.',
    };
    const getHelp = {
        asset: `Ask for a token, or for ${coinTicker || 'the network coin'}. Any holder of the token can match your order; when you ask for native ${coinTicker || 'coin'}, the matcher pays it to you within the expiration window.`,
        amount: 'How much you want in total for what you give; together with the give amount it sets your price.',
    };
    const fromHelp = 'The address that posts this order and escrows what you give. Both sides of the order settle on this network; to get a token on another network, use Cross-Chain Order.';
    const receiveHelp = 'Address where you receive the get side. Defaults to your source address.';

    // The ownership switches, built once and shown in whichever view
    // is open. Ownership is a token-side choice; a coin side shows its switch off and disabled.
    const ownershipHelp = 'Trade control of the whole token instead of a quantity of it. It moves as one piece, with no partial fills.';
    const giveOwnershipToggle = (
        <OwnershipToggle
            label={giveType === 'token'
                ? `Trade ownership of ${giveTick.trim().toUpperCase() || 'the give token'} (not a balance)`
                : `Trade ownership of the give asset (${coinTicker || 'coin'} is a coin, not a token)`}
            help={`${ownershipHelp} Transfers the entire ownership of ${giveTick.trim().toUpperCase() || 'this token'} (single fill, no partial matches).`}
            checked={giveType === 'token' && giveOwnership}
            onChange={changeGiveOwnership}
            disabled={giveType !== 'token'}
        />
    );
    const getOwnershipToggle = (
        <OwnershipToggle
            label={getType === 'token'
                ? `Trade ownership of ${getTick.trim().toUpperCase() || 'the get token'} (not a balance)`
                : `Trade ownership of the get asset (${coinTicker || 'coin'} is a coin, not a token)`}
            help={`${ownershipHelp} The matcher must own ${getTick.trim().toUpperCase() || 'this token'}; on match its ownership transfers to you.`}
            checked={getType === 'token' && getOwnership}
            onChange={changeGetOwnership}
            disabled={getType !== 'token'}
        />
    );

    const coinForCoinNotice = giveType === 'coin' && getType === 'coin' ? (
        <FormNotice variant="warning" role="alert">
            At least one side must be a token. Coin-for-coin is a regular payment, not an order.
        </FormNotice>
    ) : null;

    // Receive at: a normal address field right under You get, in both views,
    // prefilled with From. Editing sets a custom address; clearing uses From.
    const receiveField = (
        <AddressField
            label="Receive at"
            help={receiveHelp}
            value={receiveEdited ? getAddress : (fromAddress?.address || '')}
            onChange={(e) => { setGetAddress(e.target.value); setReceiveEdited(true); setReceiveError(null); }}
            error={receiveError || undefined}
            icon="addresses"
            iconLabel="Choose receive address"
            onIconClick={() => setReceivePickerOpen(true)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
        />
    );

    // The Quick body of the Order section: the give and get cards
    // (Receive at stays on the get card), the flip and the rate.
    const quickOrder = (
        <GiveGetQuick
            give={{
                label: 'You give',
                help: giveHelp.asset,
                // No network control; the card shows the asset's network read-only.
                asset: giveAssetValue,
                assetLabel: 'Give asset', assetPlaceholder: 'Select an asset',
                onOpenAsset: () => setAssetPickerFor('give'),
                amount: giveAmount,
                onAmountChange: amountInput(setGiveAmount, giveDivisibility),
                amountLabel: 'Give amount',
                divisibility: giveDivisibility,
                ownership: giveType === 'token' && giveOwnership,
                ownershipHint: 'Single fill, no partial matches.',
                balanceText: giveBalanceText,
                onMax: giveMax || null,
                maxDisabled: !giveMax,
                // "Native coin is paid after a match" lives in the You give
                // '?' tip (giveHelp.asset), never as a loose line (U57).
                // No From row in the card; From is the standard's first section.
            }}
            get={{
                label: 'You get',
                help: getHelp.asset,
                asset: getAssetValue,
                assetLabel: 'Get asset', assetPlaceholder: 'Select an asset',
                onOpenAsset: () => setAssetPickerFor('get'),
                amount: getAmount,
                onAmountChange: amountInput(setGetAmount, getDivisibility),
                amountLabel: 'Get amount',
                divisibility: getDivisibility,
                ownership: getType === 'token' && getOwnership,
                ownershipHint: 'The matcher hands over this token name.',
                // The matcher paying native coin is in the You get '?' tip
                // (getHelp.asset), never a loose line under the card (U57).
            }}
            onFlip={flipSides}
            notice={coinForCoinNotice}
            rate={<>{receiveField}{rateLine}</>}
        />
    );

    // The Full body of the Order section: both sides' fields in one
    // open section (each side captioned You give / You get), Receive at with
    // the get side, then the rate.
    const fullOrder = (
        <>
                    <SideFields
                        side="give"
                        caption="You give"
                        type={giveType}
                        assetValue={giveAssetValue}
                        onOpenAsset={() => setAssetPickerFor('give')}
                        amount={giveAmount}
                        onAmount={setGiveAmount}
                        ownership={giveOwnership}
                        coinTicker={coinTicker}
                        help={giveHelp}
                        divisibility={giveDivisibility}
                        onMax={giveMax}
                        maxDisabled={!giveMax}
                        balanceText={giveBalanceText}
                    />
                        <SideFields
                            side="get"
                            caption="You get"
                            type={getType}
                            assetValue={getAssetValue}
                            onOpenAsset={() => setAssetPickerFor('get')}
                            amount={getAmount}
                            onAmount={setGetAmount}
                            ownership={getOwnership}
                            coinTicker={coinTicker}
                            help={getHelp}
                            divisibility={getDivisibility}
                        />
                        {coinForCoinNotice}
                        {/* The receive address sits right under the get side. */}
                        {receiveField}
                        {rateLine}
        </>
    );

    // The Order Terms fields, one optional section in both views, so
    // Quick's terms row expands in place and never switches to Full. Inside an
    // optional section the fields drop their own Optional tags.
    const termsFields = (
        <>
                        {/* A choice among a few named options is the icon dropdown (G44);
                            Expires always shows and follows it (operator 2026-11-13). */}
                        <ExpirationFields
                            name="order-exp"
                            mode={expMode}
                            input={expInput}
                            onChange={(mode, input) => { setExpMode(mode); setExpInput(input); }}
                            help="How long the order stays open for matching. When it expires, what is still escrowed returns to you."
                            expiresHelp="The order is valid until this time. Set by the Expiration choice, or pick a time to expire at a specific time."
                        />
                        {giveIsNative ? (
                            <>
                                <Switch
                                    label={<strong>Auto pay</strong>}
                                    help="We watch for matches on this order and pay each one automatically."
                                    checked={autopayArm}
                                    disabled={!autopayEligible}
                                    onChange={(e) => setAutopayEnabled(e.target.checked)}
                                />
                                {!autopayEligible ? (
                                    <StatusMessage variant="info" role="note">
                                        {isWatcherMode
                                            ? t('components.placeOrderPanel.autoPayIsUnavailableIn')
                                            : t('components.placeOrderPanel.autoPayIsUnavailableFor')}
                                    </StatusMessage>
                                ) : null}
                                <MobileAutopayNotice />
                                {/* Notes sit in the shared warning card, never as loose paragraphs.
                                    G120: a static note with the field, there whether the
                                    switch is on or off. */}
                                {exposure && Number.isFinite(Number(exposure.total)) ? (
                                    <WarningCard data-autopay-exposure-note="">
                                        <WarningLine>
                                            Even if the service that reports matches were fully compromised, auto pay could send
                                            at most the combined amounts you give across all your orders with auto pay on.
                                        </WarningLine>
                                    </WarningCard>
                                ) : null}
                            </>
                        ) : null}
        </>
    );

    // The Lists section: who may match the order.
    const listsFields = (
        <>
                        {/* Allow and block lists are picker fields like Token, never grey buttons. */}
                        <ListField
                            label="Allow list"
                            help="Only addresses on this list can match the order. Pick an address list you published in My Lists."
                            placeholder="None set"
                            valueText={allowListIdx ? `${pickedListText(allowListIdx, allowListPick)}${allowListCount != null ? ` · ${allowListCount} member${allowListCount === 1 ? '' : 's'}` : ''}` : null}
                            onOpenPicker={() => setListPickerFor('allow')}
                            onClear={() => { setAllowListIdx(''); setAllowListCount(null); }}
                            clearLabel="Clear allow list"
                        />
                        <ListField
                            label="Block list"
                            help="Addresses on this list cannot match the order. Pick an address list you published in My Lists."
                            placeholder="None set"
                            valueText={blockListIdx ? `${pickedListText(blockListIdx, blockListPick)}${blockListCount != null ? ` · ${blockListCount} member${blockListCount === 1 ? '' : 's'}` : ''}` : null}
                            onOpenPicker={() => setListPickerFor('block')}
                            onClear={() => { setBlockListIdx(''); setBlockListCount(null); }}
                            clearLabel="Clear block list"
                        />
        </>
    );

    return wrap(
        <FormFrame
            demoGuard={demoGuard}
            label="Create order"
            onSubmit={handleReview}
            noValidate
            data-form-standard="create-order"
            status={formError ? <StatusMessage variant="error">{formError}</StatusMessage> : null}
            from={(
                /*
                  * An order is posted to ONE chain and escrows a balance held on
                  * that chain, so the chain is part of the order, not context.
                  * From holds the Network and the source address; a
                  * picked token locks the network (the asset decides it), and
                  * before one is picked the network can change here.
                  */
                <FromSection
                    {...bind('from')}
                    chainId={chainId}
                    chainIds={chainChoices}
                    chainRegistry={chainRegistry}
                    lockNetwork={assetLocksNetwork}
                    onNetworkChange={handleChainChange}
                    networkHelp="Both sides of the order settle on this network. A picked token decides it."
                    address={fromAddress?.address || null}
                    onOpenPicker={() => setSourcePickerOpen(true)}
                    pickerLabel="Choose source address"
                    addressHelp={fromHelp}
                    // Only when this network has no address at all, so
                    // the first default pick never opens From for good.
                    missing={!(addressesByChain[chainId] || []).length ? (
                        <FormNotice variant="error">No address on this network. Use Receive to generate one first.</FormNotice>
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
                    fees={{
                        quote: protocolFeeQuote,
                        pending: protocolFeePending,
                        waiting: protocolFeeWaiting,
                        // An order inside the free period costs no protocol fee.
                        free: expirationWithinFreePeriod(expMode, expInput),
                        nativeFeeProps: { ...nativeFee.toggleProps, coinTicker },
                    }}
                />
            )}
            action={(
                /* Always named for what it does (U63); a review step still
                   follows when the order does not fit one encode. */
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
                title="Order"
                icon={Icon.MarketIcon}
                {...bind('order')}
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
                summary={giveOwnership || getOwnership ? 'Single fill' : 'Token sides only'}
            >
                {/* Ownership is a token-side choice: a coin side carries no switch. */}
                {giveType === 'token' ? giveOwnershipToggle : null}
                {getType === 'token' ? getOwnershipToggle : null}
            </FormSection>
            <FormSection
                id="options"
                title="Order Terms"
                icon={Icon.FilterIcon}
                optional
                {...bind('options')}
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
                summary={listsSummary}
            >
                {listsFields}
            </FormSection>
            <MemoSection
                {...bind('memo')}
                maxLength={MAX_MEMO_LENGTH}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
            />
        </FormFrame>,
    );
}

/**
 * One side of the Full view. The Asset picker (coin plus tokens) sets the
 * side; the ownership switch follows the amount on token sides, as on Swap.
 */
function SideFields({
    side, caption, type, assetValue, onOpenAsset, amount, onAmount, ownership, ownershipToggle, coinTicker,
    help, onMax, maxDisabled = true, balanceText = null, divisibility,
}) {
    // Both sides share the one Order section, so each side's
    // Asset and Amount sit under a small You give / You get caption.
    const captionId = useId();
    return (
        <div role="group" aria-labelledby={captionId} className={styles.choiceGroup}>
            <p id={captionId} className={styles.choiceGroupLabel}>{caption}</p>
            <TokenField
                id={`order-${side}-asset`}
                label="Asset"
                help={help?.asset}
                placeholder="Select an asset"
                value={assetValue}
                onOpenPicker={onOpenAsset}
            />
            {/* The shared amount field keeps Max inside the field on both
                sides (U61); a side with no sensible maximum shows it disabled. */}
            {!(type === 'token' && ownership) ? (
                <AmountField
                    label="Amount"
                    help={help?.amount}
                    amount={amount}
                    // The unit joins the label only for the coin side, so the
                    // token side keeps the plain "Amount" label it has always had.
                    tick={type === 'coin' ? coinTicker : undefined}
                    divisibility={divisibility}
                    onAmountFieldChange={(rawValue) => {
                        const stripped = String(rawValue).replace(/,/g, '');
                        if (stripped !== '' && !/^\d*\.?\d*$/.test(stripped)) return;
                        onAmount(stripped);
                    }}
                    onMax={onMax}
                    maxDisabled={maxDisabled}
                    balanceText={balanceText}
                />
            ) : null}
            {type === 'token' ? ownershipToggle : null}
        </div>
    );
}

// The typed-name escape hatch inside the Asset picker page: a ticker or ^ID
// the list does not hold is used as typed. Read through context so the list
// page component keeps one identity across renders. Exported so Cross-Chain
// Order's Get token picker offers the same "Use typed name" option.
export const TypedNameContext = createContext(/** @type {{ query: string, onUse: (tick: string) => void } | null} */ (null));

export function TypedNameListPage({ intro, actions, ...rest }) {
    const typed = useContext(TypedNameContext);
    const query = String(typed?.query || '').trim();
    return (
        <ListPage
            {...rest}
            intro={query
                ? `Not in the list? Use "${query.toUpperCase()}" as typed: a ticker name, or ^ and the token's number.`
                : intro}
            actions={query ? (
                <Button
                    variant="secondary"
                    size="sm"
                    icon={<Icon.PencilIcon />}
                    onClick={() => typed.onUse(query)}
                >
                    Use Typed Name
                </Button>
            ) : actions}
        />
    );
}

/**
 * The Asset picker page for one order side, a TokenPicker held to
 * the order's chain. A coin row returns `{ native: true }`; a token row or
 * a typed name returns `{ tick }`.
 */
// `scoped` holds the list to `chainId`; unscoped it lists every
// network and each pick carries its row's chainId. A typed name has no chain
// of its own, so it is used on the order's current network.
function OrderAssetPicker({ purpose, walletId, title, chainId, coinTicker, scoped = true, onPick, onBack }) {
    const [query, setQuery] = useState('');
    const typed = useMemo(() => ({
        query,
        onUse: (tick) => {
            const upper = String(tick).trim().toUpperCase();
            // A typed coin name is the coin side, never a token named like it.
            if (coinTicker && upper === coinTicker) onPick({ native: true });
            else onPick({ tick: upper });
        },
    }), [query, onPick, coinTicker]);
    return (
        <TypedNameContext.Provider value={typed}>
            <TokenPicker
                purpose={purpose}
                walletId={walletId}
                title={title}
                backLabel="Back to Create order"
                networkFilter={scoped ? coinFromChainId(chainId) : undefined}
                chainIdFilter={scoped ? chainId : undefined}
                tokenQuery={query}
                onTokenQueryChange={setQuery}
                listPageComponent={TypedNameListPage}
                onSelect={(sel) => {
                    if (sel?.kind === 'native') onPick({ native: true, chainId: sel?.chainId });
                    else onPick({ tick: sel?.tick, chainId: sel?.chainId });
                }}
                onBack={onBack}
            />
        </TypedNameContext.Provider>
    );
}
