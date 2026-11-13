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
    Checkbox,
    EmptyState,
    FieldNote,
    FormNotice,
    FormPage,
    Icon,
    Input,
    SegmentedControl,
    Select,
    StatusMessage,
} from '@xchain-wallet/core/ui';
// The Trade page's form (layout="trade") reads exact decimals for the percent
// chips and the swap ticket, and draws the pair's coin icons.
import {
    decimalFromBaseUnits,
    decimalQuotientFloor,
    multiplyDecimalStrings,
    trimAmountTail,
} from '../utils/amountFormat.js';
import { BuyGlyph, SellGlyph, SwapTicket } from './marketTradeParts.jsx';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useDemoGuard, useWalletSource } from '../hooks/useDemoGuard.jsx';
import { useGatedTickNotice, gatedTickWarningCopy } from '../hooks/useGatedTickNotice.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from './ActionConfirmScreen.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { isHwSource, SignCredentials } from './SignCredentials.jsx';
import { buildBalanceRows, formatAmount } from './BalanceList.jsx';
import { NativeFeeToggle } from './NativeFeeToggle.jsx';
import { FeesCard } from './FeesCard.jsx';
import { ResultScreen } from './ResultScreen.jsx';
import { NATIVE_FEE_WARNING } from '../../sdk/nativeFeePreflight.js';
import { submitFailureMessage, SIGNED_NOT_BROADCAST_TITLE } from '../utils/submitFailureMessage.js';
import { preferredSourceId } from '../addressSelection.js';
import { estimateNativeSendFee } from '../../flows/feeEstimate.js';
import { compareAmounts, multiplyAmounts } from '../../market/orderMath.js';
import { normalizeAmountFieldInput, tokenAmountPrecisionError } from '../utils/amountFormat.js';
import { orderGiveParts } from '../utils/confirmSummaryParts.js';
import { baseUnitsToCoinText } from '../../market/obligationStatus.js';
import { useNativeFee } from '../hooks/useNativeFee.js';
import { useProtocolFeeQuote } from '../hooks/useProtocolFeeQuote.js';
import { useTokenInfo } from '../hooks/useTokenInfo.js';
import styles from './MarketTrading.module.css';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/flows.js';
import '../../i18n/locales/en/routes.js';
import '../../i18n/locales/en/send.js';

const chainRegistry = registryLib.defaultRegistry();

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
 * @param {'buy' | 'sell'} [props.side]               controlled side (the page owns it); omit to keep it inside
 * @param {(side: 'buy' | 'sell') => void} [props.onSideChange]
 * @param {string | null} [props.bestBid]             best bid and ask, for Market orders and Fill now
 * @param {string | null} [props.bestAsk]
 * @param {string | null} [props.lastPrice]           the starting limit price when nothing was prefilled
 * @param {'limit' | 'market'} [props.initialOrderType]
 */
