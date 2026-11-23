// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PlaceOrderPanel: §41.3.4 Place Order form.
//
// Limit orders only (XChain ORDER is inherently limit-based; Pass 1
// §3 rules out margin / algo / aggregation). Buy vs Sell toggle maps
// to which side of the (tick1, tick2) pair the user gives vs gets:
//
//   Buy  tick1 with tick2 → give (price × size) tick2, get size tick1
//   Sell tick1 for tick2  → give size tick1, get (price × size) tick2
//
// Expiration in blocks (XChain's native unit). Presets map rough
// calendar durations to their block counts per-chain; "never" emits
// 0 (the protocol's perpetual sentinel).
//
// Signs via `messaging.orderAction` / `orderActionHw`, reusing the
// shared <SignCredentials> gate so Trezor/Ledger signers slot in
// behind the same form surface (Phase 2 HW Sign pattern).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Button,
    EmptyState,
    FieldIconButton,
    FieldNote,
    FormNotice,
    FormPage,
    Icon,
    IconSelect,
    Input,
    SegmentedControl,
    Select,
    StatusMessage,
    Switch,
} from '@xchain-wallet/core/ui';
// The Trade page's form (layout="trade") reads exact decimals for the percent
// chips and the swap ticket, and draws the pair's coin icons.
import {
    decimalFromBaseUnits,
    decimalQuotientFloor,
    formatWithThousands,
    multiplyDecimalStrings,
    trimAmountTail,
} from '../utils/amountFormat.js';
import { BuyGlyph, SellGlyph, SwapTicket } from './marketTradeParts.jsx';
import { decoder as decoderLib, registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard, useWalletSource } from '../hooks/useDemoGuard.jsx';
import { useGatedTickNotice, gatedTickWarningCopy } from '../hooks/useGatedTickNotice.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from './ActionConfirmScreen.jsx';
import { ConfirmActionModal } from './ConfirmActionModal.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { isHwSource, SignCredentials } from './SignCredentials.jsx';
import { buildBalanceRows, formatAmount } from './BalanceList.jsx';
import { FeeSection } from './formStandard/FeeSection.jsx';
import { FormAction, FormFrame, FormSection, FromSection, joinSummary, useFormSections } from './formStandard/index.js';
import { ResultScreen } from './ResultScreen.jsx';
import { MobileAutopayNotice } from './MobileAutopayNotice.jsx';
import { NATIVE_FEE_WARNING } from '../../sdk/nativeFeePreflight.js';
import { submitFailureMessage, SIGNED_NOT_BROADCAST_TITLE } from '../utils/submitFailureMessage.js';
import { preferredSourceId } from '../addressSelection.js';
import {
    customFeeEstimate,
    customFeeReviewStop,
    displayRateToSettingsCustom,
    estimateNativeSendFee,
    estimateNativeSendFeeTiers,
} from '../../flows/feeEstimate.js';
import { compareAmounts, multiplyAmounts } from '../../market/orderMath.js';
import { normalizeAmountFieldInput, tokenAmountPrecisionError } from '../utils/amountFormat.js';
import { orderGiveParts } from '../utils/confirmSummaryParts.js';
import { baseUnitsToCoinText } from '../../market/obligationStatus.js';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { useProtocolFeeQuote } from '../hooks/useProtocolFeeQuote.js';
import { normalizeProtocolFee } from '../../flows/protocolFeeRow.js';
import { useTokenInfo } from '../hooks/useTokenInfo.js';
import styles from './MarketTrading.module.css';
import ownStyles from './PlaceOrderPanel.module.css';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/flows.js';
import '../../i18n/locales/en/market.js';
import '../../i18n/locales/en/routes.js';
import '../../i18n/locales/en/send.js';

const chainRegistry = registryLib.defaultRegistry();
const NO_ACKNOWLEDGMENTS = new Set();

const PROTOCOL_COIN_TICKER = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };

// ORDER EXPIRATION is a wall-clock Unix timestamp, NOT a block height:
// the indexer rejects `EXPIRATION <= BLOCK_TIME` as "past", so the old
// block-count presets (144/1008/…) were all < BLOCK_TIME and made every
// timed order index invalid. Presets are now durations converted to a
// future Unix timestamp at submit; `days: null` = the default window
// (omit EXPIRATION, since an empty field yields the protocol default,
// not "never" - there is no on-wire perpetual expiration).
const EXPIRATION_PRESETS = [
    { id: '1d', label: '1 day', days: 1 },
    { id: '1w', label: '1 week', days: 7 },
    { id: '1m', label: '1 month', days: 30 },
    { id: 'default', label: 'Default window', days: null },
];

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string} props.tick1
 * @param {string} props.tick2
 * @param {string | null} [props.prefillPrice]       from orderbook click
 * @param {number} [props.prefillPick]               counts book picks, so the same price picked again refills
 * @param {() => void} [props.onOrderPlaced]         refresh parent after placement
 * @param {'panel' | 'trade'} [props.layout]          'trade' draws the Trade page's form; 'panel' (default) is the standalone form
 * @param {'market' | 'swap'} [props.view]            trade layout only: the order form, or the You pay / You get ticket
 * @param {(view: 'market' | 'swap') => void} [props.onViewChange]   trade layout: the page owns the view; omit to keep it inside
 * @param {'buy' | 'sell'} [props.side]               controlled side (the page owns it); omit to keep it inside
 * @param {(side: 'buy' | 'sell') => void} [props.onSideChange]
 * @param {string | null} [props.bestBid]             best bid and ask, for Market orders and Fill now
 * @param {string | null} [props.bestAsk]
 * @param {string | null} [props.lastPrice]           the starting limit price when nothing was prefilled
 * @param {'limit' | 'market'} [props.initialOrderType]
 */
