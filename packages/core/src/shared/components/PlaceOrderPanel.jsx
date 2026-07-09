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
import { useMessaging } from '../useMessaging.js';
import { isHwSource, SignCredentials } from './SignCredentials.jsx';
import { buildBalanceRows } from './BalanceList.jsx';
import { formatWithThousands } from '../utils/amountFormat.js';
import { NativeFeeToggle } from './NativeFeeToggle.jsx';
import { NATIVE_FEE_WARNING } from '../../sdk/nativeFeePreflight.js';
import { preferredSourceId } from '../addressSelection.js';
import { estimateNativeSendFee } from '../../flows/feeEstimate.js';
import { multiplyAmounts } from '../../market/orderMath.js';

const chainRegistry = registryLib.defaultRegistry();

const PROTOCOL_COIN_TICKER = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };

const EXPIRATION_PRESETS = [
    { id: '1d', label: '1 day', blocks: 144 },
    { id: '1w', label: '1 week', blocks: 1008 },
    { id: '1m', label: '1 month', blocks: 4320 },
    { id: 'never', label: 'Never', blocks: 0 },
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
    const { messaging } = useMessaging();
    const [side, setSide] = useState(/** @type {'buy' | 'sell'} */ ('buy'));
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

    const [payFeeInNativeCoin, setPayFeeInNativeCoin] = useState(false);

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

    // Exact price × size as a plain-decimal string (never a float
    // artifact or scientific notation). This is both what the review
    // screen shows and what serialises into GIVE_AMOUNT / GET_AMOUNT, so
    // the two can never disagree. null when price or size isn't a
    // positive plain-decimal number.
    const total = useMemo(() => multiplyAmounts(price, size), [price, size]);

    const expirationBlocks = useMemo(() => {
        if (expirationId === 'custom') {
            const n = Number(customExpiration);
            if (!Number.isFinite(n) || n < 0) return null;
            return Math.floor(n);
        }
        const preset = EXPIRATION_PRESETS.find((e) => e.id === expirationId);
        return preset ? preset.blocks : null;
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
        const p = { VERSION: '0' };
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
        if (expirationBlocks != null) p.EXPIRATION = String(expirationBlocks);
        return p;
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
        if (expirationBlocks === null) {
            setFormError('Expiration must be a non-negative integer (blocks).');
            return;
        }
        setFormError(null);
        setSubmitError(null);
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
                if (err?.reason === 'unsupported') {
                    errorMessage = `Paying the protocol fee in ${coinTicker || 'the native coin'} is not available for this action. Turn it off to pay in XCHAIN.`;
                } else {
                    errorMessage = 'The native-coin fee price is temporarily unavailable. Try again in a moment, or turn off native-coin fee payment.';
                }
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
        const expirationLabel = expirationId === 'never'
            ? 'Never (perpetual)'
            : expirationId === 'custom'
                ? `${expirationBlocks} blocks`
                : (EXPIRATION_PRESETS.find((e) => e.id === expirationId)?.label ?? expirationId);

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
                    label="Custom expiration (blocks)"
                    value={customExpiration}
                    onChange={(e) => setCustomExpiration(e.target.value)}
                    inputMode="numeric"
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
            />
            {payFeeInNativeCoin ? (
                <p
                    role="alert"
                    style={{ margin: '0.5rem 0 0', color: 'var(--xc-text-muted)', fontSize: '0.75rem' }}
                >
                    {NATIVE_FEE_WARNING}
                </p>
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
                    disabled={!fromAddress || !price || !size}
                >
                    Review
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
