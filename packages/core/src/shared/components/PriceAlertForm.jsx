// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PriceAlertForm (§46). A compact "notify me when {coin} goes
// {above|below} {price}" form, shared by the Settings → Notifications
// manager and the native-coin TokenDetail "Set price alert" entry.
//
// Only native mainnet coins have price data (priceOracle's
// COINGECKO_SUPPORTED_CHAINS), so the coin selector lists just those. When
// `lockedChainId` is supplied (the TokenDetail entry already knows the
// coin) the selector is hidden. A soft warning appears when the target is
// already met given `currentPrice` (the alert is still valid, it'll just
// fire on the next check.

import { useMemo, useState } from 'react';
import { COINGECKO_SUPPORTED_CHAINS } from '../../flows/priceOracle.js';

const FIELD = {
    background: 'var(--xc-bg)',
    color: 'var(--xc-text)',
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-sm)',
    padding: 'var(--xc-space-1) var(--xc-space-2)',
    fontSize: 'var(--xc-text-sm)',
    fontFamily: 'inherit',
};
const PRIMARY_BTN = {
    background: 'var(--xc-accent, #3a7afe)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--xc-radius-sm)',
    padding: 'var(--xc-space-1) var(--xc-space-3)',
    fontSize: 'var(--xc-text-sm)',
    fontFamily: 'inherit',
    cursor: 'pointer',
};
const HINT = {
    color: 'var(--xc-text-muted)',
    fontSize: 'var(--xc-text-xs)',
    lineHeight: 1.3,
};

/** Native mainnet coins that have a price source. */
const MAINNET_PRICE_CHAINS = COINGECKO_SUPPORTED_CHAINS.filter((c) => c.endsWith('-mainnet'));

/** 'bitcoin-mainnet' → 'Bitcoin'. */
export function coinLabelForChain(chainId) {
    if (typeof chainId !== 'string' || !chainId) return String(chainId);
    const coin = chainId.split('-')[0];
    return coin ? coin.charAt(0).toUpperCase() + coin.slice(1) : chainId;
}

/**
 * @param {object} props
 * @param {(input: { chainId: string, direction: 'above'|'below', targetFiat: number, fiatCurrency: string }) => Promise<void> | void} props.onCreate
 * @param {string} [props.fiatCurrency]      display currency for the threshold (default 'usd')
 * @param {string} [props.lockedChainId]     when set, hides the coin selector and pins this coin
 * @param {number|null} [props.currentPrice] current spot price, drives the "already met" hint + prefill
 * @param {() => void} [props.onCancel]
 */
export function PriceAlertForm({ onCreate, fiatCurrency = 'usd', lockedChainId, currentPrice = null, onCancel }) {
    const cur = String(fiatCurrency || 'usd').toLowerCase();
    const [chainId, setChainId] = useState(lockedChainId || MAINNET_PRICE_CHAINS[0] || '');
    const [direction, setDirection] = useState('above');
    const [targetStr, setTargetStr] = useState(
        currentPrice != null && Number.isFinite(currentPrice) ? String(roundForInput(currentPrice)) : '',
    );
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState(/** @type {string|null} */ (null));

    const targetFiat = Number(targetStr);
    const valid = Boolean(chainId) && Number.isFinite(targetFiat) && targetFiat > 0;

    const alreadyMet = useMemo(() => {
        if (currentPrice == null || !Number.isFinite(currentPrice) || !valid) return false;
        return direction === 'above' ? currentPrice >= targetFiat : currentPrice <= targetFiat;
    }, [currentPrice, valid, direction, targetFiat]);

    const submit = async () => {
        if (!valid || busy) return;
        setBusy(true);
        setErr(null);
        try {
            await onCreate({ chainId, direction, targetFiat, fiatCurrency: cur });
            setTargetStr('');
        } catch (e) {
            setErr(e?.message || 'Could not save the alert');
        } finally {
            setBusy(false);
        }
    };

    const symbol = cur === 'usd' ? '$' : '';

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--xc-space-2)' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--xc-space-2)' }}>
                {lockedChainId ? (
                    <span style={{ fontWeight: 500 }}>{coinLabelForChain(lockedChainId)}</span>
                ) : (
                    <select
                        aria-label="Coin"
                        value={chainId}
                        onChange={(e) => setChainId(e.target.value)}
                        style={FIELD}
                    >
                        {MAINNET_PRICE_CHAINS.map((c) => (
                            <option key={c} value={c}>{coinLabelForChain(c)}</option>
                        ))}
                    </select>
                )}
                <select
                    aria-label="Direction"
                    value={direction}
                    onChange={(e) => setDirection(e.target.value)}
                    style={FIELD}
                >
                    <option value="above">rises above</option>
                    <option value="below">falls below</option>
                </select>
                <span aria-hidden="true">{symbol}</span>
                <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    aria-label="Target price"
                    placeholder="Price"
                    value={targetStr}
                    onChange={(e) => setTargetStr(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                    style={{ ...FIELD, width: 110 }}
                />
                {!cur || cur === 'usd' ? null : <span aria-hidden="true">{cur.toUpperCase()}</span>}
                <button type="button" onClick={submit} disabled={!valid || busy} style={{ ...PRIMARY_BTN, opacity: !valid || busy ? 0.5 : 1 }}>
                    {busy ? 'Adding…' : 'Add alert'}
                </button>
                {onCancel ? (
                    <button
                        type="button"
                        onClick={onCancel}
                        style={{ ...FIELD, cursor: 'pointer', background: 'transparent' }}
                    >
                        Cancel
                    </button>
                ) : null}
            </div>
            {alreadyMet ? (
                <span style={HINT}>
                    {coinLabelForChain(chainId)} is already {direction === 'above' ? 'above' : 'below'} that price.
                    This alert will fire on the next check.
                </span>
            ) : null}
            {err ? <span style={{ ...HINT, color: 'var(--xc-error, #c33)' }}>{err}</span> : null}
        </div>
    );
}

/** Keep prefilled targets readable: whole dollars for big prices, 2dp for small. */
function roundForInput(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return value;
    if (n >= 100) return Math.round(n);
    if (n >= 1) return Math.round(n * 100) / 100;
    return Math.round(n * 1e6) / 1e6;
}
