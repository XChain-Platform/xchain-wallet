// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

const COIN_DECIMALS = 8;
const COIN_SCALE = 100_000_000n;

export function selectedNetworkFee({ tiers, value, customEstimate } = {}) {
    const mode = value?.mode || 'normal';
    const estimate = mode === 'custom' ? customEstimate : tiers?.[mode];
    const amount = estimate?.coinAmount;
    return validDecimal(amount) ? String(amount) : null;
}

export function formatFeesTotal({
    coinTicker,
    networkFee,
    protocolXchain,
    protocolNativeSats,
    payInNative,
    fiatText,
} = {}) {
    const networkUnits = decimalToUnits(networkFee);
    const ticker = String(coinTicker || '').trim();
    if (networkUnits === null || !ticker) return null;

    let coinText;
    if (payInNative) {
        const nativeUnits = integerUnits(protocolNativeSats);
        if (nativeUnits === null) return null;
        coinText = `${unitsToDecimal(networkUnits + nativeUnits)} ${ticker}`;
    } else {
        if (!validDecimal(protocolXchain)) return null;
        const protocolText = trimDecimal(String(protocolXchain));
        coinText = `${unitsToDecimal(networkUnits)} ${ticker}`;
        if (/[1-9]/.test(protocolText)) coinText += ` + ${protocolText} XCHAIN`;
    }

    const fiat = typeof fiatText === 'string' ? fiatText.trim() : '';
    return fiat ? `${coinText} ${fiat}` : coinText;
}

export function formatCoinBaseUnits(value) {
    const units = integerUnits(value);
    return units === null ? null : unitsToDecimal(units);
}

function validDecimal(value) {
    return typeof value === 'string' || typeof value === 'number'
        ? /^\d+(\.\d+)?$/.test(String(value).trim())
        : false;
}

function decimalToUnits(value) {
    if (!validDecimal(value)) return null;
    const [whole, fraction = ''] = String(value).trim().split('.');
    if (fraction.length > COIN_DECIMALS) return null;
    return (BigInt(whole) * COIN_SCALE) + BigInt(fraction.padEnd(COIN_DECIMALS, '0'));
}

function integerUnits(value) {
    const text = String(value ?? '').trim();
    return /^\d+$/.test(text) ? BigInt(text) : null;
}

function unitsToDecimal(units) {
    const whole = units / COIN_SCALE;
    const fraction = String(units % COIN_SCALE).padStart(COIN_DECIMALS, '0');
    return trimDecimal(`${whole}.${fraction}`);
}

function trimDecimal(value) {
    return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
}
