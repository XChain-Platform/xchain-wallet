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
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';
// The publishing Network and address and the fee selector come from the
// standard FromSection and FeeSection, not ui/FormSection (a different,
// non-collapsible block).
import { Button, FieldNote, FormNotice, FormPage, Icon, Input, NetworkField, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
// The priced token and the fiat currency are picker fields that open full
// pages (G122), never a typed ticker or a dropdown.
import { TokenField } from '../components/TokenField.jsx';
import { TokenPicker } from './TokenPicker.jsx';
import { FiatCurrencyField } from '../components/FiatCurrencyField.jsx';
import { FiatCurrencyPicker } from '../components/FiatCurrencyPicker.jsx';
import { PROTOCOL_FIAT_CODES } from '../utils/fiatCurrencies.js';
// The Wallet Form Standard frame.
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
import {
    registry as registryLib,
    decoder as decoderLib,
    flows as flowsLib,
} from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { groupDecodedAmounts } from '../utils/amountFormat.js';
import { isExactTypedConfirmation } from '../../flows/typedConfirmation.js';
import { typedConfirmationCopy } from '../utils/typedConfirmationCopy.js';
import { useDemoGuard } from '../hooks/useDemoGuard.jsx';
import { humanizeError } from '../utils/humanizeError.js';
import { ResultScreen } from '../components/ResultScreen.jsx';
import { useActionForm } from '../hooks/useActionForm.js';
import { useActionConfirmFlow, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { ConfirmActionModal } from '../components/ConfirmActionModal.jsx';
import { tickerForCoin, isProtocolCoinTicker } from '../../registry/coinTicker.js';
import { useSignerInfo } from '../hooks/useSignerInfo.js';
import { nativeFeeForFeelessAction } from '../../flows/feeBearingActions.js';
import {
    quoteDeviationPct,
    activationCountdownText,
} from '../../flows/oracleQueries.js';
import {
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
    customFeeEstimate,
    displayRateToSettingsCustom,
} from '../../flows/feeEstimate.js';
import { customFeeReviewStop } from '../../flows/feeEstimate.js';
import { oraclePriceFeeError, oraclePriceValueError } from '../../flows/oraclePriceAction.js';
import { OwnAddressPickerScreen } from '../components/OwnAddressPickerScreen.jsx';
import { StopSlider } from '../components/StopSlider.jsx';
import { MAX_MEMO_LENGTH, memoLengthError } from '../utils/memoLimit.js';
import { tickerReferenceError } from '../utils/tickerGrammar.js';
import styles from './IssueTokenForm.module.css';
import { submitFailureMessage } from '../utils/submitFailureMessage.js';

// The usage fee is typed as a percent; the protocol carries a fraction of at
// most 18 decimals, so a percent takes at most 16. Both conversions move the
// decimal point on the digit string, so nothing passes through a float.
const FEE_PERCENT_RE = /^[0-9]+(\.[0-9]{1,16})?$/;
// Stop slider stops: Free is a blank fee (no FEE param), the rest are exact
// percent text; Custom opens one entry that takes any valid percent.
const FEE_STOPS = [
    { id: 'free', label: 'Free', percent: '' },
    { id: '0.5', label: '0.5%', percent: '0.5' },
    { id: '1', label: '1%', percent: '1' },
    { id: '2', label: '2%', percent: '2' },
    { id: '5', label: '5%', percent: '5' },
    { id: 'custom', label: 'Custom', percent: null },
];

/** Exact percent text -> protocol fraction text ("1" -> "0.01"); '' when not a valid percent. */
export function usageFeePercentToFraction(percent) {
    const p = String(percent ?? '').trim();
    if (!FEE_PERCENT_RE.test(p)) return '';
    const [whole, frac = ''] = p.split('.');
    const digits = (whole.replace(/^0+/, '') || '0').padStart(3, '0') + frac;
    const cut = digits.length - frac.length - 2;
    const intPart = (digits.slice(0, cut).replace(/^0+/, '') || '0');
    const fracPart = digits.slice(cut).replace(/0+$/, '');
    return fracPart ? `${intPart}.${fracPart}` : intPart;
}
/** Protocol fraction text -> percent text ("0.0025" -> "0.25"); '' when not a fraction. */
export function usageFeeFractionToPercent(fraction) {
    const f = String(fraction ?? '').trim();
    if (!/^[0-9]+(\.[0-9]+)?$/.test(f)) return '';
    const [whole, frac = ''] = f.split('.');
    const shifted = frac.padEnd(2, '0');
    const intPart = ((whole === '0' ? '' : whole) + shifted.slice(0, 2)).replace(/^0+/, '') || '0';
    const fracPart = shifted.slice(2).replace(/0+$/, '');
    return fracPart ? `${intPart}.${fracPart}` : intPart;
}

/** Error text in percent for a typed usage fee, or null when it is blank or valid. */
export function usageFeePercentError(percent) {
    const p = String(percent ?? '').trim();
    if (!p) return null;
    if (!FEE_PERCENT_RE.test(p)) {
        return 'Usage fee must be a percent from 0 to 100, with at most 16 decimal places.';
    }
    const fraction = usageFeePercentToFraction(p);
    // Backstop: the protocol's own fraction check on the converted value.
    if (oraclePriceFeeError(fraction)) return 'Usage fee can be at most 100%.';
    return null;
}

const chainRegistry = registryLib.defaultRegistry();
const NO_ACKNOWLEDGMENTS = new Set();

const PROTOCOL_COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

// The chains a quote's COIN may name. COIN is the priced token's chain, not
// the publishing chain: a DOGE transaction may publish a BTC token's price.
const PRICE_COINS = Array.from(new Set(chainRegistry.coins().map(tickerForCoin)))
    .filter(isProtocolCoinTicker);

const UNCHECKED_CONSUMERS = Object.freeze({ supported: false, dispensers: Object.freeze([]) });

// The 12 fiats the protocol prices in (xchain-indexer config FIATS, mirrored
// in the SDK's VALID_FIAT_CODES). A publish naming anything else is rejected
// on chain with 'invalid: FIAT (unsupported)'.
const FIAT_CODES = PROTOCOL_FIAT_CODES;

// Above this move against the publisher's own last published price, the
// republish needs a typed confirm. The basis is deliberately their own prior
// on-chain value: the wallet has no trustworthy outside price for an arbitrary
// token, and putting a third-party feed in front of a consensus input would be
// worse than the fat-finger it is trying to catch. Chosen high enough that
// ordinary repricing does not train people to type through it.
const DEVIATION_TYPED_CONFIRM_PCT = 25;

function fmtPct(pct) {
    if (pct == null) return null;
    const rounded = Math.abs(pct) >= 10 ? pct.toFixed(0) : pct.toFixed(1);
    return `${pct > 0 ? '+' : ''}${rounded}%`;
}

function staleAgeText(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return 'age unknown';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours >= 1) return `${hours}h ${minutes}m old`;
    if (minutes >= 1) return `${minutes}m old`;
    return 'under a minute old';
}

/**
 * "My oracle" surface (PC-30): publish and manage PRICE v1 quotes.
 *
 * A PRICE v1 oracle prices a TOKEN in a fiat currency. Oracle-priced
 * (Mode B) dispensers cross-convert that quote through the validator
 * federation's COIN/FIAT snapshot, so a buyer can trigger a dispense with a
 * bare coin payment and no XChain transaction of their own. Publishing is
 * permissionless and unstaked; the publisher earns the usage fee,
 * paid up front in coin by whoever opens a dispenser against this address.
 *
 * Three things make this riskier than it looks, and the screen is built
 * around them:
 *
 *   - A publish is inert for 24 hours and cannot be retracted in that
 *     window. The soonest correction is another publish, which also
 *     matures a day later.
 *   - Consumers settle real money against whatever matures. The form lists
 *     the dispensers currently pointing here before the signature.
 *   - A fat-fingered decimal is indistinguishable from a repricing, so a
 *     move over DEVIATION_TYPED_CONFIRM_PCT against the publisher's own
 *     last price takes a typed confirm.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 * @param {string} [props.initialChainId]
 * @param {string} [props.initialFromAddress]
 * @param {string} [props.initialTick]
 */
export function OracleForm({ walletId, onBack, initialChainId, initialFromAddress, initialTick }) {
    const { messaging, shell } = useMessaging();
    const demoGuard = useDemoGuard(walletId, { onBack });
    const variant = screenVariantFor(shell);

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
        isWatcherMode,
        isHwSource,
        hwStatus,
        onHwStatusChange,
        buildFrom,
        submit,
    } = useActionForm({
        walletId,
        action: 'PRICE',
        submitMethods: { hw: 'oraclePriceActionHw', software: 'oraclePriceAction' },
        initialChainId,
        initialFromAddress,
        noAddressMessage:
            'No addresses on any network yet. Use Receive to generate one first.',
    });

    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';

    // Keep the chain-required flag in every submit path without presenting a
    // protocol-fee choice for this feeless action.
    const nativeFee = nativeFeeForFeelessAction(coinTicker);

    // Empty until the user picks, so the quote's COIN follows the publishing
    // chain by default and keeps following it across a chain switch.
    const [coinPick, setCoinPick] = useState('');
    const priceCoin = coinPick || coinTicker;
    const crossChain = !!(priceCoin && coinTicker && priceCoin !== coinTicker);
    // The priced token's network is picked with the standard network field,
    // which speaks chainIds: each protocol coin maps to its chain on the
    // publishing chain's network kind, and a pick maps back to the coin.
    const priceChainIds = useMemo(() => PRICE_COINS.map((coinTick) => {
        const chains = chainRegistry.supportedChains()
            .filter((d) => tickerForCoin(d.coin) === coinTick);
        const sameKind = chains.find((d) => d.networkKind === descriptor?.networkKind);
        return (sameKind || chains[0])?.id;
    }).filter(Boolean), [descriptor?.networkKind]);
    const priceChainId = priceChainIds.find((id) => tickerForCoin(chainRegistry.get(id)?.coin) === priceCoin) || '';
    const [ticker, setTicker] = useState((initialTick || '').toUpperCase());
    const [fiat, setFiat] = useState('USD');
    const [value, setValue] = useState('');
    const [fee, setFee] = useState('');
    // True once the Custom stop is picked, so typing 1 there does not snap away.
    const [feeCustom, setFeeCustom] = useState(false);
    const [memo, setMemo] = useState('');
    const [password, setPassword] = useState('');
    const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
    // The Token and Fiat currency fields each open a full picker page.
    const [tokenPickerOpen, setTokenPickerOpen] = useState(false);
    const [fiatPickerOpen, setFiatPickerOpen] = useState(false);
    // The tokens this wallet owns on the priced token's network, which the
    // Token picker lists first (the getOwnedTokens read My tokens shows); any
    // other token is found by the picker's platform search, since an oracle
    // may price any token. `rows` is null while loading, `failed` says a read
    // failed so an empty list is not shown as "you own none".
    const [ownedTokens, setOwnedTokens] = useState(
        /** @type {{ rows: Array<{ chainId: string, tick: string }> | null, failed: boolean }} */
        ({ rows: null, failed: false }),
    );
    const [typedConfirm, setTypedConfirm] = useState('');
    // The standard sections' open state, held here so it survives
    // the address picker page and the review. Only Price starts open. Each
    // Publish attempt bumps the counter, so the section holding the refusal
    // reopens even after the user closed it.
    const formSections = useFormSections({ from: false, price: true, feeds: false, usage: false, memo: false, fee: false });
    const [reviewAttempt, setReviewAttempt] = useState(0);
    const [feeRefused, setFeeRefused] = useState(false);

    const [stage, setStage] = useState(/** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'));
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));

    // Feeds this address already publishes. Reloaded after a successful
    // publish so the new quote shows up in its pending state rather than
    // leaving the operator to guess whether it landed.
    const [feeds, setFeeds] = useState(/** @type {any[] | null} */ (null));
    const [feedsError, setFeedsError] = useState(/** @type {string | null} */ (null));
    const [reloadToken, setReloadToken] = useState(0);
    const oracleAddress = fromAddress?.address || null;

    useEffect(() => {
        if (!chainId || !oracleAddress) { setFeeds(null); return undefined; }
        if (flowsLib.isDemoWallet(walletId)) { setFeeds([]); return undefined; }
        if (typeof messaging?.oracleFeeds !== 'function') { setFeeds([]); return undefined; }
        let cancelled = false;
        setFeedsError(null);
        messaging.oracleFeeds({ chainId, address: oracleAddress })
            .then((f) => { if (!cancelled) setFeeds(Array.isArray(f) ? f : []); })
            .catch((err) => {
                if (cancelled) return;
                setFeeds([]);
                setFeedsError(humanizeError(err, 'load your published prices').message);
            });
        return () => { cancelled = true; };
    }, [chainId, oracleAddress, messaging, walletId, reloadToken]);

    // Read when the Token picker opens (and again on each open), so a token
    // issued since the last look lists. A demo wallet owns nothing and never
    // sends its addresses to an explorer.
    useEffect(() => {
        if (!tokenPickerOpen || !priceChainId) return undefined;
        if (flowsLib.isDemoWallet(walletId)) { setOwnedTokens({ rows: [], failed: false }); return undefined; }
        if (typeof messaging?.getOwnedTokens !== 'function') { setOwnedTokens({ rows: [], failed: true }); return undefined; }
        const sources = (addressesByChain?.[priceChainId] || [])
            .filter((source) => typeof source?.address === 'string' && source.address);
        if (sources.length === 0) { setOwnedTokens({ rows: [], failed: false }); return undefined; }
        let cancelled = false;
        setOwnedTokens((prev) => (prev.rows && !prev.failed ? prev : { rows: null, failed: false }));
        Promise.all(sources.map((source) => Promise.resolve()
            .then(() => messaging.getOwnedTokens({ chainId: priceChainId, address: source.address }))
            .then((rows) => ({ rows: Array.isArray(rows) ? rows : [], failed: false }))
            .catch(() => ({ rows: [], failed: true }))))
            .then((batches) => {
                if (cancelled) return;
                const seen = new Set();
                const merged = [];
                for (const batch of batches) {
                    for (const row of batch.rows) {
                        const owned = String(row?.tick || '').trim();
                        if (!owned || seen.has(owned)) continue;
                        seen.add(owned);
                        merged.push({ chainId: priceChainId, tick: owned });
                    }
                }
                setOwnedTokens({ rows: merged, failed: batches.some((batch) => batch.failed) });
            });
        return () => { cancelled = true; };
    }, [tokenPickerOpen, priceChainId, addressesByChain, messaging, walletId]);

    // Dispensers priced by this address. `supported: false` means the lane
    // could not be queried at all, which must not read as "none": an
    // operator who sees "no dispensers" and republishes on that basis has
    // been told something the wallet never verified.
    const [consumers, setConsumers] = useState(
        /** @type {{ supported: boolean, dispensers: any[] } | null} */ (null),
    );
    useEffect(() => {
        if (!chainId || !oracleAddress) { setConsumers(null); return undefined; }
        if (flowsLib.isDemoWallet(walletId)) {
            setConsumers({ supported: false, dispensers: [] });
            return undefined;
        }
        if (typeof messaging?.oracleConsumers !== 'function') {
            setConsumers({ supported: false, dispensers: [] });
            return undefined;
        }
        let cancelled = false;
        messaging.oracleConsumers({ chainId, address: oracleAddress })
            .then((c) => { if (!cancelled) setConsumers(c || { supported: false, dispensers: [] }); })
            .catch(() => { if (!cancelled) setConsumers({ supported: false, dispensers: [] }); });
        return () => { cancelled = true; };
    }, [chainId, oracleAddress, messaging, walletId, reloadToken]);

    const tick = ticker.trim().toUpperCase();
    const currentFeed = useMemo(() => {
        if (!feeds || !tick || !priceCoin) return null;
        const key = `${priceCoin}/${tick}/${fiat}`;
        return feeds.find((f) => f.key === key) || null;
    }, [feeds, tick, fiat, priceCoin]);

    // "Prior published value" for the deviation check is the newest quote on
    // this pair, whether pending, live or stale. A pending row is what the pair
    // is about to be worth, so comparing against an older effective row would
    // understate a second correction made inside the same 24h window.
    const priorQuote = currentFeed
        ? (currentFeed.pending || currentFeed.live || currentFeed.stale)
        : null;
    const isFirstPublish = !currentFeed;
    // The deviation basis may be a quote still maturing, and nothing sells at
    // a pending price, so the wording must not call it current.
    const hasLiveQuote = !!currentFeed?.live;
    const hasStaleQuote = !!currentFeed?.stale;
    const priorLabel = priorQuote === currentFeed?.pending
        ? 'Pending price'
        : priorQuote === currentFeed?.stale
            ? 'Stale price'
            : 'Current price';
    const deviationPct = quoteDeviationPct(priorQuote?.value, value.trim());
    const needsTypedConfirm = deviationPct != null
        && Math.abs(deviationPct) > DEVIATION_TYPED_CONFIRM_PCT;
    const typedConfirmOk = !needsTypedConfirm || isExactTypedConfirmation(typedConfirm, 'PUBLISH');

    // Consumers of the exact pair being republished, which is the set that
    // actually reprices. Dispensers on this address's other feeds are
    // unaffected and would be noise on the confirm screen.
    // The lookup reads the publishing chain's dispensers only. A quote for
    // another chain's token is read by dispensers on THAT chain, so an empty
    // answer here would be an all-clear nobody checked.
    const consumerView = crossChain ? UNCHECKED_CONSUMERS : consumers;
    const pairConsumers = useMemo(() => {
        if (!consumerView?.supported || !tick) return [];
        return consumerView.dispensers.filter((d) => String(d.give_tick || '').toUpperCase() === tick);
    }, [consumerView, tick]);

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

    const actionParams = useMemo(() => {
        /** @type {Record<string, string>} */
        const p = { VERSION: '1' };
        if (priceCoin) p.COIN = priceCoin;
        if (tick) p.TICK = tick;
        if (fiat) p.FIAT = fiat;
        const v = value.trim();
        if (v) p.VALUE = v;
        // The field holds a percent; the protocol takes the exact fraction.
        // An unparseable entry is sent as typed so the pre-sign guard names it.
        const f = fee.trim();
        if (f) p.FEE = usageFeePercentToFraction(f) || f;
        const m = memo.trim();
        if (m) p.MEMO = m;
        return p;
    }, [priceCoin, tick, fiat, value, fee, memo]);

    const decoded = useMemo(() => {
        if (stage !== 'review' && stage !== 'submitting') return null;
        return groupDecodedAmounts(decoderLib.decodeAction({
            action: 'PRICE', params: actionParams, chainId: chainId || undefined, chainRegistry,
        }));
    }, [stage, actionParams, chainId]);

    const prefillFromFeed = useCallback((feed) => {
        setCoinPick(feed.coin && feed.coin !== coinTicker ? feed.coin : '');
        setTicker(feed.tick);
        setFiat(feed.fiat);
        const source = feed.pending || feed.live || feed.stale;
        setValue(source?.value ? String(source.value) : '');
        setFee(source?.fee ? usageFeeFractionToPercent(source.fee) : '');
        setFormError(null);
    }, [coinTicker]);

    function guardBeforeSign() {
        if (!chainId || !fromAddress) { setFormError('Pick a publishing address first.'); return false; }
        if (!tick) { setFormError('Choose the token this oracle prices.'); return false; }
        // A picked token always passes; a ticker from a link or a feed may not.
        const tickerError = tickerReferenceError(tick, { noun: 'Token', allowRef: true });
        if (tickerError) { setFormError(tickerError); return false; }
        if (!FIAT_CODES.includes(fiat)) { setFormError('Pick a supported fiat currency.'); return false; }
        const v = value.trim();
        const valueError = oraclePriceValueError(v);
        if (valueError) { setFormError(valueError); return false; }
        const feeError = usageFeePercentError(fee);
        if (feeError) { setFormError(feeError); return false; }
        const m = memo.trim();
        if (m.includes('|') || m.includes(';')) { setFormError('Memo cannot contain "|" or ";".'); return false; }
        const memoError = memoLengthError(m);
        if (memoError) { setFormError(memoError); return false; }
        return true;
    }

    // Sign through the shared confirm page, so the network pre-flight runs
    // before a price nobody can withdraw for 24 hours. Watcher mode never
    // signs, so it keeps the local review stage and builds an unsigned tx.
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    // Approve reads the ref, so it signs with the latest keystrokes.
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;

    async function openConfirm() {
        const from = buildFrom();
        if (!chainId || !from) return;
        const params = actionParams;
        const feeOpts = { payFeeInNativeCoin: nativeFee.flag, ...(feePerKb != null ? { feePerKb } : {}) };
        setSubmitError(null);
        try {
            const res = await actionConfirm.run({
                chainId,
                from,
                actionData: { action: 'PRICE', params },
                encoderOpts: feeOpts,
                // useActionForm's dispatch picks the software or device lane and
                // records the last-used chain; prebuiltPsbt pins the signed bytes.
                onApprove: (prebuiltPsbt) => submit({
                    params,
                    password: passwordValueRef.current,
                    extraBase: { ...feeOpts, prebuiltPsbt },
                }),
            });
            setResult(res);
            setPassword('');
            setReloadToken((t) => t + 1);
            setStage('done');
        } catch (err) {
            if (isUserRejection(err)) return;
            setFormError(submitFailureMessage(err, {
                chainId,
                coinTicker, mandatory: nativeFee.mandatory, fallback: err?.message || 'Publishing the price failed.',
            }));
        }
    }

    function handleReview(event) {
        event.preventDefault();
        setReviewAttempt((n) => n + 1);
        const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
        setFeeRefused(Boolean(feeStop));
        if (feeStop) { setFormError(feeStop.formError); return; }
        if (!guardBeforeSign()) return;
        setFormError(null);
        setTypedConfirm('');
        if (!isWatcherMode) { openConfirm(); return; }
        setStage('review');
    }

    const hwSignerInfo = useSignerInfo({ walletId, signerId: isHwSource ? fromAddress?.signerId : null });

    // Watcher lane only: encode an unsigned PRICE for a Signer-mode wallet.
    // The stage updates a render late, so the ref stops a second submit in
    // the same turn from building a second unsigned publish.
    const watcherSubmitRef = useRef(false);
    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting' || watcherSubmitRef.current) return;
        if (!typedConfirmOk) return;
        watcherSubmitRef.current = true;
        setStage('submitting');
        setSubmitError(null);
        try {
            const res = await submit({
                params: actionParams,
                password,
                extraBase: {
                    payFeeInNativeCoin: nativeFee.flag,
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
                encoderOpts: {
                    payFeeInNativeCoin: nativeFee.flag,
                    ...(feePerKb != null ? { feePerKb } : {}),
                },
            });
            setResult(res);
            setReloadToken((t) => t + 1);
            setStage('done');
        } catch (err) {
            setSubmitError(submitFailureMessage(err, {
                chainId,
                coinTicker, mandatory: nativeFee.mandatory, fallback: err?.message || 'Publishing the price failed.',
            }));
            setStage('review');
        } finally {
            watcherSubmitRef.current = false;
        }
    }

    function handleBuildAnother() { setResult(null); setSubmitError(null); setStage('form'); }

    const header = (
        <PageHeader
            nested={stage === 'review' || stage === 'submitting'}
            onBack={stage === 'review'
                ? () => { setSubmitError(null); setStage('form'); }
                : onBack}
            backDisabled={stage === 'submitting'}
            title={stage === 'review' || stage === 'submitting' ? 'Review Price Publish' : 'My Oracle'}
        />
    );
    // The review always opens at its top instead of inheriting how far the
    // form was scrolled; the form keeps its own position for Back.
    const wrap = (children) => (
        <Screen
            variant={variant}
            header={header}
            restoreScroll={!(stage === 'review' || stage === 'submitting')}
        >
            {children}
        </Screen>
    );

    const publishFacts = useMemo(() => [
        ...(priorQuote ? [{
            label: priorLabel,
            value: `${priorQuote.value} ${fiat}${
                priorLabel === 'Stale price'
                    ? ` (${staleAgeText(priorQuote.secondsSinceEffective)})`
                    : ''
            }${deviationPct != null ? ` (${fmtPct(deviationPct)})` : ''}`,
        }] : []),
        {
            label: 'Affected dispensers',
            value: consumerView && !consumerView.supported
                ? 'Could not check'
                : pairConsumers.length > 0
                    ? `${pairConsumers.length} open`
                    : 'None open',
        },
        ...pairConsumers.map((dispenser) => ({
            label: `Dispenser ${String(dispenser.action_index)}`,
            value: `${dispenser.address || dispenser.source} · ${dispenser.give_amount} ${tick} per dispense`,
        })),
    ], [consumerView, deviationPct, fiat, pairConsumers, priorLabel, priorQuote, tick]);
    const publishWarnings = useMemo(() => {
        const activation = isFirstPublish
            ? 'This is the first price for this pair. It will not price anything for 24 hours, and a dispenser pointed at it before then cannot settle.'
            : hasLiveQuote
                ? 'This price takes effect in 24 hours and cannot be withdrawn before then. The current price keeps selling until this one matures.'
                : hasStaleQuote
                    ? 'This price takes effect in 24 hours and cannot be withdrawn before then. Nothing sells on this pair until it matures.'
                    : 'This price takes effect in 24 hours and cannot be withdrawn before then. An earlier pending price takes effect first.';
        return [
            activation,
            ...(needsTypedConfirm ? [`This is a ${fmtPct(deviationPct)} move from the last published price. Check the decimal point before approving.`] : []),
            ...(consumerView && !consumerView.supported ? [
                `The wallet could not check which dispensers use this oracle. Treat the publish as if buyers are watching${crossChain ? `; dispensers selling ${priceCoin} tokens are not visible from this network` : ''}.`,
            ] : pairConsumers.length > 0 ? [
                `${pairConsumers.length} open dispenser${pairConsumers.length === 1 ? '' : 's'} will use this price once it takes effect.`,
            ] : []),
        ];
    }, [consumerView, crossChain, deviationPct, hasLiveQuote, hasStaleQuote, isFirstPublish, needsTypedConfirm, pairConsumers.length, priceCoin]);
    const reviewDecoded = useMemo(() => (decoded ? {
        ...decoded,
        warnings: [...(decoded.warnings || []), ...publishWarnings],
    } : null), [decoded, publishWarnings]);
    const legacyComposed = useMemo(() => (reviewDecoded ? {
        action: 'PRICE',
        chainId,
        decoded: reviewDecoded,
        protocolFeeKnownFree: true,
    } : null), [chainId, reviewDecoded]);
    const confirmComposed = useMemo(() => {
        const composed = actionConfirm.confirmAction.composed;
        if (!composed) return composed;
        return {
            ...composed,
            decoded: {
                ...(composed.decoded || {}),
                warnings: [...(composed.decoded?.warnings || []), ...publishWarnings],
            },
        };
    }, [actionConfirm.confirmAction.composed, publishWarnings]);
    const pricedAsset = String(actionParams.TICK || actionParams.COIN || '').toUpperCase();
    const confirmPriceSummary = {
        verb: t('components.confirmSummary.verbPublishPrice'),
        ...(pricedAsset && actionParams.VALUE
            ? {
                target: t('components.confirmSummary.priceTarget', {
                    asset: pricedAsset,
                    value: actionParams.VALUE,
                    fiat: String(actionParams.FIAT || '').toUpperCase(),
                }).trim(),
            }
            : {}),
        direction: 'none',
        chainId,
        address: fromAddress?.address,
        facts: publishFacts,
    };
    const typedGate = needsTypedConfirm ? (
        <Input
            label="Type PUBLISH to confirm"
            help={typedConfirmationCopy.oracle(fmtPct(deviationPct))}
            value={typedConfirm}
            onChange={(event) => setTypedConfirm(event.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
        />
    ) : null;

    // The load error, the loading line and every result lay out through
    // FormPage like the form itself, so no state draws straight into Screen.
    if (loadError) {
        return wrap(
            <FormPage
                label="Publish oracle price"
                status={<StatusMessage variant="error">{loadError}</StatusMessage>}
            />,
        );
    }
    if (!addressesByChain || !chainId) {
        return wrap(<FormPage label="Publish oracle price"><p className={styles.hint}>Loading…</p></FormPage>);
    }

    if (actionConfirm.open) {
        const credsReady = isHwSource ? hwStatus === 'available' : (signerReady || password.length > 0);
        return (
            <ActionConfirmScreen
                confirmAction={{ ...actionConfirm.confirmAction, composed: confirmComposed }}
                summary={confirmPriceSummary}
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
                // Approve also waits on the typed PUBLISH when the move is large.
                credentialsReady={typedConfirmOk && credsReady}
                extraCredentials={typedGate}
                hwSource={isHwSource ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                hwSignerInfo={hwSignerInfo}
                chainId={chainId}
                getSignerStatus={messaging.getSignerStatus}
                hintClassName={styles.hint}
            />
        );
    }

    if (stage === 'done') {
        const txid = result?.txid || result?.broadcast?.txid;
        // Signed but not broadcast yet: nothing is priced, so no success copy.
        if (result?.queued) {
            return wrap(
                <FormPage label="Queued price publish">
                    <ResultScreen state="signed-not-broadcast" onDone={onBack} what="price publish" unsaved={result.unsaved} />
                </FormPage>,
            );
        }
        if (result?.psbtHex && !txid) {
            return wrap(
                <FormPage label="Unsigned price publish">
                    <ResultScreen state="unsigned" result={result} onBuildAnother={handleBuildAnother} onDone={onBack} />
                </FormPage>,
            );
        }
        return wrap(
            <FormPage
                label="Price publish result"
                actions={(
                    <>
                        <Button variant="secondary" onClick={handleBuildAnother}>Publish Another</Button>
                        <Button variant="success" icon={<Icon.CheckIcon />} onClick={onBack}>Done</Button>
                    </>
                )}
            >
                <h2 className={styles.successTitle}>Price publish broadcast</h2>
                <p className={styles.hint}>
                    {tick} = {value.trim()} {fiat} starts pricing dispensers 24 hours after this
                    transaction confirms. Until then the previous price (if any) stays in effect.
                </p>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>Transaction ID</p>
                        <code className={styles.txid}>{txid}</code>
                    </>
                ) : null}
            </FormPage>,
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
                onReject={() => { setSubmitError(null); setTypedConfirm(''); setStage('form'); }}
                decoded={reviewDecoded}
                chainLabel={descriptor?.displayName || chainId}
                screenVariant={variant}
                error={submitError}
                sourceAddress={fromAddress?.address}
                nativeTicker={coinTicker}
                credentialsReady={typedConfirmOk}
                credentials={(
                    <>
                        <p className={styles.hint}>{t('common.watcherBuildsUnsigned')}</p>
                        {typedGate}
                    </>
                )}
                summary={confirmPriceSummary}
                networkFee={feeEstimate?.coinAmount ? {
                    amount: String(feeEstimate.coinAmount), ticker: coinTicker, estimate: true,
                } : null}
            />
        );
    }

    if (sourcePickerOpen) {
        return (
            <OwnAddressPickerScreen
                variant={variant}
                title="Publishing Address"
                walletId={walletId}
                chainId={chainId}
                onChainChange={setChainId}
                onPick={(a) => { setFromAddressId(a.id); setSourcePickerOpen(false); }}
                onBack={() => setSourcePickerOpen(false)}
            />
        );
    }

    // The standard token picker on the priced token's network: the tokens
    // this wallet owns list first, and a typed search finds any token there,
    // since an oracle may price any token. A pick is the TICK, and its chain
    // is the COIN, so the two can never disagree.
    if (tokenPickerOpen) {
        const networkName = chainRegistry.get(priceChainId)?.displayName || priceCoin;
        const failedEmpty = ownedTokens.failed && Array.isArray(ownedTokens.rows) && ownedTokens.rows.length === 0;
        return (
            <TokenPicker
                purpose="send"
                walletId={walletId}
                kindFilter="tokens"
                kindLocked
                chainIdFilter={priceChainId || undefined}
                title="Select Token"
                rows={ownedTokens.rows}
                searchPlatform
                emptyTitle={failedEmpty ? "Couldn't load your tokens" : `No tokens you own on ${networkName}`}
                emptyBody={`Search to find any token on ${networkName} to price.`}
                onSelect={(sel) => {
                    if (sel?.tick) {
                        const pickedCoin = tickerForCoin(chainRegistry.get(sel.chainId)?.coin);
                        if (pickedCoin && isProtocolCoinTicker(pickedCoin)) {
                            setCoinPick(pickedCoin === coinTicker ? '' : pickedCoin);
                        }
                        setTicker(String(sel.tick).toUpperCase());
                        setFormError(null);
                    }
                    setTokenPickerOpen(false);
                }}
                onBack={() => setTokenPickerOpen(false)}
            />
        );
    }

    // The fiat currencies the protocol prices in, on the shared picker page;
    // the pick is the same ISO code the dropdown submitted.
    if (fiatPickerOpen) {
        return (
            <FiatCurrencyPicker
                variant={variant}
                codes={FIAT_CODES}
                value={fiat}
                onSelect={(code) => {
                    if (code) setFiat(code);
                    setFiatPickerOpen(false);
                }}
                onBack={() => setFiatPickerOpen(false)}
            />
        );
    }

    // Counts only this chain's own-coin feeds, for the same reason as consumerView.
    const consumerCountFor = (feed) => {
        if (!consumers?.supported || feed.coin !== coinTicker) return null;
        return consumers.dispensers.filter(
            (d) => String(d.give_tick || '').toUpperCase() === String(feed.tick).toUpperCase(),
        ).length;
    };

    // The section a refusal belongs to, so Publish reopens it.
    const errorSection = !formError ? null
        : feeRefused ? 'fee'
            : /memo/i.test(formError) ? 'memo'
                : /usage fee/i.test(formError) ? 'usage'
                    : /publishing address/i.test(formError) ? 'from'
                        : 'price';
    const revealFor = (id) => (errorSection === id ? reviewAttempt : 0);
    const noSourceOnChain = !((addressesByChain?.[chainId]) || []).length;
    // Closed-section summaries.
    const priceSummary = joinSummary(
        tick ? `${crossChain ? `${priceCoin}:` : ''}${tick}` : null,
        value.trim() ? `${value.trim()} ${fiat}` : fiat,
    ) || null;
    const feedsSummary = feeds == null ? 'Loading'
        : feedsError ? 'Could not load'
            : feeds.length === 0 ? 'None yet'
                : `${feeds.length} price${feeds.length === 1 ? '' : 's'}`;

    // The standard order: From (closed) holds the publishing network and
    // address, the oracle's identity; Price (open) holds the priced token,
    // currency and price; then Published Prices, Usage Fee, Memo and fee.
    return wrap(
        <FormFrame
            demoGuard={demoGuard}
            label="Publish oracle price"
            onSubmit={handleReview}
            status={formError ? (
                <StatusMessage variant="error">{formError}</StatusMessage>
            ) : null}
            action={(
                <FormAction
                    icon={<Icon.UploadIcon />}
                    loading={actionConfirm.composing}
                    disabled={actionConfirm.composing}
                >
                    {actionConfirm.composing ? 'Preparing Review…' : 'Publish Price'}
                </FormAction>
            )}
            /*
              * Pick the PUBLISHING chain: it decides which address signs, pays
              * the fee and becomes the oracle's identity. The priced token's
              * chain is the separate COIN field below, and dispensers on any
              * chain may read this oracle, so the two need not match.
              */
            from={(
                <FromSection
                    {...formSections.bind('from')}
                    chainId={chainId}
                    chainIds={chainsWithAddresses.length ? chainsWithAddresses : (chainId ? [chainId] : [])}
                    chainRegistry={chainRegistry}
                    onNetworkChange={setChainId}
                    networkHelp="The chain your price updates are published on. It decides which address signs and pays the fee, and it becomes your oracle's identity."
                    address={fromAddress?.address || null}
                    addressLabel="Publishing address"
                    addressHelp="The address that publishes prices. It is your oracle's identity: dispensers that use this oracle read the prices published from this address."
                    onOpenPicker={() => setSourcePickerOpen(true)}
                    pickerLabel="Choose publishing address"
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
                id="price"
                title="Price"
                icon={Icon.DollarIcon}
                {...formSections.bind('price')}
                revealKey={revealFor('price')}
                summary={priceSummary}
            >
            {/* The priced token's network stays a network field here,
                beside the ticker: it is the PRICE action's COIN, not the
                publishing network, which lives in From. */}
            <NetworkField
                label="Priced token network"
                help="The network the priced token lives on. It can differ from the publishing network."
                value={priceChainId}
                onChange={(nextChainId) => {
                    const nextCoin = tickerForCoin(chainRegistry.get(nextChainId)?.coin);
                    setCoinPick(nextCoin === coinTicker ? '' : nextCoin);
                }}
                chainIds={priceChainIds}
                chainRegistry={chainRegistry}
                notSource
            />
            {crossChain ? (
                <p className={styles.hint}>
                    {`Cross-chain: a ${coinTicker} transaction publishing the price of a ${priceCoin} token.`}
                </p>
            ) : null}
            {/* The standard token field: tapping it opens the token
                picker; the field never takes typed text. */}
            <TokenField
                id="oracle-token"
                label="Token"
                help={`The ${priceCoin} token you are pricing. Its network can differ from the publishing network.`}
                value={tick && priceChainId ? { chainId: priceChainId, tick } : null}
                onOpenPicker={() => setTokenPickerOpen(true)}
            />
            <FiatCurrencyField
                id="oracle-fiat"
                help="Dispensers pricing in this currency can use this oracle."
                value={fiat}
                onOpenPicker={() => setFiatPickerOpen(true)}
            />
            <Input
                label={`Price of one ${tick || 'token'} in ${fiat}`}
                help="The price published for one token in the selected currency, with up to 8 decimal places."
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                autoComplete="off"
            />
            {priorQuote ? (
                <p className={styles.hint}>
                    Currently published: {priorQuote.value} {fiat}
                    {priorQuote === currentFeed?.stale
                        ? ` (stale, ${staleAgeText(priorQuote.secondsSinceEffective)})`
                        : priorQuote.effective ? '' : ` (not in effect yet${
                        activationCountdownText(priorQuote.secondsUntilEffective)
                            ? `, starts in ${activationCountdownText(priorQuote.secondsUntilEffective)}`
                            : ''})`}
                    {deviationPct != null ? ` · this publish is a ${fmtPct(deviationPct)} move` : ''}
                </p>
            ) : tick ? (
                <p className={styles.hint}>
                    First price for {tick} in {fiat}. It will not price anything for 24 hours.
                </p>
            ) : null}
            </FormSection>

            {/* The prices this address already publishes, each a
                button that fills Price with its values, in a closed section. */}
            <FormSection
                id="feeds"
                title="Published Prices"
                icon={Icon.LineChartIcon}
                {...formSections.bind('feeds')}
                summary={feedsSummary}
            >
            {feeds == null ? (
                <p className={styles.hint}>Loading…</p>
            ) : feedsError ? (
                <FieldNote variant="error">{feedsError}</FieldNote>
            ) : feeds.length === 0 ? (
                <p className={styles.hint}>
                    This address has not published any prices yet. The first one you publish starts
                    pricing 24 hours later.
                </p>
            ) : (
                <ul>
                    {feeds.map((f) => {
                        const countdown = activationCountdownText(f.pending?.secondsUntilEffective);
                        const staleAge = staleAgeText(f.stale?.secondsSinceEffective);
                        const effectiveQuote = f.live || f.stale;
                        const count = consumerCountFor(f);
                        return (
                            <li key={f.key} className={styles.hint}>
                                <Button variant="secondary" size="sm" icon={<Icon.DollarIcon />} onClick={() => prefillFromFeed(f)}>
                                    {f.coin && f.coin !== coinTicker ? `${f.coin}:` : ''}{f.tick} in {f.fiat}
                                </Button>
                                {': '}
                                {f.live
                                    ? `${f.live.value} ${f.fiat} live`
                                    : f.stale
                                        ? `${f.stale.value} ${f.fiat} stale (${staleAge})`
                                        : 'nothing live yet'}
                                {f.pending
                                    ? `, ${f.pending.value} ${f.fiat} starts in ${countdown || 'moments'}`
                                    : ''}
                                {effectiveQuote?.fee ? ` · fee ${effectiveQuote.fee}` : ''}
                                {count != null ? ` · ${count} dispenser${count === 1 ? '' : 's'}` : ''}
                            </li>
                        );
                    })}
                </ul>
            )}
            </FormSection>

            {/* The usage fee is the oracle's own charge, separate
                from the Network fee row; an optional section of its own. */}
            <FormSection
                id="usage"
                title="Usage Fee"
                icon={Icon.CoinsIcon}
                optional
                {...formSections.bind('usage')}
                revealKey={revealFor('usage')}
                summary={fee.trim() ? `${fee.trim()}%` : 'None'}
            >
                <StopSlider
                    label="Usage fee"
                    infoAria="How the usage fee works"
                    infoLabel="Percent charged when someone opens a dispenser with this oracle. The fee scales with escrow. The usage fee should be very small: most oracles charge well under 1%. Free charges nothing."
                    stops={FEE_STOPS}
                    activeId={feeCustom ? 'custom' : (FEE_STOPS.find((s) => s.percent !== null && s.percent === fee.trim())?.id || 'custom')}
                    pill={fee.trim() ? `${fee.trim()}%` : 'Free'}
                    valueText={fee.trim() ? `${fee.trim()} percent` : 'Free, 0 percent'}
                    onPick={(id) => {
                        const stop = FEE_STOPS.find((s) => s.id === id);
                        if (!stop) return;
                        if (stop.percent === null) { setFeeCustom(true); return; }
                        setFeeCustom(false);
                        setFee(stop.percent);
                    }}
                >
                    {(feeCustom || (fee.trim() && !FEE_STOPS.some((s) => s.percent === fee.trim()))) ? (
                        <Input
                            label="Custom usage fee"
                            help="A percent from 0 to 100. Keep it very small."
                            hint="Keep the usage fee very small."
                            inputMode="decimal"
                            value={fee}
                            onChange={(e) => setFee(e.target.value)}
                            autoComplete="off"
                            fieldAction={<span className={styles.fieldUnit}>%</span>}
                        />
                    ) : null}
                </StopSlider>
            </FormSection>
            {/* Memo holds only the memo: the section title names the field
                and carries its count. */}
            <MemoSection
                {...formSections.bind('memo')}
                revealKey={revealFor('memo')}
                maxLength={MAX_MEMO_LENGTH}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
            />
        </FormFrame>,
    );
}
