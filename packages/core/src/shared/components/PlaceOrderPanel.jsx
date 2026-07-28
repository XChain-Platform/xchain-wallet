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
import { Button, Input } from '@xchain-wallet/core/ui';
import { flows as flowsLib, registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useGatedTickNotice, gatedTickWarningCopy } from '../hooks/useGatedTickNotice.js';
import { useActionConfirmFlow, useConfirmSubmit, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from './ActionConfirmScreen.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { isHwSource, SignCredentials } from './SignCredentials.jsx';
import { buildBalanceRows } from './BalanceList.jsx';
import { formatWithThousands } from '../utils/amountFormat.js';
import { NativeFeeToggle } from './NativeFeeToggle.jsx';
import { NATIVE_FEE_WARNING, nativeFeeErrorMessage } from '../../sdk/nativeFeePreflight.js';
import { preferredSourceId } from '../addressSelection.js';
import { estimateNativeSendFee } from '../../flows/feeEstimate.js';
import { multiplyAmounts } from '../../market/orderMath.js';
import { baseUnitsToCoinText } from '../../market/obligationStatus.js';
import { useNativeFee } from '../hooks/useNativeFee.js';

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
 * @param {() => void} [props.onOrderPlaced]         refresh parent after placement
 */
export function PlaceOrderPanel({ walletId, chainId, tick1, tick2, prefillPrice, onOrderPlaced }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const signerReady = useSignerReady(walletId);
    const [side, setSide] = useState(/** @type {'buy' | 'sell'} */ ('buy'));
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
    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));
    const [password, setPassword] = useState('');
    const [stage, setStage] = useState(/** @type {'form' | 'review' | 'submitting' | 'done'} */ ('form'));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    const { payFeeInNativeCoin, setPayFeeInNativeCoin, mandatory: nativeFeeMandatory } =
        useNativeFee(chainId);

    // PC-16 CoinPay auto-pay consent. Checked by default (operator-ratified):
    // a coin-GIVE order that is not auto-paid is not fire-and-forget.
    const [autopayEnabled, setAutopayEnabled] = useState(true);
    const [keepOpenAck, setKeepOpenAck] = useState(false);
    const [exposure, setExposure] = useState(/** @type {Record<string, string> | null} */ (null));

    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    useEffect(() => {
        if (prefillPrice) setPrice(prefillPrice);
    }, [prefillPrice]);

    useEffect(() => {
        let cancelled = false;
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
                const sourceId = preferredSourceId(byChain[chainId] || [], active?.[chainId]);
                if (sourceId) setFromAddressId(sourceId);
                // Pull balances alongside addresses so we can show the
                // user how much of tick1 / tick2 they have available
                // before they place the order.
                let b;
                if (flowsLib.isDemoWallet(walletId)) {
                    b = flowsLib.synthesizeDemoBalances(byChain);
                } else {
                    b = await messaging.getWalletBalances(walletId);
                }
                if (!cancelled) setBalances(b);
            } catch { /* surfaced via submit error on place */ }
        })();
        return () => { cancelled = true; };
    }, [messaging, walletId, chainId]);

    const balanceFor = useCallback((tick) => {
        if (!balances) return null;
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
        if (!hit) return '0';
        return formatQuantity(hit.quantity, hit.divisibility);
    }, [balances, chainId, addressesByChain, fromAddressId]);

    const fromAddress = useMemo(() => {
        if (!addressesByChain || !fromAddressId) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [addressesByChain, chainId, fromAddressId]);

    const hw = isHwSource(fromAddress);

    const descriptor = chainRegistry.get(chainId);
    const coinTicker = descriptor ? (PROTOCOL_COIN_TICKER[descriptor.coin] || '') : '';

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
    // Web SPA has no background watcher: a one-time per-shell "keep the
    // wallet open" acknowledgment gates first use of the checkbox.
    const ackKey = 'xchain-wallet:autopay-keep-open-ack';
    const ackDone = shell === 'web'
        ? (() => { try { return globalThis.localStorage?.getItem(ackKey) === '1'; } catch { return false; } })()
        : true;
    const ackRequired = shell === 'web' && autopayArm && !ackDone;

    // Aggregate outstanding auto-pay exposure (the bound the user accepts).
    useEffect(() => {
        if (!autopayArm || typeof messaging.getAutopayExposure !== 'function') return;
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

    // The chosen expiration as a Unix timestamp (seconds). `null` = the
    // default window (omit EXPIRATION); `undefined` = an invalid custom
    // entry (blocked in the guard); a number is emitted verbatim.
    const expirationUnix = useMemo(() => {
        if (expirationId === 'custom') {
            const ms = Date.parse(customExpiration);
            if (!Number.isFinite(ms)) return undefined;
            return Math.floor(ms / 1000);
        }
        const preset = EXPIRATION_PRESETS.find((e) => e.id === expirationId);
        if (!preset) return undefined;
        if (preset.days == null) return null;
        return Math.floor(Date.now() / 1000) + preset.days * 86400;
    }, [expirationId, customExpiration]);

    const summary = useMemo(() => {
        if (!total) return null;
        if (side === 'buy') {
            return `Give ${total} ${tick2}, get ${size} ${tick1}`;
        }
        return `Give ${size} ${tick1}, get ${total} ${tick2}`;
    }, [side, total, size, tick1, tick2]);

    function buildParams() {
        const sizeStr = String(size).trim();
        const totalStr = total == null ? '' : String(total);
        /** @type {Record<string, string>} */
        // GIVE_COIN / GET_COIN are required by the indexer (order.js
        // rejects a missing COIN network as invalid); same-chain orders
        // always carry the panel's own chain, matching SwapForm.
        //
        // : this hardcoded same-coin pair IS the wallet's ORDER
        // boundary. The wire allows GIVE_COIN != GET_COIN (a cross-chain
        // order escrows the GIVE side locally and settles through the
        // validator federation via CROSS_SETTLE, ORDER.md "Notes"), and
        // orderAction forwards params verbatim, so the flow layer would
        // carry it. What is missing is authoring UI: no give-chain /
        // get-chain split exists for ORDER the way CrossChainSwapForm has
        // one for SWAP, and no GET_ADDRESS is resolved on a second chain.
        // Cross-chain trading from the wallet is SWAP-only. Boundary doc:
        // claude/components/xchain-wallet/ORDER-CROSS-CHAIN-BOUNDARY.md.
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
        if (typeof expirationUnix === 'number') p.EXPIRATION = String(expirationUnix);
        return p;
    }

    //  §5.6 slice 3: software orders compose ONE PSBT host-side and
    // confirm it on the shared confirm page; hardware + watcher keep the
    // legacy review stage (they need their own signing gates).
    // (isWatcherMode is read above for the auto-pay eligibility gate.)
    const actionConfirm = useActionConfirmFlow({ messaging, walletId, slice: 'bespokeFlows' });
    const singleEncode = !isWatcherMode;
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;
    // : hardware signs the SAME prebuilt PSBT through the same host
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
            setResult(res);
            setPassword('');
            setStage('done');
            onOrderPlaced?.();
        } catch (err) {
            if (isUserRejection(err)) return;
            // Same mapping the sign path already does: NativeFeeForfeitError's own message is
            // wire wording, and this confirm path is the one the flow actually takes.
            setFormError(err?.name === 'NativeFeeForfeitError'
                ? nativeFeeErrorMessage(err, { coinTicker, mandatory: nativeFeeMandatory })
                : err?.message || 'Order placement failed.');
        }
    }

    // Validate form fields and advance to the review stage. No signing
    // happens here; the user sees a summary and confirms before we touch
    // the key material.
    function handleReview(event) {
        event.preventDefault();
        if (!fromAddress) {
            setFormError('No address to sign from on this chain. Use Receive first.');
            return;
        }
        if (!price.trim() || !size.trim()) {
            setFormError('Price and size are required.');
            return;
        }
        const p = Number(price);
        const s = Number(size);
        if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(s) || s <= 0) {
            setFormError('Price and size must be positive numbers.');
            return;
        }
        if (expirationUnix === undefined) {
            setFormError('Pick a valid expiration date and time.');
            return;
        }
        if (typeof expirationUnix === 'number' && expirationUnix <= Math.floor(Date.now() / 1000)) {
            setFormError('Expiration must be in the future.');
            return;
        }
        if (ackRequired && !keepOpenAck) {
            setFormError('Acknowledge the auto-pay requirement (or turn auto-pay off) to continue.');
            return;
        }
        if (shell === 'web' && autopayArm && !ackDone && keepOpenAck) {
            try { globalThis.localStorage?.setItem(ackKey, '1'); } catch { /* per-shell nicety only */ }
        }
        setFormError(null);
        setSubmitError(null);
        if (singleEncode) { openConfirmScreen(); return; }
        setStage('review');
        // Focus the password field on the review screen so the user
        // can immediately start typing without an extra click.
        setTimeout(() => passwordRef.current?.focus(), 0);
    }

    // Executes the ORDER sign and broadcast. Only reachable from the
    // review stage; returns to review (not form) on error so the user
    // can correct their credentials without losing the order summary.
    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        setStage('submitting');
        setSubmitError(null);
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
            const res = hw
                ? await messaging.orderActionHw({ ...base, signerId: fromAddress.signerId })
                : await messaging.orderAction({ ...base, password });
            setResult(res);
            setPassword('');
            setStage('done');
            onOrderPlaced?.();
        } catch (err) {
            let errorMessage;
            if (err?.name === 'InvalidPasswordError') {
                errorMessage = 'Incorrect password.';
            } else if (err?.name === 'NativeFeeForfeitError') {
                errorMessage = nativeFeeErrorMessage(err, { coinTicker, mandatory: nativeFeeMandatory });
            } else {
                errorMessage = err?.message || 'Order placement failed.';
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

    if (stage === 'done') {
        const txid = result?.txid || result?.broadcast?.txid;
        // : a queued result is SIGNED and not broadcast. This panel is
        // inline rather than a screen, so it keeps its own frame and only
        // swaps the copy; "Place another" is deliberately not offered, since
        // a signed copy already exists (the §5.3.4 double-broadcast trap).
        if (result?.queued) {
            return (
                <div
                    role="status"
                    aria-live="polite"
                    style={{
                        border: '1px solid var(--xc-warning)',
                        borderRadius: '4px',
                        padding: '0.75rem',
                    }}
                >
                    <p style={{ margin: '0 0 0.25rem', fontWeight: 600 }}>Signed. Broadcast will retry.</p>
                    <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--xc-text-muted)' }}>
                        Your order is signed but couldn&apos;t reach the network just now. It&apos;s
                        queued and will be broadcast automatically; track it from the
                        queued-transactions banner, and don&apos;t place it again.
                    </p>
                </div>
            );
        }
        return (
            <div
                style={{
                    border: '1px solid var(--xc-border)',
                    borderRadius: '4px',
                    padding: '0.75rem',
                }}
            >
                <p style={{ margin: '0 0 0.25rem', fontWeight: 600 }}>Order placed</p>
                {txid ? (
                    <p style={{ margin: 0, fontSize: '0.75rem' }}>
                        <code>{txid}</code>
                    </p>
                ) : null}
                {result?.autopayArmed === true ? (
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: 'var(--xc-text-muted)' }}>
                        CoinPay auto-pay is armed for this order. You can turn it off any time from the open-orders list.
                    </p>
                ) : result?.autopayArmed === false ? (
                    <p role="alert" style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#ef5350' }}>
                        The order was placed, but auto-pay could not be armed
                        {result?.autopayConsentError ? ` (${result.autopayConsentError})` : ''}. Matches will need manual payment from Payments due.
                    </p>
                ) : null}
                <div style={{ marginTop: '0.5rem' }}>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                            setStage('form');
                            setPrice('');
                            setSize('');
                            setResult(null);
                        }}
                    >
                        Place another
                    </Button>
                </div>
            </div>
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
        const giveAmt = side === 'buy' ? (total != null ? String(total) : '') : size;
        const getTick = side === 'buy' ? tick1 : tick2;
        const getAmt = side === 'buy' ? size : (total != null ? String(total) : '');

        let feeDisplay = 'Estimate unavailable';
        if (feeEstimate) {
            feeDisplay = `${feeEstimate.coinAmount} ${coinTicker}`;
            if (feeEstimate.rate) feeDisplay += ` (${feeEstimate.rate})`;
        }

        const panelStyle = {
            border: '1px solid var(--xc-border)',
            borderRadius: '4px',
            padding: '0.75rem',
        };
        const dlStyle = {
            margin: '0 0 var(--xc-space-2)',
            padding: 'var(--xc-space-2) var(--xc-space-3)',
            background: 'var(--xc-bg-muted)',
            border: '1px solid var(--xc-border)',
            borderRadius: 'var(--xc-radius-sm)',
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            columnGap: 'var(--xc-space-3)',
            rowGap: 2,
            fontSize: 'var(--xc-text-xs)',
        };
        const dtStyle = { color: 'var(--xc-text-muted)' };
        const ddStyle = { margin: 0, color: 'var(--xc-text)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

        return (
            <div style={panelStyle}>
                <p style={{ margin: '0 0 var(--xc-space-2)', fontSize: '0.85rem', fontWeight: 600 }}>
                    {summary || `${side === 'buy' ? 'Buy' : 'Sell'} order`}
                </p>
                <dl style={dlStyle}>
                    <dt style={dtStyle}>Market</dt>
                    <dd style={ddStyle}>{tick1}/{tick2}</dd>
                    <dt style={dtStyle}>Side</dt>
                    <dd style={ddStyle}>{side === 'buy' ? 'Buy' : 'Sell'}</dd>
                    <dt style={dtStyle}>Give</dt>
                    <dd style={ddStyle}>{giveAmt} {giveTick}</dd>
                    <dt style={dtStyle}>Get</dt>
                    <dd style={ddStyle}>{getAmt} {getTick}</dd>
                    <dt style={dtStyle}>Price</dt>
                    <dd style={ddStyle}>{price} {tick2}/{tick1}</dd>
                    <dt style={dtStyle}>Expiration</dt>
                    <dd style={ddStyle}>{expirationLabel}</dd>
                    <dt style={dtStyle}>From</dt>
                    <dd style={{ ...ddStyle, wordBreak: 'break-all' }}>
                        {fromAddress?.address ?? '-'}
                    </dd>
                    <dt style={dtStyle}>Network fee</dt>
                    <dd style={ddStyle}>{feeDisplay}</dd>
                </dl>
                {payFeeInNativeCoin ? (
                    <p
                        role="alert"
                        style={{ margin: '0 0 var(--xc-space-2)', color: 'var(--xc-text-muted)', fontSize: '0.75rem' }}
                    >
                        {NATIVE_FEE_WARNING}
                    </p>
                ) : null}
                <form onSubmit={handleSubmit} noValidate>
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
                    {submitError && hw ? (
                        <p role="alert" style={{ margin: '0.5rem 0 0', color: '#ef5350', fontSize: '0.75rem' }}>
                            {submitError}
                        </p>
                    ) : null}
                    <div style={{ display: 'flex', gap: 'var(--xc-space-2)', marginTop: '0.5rem' }}>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setStage('form')}
                            disabled={stage === 'submitting'}
                        >
                            Edit order
                        </Button>
                        <Button
                            type="submit"
                            variant="primary"
                            block
                            loading={stage === 'submitting'}
                            disabled={hw && hwStatus !== 'available'}
                        >
                            {hw
                                ? `Sign on ${fromAddress?.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                                : `Place ${side} order`}
                        </Button>
                    </div>
                </form>
            </div>
        );
    }

    //  confirm page, rendered in place of the panel (the same
    // substitution the review stage above already does); form state stays
    // intact behind it, so Reject returns the user to their filled-in order.
    if (actionConfirm.open) {
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId}
                feeText={feeEstimate?.coinAmount
                    ? `Network fee: ${feeEstimate.coinAmount} ${coinTicker}`.trim()
                    : undefined}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                // : hardware swaps the password field for the device block
                // and gates Approve on the device being available (§5.1).
                hwSource={hw ? fromAddress : null}
                hwStatus={hwStatus}
                onHwStatusChange={onHwStatusChange}
                chainId={chainId}
                getSignerStatus={messaging.getSignerStatus}
            />
        );
    }

    return (
        <form
            onSubmit={handleReview}
            noValidate
            style={{
                border: '1px solid var(--xc-border)',
                borderRadius: '4px',
                padding: '0.5rem',
            }}
        >
            <dl style={{
                margin: '0 0 var(--xc-space-2)',
                padding: 'var(--xc-space-2) var(--xc-space-3)',
                background: 'var(--xc-bg-muted)',
                border: '1px solid var(--xc-border)',
                borderRadius: 'var(--xc-radius-sm)',
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                columnGap: 'var(--xc-space-3)',
                rowGap: 2,
                fontSize: 'var(--xc-text-xs)',
            }}>
                <dt style={{ color: 'var(--xc-text-muted)' }}>Balance {tick1}</dt>
                <dd style={{ margin: 0, color: 'var(--xc-text)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {balanceFor(tick1) ?? '-'}
                </dd>
                <dt style={{ color: 'var(--xc-text-muted)' }}>Balance {tick2}</dt>
                <dd style={{ margin: 0, color: 'var(--xc-text)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {balanceFor(tick2) ?? '-'}
                </dd>
            </dl>
            <div style={{ display: 'flex', gap: 'var(--xc-space-2)', marginBottom: 'var(--xc-space-2)' }}>
                <button
                    type="button"
                    onClick={() => setSide('buy')}
                    aria-pressed={side === 'buy'}
                    style={{
                        flex: 1,
                        appearance: 'none',
                        font: 'inherit',
                        fontWeight: 700,
                        cursor: 'pointer',
                        padding: 'var(--xc-space-2) var(--xc-space-3)',
                        borderRadius: 'var(--xc-radius-md)',
                        border: '1px solid #16a34a',
                        background: '#16a34a',
                        color: '#FFFFFF',
                        opacity: side === 'buy' ? 1 : 0.45,
                    }}
                >
                    Buy {tick1}
                </button>
                <button
                    type="button"
                    onClick={() => setSide('sell')}
                    aria-pressed={side === 'sell'}
                    style={{
                        flex: 1,
                        appearance: 'none',
                        font: 'inherit',
                        fontWeight: 700,
                        cursor: 'pointer',
                        padding: 'var(--xc-space-2) var(--xc-space-3)',
                        borderRadius: 'var(--xc-radius-md)',
                        border: '1px solid #dc2626',
                        background: '#dc2626',
                        color: '#FFFFFF',
                        opacity: side === 'sell' ? 1 : 0.45,
                    }}
                >
                    Sell {tick1}
                </button>
            </div>
            <Input
                label={`Price (${tick2})`}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                inputMode="decimal"
                autoComplete="off"
            />
            <Input
                label={`Size (${tick1})`}
                value={size}
                onChange={(e) => setSize(e.target.value)}
                inputMode="decimal"
                autoComplete="off"
            />
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--xc-space-1)',
                marginBottom: 'var(--xc-space-3)',
            }}>
                <label
                    htmlFor="place-order-expiration"
                    style={{
                        fontSize: 'var(--xc-text-sm)',
                        color: 'var(--xc-text-muted)',
                        fontWeight: 500,
                    }}
                >
                    Expiration
                </label>
                <select
                    id="place-order-expiration"
                    value={expirationId}
                    onChange={(e) => setExpirationId(e.target.value)}
                    style={{
                        appearance: 'none',
                        padding: 'var(--xc-space-2) calc(var(--xc-space-3) + 16px) var(--xc-space-2) var(--xc-space-3)',
                        fontFamily: 'var(--xc-font-sans)',
                        fontSize: 'var(--xc-text-md)',
                        color: 'var(--xc-text)',
                        background: 'var(--xc-surface)',
                        border: '1px solid var(--xc-border-strong)',
                        borderRadius: 'var(--xc-radius-md)',
                        minHeight: 36,
                        width: '100%',
                        cursor: 'pointer',
                        font: 'inherit',
                        backgroundImage:
                            'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\' viewBox=\'0 0 10 6\'><path fill=\'%23888\' d=\'M0 0l5 6 5-6z\'/></svg>")',
                        backgroundRepeat: 'no-repeat',
                        backgroundPosition: 'right var(--xc-space-3) center',
                    }}
                >
                    {EXPIRATION_PRESETS.map((p) => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                    <option value="custom">Custom…</option>
                </select>
            </div>
            {expirationId === 'custom' ? (
                <Input
                    label="Custom expiration"
                    type="datetime-local"
                    value={customExpiration}
                    onChange={(e) => setCustomExpiration(e.target.value)}
                    autoComplete="off"
                />
            ) : null}
            {summary ? (
                <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }}>
                    {summary}
                </p>
            ) : null}
            <NativeFeeToggle
                checked={payFeeInNativeCoin}
                onChange={setPayFeeInNativeCoin}
                coinTicker={coinTicker}
                mandatory={nativeFeeMandatory}
            />
            {payFeeInNativeCoin ? (
                <p
                    role="alert"
                    style={{ margin: '0.5rem 0 0', color: 'var(--xc-text-muted)', fontSize: '0.75rem' }}
                >
                    {NATIVE_FEE_WARNING}
                </p>
            ) : null}
            {gatedGiveNotice.gated ? (
                <p role="alert" style={{ margin: '0.5rem 0 0', color: 'var(--xc-text-muted)', fontSize: '0.75rem' }}>
                    {gatedTickWarningCopy(side === 'sell' ? tick1 : tick2, 'the order counterparty')}
                </p>
            ) : null}
            {giveIsNative ? (
                <div style={{
                    margin: '0.5rem 0 0',
                    padding: 'var(--xc-space-2) var(--xc-space-3)',
                    background: 'var(--xc-bg-muted)',
                    border: '1px solid var(--xc-border)',
                    borderRadius: 'var(--xc-radius-sm)',
                    fontSize: '0.75rem',
                }}>
                    <p style={{ margin: 0, color: 'var(--xc-text-muted)' }}>
                        This order gives {coinTicker}, so each match settles via CoinPay:
                        the {coinTicker} payment must be sent within the payment window
                        (about 2 hours) or the match expires.
                    </p>
                    {autopayEligible ? (
                        <>
                            <label style={{ display: 'flex', gap: 'var(--xc-space-2)', alignItems: 'flex-start', marginTop: 'var(--xc-space-2)', cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={autopayEnabled}
                                    onChange={(e) => setAutopayEnabled(e.target.checked)}
                                    style={{ marginTop: 2 }}
                                />
                                <span>
                                    <strong>Enable CoinPay auto-pay</strong>
                                    <br />
                                    We monitor for matches on your orders and send payment for them automatically.
                                </span>
                            </label>
                            {(() => {
                                // The GIVE side is the coin, so this order's own
                                // exposure is its GIVE amount: price×size when
                                // buying (giving tick2), size when selling tick1.
                                const thisOrderGive = side === 'buy'
                                    ? (total != null ? String(total) : '')
                                    : String(size).trim();
                                if (autopayArm && exposure && exposure[chainId]) {
                                    return (
                                        <p style={{ margin: 'var(--xc-space-2) 0 0', color: 'var(--xc-text-muted)' }}>
                                            Outstanding auto-pay exposure on this chain:{' '}
                                            {baseUnitsToCoinText(exposure[chainId]) ?? exposure[chainId]} {coinTicker}
                                            {thisOrderGive ? ` (+ ${thisOrderGive} ${coinTicker} from this order)` : ''}. Under full
                                            indexer compromise this bound is the most auto-pay could send.
                                        </p>
                                    );
                                }
                                if (autopayArm && thisOrderGive) {
                                    return (
                                        <p style={{ margin: 'var(--xc-space-2) 0 0', color: 'var(--xc-text-muted)' }}>
                                            Auto-pay exposure from this order: up to {thisOrderGive} {coinTicker}.
                                        </p>
                                    );
                                }
                                return null;
                            })()}
                            {ackRequired ? (
                                <label style={{ display: 'flex', gap: 'var(--xc-space-2)', alignItems: 'flex-start', marginTop: 'var(--xc-space-2)', cursor: 'pointer' }}>
                                    <input
                                        type="checkbox"
                                        checked={keepOpenAck}
                                        onChange={(e) => setKeepOpenAck(e.target.checked)}
                                        style={{ marginTop: 2 }}
                                    />
                                    <span>I understand the wallet must stay open for auto-pay to work.</span>
                                </label>
                            ) : null}
                        </>
                    ) : (
                        <p style={{ margin: 'var(--xc-space-2) 0 0', color: 'var(--xc-text-muted)' }}>
                            {isWatcherMode
                                ? 'Auto-pay is unavailable in watch-only mode; you will be notified when a match needs payment.'
                                : 'Auto-pay is unavailable for hardware signers (unattended signing needs a software key); you will be notified when a match needs payment.'}
                        </p>
                    )}
                </div>
            ) : null}
            {formError ? (
                <p role="alert" style={{ margin: '0.5rem 0 0', color: '#ef5350', fontSize: '0.8rem' }}>
                    {formError}
                </p>
            ) : null}
            <div style={{ marginTop: '0.5rem' }}>
                <Button
                    type="submit"
                    variant="primary"
                    block
                    loading={actionConfirm.composing}
                    disabled={!fromAddress || !price || !size || actionConfirm.composing}
                >
                    {singleEncode ? `Place ${side} order` : 'Review'}
                </Button>
            </div>
        </form>
    );
}

// Render a balance value with thousand separators and a sensible
// number of decimals. Caps at `divisibility` digits when supplied
// (defaults to 8, the native-coin precision); trailing zeros after
// the decimal point are trimmed so "1.00000000" reads as "1".
function formatQuantity(quantity, divisibility) {
    if (quantity == null || quantity === '') return '-';
    const raw = String(quantity).trim();
    if (!raw) return '-';
    const n = Number(raw);
    if (!Number.isFinite(n)) return raw;
    const maxFractionDigits = Number.isFinite(divisibility) && divisibility >= 0
        ? Math.min(20, Math.floor(divisibility))
        : 8;
    // Use toFixed to enforce a cap, then strip trailing zeros and a
    // dangling decimal point so whole amounts read cleanly.
    let str = n.toFixed(maxFractionDigits);
    if (str.includes('.')) {
        str = str.replace(/0+$/, '').replace(/\.$/, '');
    }
    return formatWithThousands(str);
}