export function PlaceOrderPanel({
    walletId, chainId, tick1, tick2, prefillPrice, prefillPick, onOrderPlaced,
    layout = 'panel', view = 'market', side: controlledSide, onSideChange,
    bestBid = null, bestAsk = null, lastPrice = null, initialOrderType = 'limit',
}) {
    const { shell } = useMessaging();
    const { messaging } = useWalletSource(walletId);
    const demoGuard = useDemoGuard(walletId);
    const variant = screenVariantFor(shell);
    const signerReady = useSignerReady(walletId);
    // The Trade page owns the side (its Buy and Sell buttons open it on one),
    // so a controlled side wins; without one the panel keeps its own.
    const [ownSide, setOwnSide] = useState(/** @type {'buy' | 'sell'} */ (controlledSide || 'buy'));
    const side = controlledSide || ownSide;
    const setSide = useCallback((next) => {
        setOwnSide(next);
        onSideChange?.(next);
    }, [onSideChange]);
    const trade = layout === 'trade';
    // PC-26: order settlement carries no gated-key handoff; warn when the
    // give-side token (sell → tick1, buy → tick2) has gated content.
    const gatedGiveNotice = useGatedTickNotice({
        messaging, chainId, tick: side === 'sell' ? tick1 : tick2,
    });
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

    // PC-16: the GIVE side is the chain's native coin - the (only) shape
    // that settles via CoinPay and can arm auto-pay. Buy gives tick2,
    // sell gives tick1.
    const giveIsNative = Boolean(coinTicker) &&
        (side === 'buy' ? tick2 : tick1).toUpperCase() === coinTicker;
    // Software signers only: HW and watch-only can never sign unattended,
    // so they stay notify-only (checkbox hidden, copy explains).
    const { isWatcherMode } = useWalletMode();
    const autopayEligible = giveIsNative && !isWatcherMode && !isHwSource(fromAddress);
    const autopayArm = autopayEligible && autopayEnabled;
    // The web wallet has no background watcher, so an armed order pays only
    // while the wallet is open; the confirm screen says so on every order.
    const confirmNotice = shell === 'web' && autopayArm
        ? t('components.placeOrderPanel.autoPayConfirmNotice')
        : undefined;

    // Aggregate outstanding auto-pay exposure (the bound the user accepts).
    useEffect(() => {
        setExposure(null);
        if (!autopayArm || typeof messaging.getAutopayExposure !== 'function') return undefined;
        let cancelled = false;
        messaging.getAutopayExposure({ walletId })
            .then((e) => { if (!cancelled) setExposure(e || {}); })
            .catch(() => { if (!cancelled) setExposure(null); });
        return () => { cancelled = true; };
    }, [messaging, walletId, autopayArm]);

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
                encoderOpts: { payFeeInNativeCoin: payFeeInNativeCoin || undefined },
                onApprove: (prebuiltPsbt) => submitConfirmed({
                    walletId,
                    chainId,
                    from,
                    params,
                    payFeeInNativeCoin: payFeeInNativeCoin || undefined,
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
        event.preventDefault();
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
                autopay: autopayArm ? { enabled: true } : undefined,
            };
            let res;
            if (isWatcherMode) {
                res = await messaging.buildActionPsbtRequest({
                    chainId,
                    from: base.from,
                    actionData: { action: 'ORDER', params: base.params },
                    encoderOpts: { payFeeInNativeCoin: payFeeInNativeCoin || undefined },
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

    const feeEstimate = useMemo(
        () => estimateNativeSendFee({ chainId, chainRegistry }),
        [chainId],
    );

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
                    <StatusMessage variant="success">
                        {t('components.placeOrderPanel.coinpayAutoPayIsArmed')}
                    </StatusMessage>
                ) : result?.autopayArmed === false ? (
                    <StatusMessage variant="error">
                        {t('components.placeOrderPanel.theOrderWasPlacedBut')}
                        {result?.autopayConsentError ? ` (${result.autopayConsentError})` : ''}
                        {t('components.placeOrderPanel.matchesWillNeedManualPayment')}
                    </StatusMessage>
                ) : null}
            </>
        );
    }

    // Review stage: show order summary, collect credentials, then sign.
    // The user returns to the form (with inputs intact) via "Edit order".
    if (stage === 'review' || stage === 'submitting') {
        const expirationLabel = expirationId === 'default'
            ? 'Default window'
            : (typeof expirationUnix === 'number'
                ? new Date(expirationUnix * 1000).toLocaleString()
                : (EXPIRATION_PRESETS.find((e) => e.id === expirationId)?.label ?? expirationId));

        const giveTick = side === 'buy' ? tick2 : tick1;
        const giveAmt = side === 'buy' ? (total != null ? String(total) : '') : sizeText;
        const getTick = side === 'buy' ? tick1 : tick2;
        const getAmt = side === 'buy' ? sizeText : (total != null ? String(total) : '');

        let feeDisplay = 'Estimate unavailable';
        if (feeEstimate) {
            feeDisplay = `${feeEstimate.coinAmount} ${coinTicker}`;
            if (feeEstimate.rate) feeDisplay += ` (${feeEstimate.rate})`;
        }

        const dlStyle = {
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
        };
        const dtStyle = { color: 'var(--xc-text-muted)' };
        const ddStyle = {
            margin: 0,
            minWidth: 0,
            color: 'var(--xc-text)',
            textAlign: 'right',
            fontVariantNumeric: 'tabular-nums',
            overflowWrap: 'anywhere',
        };

        return (
            <FormPage
                demoGuard={demoGuard}
                label={t('components.placeOrderPanel.reviewOrder')}
                intro={summary || (side === 'buy'
                    ? t('components.placeOrderPanel.buyOrder')
                    : t('components.placeOrderPanel.sellOrder'))}
                onSubmit={handleSubmit}
                noValidate
                aria-busy={stage === 'submitting' || undefined}
                actions={(
                    <>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={(event) => {
                                event.preventDefault();
                                setStage('form');
                            }}
                            disabled={stage === 'submitting'}
                        >
                            {t('components.placeOrderPanel.editOrder')}
                        </Button>
                        <Button
                            type="submit"
                            variant="primary"
                            block
                            icon={!isWatcherMode && hw ? <Icon.SignIcon /> : (side === 'buy' ? <BuyGlyph /> : <SellGlyph />)}
                            loading={stage === 'submitting'}
                            disabled={!isWatcherMode && hw && hwStatus !== 'available'}
                        >
                            {isWatcherMode
                                ? t('components.placeOrderPanel.placeOrder', { side })
                                : hw
                                ? t('send.review.sign')
                                : t('components.placeOrderPanel.placeOrder', { side })}
                        </Button>
                    </>
                )}
            >
                <dl style={dlStyle}>
                    <dt style={dtStyle}>{t('components.placeOrderPanel.market')}</dt>
                    <dd style={ddStyle}>{tick1}/{tick2}</dd>
                    <dt style={dtStyle}>{t('components.placeOrderPanel.side')}</dt>
                    <dd style={ddStyle}>{side === 'buy' ? t('components.placeOrderPanel.buy') : t('components.placeOrderPanel.sell')}</dd>
                    <dt style={dtStyle}>{t('components.placeOrderPanel.give')}</dt>
                    <dd style={ddStyle}>{giveAmt} {giveTick}</dd>
                    <dt style={dtStyle}>{t('components.placeOrderPanel.get')}</dt>
                    <dd style={ddStyle}>{getAmt} {getTick}</dd>
                    <dt style={dtStyle}>{t('components.placeOrderPanel.price')}</dt>
                    <dd style={ddStyle}>{priceText} {tick2}/{tick1}</dd>
                    <dt style={dtStyle}>{t('components.placeOrderPanel.expiration')}</dt>
                    <dd style={ddStyle}>{expirationLabel}</dd>
                    <dt style={dtStyle}>{t('send.fields.from')}</dt>
                    <dd style={{ ...ddStyle, wordBreak: 'break-all' }}>
                        {fromAddress?.address ?? '-'}
                    </dd>
                    <dt style={dtStyle}>{t('components.placeOrderPanel.settlementAddress')}</dt>
                    <dd style={{ ...ddStyle, wordBreak: 'break-all' }}>
                        {fromAddress?.address ?? '-'}
                    </dd>
                    <dt style={dtStyle}>{t('send.networkFee')}</dt>
                    <dd style={ddStyle}>{feeDisplay}</dd>
                </dl>
                {payFeeInNativeCoin ? (
                    <FormNotice variant="warning" role="alert">{NATIVE_FEE_WARNING}</FormNotice>
                ) : null}
                {isWatcherMode ? (
                    <p style={{ margin: '0 0 var(--xc-space-2)', color: 'var(--xc-text-muted)', fontSize: '0.75rem' }}>
                        {t('common.watcherBuildsUnsigned')}
                    </p>
                ) : (
                    <SignCredentials
                        fromAddress={fromAddress}
                        chainId={chainId}
                        password={password}
                        onPasswordChange={(v) => {
                            setPassword(v);
                            if (submitError) setSubmitError(null);
                        }}
                        onStatusChange={onHwStatusChange}
                        passwordRef={passwordRef}
                        submitError={submitError}
                        disabled={stage === 'submitting'}
                        getSignerStatus={messaging.getSignerStatus}
                    />
                )}
                {submitError && (isWatcherMode || hw) ? (
                    <FormNotice variant="error">{submitError}</FormNotice>
                ) : null}
            </FormPage>
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

    // The fees card, the native-fee warning and the gated-content notice,
    // shared by the panel and the Trade page's form.
    const feesBlock = (
        <>
            <FeesCard
                chainId={chainId}
                quote={protocolFeeQuote}
                pending={protocolFeePending}
                feeSelector={null}
                tiers={feeEstimate ? { normal: feeEstimate } : undefined}
                value={{ mode: 'normal' }}
                coinTicker={coinTicker}
            >
                <NativeFeeToggle
                    checked={payFeeInNativeCoin}
                    onChange={setPayFeeInNativeCoin}
                    coinTicker={coinTicker}
                    mandatory={nativeFeeMandatory}
                />
            </FeesCard>
            {payFeeInNativeCoin ? (
                <FieldNote variant="warning" role="alert">{NATIVE_FEE_WARNING}</FieldNote>
            ) : null}
            {gatedGiveNotice.gated ? (
                <FormNotice variant="warning" role="alert">
                    {gatedTickWarningCopy(side === 'sell' ? tick1 : tick2, 'the order counterparty')}
                </FormNotice>
            ) : null}
        </>
    );

    // The CoinPay notice and auto-pay choices, shared by the panel and the
    // Trade page's form so both offer the same choices.
    const coinpayBlock = giveIsNative ? (
        <div style={{
            margin: '0.5rem 0 0',
            padding: 'var(--xc-card-pad)',
            background: 'var(--xc-card-bg)',
            border: 'var(--xc-card-border)',
            borderRadius: 'var(--xc-card-radius)',
            fontSize: '0.75rem',
        }}>
            <p style={{ margin: 0, color: 'var(--xc-text-muted)' }}>
                {t('components.placeOrderPanel.thisOrderGives')} {coinTicker}{t('components.placeOrderPanel.soEachMatchSettlesVia')} {coinTicker} {t('components.placeOrderPanel.paymentMustBeSentWithin')}
            </p>
            {autopayEligible ? (
                <>
                    <div style={{ marginTop: 'var(--xc-space-2)' }}>
                        <Checkbox
                            label={t('components.placeOrderPanel.enableCoinpayAutoPay')}
                            description={t('components.placeOrderPanel.weMonitorForMatchesOn')}
                            checked={autopayEnabled}
                            onChange={(e) => setAutopayEnabled(e.target.checked)}
                        />
                    </div>
                    {(() => {
                        // The GIVE side is the coin, so this order's own
                        // exposure is its GIVE amount: price×size when
                        // buying (giving tick2), size when selling tick1.
                        const thisOrderGive = side === 'buy'
                            ? (total != null ? String(total) : '')
                            : sizeText;
                        if (autopayArm && exposure && exposure[chainId]) {
                            return (
                                <p style={{ margin: 'var(--xc-space-2) 0 0', color: 'var(--xc-text-muted)' }}>
                                    {t('components.placeOrderPanel.outstandingAutoPayExposureOn')}{' '}
                                    {baseUnitsToCoinText(exposure[chainId]) ?? exposure[chainId]} {coinTicker}
                                    {thisOrderGive ? t('components.placeOrderPanel.fromThisOrder', { thisOrderGive, coinTicker }) : ''}
                                    {t('components.placeOrderPanel.evenIfTheServiceThat')}
                                </p>
                            );
                        }
                        if (autopayArm && thisOrderGive) {
                            return (
                                <p style={{ margin: 'var(--xc-space-2) 0 0', color: 'var(--xc-text-muted)' }}>
                                    {t('components.placeOrderPanel.autoPayExposureFromThis')} {thisOrderGive} {coinTicker}.
                                </p>
                            );
                        }
                        return null;
                    })()}
                </>
            ) : (
                <p style={{ margin: 'var(--xc-space-2) 0 0', color: 'var(--xc-text-muted)' }}>
                    {isWatcherMode
                        ? t('components.placeOrderPanel.autoPayIsUnavailableIn')
                        : t('components.placeOrderPanel.autoPayIsUnavailableFor')}
                </p>
            )}
        </div>
    ) : null;

    // The Trade page's form. Same state, guard (handleReview) and confirm and
    // submit path as the panel below; only the fields' arrangement differs.
    if (trade) {
        const busy = accountLoading || actionConfirm.composing;
        const sideTone = side === 'buy' ? 'success' : 'danger';
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
        const sideControl = (
            <SegmentedControl
                className={styles.tradeSide}
                aria-label={t('components.placeOrderPanel.orderSide')}
                value={side}
                onChange={setSide}
                items={[
                    { id: 'buy', label: <span className={styles.segLabel}><BuyGlyph />{t('components.placeOrderPanel.buy')}</span>, tone: 'success' },
                    { id: 'sell', label: <span className={styles.segLabel}><SellGlyph />{t('components.placeOrderPanel.sell')}</span>, tone: 'danger' },
                ]}
            />
        );
        const notices = (
            <>
                <div className={styles.tradeRows}>
                    {swap ? (
                        <>
                            <span className={styles.tradeRowLabel}>{t('components.placeOrderPanel.fills')}</span>
                            <span className={styles.tradeRowValue}>{fillsText}</span>
                        </>
                    ) : (
                        <>
                            <span className={styles.tradeRowLabel}>{t('flows.feesCard.total')}</span>
                            <span className={styles.tradeRowValue}>{total ? `${trimAmountTail(total)} ${tick2}` : '-'}</span>
                        </>
                    )}
                </div>
                <Select
                    id="place-order-expiration"
                    label={t('components.placeOrderPanel.expiration')}
                    value={expirationId}
                    onChange={(e) => setExpirationId(e.target.value)}
                >
                    {EXPIRATION_PRESETS.map((p) => (
                        /* Native options supply Select choices because the kit has no option primitive. */
                        <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                    {/* Native options supply Select choices because the kit has no option primitive. */}
                    <option value="custom">{t('components.placeOrderPanel.custom')}</option>
                </Select>
                {expirationId === 'custom' ? (
                    <Input
                        label={t('components.placeOrderPanel.customExpiration')}
                        type="datetime-local"
                        value={customExpiration}
                        onChange={(e) => setCustomExpiration(e.target.value)}
                        autoComplete="off"
                    />
                ) : null}
                {/* The shared fees and CoinPay blocks. */}
                {feesBlock}
                {coinpayBlock}
            </>
        );
        // The Swap | Market tabs sit right above this form, so the demo note
        // goes just above the action button. FormPage still blocks the submit
        // but draws no note.
        const tradeGuard = demoGuard.blocked ? { ...demoGuard, note: null } : demoGuard;
        // The chips drop the unit first, then shorten "Fill now at"
        // as the row narrows (MarketTrading.module.css); the name stays whole.
        const limitText = trimAmountTail(limitShown) || '-';
        const fillText = bestQuote ? trimAmountTail(bestQuote) : '';
        return (
            <FormPage
                demoGuard={tradeGuard}
                label={swap ? t('components.placeOrderPanel.swapTicket') : t('components.placeOrderPanel.placeOrder2')}
                onSubmit={handleReview}
                noValidate
                aria-busy={busy || undefined}
                status={formError ? <StatusMessage variant="error">{formError}</StatusMessage> : null}
                actions={(
                    <Button
                        type="submit"
                        variant={sideTone}
                        block
                        loading={busy}
                        disabled={busy}
                        icon={swap ? <Icon.ArrowRightIcon /> : (side === 'buy' ? <BuyGlyph /> : <SellGlyph />)}
                    >
                        {swap ? t('components.placeOrderPanel.review') : (side === 'buy' ? t('components.placeOrderPanel.buy') : t('components.placeOrderPanel.sell'))}
                    </Button>
                )}
            >
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
                        payBalance={`Balance ${balanceFor(payTick) ?? '-'}`}
                        getNote={price ? `at ${trimAmountTail(price)} each` : ''}
                        onFlip={() => setSide(side === 'buy' ? 'sell' : 'buy')}
                    />
                ) : (
                    <div className={styles.tradeCard}>
                        {sideControl}
                        <SegmentedControl
                            className={styles.tradeType}
                            aria-label={t('components.placeOrderPanel.orderType')}
                            value={orderType}
                            onChange={chooseOrderType}
                            items={[
                                { id: 'limit', label: <span className={styles.segLabel}><Icon.ClockIcon />{t('components.placeOrderPanel.limit')}</span> },
                                { id: 'market', label: <span className={styles.segLabel}><Icon.ZapIcon />{t('components.placeOrderPanel.market')}</span> },
                            ]}
                        />
                        <Input
                            label={t('components.placeOrderPanel.price')}
                            hint={bestQuote ? `${side === 'buy' ? 'Best ask' : 'Best bid'} ${trimAmountTail(bestQuote)} ${tick2}${orderType === 'market' ? '; a Market order takes it' : ''}` : undefined}
                            value={price}
                            onChange={(e) => setPrice(normalizeDecimalEntry(e.target.value, price))}
                            readOnly={orderType === 'market'}
                            inputMode="decimal"
                            autoComplete="off"
                            fieldAction={<span className={styles.fieldUnit}>{tick2}</span>}
                            style={{ fontVariantNumeric: 'tabular-nums' }}
                        />
                        <Input
                            label={t('send.fields.amount')}
                            hint={t('components.placeOrderPanel.available', { amount: balanceFor(side === 'sell' ? tick1 : tick2) ?? '-', tick: side === 'sell' ? tick1 : tick2 })}
                            value={size}
                            onChange={(e) => setSize(normalizeDecimalEntry(e.target.value, size))}
                            inputMode="decimal"
                            autoComplete="off"
                            fieldAction={<span className={styles.fieldUnit}>{tick1}</span>}
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
                                    aria-label={pct === 100 ? t('components.placeOrderPanel.useMax') : t('components.placeOrderPanel.usePercent', { pct })}
                                >
                                    {pct === 100 ? t('components.amountField.max') : `${pct}%`}
                                </Button>
                            ))}
                        </div>
                    </div>
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
                {/* The demo note, just above the action button. */}
                {demoGuard.blocked ? demoGuard.note : null}
            </FormPage>
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
                    { id: 'buy', label: <>{t('components.placeOrderPanel.buy')} {tick1}</>, tone: 'success' },
                    { id: 'sell', label: <>{t('components.placeOrderPanel.sell')} {tick1}</>, tone: 'danger' },
                ]}
            />
            <div className={styles.priceAmountFields} role="group" aria-label={t('components.placeOrderPanel.priceAndAmount')}>
                <Input
                    label={t('components.placeOrderPanel.price2', { tick2 })}
                    value={price}
                    onChange={(e) => setPrice(normalizeDecimalEntry(e.target.value, price))}
                    inputMode="decimal"
                    autoComplete="off"
                    style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                />
                <Input
                    label={t('components.placeOrderPanel.size', { tick1 })}
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
                value={expirationId}
                onChange={(e) => setExpirationId(e.target.value)}
            >
                {EXPIRATION_PRESETS.map((p) => (
                    /* Native options supply Select choices because the kit has no option primitive. */
                    <option key={p.id} value={p.id}>{p.label}</option>
                ))}
                {/* Native options supply Select choices because the kit has no option primitive. */}
                <option value="custom">{t('components.placeOrderPanel.custom')}</option>
            </Select>
            {expirationId === 'custom' ? (
                <Input
                    label={t('components.placeOrderPanel.customExpiration')}
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