export function PlaceOrderPanel({
    walletId, chainId, tick1, tick2, prefillPrice, prefillPick, onOrderPlaced,
    layout = 'panel', view: viewProp = 'market', onViewChange, side: controlledSide, onSideChange,
    bestBid = null, bestAsk = null, lastPrice = null, initialOrderType = 'limit',
}) {
    // The Trade page owns the view when it passes onViewChange (the Swap |
    // Limit | Market toggle lives in this form); otherwise the panel keeps it.
    const [ownView, setOwnView] = useState(/** @type {'market' | 'swap'} */ (viewProp));
    const view = onViewChange ? viewProp : ownView;
    const setView = useCallback((next) => {
        setOwnView(next);
        onViewChange?.(next);
    }, [onViewChange]);
    const { shell } = useMessaging();
    const { messaging } = useWalletSource(walletId);
    const demoGuard = useDemoGuard(walletId);
    const variant = screenVariantFor(shell);
    const signerReady = useSignerReady(walletId);
    // The Trade page owns the side (the Market page's Buy and Sell open it on
    // one, and its Buy | Sell toggle and Swap's flip arrow change it), so a
    // controlled side wins when the host also takes onSideChange; otherwise
    // `side` only opens the panel on it and the panel keeps its own.
    const [ownSide, setOwnSide] = useState(/** @type {'buy' | 'sell'} */ (controlledSide || 'buy'));
    const side = (onSideChange && controlledSide) || ownSide;
    const setSide = useCallback((next) => {
        setOwnSide(next);
        onSideChange?.(next);
    }, [onSideChange]);
    const trade = layout === 'trade';
    // PC-26: order settlement carries no gated-key handoff; warn when the
    // give-side token (sell → tick1, buy → tick2) has gated content.
    const gatedTick1 = useGatedTickNotice({
        messaging, chainId, tick: tick1, enabled: side === 'sell',
    });
    const gatedTick2 = useGatedTickNotice({
        messaging, chainId, tick: tick2, enabled: side !== 'sell',
    });
    const gatedGiveNotice = side === 'sell' ? gatedTick1 : gatedTick2;
    const [price, setPrice] = useState('');
    const [size, setSize] = useState('');
    const [expirationId, setExpirationId] = useState('1w');
    const [customExpiration, setCustomExpiration] = useState('');
    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [balances, setBalances] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [accountLoading, setAccountLoading] = useState(true);
    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));
    const [password, setPassword] = useState('');
    const [stage, setStage] = useState(/** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    // The Trade form shows the demo refusal only once Place Order was pressed
    // (G92), whether or not the guard itself holds its note back until then.
    const [demoRefused, setDemoRefused] = useState(false);
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const panelVersionRef = useRef(0);

    useEffect(() => {
        panelVersionRef.current += 1;
        setStage('form');
        setSubmitError(null);
        setFormError(null);
        setResult(null);
        setPassword('');
        return () => { panelVersionRef.current += 1; };
    }, [walletId, chainId, tick1, tick2]);

    useEffect(() => {
        if (stage !== 'review') return undefined;
        const focusTimer = setTimeout(() => passwordRef.current?.focus(), 0);
        const handleEscape = (event) => {
            if (event.key !== 'Escape' || event.defaultPrevented) return;
            event.preventDefault();
            setStage('form');
        };
        window.addEventListener('keydown', handleEscape);
        return () => {
            clearTimeout(focusTimer);
            window.removeEventListener('keydown', handleEscape);
        };
    }, [stage]);

    const { payFeeInNativeCoin, setPayFeeInNativeCoin, mandatory: nativeFeeMandatory } =
        useNativeFee(chainId);

    // The Trade page's Network fee section: Slow / Normal / Fast / Custom, as
    // on Swap and Create order. The pick prices the broadcast (feePerKb) and
    // the fee the confirm screen shows. The standalone panel has no picker and
    // keeps its fixed normal estimate with no feePerKb, as before.
    const [feePick, setFeePick] = useState(
        /** @type {{ mode: 'low' | 'normal' | 'fast' | 'custom', customRate?: number }} */ ({ mode: 'normal' }),
    );
    const feeTiers = useMemo(
        () => (trade ? estimateNativeSendFeeTiers({ chainId, chainRegistry }) : null),
        [trade, chainId],
    );
    const feeCustomEstimate = useMemo(
        () => (trade && feePick.mode === 'custom'
            ? customFeeEstimate({ chainId, chainRegistry, rate: Number(feePick.customRate) || 0 })
            : null),
        [trade, chainId, feePick],
    );
    const pickedFeeEstimate = !trade
        ? null
        : (feePick.mode === 'custom'
            ? feeCustomEstimate
            : (feeTiers ? feeTiers[feePick.mode] : estimateNativeSendFee({ chainId, chainRegistry, speed: feePick.mode })));
    const feePerKb = (pickedFeeEstimate && pickedFeeEstimate.unit
        && Number.isFinite(pickedFeeEstimate.rateValue) && pickedFeeEstimate.rateValue > 0)
        ? displayRateToSettingsCustom(pickedFeeEstimate.unit, pickedFeeEstimate.rateValue)
        : null;
    const feePerKbOpts = feePerKb != null ? { feePerKb } : {};
    // The Trade page's Form Standard sections (From, Trade Details, Fees),
    // held here, above every early return, so the confirm screen does not
    // close a section the user opened. Trade Details starts open.
    const tradeSections = useFormSections({ from: false, trade: true, fee: false });

    // PC-16 CoinPay auto-pay consent. Checked by default (operator-ratified):
    // a coin-GIVE order that is not auto-paid is not fire-and-forget.
    const [autopayEnabled, setAutopayEnabled] = useState(true);
    const [exposure, setExposure] = useState(/** @type {Record<string, string> | null} */ (null));

    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    useEffect(() => {
        if (prefillPrice) setPrice(prefillPrice);
    }, [prefillPrice, prefillPick]);

    // Limit | Market on the Trade page and the swap ticket's Limit and Fill now
    // chips are one setting. Market is still an ORDER, priced at the best
    // opposite quote (ask for a buy, bid for a sell); the typed limit price
    // is kept aside and returns when Limit is chosen again.
    const [orderType, setOrderType] = useState(/** @type {'limit' | 'market'} */ (initialOrderType));
    const limitPriceRef = useRef(/** @type {string | null} */ (null));
    const bestQuote = side === 'buy' ? bestAsk : bestBid;
    const chooseOrderType = (next) => {
        if (next === orderType) return;
        if (next === 'market') limitPriceRef.current = price;
        else if (limitPriceRef.current !== null) setPrice(limitPriceRef.current);
        setOrderType(next);
    };
    useEffect(() => {
        if (trade && orderType === 'market' && bestQuote) setPrice(bestQuote);
    }, [trade, orderType, bestQuote]);
    // With no book pick, the Trade page starts at the last trade price.
    const startPriceAppliedRef = useRef(false);
    useEffect(() => {
        if (!trade || startPriceAppliedRef.current || prefillPrice) return;
        if (lastPrice) {
            startPriceAppliedRef.current = true;
            setPrice((current) => current || lastPrice);
        }
    }, [trade, lastPrice, prefillPrice]);

    useEffect(() => {
        let cancelled = false;
        setAccountLoading(true);
        (async () => {
            try {
                const [byChain, active] = await Promise.all([
                    messaging.getAddressesByChain(walletId),
                    typeof messaging.getActiveAddresses === 'function'
                        ? messaging.getActiveAddresses(walletId)
                        : Promise.resolve({}),
                ]);
                if (cancelled) return;
                setAddressesByChain(byChain);
                // Fund the order from the chain's active address (fall back to
                // the newest HD external), matching Send so the balance shown
                // below and the address that signs are the same one.
                const chainAddresses = byChain[chainId] || [];
                const sourceId = preferredSourceId(chainAddresses, active?.[chainId])
                    || chainAddresses[0]?.id;
                if (sourceId) setFromAddressId(sourceId);
                // Pull balances alongside addresses so we can show the
                // user how much of tick1 / tick2 they have available
                // before they place the order.
                const b = await messaging.getWalletBalances(walletId);
                if (!cancelled) setBalances(b);
            } catch { /* surfaced via submit error on place */ }
            finally {
                if (!cancelled) setAccountLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [messaging, walletId, chainId]);

    const assetFor = useCallback((tick) => {
        if (!balances) return null;
        if (!Array.isArray(balances[chainId])) return null;
        // Scope the shown balance to the funding address (the one that will
        // sign), not the wallet-wide aggregate: a single SOURCE can only spend
        // what sits on that address, so showing the aggregate would overstate
        // what the order can actually cover.
        const fundingAddr = (addressesByChain?.[chainId] || [])
            .find((a) => a.id === fromAddressId)?.address || null;
        const rows = buildBalanceRows(
            balances,
            chainRegistry,
            fundingAddr ? { [chainId]: { address: fundingAddr } } : null,
        );
        const tickUpper = String(tick || '').toUpperCase();
        const hit = rows.find((r) => r.chainId === chainId && r.tick.toUpperCase() === tickUpper);
        if (!hit) return { balance: '0', available: '0', divisibility: null };
        return {
            balance: formatQuantity(hit.quantity, hit.divisibility),
            // The display balance carries thousands separators, which no exact
            // comparison can parse; the guard compares against this plain form.
            available: plainQuantity(hit.quantity, hit.divisibility),
            divisibility: Number.isInteger(Number(hit.divisibility)) ? Number(hit.divisibility) : null,
        };
    }, [balances, chainId, addressesByChain, fromAddressId]);
    const balanceFor = useCallback((tick) => assetFor(tick)?.balance ?? null, [assetFor]);

    const fromAddress = useMemo(() => {
        if (!addressesByChain || !fromAddressId) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [addressesByChain, chainId, fromAddressId]);

    const hw = isHwSource(fromAddress);

    const descriptor = chainRegistry.get(chainId);
    const coinTicker = descriptor ? (PROTOCOL_COIN_TICKER[descriptor.coin] || '') : '';
    const tick1Info = useTokenInfo({
        chainId, tick: tick1, skip: tick1.toUpperCase() === coinTicker,
    });
    const tick2Info = useTokenInfo({
        chainId, tick: tick2, skip: tick2.toUpperCase() === coinTicker,
    });

    // The GIVE side is the chain's native coin, the only shape that settles
    // via CoinPay and can arm auto pay. Buy gives tick2,
    // sell gives tick1.
    const giveIsNative = Boolean(coinTicker) &&
        (side === 'buy' ? tick2 : tick1).toUpperCase() === coinTicker;
    // Device and remote signers stay off because they cannot sign unattended.
    const { isWatcherMode } = useWalletMode();
    const signsUnattended = !isWatcherMode && !isHwSource(fromAddress);
    const autopayEligible = giveIsNative && signsUnattended;
    const autopayArm = autopayEligible && autopayEnabled;
    // The web wallet has no background watcher, so an armed order pays only
    // while the wallet is open; the confirm screen says so on every order.
    const confirmNotice = shell === 'web' && autopayArm
        ? t('components.placeOrderPanel.autoPayConfirmNotice')
        : undefined;
    // The CoinPay notice and auto-pay choice show when the current side
    // gives the coin.
    const coinpaySide = giveIsNative ? side : null;
    const coinpayArmShown = Boolean(coinpaySide) && signsUnattended && autopayEnabled;

    // Aggregate outstanding auto-pay exposure (the bound the user accepts).
    useEffect(() => {
        setExposure(null);
        if (!coinpayArmShown || typeof messaging.getAutopayExposure !== 'function') return undefined;
        let cancelled = false;
        messaging.getAutopayExposure({ walletId })
            .then((e) => { if (!cancelled) setExposure(e || {}); })
            .catch(() => { if (!cancelled) setExposure(null); });
        return () => { cancelled = true; };
    }, [messaging, walletId, coinpayArmShown]);

    // Exact price × size as a plain-decimal string (never a float
    // artifact or scientific notation). This is both what the review
    // screen shows and what serialises into GIVE_AMOUNT / GET_AMOUNT, so
    // the two can never disagree. null when price or size isn't a
    // positive plain-decimal number.
    const total = useMemo(() => multiplyAmounts(price, size), [price, size]);

    // The size as the wire spells it. The indexer refuses an amount with an
    // empty half (".5", "5."), which the entry filter allows; multiplying by
    // one gives the same plain form the total already uses.
    const sizeText = useMemo(() => multiplyAmounts(size, '1') ?? String(size).trim(), [size]);
    // The price in the same plain spelling, so the review row reads like the
    // give and get amounts beside it.
    const priceText = useMemo(() => multiplyAmounts(price, '1') ?? String(price).trim(), [price]);

    // The chosen expiration as a Unix timestamp (seconds). `null` = the
    // default window (omit EXPIRATION); `undefined` = an invalid custom
    // entry (blocked in the guard); a number is emitted verbatim.
    // A preset is a duration from the moment of submit, so it resolves on every
    // call: a panel left open for hours still places a full-length order.
    const resolveExpirationUnix = () => {
        if (expirationId === 'custom') {
            const ms = Date.parse(customExpiration);
            if (!Number.isFinite(ms)) return undefined;
            return Math.floor(ms / 1000);
        }
        const preset = EXPIRATION_PRESETS.find((e) => e.id === expirationId);
        if (!preset) return undefined;
        if (preset.days == null) return null;
        return Math.floor(Date.now() / 1000) + preset.days * 86400;
    };
    const expirationUnix = resolveExpirationUnix();

    const summary = useMemo(() => {
        if (!total) return null;
        if (side === 'buy') {
            return t('components.placeOrderPanel.summaryBuy', {
                total, tick2, size: sizeText, tick1,
            });
        }
        return t('components.placeOrderPanel.summarySell', {
            size: sizeText, tick1, total, tick2,
        });
    }, [side, total, sizeText, tick1, tick2]);

    function buildParams() {
        const sizeStr = sizeText;
        const totalStr = total == null ? '' : String(total);
        /** @type {Record<string, string>} */
        // GIVE_COIN / GET_COIN are required by the indexer (order.js
        // rejects a missing COIN network as invalid). This panel trades a
        // market that lives on ONE chain, so both sides carry the panel's
        // own coin; an order whose GET side settles on another chain
        // (federation-matched, CROSS_SETTLE) is authored by
        // CrossChainOrderForm.
        const p = { VERSION: '0', GIVE_COIN: coinTicker, GET_COIN: coinTicker };
        if (side === 'buy') {
            p.GIVE_TICK = tick2;
            p.GIVE_AMOUNT = totalStr;
            p.GET_TICK = tick1;
            p.GET_AMOUNT = sizeStr;
        } else {
            p.GIVE_TICK = tick1;
            p.GIVE_AMOUNT = sizeStr;
            p.GET_TICK = tick2;
            p.GET_AMOUNT = totalStr;
        }
        // Native lane (PC-16): the wire encodes a native-coin side as an
        // EMPTY tick (ORDER.md; the indexer treats a coin-named tick as an
        // unknown TOKEN and rejects the order). A market pair that includes
        // the chain's own coin composes with that side blanked.
        if (coinTicker && p.GIVE_TICK.toUpperCase() === coinTicker) p.GIVE_TICK = '';
        if (coinTicker && p.GET_TICK.toUpperCase() === coinTicker) p.GET_TICK = '';
        const submitExpiration = resolveExpirationUnix();
        if (typeof submitExpiration === 'number') p.EXPIRATION = String(submitExpiration);
        return p;
    }
    const actionParams = useMemo(
        () => buildParams(),
        [coinTicker, expirationUnix, side, sizeText, tick1, tick2, total],
    );

    const quoteActionData = useMemo(() => {
        if (!fromAddress || !total
            || String(tick1).trim().toUpperCase() === String(tick2).trim().toUpperCase()) return null;
        if ((price.trim().split('.')[1] || '').length > 18) return null;
        const sizeAsset = assetFor(tick1);
        if (tokenAmountPrecisionError(size, {
            divisibility: sizeAsset?.divisibility
                ?? (tick1.toUpperCase() === coinTicker ? 8 : tick1Info?.divisibility),
            tick: tick1,
            noun: 'Size',
        })) return null;
        const totalAsset = assetFor(tick2);
        if (tokenAmountPrecisionError(total, {
            divisibility: totalAsset?.divisibility
                ?? (tick2.toUpperCase() === coinTicker ? 8 : tick2Info?.divisibility),
            tick: tick2,
            noun: 'Price and size total',
        })) return null;
        const giveAmount = side === 'buy' ? total : size.trim();
        const giveAsset = side === 'buy' ? totalAsset : sizeAsset;
        if (giveAsset && compareAmounts(giveAmount, giveAsset.available) === 1) return null;
        if (expirationUnix === undefined
            || (typeof expirationUnix === 'number'
                && expirationUnix <= Math.floor(Date.now() / 1000))) return null;
        return { action: 'ORDER', params: actionParams };
    }, [actionParams, assetFor, coinTicker, expirationUnix, fromAddress, price, side,
        size, tick1, tick1Info?.divisibility, tick2, tick2Info?.divisibility, total]);
    const { quote: protocolFeeQuote, pending: protocolFeePending } = useProtocolFeeQuote({
        messaging,
        chainId,
        source: fromAddress?.address,
        actionData: quoteActionData,
    });
    const legacyDecoded = useMemo(() => {
        if (stage !== 'review' && stage !== 'submitting') return null;
        const decoded = decoderLib.decodeAction({ action: 'ORDER', params: actionParams, chainId, chainRegistry });
        if (!payFeeInNativeCoin) return decoded;
        return { ...decoded, warnings: [...(decoded.warnings || []), NATIVE_FEE_WARNING] };
    }, [actionParams, chainId, payFeeInNativeCoin, stage]);
    const quotedProtocolFee = normalizeProtocolFee(protocolFeeQuote);
    const legacyComposed = legacyDecoded ? {
        action: 'ORDER',
        chainId,
        decoded: legacyDecoded,
        quote: protocolFeeQuote,
        protocolFeeKnownFree: quotedProtocolFee.known && quotedProtocolFee.free,
    } : null;

    // §5.6 slice 3: software orders compose ONE PSBT host-side and
    // confirm it on the shared confirm page; hardware + watcher keep the
    // legacy review stage (they need their own signing gates).
    // (isWatcherMode is read above for the auto-pay eligibility gate.)
    const actionConfirm = useActionConfirmFlow({ messaging, walletId, slice: 'bespokeFlows' });
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
        software: 'orderAction',
        hardware: 'orderActionHw',
    });

    // Compose + tamper-check + pre-flight all run HOST-side; Approve signs the
    // byte-identical prebuilt PSBT. Reject is a calm no-op back to the form.
    async function openConfirmScreen() {
        const panelVersion = panelVersionRef.current;
        const from = {
            address: fromAddress.address,
            publicKey: fromAddress.publicKey,
            derivationPath: fromAddress.derivationPath,
            addressId: fromAddress.id,
            source: fromAddress.source,
            signerId: fromAddress.signerId,
        };
        const params = buildParams();
        setSubmitError(null);
        try {
            const res = await actionConfirm.run({
                chainId,
                from,
                actionData: { action: 'ORDER', params },
                encoderOpts: { payFeeInNativeCoin: payFeeInNativeCoin || undefined, ...feePerKbOpts },
                onApprove: (prebuiltPsbt) => submitConfirmed({
                    walletId,
                    chainId,
                    from,
                    params,
                    payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                    ...feePerKbOpts,
                    autopay: autopayArm ? { enabled: true } : undefined,
                    prebuiltPsbt,
                }),
            });
            if (panelVersion !== panelVersionRef.current) return;
            setResult(res);
            setPassword('');
            setStage('done');
            onOrderPlaced?.();
        } catch (err) {
            if (panelVersion !== panelVersionRef.current) return;
            if (isUserRejection(err)) return;
            // Same mapping the sign path already does: NativeFeeForfeitError's own message is
            // wire wording, and this confirm path is the one the flow actually takes.
            setFormError(submitFailureMessage(err, {
                chainId,
                coinTicker,
                mandatory: nativeFeeMandatory,
                fallback: "Couldn't place this order. Something went wrong. Try again.",
                verb: 'place this order',
            }));
        }
    }

    // Validate form fields and advance to the review stage. No signing
    // happens here; the user sees a summary and confirms before we touch
    // the key material.
    function handleReview(event) {
        // The Trade page's Buy and Sell buttons run it again once the pressed
        // side has rendered, with no event.
        event?.preventDefault?.();
        // A custom fee rate the selector refuses stops here, as on Swap; the
        // selector shows its own field error, so only an unpriced rate adds one.
        if (trade) {
            const feeStop = customFeeReviewStop({ feePick, tiers: feeTiers, estimate: feeCustomEstimate });
            if (feeStop) {
                setFormError(feeStop.formError);
                tradeSections.setOpen('fee', true);
                return;
            }
        }
        // An order is signed from an address on THIS chain; without one there is
        // nothing to spend from and nothing to receive into.
        if (!fromAddress) {
            setFormError('No address to sign from on this network. Use Receive first.');
            return;
        }
        // One token on both sides composes give X for get X, which consensus
        // accepts and whoever matches it profits from.
        if (String(tick1).trim().toUpperCase() === String(tick2).trim().toUpperCase()) {
            setFormError('This market has the same token on both sides, so it cannot take an order.');
            return;
        }
        // Both legs are required: an order with one side blank has no price.
        if (!price.trim() || !size.trim()) {
            setFormError('Price and size are required.');
            return;
        }
        // The exact decimal multiplication is also the wire representation.
        // Reject syntax such as scientific notation that Number accepts but
        // the protocol amount encoder cannot serialize.
        if (!total) {
            setFormError('Price and size must be positive numbers.');
            return;
        }
        const priceFraction = price.trim().split('.')[1] || '';
        if (priceFraction.length > 18) {
            setFormError('Price can have at most 18 decimal places.');
            return;
        }
        const sizeAsset = assetFor(tick1);
        const sizePrecisionError = tokenAmountPrecisionError(size, {
            divisibility: sizeAsset?.divisibility
                ?? (tick1.toUpperCase() === coinTicker ? 8 : tick1Info?.divisibility),
            tick: tick1,
            noun: 'Size',
        });
        if (sizePrecisionError) {
            setFormError(sizePrecisionError);
            return;
        }
        const totalAsset = assetFor(tick2);
        const totalPrecisionError = tokenAmountPrecisionError(total, {
            divisibility: totalAsset?.divisibility
                ?? (tick2.toUpperCase() === coinTicker ? 8 : tick2Info?.divisibility),
            tick: tick2,
            noun: 'Price and size total',
        });
        if (totalPrecisionError) {
            setFormError(totalPrecisionError);
            return;
        }
        const giveTick = side === 'buy' ? tick2 : tick1;
        const giveAmount = side === 'buy' ? total : size.trim();
        const giveAsset = side === 'buy' ? totalAsset : sizeAsset;
        if (giveAsset && compareAmounts(giveAmount, giveAsset.available) === 1) {
            setFormError(`Give amount exceeds your available ${giveTick} balance of ${giveAsset.balance}.`);
            return;
        }
        // undefined means the custom date box holds something unparseable;
        // null is the legitimate "never expires" preset and passes.
        const reviewExpiration = resolveExpirationUnix();
        if (reviewExpiration === undefined) {
            setFormError('Pick a valid expiration date and time.');
            return;
        }
        // An expiration already in the past is dead on arrival at the indexer.
        if (typeof reviewExpiration === 'number' && reviewExpiration <= Math.floor(Date.now() / 1000)) {
            setFormError('Expiration must be in the future.');
            return;
        }
        setFormError(null);
        setSubmitError(null);
        if (singleEncode) { openConfirmScreen(); return; }
        setStage('review');
        // Focus the password field on the review screen so the user
        // can immediately start typing without an extra click.
    }

    // Executes the ORDER sign and broadcast. Only reachable from the
    // review stage; returns to review (not form) on error so the user
    // can correct their credentials without losing the order summary.
    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        setStage('submitting');
        setSubmitError(null);
        const panelVersion = panelVersionRef.current;
        try {
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
                params: buildParams(),
                payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                ...feePerKbOpts,
                autopay: autopayArm ? { enabled: true } : undefined,
            };
            let res;
            if (isWatcherMode) {
                res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from: base.from,
                    actionData: { action: 'ORDER', params: base.params },
                    encoderOpts: { payFeeInNativeCoin: payFeeInNativeCoin || undefined, ...feePerKbOpts },
                });
            } else if (hw) {
                res = await messaging.orderActionHw({ ...base, signerId: fromAddress.signerId });
            } else {
                res = await messaging.orderAction({ ...base, password });
            }
            if (panelVersion !== panelVersionRef.current) return;
            setResult(res);
            setPassword('');
            setStage('done');
            if (!isWatcherMode) onOrderPlaced?.();
        } catch (err) {
            if (panelVersion !== panelVersionRef.current) return;
            let errorMessage;
            if (err?.name === 'InvalidPasswordError') {
                errorMessage = 'Incorrect password.';
            } else {
                errorMessage = submitFailureMessage(err, {
                    chainId,
                    coinTicker,
                    mandatory: nativeFeeMandatory,
                    fallback: "Couldn't place this order. Something went wrong. Try again.",
                    verb: 'place this order',
                });
            }
            setSubmitError(errorMessage);
            // Return to review (not form) so the user sees the error
            // alongside their credentials without having to re-enter
            // the order details.
            setStage('review');
            if (!hw) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        }
    }

    const fixedFeeEstimate = useMemo(
        () => estimateNativeSendFee({ chainId, chainRegistry }),
        [chainId],
    );
    // The fee the review and confirm screens show: the Trade page's pick, or
    // the panel's fixed normal estimate.
    const feeEstimate = trade ? pickedFeeEstimate : fixedFeeEstimate;

    // The size field's decimal places, as the guard reads them.
    const sizeDivisibility = assetFor(tick1)?.divisibility
        ?? (tick1.toUpperCase() === coinTicker ? 8 : tick1Info?.divisibility)
        ?? 8;
    // The total's decimal places, as the guard reads them.
    const totalDivisibility = assetFor(tick2)?.divisibility
        ?? (tick2.toUpperCase() === coinTicker ? 8 : tick2Info?.divisibility)
        ?? 8;
    // floor(a / b) at the size's places: a size worked out from an amount to
    // pay or get never spends more than that amount. The size is then snapped
    // down to a step at which price x size fits the total's places, so the
    // guard's precision check (handleReview) passes; with a long price that
    // step can be a whole number of tokens or more.
    const floorSize = useCallback((amount, per) => {
        if (!amount || !per || multiplyAmounts(amount, '1') === null || multiplyAmounts(per, '1') === null) return '';
        const scaled = multiplyDecimalStrings(amount, `1${'0'.repeat(sizeDivisibility)}`);
        const units = scaled === null ? null : decimalQuotientFloor(scaled, per);
        if (units === null || units === '0') return '';
        const step = sizeStepUnits(price, sizeDivisibility, totalDivisibility);
        const snapped = step > 1n ? (BigInt(units) / step) * step : BigInt(units);
        if (snapped === 0n) return '';
        return trimAmountTail(decimalFromBaseUnits(String(snapped), sizeDivisibility) ?? '');
    }, [sizeDivisibility, totalDivisibility, price]);

    // 25 / 50 / 75 / Max of what the order can spend: a sell spends the base
    // token, a buy the quote token at the entered price. A share too small
    // for one size step says so instead of leaving the field empty.
    const tooSmallForStep = () => {
        const step = sizeStepUnits(price, sizeDivisibility, totalDivisibility);
        const stepText = trimAmountTail(decimalFromBaseUnits(String(step), sizeDivisibility) ?? '');
        setFormError(`At this price an amount goes in steps of ${stepText} ${tick1}, more than this share covers.`);
    };
    const fillPercent = (pct) => {
        setFormError(null);
        if (side === 'sell') {
            const available = assetFor(tick1)?.available;
            if (!available || available === '0') return;
            const next = floorSize(pct === 100 ? available : multiplyDecimalStrings(available, String(pct / 100)), '1');
            setSize(next);
            if (!next) tooSmallForStep();
            return;
        }
        const available = assetFor(tick2)?.available;
        if (!available || available === '0') return;
        if (multiplyAmounts(price, '1') === null) {
            setFormError('Enter a price first.');
            return;
        }
        const next = floorSize(multiplyDecimalStrings(available, String(pct / 100)), price);
        setSize(next);
        if (!next) tooSmallForStep();
    };

    // The swap ticket's two amounts. The side's base-token amount is
    // the order size itself; the other amount is price x size, and typing it
    // works the size out from the price (rounded down to a size the guard
    // takes). While that amount is being typed it shows the typed text; on
    // leaving the field it shows price x size, which is what buildParams sends.
    const [ticketDraft, setTicketDraft] = useState(/** @type {{ field: 'pay' | 'get', text: string } | null} */ (null));
    const sizeField = side === 'buy' ? 'get' : 'pay';
    useEffect(() => {
        if (ticketDraft && ticketDraft.field !== sizeField) setSize(floorSize(ticketDraft.text, price));
    }, [price]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { setTicketDraft(null); }, [view, side]);

    if (stage === 'done') {
        const txid = result?.txid || result?.broadcast?.txid;
        if (result?.psbtHex && !txid) {
            return (
                <ResultScreen
                    state="unsigned"
                    result={result}
                    onBuildAnother={() => { setResult(null); setStage('form'); }}
                    onDone={() => { setResult(null); setStage('form'); }}
                />
            );
        }
        // A queued result is SIGNED and not broadcast. This panel is
        // inline rather than a screen, so it keeps its own frame and only
        // swaps the copy; "Place another" is deliberately not offered, since
        // a signed copy already exists (the §5.3.4 double-broadcast trap).
        if (result?.queued) {
            return (
                <EmptyState
                    title={SIGNED_NOT_BROADCAST_TITLE}
                    titleAs="h3"
                    body={t('components.placeOrderPanel.itWaitsInTheQueued')}
                />
            );
        }
        return (
            <>
                <EmptyState
                    title={t('components.placeOrderPanel.orderPlaced')}
                    titleAs="h3"
                    body={txid ? <code>{txid}</code> : null}
                    actionLabel={t('components.placeOrderPanel.placeAnother')}
                    actionIcon={<Icon.PlusIcon />}
                    onAction={() => {
                        setStage('form');
                        setPrice('');
                        setSize('');
                        setResult(null);
                    }}
                />
                {result?.autopayArmed === true ? (
                    <>
                        <StatusMessage variant="success">
                            {t('components.placeOrderPanel.coinpayAutoPayIsArmed')}
                        </StatusMessage>
                        <MobileAutopayNotice />
                    </>
                ) : result?.autopayArmed === false ? (
                    <StatusMessage variant="error">
                        {t('components.placeOrderPanel.theOrderWasPlacedBut')}
                        {t('components.placeOrderPanel.matchesWillNeedManualPayment')}
                    </StatusMessage>
                ) : null}
            </>
        );
    }

    // Watch-only review uses the same Confirm Standard body as signed orders.
    if (stage === 'review' || stage === 'submitting') {
        const expirationLabel = expirationId === 'default'
            ? 'Default window'
            : (typeof expirationUnix === 'number'
                ? new Date(expirationUnix * 1000).toLocaleString()
                : (EXPIRATION_PRESETS.find((e) => e.id === expirationId)?.label ?? expirationId));
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
                onReject={() => { setSubmitError(null); setStage('form'); }}
                decoded={legacyDecoded}
                chainLabel={descriptor?.displayName || chainId}
                screenVariant={variant}
                error={submitError}
                sourceAddress={fromAddress?.address}
                nativeTicker={coinTicker}
                credentials={<p>{t('common.watcherBuildsUnsigned')}</p>}
                credentialsReady
                summary={{
                    verb: t('components.confirmSummary.verbPlaceOrder'),
                    ...orderGiveParts(actionParams, coinTicker),
                    chainId,
                    address: fromAddress?.address,
                    facts: [
                        { label: t('components.placeOrderPanel.price'), value: `${priceText} ${tick2}/${tick1}` },
                        { label: t('components.placeOrderPanel.expiration'), value: expirationLabel },
                    ],
                    ...(confirmNotice ? { notice: confirmNotice } : {}),
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

    // confirm page, rendered in place of the panel (the same
    // substitution the review stage above already does); form state stays
    // intact behind it, so Reject returns the user to their filled-in order.
    if (actionConfirm.open) {
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                summary={{
                    verb: t('components.confirmSummary.verbPlaceOrder'),
                    ...orderGiveParts(actionParams, coinTicker),
                    chainId,
                    address: fromAddress?.address,
                    ...(confirmNotice ? { notice: confirmNotice } : {}),
                }}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId}
                feeEstimate={feeEstimate}
                feeText={feeEstimate?.coinAmount
                    ? t('send.networkFeeValue', { amount: feeEstimate.coinAmount, ticker: coinTicker }).trim()
                    : undefined}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                // Hardware swaps the password field for the device block
                // and gates Approve on the device being available (§5.1).
                hwSource={hw ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                chainId={chainId}
                getSignerStatus={messaging.getSignerStatus}
            />
        );
    }

    // The give token's gated-content warning.
    const gatedTicks = gatedGiveNotice.gated ? [side === 'sell' ? tick1 : tick2] : [];
    const gatedNotice = gatedTicks.length > 0 ? (
        <>
            {gatedTicks.map((tick) => (
                <FormNotice key={tick} variant="warning" role="alert">
                    {gatedTickWarningCopy(tick, 'the order counterparty')}
                </FormNotice>
            ))}
        </>
    ) : null;

    // The one Fees section, on the Trade page and the standalone panel alike:
    // closed it reads the speed and the fee total; open, the speed slider (the
    // panel's fixed fee has none), the network and protocol fee lines and the
    // pay-in-coin switch, wired as Swap and Create order wire it.
    const orderFees = {
        quote: protocolFeeQuote,
        pending: protocolFeePending,
        nativeFeeProps: {
            checked: payFeeInNativeCoin,
            onChange: setPayFeeInNativeCoin,
            coinTicker,
            mandatory: nativeFeeMandatory,
        },
    };
    // G120: the forfeit warning is a static note under the pay-in-coin switch,
    // worded to be true whether the switch is on or off, so flipping the
    // switch shows or hides no notice. The confirm screen a software signer
    // sees does not repeat it, so it stays on the form.
    const nativeFeeNote = coinTicker ? (
        <FieldNote variant="warning" role={null} testId="native-fee-note">
            {t('components.placeOrderPanel.nativeFeeForfeitNote', { coinTicker })}
        </FieldNote>
    ) : null;
    const tradeFeeSection = trade ? (
        <FeeSection
            {...tradeSections.bind('fee')}
            chainId={chainId}
            coinTicker={coinTicker}
            tiers={feeTiers}
            value={feePick}
            onChange={setFeePick}
            customEstimate={feeCustomEstimate}
            fees={orderFees}
        >
            {nativeFeeNote}
        </FeeSection>
    ) : null;

    // The standalone panel's Fees section and the gated-content notice.
    const feesBlock = (
        <>
            <FeeSection
                chainId={chainId}
                coinTicker={coinTicker}
                fixedFee={feeEstimate?.coinAmount ?? null}
                fees={orderFees}
            >
                {nativeFeeNote}
            </FeeSection>
            {gatedNotice}
        </>
    );

    // The CoinPay notice and auto-pay choices, shared by the panel and the
    // Trade page's form so both offer the same choices. A software signer
    // gets the Auto pay card (operator layout 3, 2026-11-13): the labelled
    // switch, on by default, whose ? tip carries the settlement rule, then
    // four short facts that stay visible whether it is on or off.
    const coinpaySettles = `${t('components.placeOrderPanel.thisOrderGives')} ${coinTicker}${t('components.placeOrderPanel.soEachMatchSettlesVia')} ${coinTicker} ${t('components.placeOrderPanel.paymentMustBeSentWithin')}`;
    // The GIVE side is the coin, so this order's own exposure is its GIVE
    // amount: price×size when buying (giving tick2), size when selling
    // tick1. A Market buy's price is already the best ask.
    const thisOrderGive = coinpaySide === 'buy'
        ? (total != null ? String(total) : '')
        : sizeText;
    const autopayFacts = [
        t('components.placeOrderPanel.autoPayBulletWindow', { coinTicker }),
        t('components.placeOrderPanel.autoPayBulletOpen'),
        thisOrderGive ? (
            <>
                {t('components.placeOrderPanel.autoPayBulletCapLead')}{' '}
                <strong>{thisOrderGive} {coinTicker}</strong>{' '}
                {t('components.placeOrderPanel.autoPayBulletCapTail')}
            </>
        ) : t('components.placeOrderPanel.autoPayBulletCapPending'),
        t('components.placeOrderPanel.autoPayBulletTurnOff'),
    ];
    const coinpayBlock = coinpaySide ? (
        <div data-autopay-card="" style={{
            // The Trade form's section body already stacks its fields on an 8px
            // gap, so the card takes no margin of its own there (the margin on
            // top of the gap made 16px under Expiration). The standalone
            // panel's form has no such gap and keeps the 0.5rem.
            margin: trade ? 0 : '0.5rem 0 0',
            padding: 'var(--xc-card-pad)',
            background: 'var(--xc-card-bg)',
            border: 'var(--xc-card-border)',
            borderRadius: 'var(--xc-card-radius)',
            fontSize: '0.75rem',
        }}>
            <Switch
                label={t('components.placeOrderPanel.enableCoinpayAutoPay')}
                help={`${coinpaySettles} ${t('components.placeOrderPanel.helpAutopay')}`}
                checked={autopayArm}
                disabled={!signsUnattended}
                onChange={(e) => setAutopayEnabled(e.target.checked)}
            />
            {!signsUnattended ? (
                <StatusMessage variant="info" role="note">
                    {isWatcherMode
                        ? t('components.placeOrderPanel.autoPayIsUnavailableIn')
                        : t('components.placeOrderPanel.autoPayIsUnavailableFor')}
                </StatusMessage>
            ) : (
                <>
                    {autopayEnabled ? null : (
                        <p style={{ margin: '0 0 var(--xc-space-1)', color: 'var(--xc-text-muted)' }}>
                            {t('components.placeOrderPanel.autoPayOffLine')}
                        </p>
                    )}
                    <ul style={{
                        listStyle: 'none',
                        margin: 0,
                        padding: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 'var(--xc-space-1)',
                        color: autopayEnabled ? 'var(--xc-text)' : 'var(--xc-text-muted)',
                    }}>
                        {autopayFacts.map((fact, i) => (
                            <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--xc-space-2)' }}>
                                <span aria-hidden="true" style={{ flex: 'none', display: 'inline-flex', color: 'var(--xc-accent-primary)' }}>
                                    <Icon.CheckIcon />
                                </span>
                                <span>{fact}</span>
                            </li>
                        ))}
                    </ul>
                    <MobileAutopayNotice />
                    {coinpayArmShown && exposure && exposure[chainId] ? (
                        <p style={{ margin: 'var(--xc-space-2) 0 0', color: 'var(--xc-text-muted)' }}>
                            {t('components.placeOrderPanel.outstandingAutoPayExposureOn')}{' '}
                            {baseUnitsToCoinText(exposure[chainId]) ?? exposure[chainId]} {coinTicker}
                            {thisOrderGive ? t('components.placeOrderPanel.fromThisOrder', { thisOrderGive, coinTicker }) : ''}
                            {t('components.placeOrderPanel.evenIfTheServiceThat')}
                        </p>
                    ) : null}
                </>
            )}
        </div>
    ) : null;

    // The Trade page's form. Same state, guard (handleReview) and confirm and
    // submit path as the panel below; only the fields' arrangement differs.
    if (trade) {
        const busy = accountLoading || actionConfirm.composing;
        const swap = view === 'swap';
        const payTick = side === 'buy' ? tick2 : tick1;
        const getTick = side === 'buy' ? tick1 : tick2;
        const ticketValue = (field) => {
            if (ticketDraft?.field === field) return ticketDraft.text;
            if (field === sizeField) return size;
            return total ? trimAmountTail(total) : '';
        };
        const editTicket = (field, raw) => {
            const text = normalizeDecimalEntry(raw, ticketValue(field));
            setFormError(null);
            if (field === sizeField) {
                setTicketDraft(null);
                setSize(text);
            } else {
                setTicketDraft({ field, text });
                setSize(floorSize(text, price));
            }
        };
        const limitShown = orderType === 'limit' ? price : (limitPriceRef.current || lastPrice || '');
        const fillsNow = bestQuote && multiplyAmounts(price, '1') !== null
            && (side === 'buy' ? compareAmounts(price, bestQuote) >= 0 : compareAmounts(price, bestQuote) <= 0);
        const fillsText = fillsNow
            ? (side === 'buy' ? 'Fills now at the best ask' : 'Fills now at the best bid')
            : (side === 'buy' ? 'Waits on the book as a bid' : 'Waits on the book as an ask');
        const atMarket = !swap && orderType === 'market';
        // One Swap | Limit | Market toggle (the shared segmented toggle). Swap
        // is the You pay / You get ticket; Limit and Market are the order form.
        // The ticket's Limit and Fill now chips and this toggle's Limit and
        // Market are one setting.
        const modeValue = swap ? 'swap' : orderType;
        const chooseMode = (next) => {
            setFormError(null);
            if (next === 'swap') {
                setView('swap');
                return;
            }
            setView('market');
            chooseOrderType(next);
        };
        const modeControl = (
            <SegmentedControl
                className={styles.tradeType}
                aria-label={t('components.placeOrderPanel.orderType')}
                value={modeValue}
                onChange={chooseMode}
                items={[
                    { id: 'swap', label: <span className={styles.segLabel}><Icon.SwapIcon />{t('components.placeOrderPanel.swap')}</span> },
                    { id: 'limit', label: <span className={styles.segLabel}><Icon.ClockIcon />{t('components.placeOrderPanel.limit')}</span> },
                    { id: 'market', label: <span className={styles.segLabel}><Icon.ZapIcon />{t('components.placeOrderPanel.market')}</span> },
                ]}
            />
        );
        // The Buy | Sell toggle, first in Trade Details and in every mode: the
        // active side fills green or red. In Swap it and the flip arrow are
        // one setting; in Limit and Market it is the order's side.
        const sideControl = (
            <SegmentedControl
                className={styles.tradeType}
                aria-label={t('components.placeOrderPanel.orderSide')}
                value={side}
                onChange={(next) => {
                    setFormError(null);
                    setSide(next);
                }}
                items={[
                    { id: 'buy', label: <span className={styles.segLabel}><BuyGlyph />{t('components.placeOrderPanel.buy')}</span>, tone: 'success' },
                    { id: 'sell', label: <span className={styles.segLabel}><SellGlyph />{t('components.placeOrderPanel.sell')}</span>, tone: 'danger' },
                ]}
            />
        );
        // What the order comes to. Swap says how it fills; Limit shows the
        // total; Market shows the side's amount at the book's best quote.
        const tradeRows = swap
            ? [[t('components.placeOrderPanel.fills'), fillsText]]
            : (atMarket
                ? [[
                    side === 'buy' ? t('components.placeOrderPanel.buyingCostsAbout') : t('components.placeOrderPanel.sellingGetsAbout'),
                    total && bestQuote ? `${trimAmountTail(total)} ${tick2}` : '-',
                ]]
                : [[t('flows.feesCard.total'), total ? `${trimAmountTail(total)} ${tick2}` : '-']]);
        const notices = (
            <>
                {tradeRows.map(([label, value]) => (
                    <div key={label} className={styles.tradeRows}>
                        <span className={styles.tradeRowLabel}>{label}</span>
                        <span className={styles.tradeRowValue}>{value}</span>
                    </div>
                ))}
                {/* The wallet's own dropdown (G44), an icon per choice. */}
                <IconSelect
                    label={t('components.placeOrderPanel.expiration')}
                    help={t('components.placeOrderPanel.helpExpiration')}
                    value={expirationId}
                    onChange={setExpirationId}
                    options={[
                        ...EXPIRATION_PRESETS.map((p) => ({
                            value: p.id,
                            label: p.label,
                            icon: p.days == null ? <Icon.HistoryIcon /> : <Icon.ClockIcon />,
                        })),
                        { value: 'custom', label: t('components.placeOrderPanel.custom'), icon: <Icon.PencilIcon /> },
                    ]}
                />
                {expirationId === 'custom' ? (
                    <Input
                        label={t('components.placeOrderPanel.customExpiration')}
                        help={t('components.placeOrderPanel.helpCustomExpiration')}
                        type="datetime-local"
                        value={customExpiration}
                        onChange={(e) => setCustomExpiration(e.target.value)}
                        autoComplete="off"
                    />
                ) : null}
                {/* CoinPay and the gated-content notice close Trade Details;
                    the Fees section follows it, as the Form Standard orders it. */}
                {coinpayBlock}
                {gatedNotice}
            </>
        );
        // A demo wallet never composes. No notice says so in advance (G92):
        // pressing Place Order is refused, and the refusal (with its Create a
        // real wallet exit) joins the status slot above the action. The guard
        // is not handed to FormPage, so the button is never disabled for it.
        const tradeStatus = [
            demoGuard.blocked && demoRefused ? demoGuard.note : null,
            formError ? <StatusMessage variant="error">{formError}</StatusMessage> : null,
        ];
        function handleTradeSubmit(event) {
            event?.preventDefault?.();
            if (busy) return;
            if (demoGuard.blocked) {
                setDemoRefused(true);
                demoGuard.refuse?.();
                return;
            }
            handleReview(event);
        }
        // One line above the action, in every mode, once an amount is in:
        // the side as a BUY or SELL pill, then what the order does.
        const sizeShown = multiplyAmounts(size, '1');
        // Literal keys, so the i18n key scanner sees every summary line in use.
        const summaryKeys = swap
            ? { buy: 'market.trade.summarySwapBuy', sell: 'market.trade.summarySwapSell' }
            : (atMarket
                ? { buy: 'market.trade.summaryMarketBuy', sell: 'market.trade.summaryMarketSell' }
                : { buy: 'market.trade.summaryLimitBuy', sell: 'market.trade.summaryLimitSell' });
        const summaryText = sizeShown && total && (!atMarket || bestQuote)
            ? t(side === 'buy' ? summaryKeys.buy : summaryKeys.sell, {
                amount: `${groupedAmount(sizeShown)} ${tick1}`,
                price: groupedAmount(price),
                value: `${groupedAmount(total)} ${tick2}`,
            })
            : null;
        const orderSummary = summaryText ? (
            <p className={ownStyles.summary} data-side={side} data-trade-summary="">
                <span className={ownStyles.sidePill}>
                    {side === 'buy' ? t('market.trade.pillBuy') : t('market.trade.pillSell')}
                </span>
                <span className={ownStyles.summaryText}>{summaryText}</span>
            </p>
        ) : null;
        // One Place Order in every mode: the standard green main action with
        // its one icon, whatever the side or mode (the toggle and the pill
        // show the side). It runs the same guard (handleReview), review or
        // confirm step and sign path the Review, Buy and Sell buttons did. A
        // Market side with no quote on the book has nothing to fill at.
        const tradeAction = (
            <>
                {orderSummary}
                <FormAction
                    icon={<Icon.MarketIcon />}
                    loading={busy}
                    disabled={busy || (atMarket && !bestQuote)}
                >
                    {t('market.trade.placeOrder')}
                </FormAction>
            </>
        );
        const tradeSummary = joinSummary(
            swap ? t('components.placeOrderPanel.swap') : (atMarket ? t('components.placeOrderPanel.market') : t('components.placeOrderPanel.limit')),
            sizeShown ? `${trimAmountTail(sizeShown)} ${tick1}` : null,
            !atMarket && multiplyAmounts(price, '1') ? `at ${trimAmountTail(price)} ${tick2}` : null,
        );
        // The chips drop the unit first, then shorten "Fill now at"
        // as the row narrows (MarketTrading.module.css); the name stays whole.
        const limitText = trimAmountTail(limitShown) || '-';
        const fillText = bestQuote ? trimAmountTail(bestQuote) : '';
        // The Form Standard order: From (closed), Trade Details (open, from
        // the Buy | Sell and Swap | Limit | Market toggles down to Expiration
        // and the CoinPay notice), Fees (closed), the status slot, then the
        // summary line and the action.
        return (
            <FormFrame
                lead={demoGuard.dialog}
                // The wallet, for the Advanced section's change address picker.
                walletId={walletId}
                label={swap ? t('components.placeOrderPanel.swapTicket') : t('components.placeOrderPanel.placeOrder2')}
                onSubmit={handleTradeSubmit}
                noValidate
                aria-busy={busy || undefined}
                status={tradeStatus}
                action={tradeAction}
                from={(
                    <FromSection
                        {...tradeSections.bind('from')}
                        chainId={chainId}
                        chainRegistry={chainRegistry}
                        lockNetwork
                        networkHelp={t('components.placeOrderPanel.helpNetwork')}
                        disabled={busy}
                        address={fromAddress?.address || null}
                        addressHelp={t('components.placeOrderPanel.helpFromAddress')}
                        pickerLockedReason={t('components.placeOrderPanel.fromLockedReason')}
                        missing={addressesByChain ? (
                            <FieldNote variant="error">{t('components.placeOrderPanel.noFromAddress')}</FieldNote>
                        ) : null}
                    />
                )}
                fee={tradeFeeSection}
            >
                <FormSection
                    id="trade"
                    title={t('components.placeOrderPanel.tradeDetails')}
                    icon={Icon.MarketIcon}
                    {...tradeSections.bind('trade')}
                    summary={tradeSummary}
                    // A guard error (a bad amount or price) reopens it.
                    revealKey={formError ? `error:${formError}` : 0}
                >
                    {sideControl}
                    {modeControl}
                    {accountLoading ? (
                        <FormNotice variant="status">{t('components.placeOrderPanel.loadingWalletBalances')}</FormNotice>
                    ) : null}
                    {swap ? (
                        /* The shared Give/Get Quick cards (SwapTicket). */
                        <SwapTicket
                            side={side}
                            chainId={chainId}
                            payTick={payTick}
                            getTick={getTick}
                            payValue={ticketValue('pay')}
                            getValue={ticketValue('get')}
                            onPayChange={(raw) => editTicket('pay', raw)}
                            onGetChange={(raw) => editTicket('get', raw)}
                            onSettle={() => setTicketDraft(null)}
                            payBalance={t('market.trade.balance', { amount: balanceFor(payTick) ?? '-' })}
                            getNote={price ? t('market.trade.priceEach', { price: trimAmountTail(price) }) : ''}
                            onFlip={() => setSide(side === 'buy' ? 'sell' : 'buy')}
                        />
                    ) : (
                        <>
                            {/* Limit: the price is typed, starting at the last
                                trade. Market: the book sets it, the best ask for
                                a buy and the best bid for a sell. */}
                            {atMarket ? (
                                <Input
                                    label={t('components.placeOrderPanel.price')}
                                    help={t('components.placeOrderPanel.helpPriceMarket')}
                                    hint={side === 'buy' ? t('market.trade.bestAskFillsNow') : t('market.trade.bestBidFillsNow')}
                                    value={bestQuote ? trimAmountTail(bestQuote) : '-'}
                                    onChange={() => {}}
                                    readOnly
                                    autoComplete="off"
                                    fieldAction={<span className={styles.fieldUnit}>{tick2}</span>}
                                    style={{ fontVariantNumeric: 'tabular-nums' }}
                                />
                            ) : (
                                <Input
                                    label={t('components.placeOrderPanel.price')}
                                    help={t('components.placeOrderPanel.helpPrice', { tick1, tick2 })}
                                    hint={lastPrice ?t('components.placeOrderPanel.lastPrice', { price: trimAmountTail(lastPrice) }) : undefined}
                                    value={price}
                                    onChange={(e) => setPrice(normalizeDecimalEntry(e.target.value, price))}
                                    inputMode="decimal"
                                    autoComplete="off"
                                    fieldAction={<span className={styles.fieldUnit}>{tick2}</span>}
                                    style={{ fontVariantNumeric: 'tabular-nums' }}
                                />
                            )}
                            {/* Both balances, since either may be spent; the chips
                                and the in-field Max spend the current side's. */}
                            <Input
                                label={t('components.placeOrderPanel.amountIn', { tick: tick1 })}
                                help={t('components.placeOrderPanel.helpAmount', { tick1 })}
                                hint={t('components.placeOrderPanel.bothBalances', {
                                    quote: balanceFor(tick2) ?? '-', tick2, base: balanceFor(tick1) ?? '-', tick1,
                                })}
                                value={size}
                                onChange={(e) => setSize(normalizeDecimalEntry(e.target.value, size))}
                                inputMode="decimal"
                                autoComplete="off"
                                fieldAction={(
                                    <FieldIconButton
                                        icon={<Icon.MaxIcon />}
                                        label={t('components.placeOrderPanel.useMax')}
                                        onClick={() => fillPercent(100)}
                                        disabled={busy}
                                    />
                                )}
                                style={{ fontVariantNumeric: 'tabular-nums' }}
                            />
                            <div className={styles.pctRow} role="group" aria-label={t('components.placeOrderPanel.amountPresets')}>
                                {[25, 50, 75, 100].map((pct) => (
                                    <Button
                                        key={pct}
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        icon={null}
                                        className={styles.pctChip}
                                        onClick={() => fillPercent(pct)}
                                        aria-label={t('components.placeOrderPanel.usePercent', { pct })}
                                    >
                                        {`${pct}%`}
                                    </Button>
                                ))}
                            </div>
                        </>
                    )}
                    {swap ? (
                        <div className={styles.chipRow} role="group" aria-label={t('components.placeOrderPanel.price')}>
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                aria-pressed={orderType === 'limit' ? 'true' : 'false'}
                                className={styles.priceChip}
                                onClick={() => chooseOrderType('limit')}
                                title={t('components.placeOrderPanel.limitValue', { value: `${limitText}${limitText === '-' ? '' : ` ${tick2}`}` })}
                                aria-label={t('components.placeOrderPanel.limitValue', { value: `${limitText}${limitText === '-' ? '' : ` ${tick2}`}` })}
                                icon={<Icon.ClockIcon />}
                            >
                                <span className={styles.priceChipText}>
                                    {t('components.placeOrderPanel.limit')} {limitText}
                                    {limitText === '-' ? null : <span className={styles.chipUnit}> {tick2}</span>}
                                </span>
                            </Button>
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                aria-pressed={orderType === 'market' ? 'true' : 'false'}
                                className={styles.priceChip}
                                onClick={() => chooseOrderType('market')}
                                disabled={!bestQuote}
                                /* A narrow chip shortens its words; the tip and name carry it whole. */
                                title={fillText ? t('components.placeOrderPanel.fillNowAt', { price: fillText, tick: tick2 }) : t('components.placeOrderPanel.fillNow')}
                                aria-label={fillText ? t('components.placeOrderPanel.fillNowAt', { price: fillText, tick: tick2 }) : t('components.placeOrderPanel.fillNow')}
                                icon={<Icon.ZapIcon />}
                            >
                                <span className={styles.priceChipText}>
                                    {t('components.placeOrderPanel.chipFill')}
                                    <span className={styles.chipNow}> {t('components.placeOrderPanel.chipNow')}</span>
                                    {fillText ? (
                                        <>
                                            <span className={styles.chipAt}> {t('components.placeOrderPanel.chipAt')}</span>
                                            {' '}{fillText}
                                            <span className={styles.chipUnit}> {tick2}</span>
                                        </>
                                    ) : null}
                                </span>
                            </Button>
                        </div>
                    ) : null}
                    {notices}
                </FormSection>
            </FormFrame>
        );
    }

    return (
        <FormPage
            demoGuard={demoGuard}
            label={t('components.placeOrderPanel.placeOrder2')}
            onSubmit={handleReview}
            noValidate
            aria-busy={accountLoading || actionConfirm.composing || undefined}
            status={formError ? <StatusMessage variant="error">{formError}</StatusMessage> : null}
            actions={(
                <Button
                    type="submit"
                    variant="primary"
                    block
                    icon={side === 'buy' ? <BuyGlyph /> : <SellGlyph />}
                    loading={accountLoading || actionConfirm.composing}
                    disabled={accountLoading || actionConfirm.composing}
                >
                    {t('components.placeOrderPanel.placeOrder', { side })}
                </Button>
            )}
        >
            {accountLoading ? (
                <FormNotice variant="status">{t('components.placeOrderPanel.loadingWalletBalances')}</FormNotice>
            ) : null}
            <dl style={{
                margin: '0 0 var(--xc-space-2)',
                padding: 'var(--xc-card-pad)',
                background: 'var(--xc-card-bg)',
                border: 'var(--xc-card-border)',
                borderRadius: 'var(--xc-card-radius)',
                display: 'grid',
                gridTemplateColumns: 'minmax(0, auto) minmax(0, 1fr)',
                columnGap: 'var(--xc-space-3)',
                rowGap: 2,
                fontSize: 'var(--xc-text-xs)',
            }}>
                <dt style={{ color: 'var(--xc-text-muted)' }}>{t('routes.manageToken.balance')} {tick1}</dt>
                <dd style={{ margin: 0, color: 'var(--xc-text)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {balanceFor(tick1) ?? '-'}
                </dd>
                <dt style={{ color: 'var(--xc-text-muted)' }}>{t('routes.manageToken.balance')} {tick2}</dt>
                <dd style={{ margin: 0, color: 'var(--xc-text)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {balanceFor(tick2) ?? '-'}
                </dd>
            </dl>
            <SegmentedControl
                className={styles.sideToggle}
                aria-label={t('components.placeOrderPanel.orderSide')}
                value={side}
                onChange={setSide}
                items={[
                    { id: 'buy', label: <span className={styles.segLabel}><BuyGlyph />{t('components.placeOrderPanel.buy')} {tick1}</span>, tone: 'success' },
                    { id: 'sell', label: <span className={styles.segLabel}><SellGlyph />{t('components.placeOrderPanel.sell')} {tick1}</span>, tone: 'danger' },
                ]}
            />
            <div className={styles.priceAmountFields} role="group" aria-label={t('components.placeOrderPanel.priceAndAmount')}>
                <Input
                    label={t('components.placeOrderPanel.price2', { tick2 })}
                    help={t('components.placeOrderPanel.helpPrice', { tick1, tick2 })}
                    value={price}
                    onChange={(e) => setPrice(normalizeDecimalEntry(e.target.value, price))}
                    inputMode="decimal"
                    autoComplete="off"
                    style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                />
                <Input
                    label={t('components.placeOrderPanel.size', { tick1 })}
                    help={t('components.placeOrderPanel.helpSize', { tick1 })}
                    value={size}
                    onChange={(e) => setSize(normalizeDecimalEntry(e.target.value, size))}
                    inputMode="decimal"
                    autoComplete="off"
                    style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                />
            </div>
            <Select
                id="place-order-expiration"
                label={t('components.placeOrderPanel.expiration')}
                help={t('components.placeOrderPanel.helpExpiration')}
                value={expirationId}
                onChange={(e) => setExpirationId(e.target.value)}
            >
                {EXPIRATION_PRESETS.map((p) => (
                    <Select.Option key={p.id} value={p.id} icon={p.days == null ? <Icon.HistoryIcon /> : <Icon.ClockIcon />}>{p.label}</Select.Option>
                ))}
                <Select.Option value="custom" icon={<Icon.PencilIcon />}>{t('components.placeOrderPanel.custom')}</Select.Option>
            </Select>
            {expirationId === 'custom' ? (
                <Input
                    label={t('components.placeOrderPanel.customExpiration')}
                    help={t('components.placeOrderPanel.helpCustomExpiration')}
                    type="datetime-local"
                    value={customExpiration}
                    onChange={(e) => setCustomExpiration(e.target.value)}
                    autoComplete="off"
                />
            ) : null}
            {summary ? (
                <p style={{
                    margin: '0.5rem 0 0',
                    fontSize: '0.85rem',
                    overflowWrap: 'anywhere',
                    fontVariantNumeric: 'tabular-nums',
                }}>
                    {summary}
                </p>
            ) : null}
            {/* The fees and CoinPay blocks, shared with the Trade form above. */}
            {feesBlock}
            {coinpayBlock}
        </FormPage>
    );
}

/**
 * The smallest size step, in the size's base units, at which
 * price x size has no more than `totalPlaces` decimal places. A price with
 * p units at scale ps and a size of n units at scale sd give a total of
 * n * p at scale ps + sd; it fits when n * p is a multiple of 10^e, with
 * e = ps + sd - totalPlaces, so n steps by 10^e / gcd(p, 10^e).
 *
 * @returns {bigint} 1n when any size fits or the price is not a plain decimal
 */
function sizeStepUnits(price, sizePlaces, totalPlaces) {
    const m = /^(\d*)(?:\.(\d*))?$/.exec(String(price ?? '').trim());
    if (!m) return 1n;
    const frac = (m[2] || '').replace(/0+$/, '');
    const digits = `${m[1] || '0'}${frac}`.replace(/^0+(?=\d)/, '');
    const p = BigInt(digits || '0');
    if (p === 0n) return 1n;
    const e = frac.length + sizePlaces - totalPlaces;
    if (e <= 0) return 1n;
    const pow = 10n ** BigInt(e);
    let a = p;
    let b = pow;
    while (b) [a, b] = [b, a % b];
    return pow / a;
}

// A plain decimal as the order summary reads it: zero tail trimmed and the
// whole part grouped ("1,000"), never through a float.
function groupedAmount(value) {
    return formatWithThousands(trimAmountTail(value)) || String(value ?? '');
}

// The shared locale reader, so "0,5" is 0.5 here as in every amount field.
// Deleting the comma would make it 05.
function normalizeDecimalEntry(value, previous) {
    const normalized = normalizeAmountFieldInput(value);
    return normalized === null ? previous : normalized;
}

// Render a balance value with thousand separators. `quantity` comes from
// buildBalanceRows, so it is raw atomic units at `divisibility` scale
// (issue #4: treating it as already-human overstated native balances 1e8x).
// formatAmount does the exact string division; trailing zeros after the
// decimal point are trimmed here so "1.00000000" reads as "1".
function formatQuantity(quantity, divisibility) {
    if (quantity == null || quantity === '') return '-';
    const raw = String(quantity).trim();
    if (!raw) return '-';
    if (!/^-?\d+$/.test(raw)) return raw;
    const div = Number.isFinite(divisibility) && divisibility >= 0
        ? Math.min(20, Math.floor(divisibility))
        : 8;
    let str = formatAmount(raw, div);
    if (str.includes('.')) {
        str = str.replace(/0+$/, '').replace(/\.$/, '');
    }
    return str;
}

// The exact balance as a plain decimal string, for comparisons.
function plainQuantity(quantity, divisibility) {
    const raw = String(quantity ?? '').trim();
    if (!/^\d+$/.test(raw)) return null;
    const div = Number.isFinite(divisibility) && divisibility >= 0
        ? Math.min(20, Math.floor(divisibility))
        : 8;
    const str = formatAmount(raw, div, 'plain');
    return str.includes('.') ? str.replace(/0+$/, '').replace(/\.$/, '') : str;
}
