// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A protocol fee priced off the chain's published fee schedule (GET
// /{COIN}/api/feeschedule, sdk.getFeeSchedule), for an action whose fee is
// gas-schedule constants times counts the form already holds. Under
// UNIFIED_FEES the indexer charges gas x GAS_PRICE XCHAIN, truncated to 8
// places (utility/fees.js bcmul(gasCost, GAS_PRICE, 8)); the gas table and
// the gas price come from the venue, never from a copy in the wallet. When
// the schedule carries usable oracle prices, the native-coin figure is the
// band midpoint the live quote uses (fee x XCHAIN/USD / COIN/USD). Display
// only: review composes and quotes for real.

const SCALE = 18n;
const ONE = 10n ** SCALE;

/**
 * One GAS_SCHEDULE entry as an integer, or null when the schedule cannot
 * price it. The indexer refuses anything but a non-negative integer
 * (resolveGasScheduleCost), so a half-read table yields no figure at all.
 *
 * @param {*} schedule
 * @param {string} key
 * @returns {bigint | null}
 */
export function scheduleGas(schedule, key) {
    const table = isObject(schedule) ? schedule.gasSchedule : null;
    if (!isObject(table)) return null;
    const text = String(table[key] ?? '').trim();
    return /^\d+$/.test(text) ? BigInt(text) : null;
}

/**
 * The quote shape the Fees section reads (`xchainFee`, and `requiredFeeSats`
 * when the oracle prices are there) for a gas amount.
 *
 * @param {*} schedule
 * @param {bigint | null} gas
 * @returns {null | { xchainFee: string, requiredFeeSats?: number, scheduleEstimate: true }}
 */
export function feeForGas(schedule, gas) {
    if (!isObject(schedule) || typeof gas !== 'bigint' || gas < 0n) return null;
    const gasPrice = toScaled(schedule.gasPrice);
    if (gasPrice === null) return null;

    const fee = truncate(gas * gasPrice, 8n);
    const quote = { xchainFee: formatScaled(fee, 8), scheduleEstimate: /** @type {true} */ (true) };

    const prices = schedule.prices;
    if (prices && prices.available === true) {
        const xchainUsd = toScaled(prices.xchainUsd);
        const coinUsd = toScaled(prices.coinUsd);
        if (xchainUsd !== null && coinUsd !== null && coinUsd > 0n) {
            const native = (fee * xchainUsd) / coinUsd; // 18 dp
            const sats = (native * 100000000n + ONE / 2n) / ONE;
            quote.requiredFeeSats = Number(sats);
        }
    }
    return quote;
}

/**
 * A base-plus-per-item fee summed over one or more transactions, each paying
 * the base once and the per-item gas for its own item count:
 * sum(base + perItem x items) (getUnifiedBaseItemFee).
 *
 * @param {*} schedule
 * @param {{ baseKey: string, perItemKey?: string | null, items?: number[] }} spec
 */
export function baseItemFeeFromSchedule(schedule, { baseKey, perItemKey = null, items = [0] }) {
    const base = scheduleGas(schedule, baseKey);
    const perItem = perItemKey ? scheduleGas(schedule, perItemKey) : 0n;
    if (base === null || perItem === null) return null;
    const legs = Array.isArray(items) && items.length > 0 ? items : [0];
    let gas = 0n;
    for (const count of legs) {
        if (!Number.isSafeInteger(count) || count < 0) return null;
        gas += base + perItem * BigInt(count);
    }
    return feeForGas(schedule, gas);
}

function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// A non-negative decimal (string or number) as an integer at 18 dp, or null.
function toScaled(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
    if (!match) return null;
    const frac = (match[2] || '').slice(0, Number(SCALE)).padEnd(Number(SCALE), '0');
    return BigInt(match[1]) * ONE + BigInt(frac || '0');
}

function truncate(scaled, places) {
    const step = 10n ** (SCALE - places);
    return (scaled / step) * step;
}

function formatScaled(scaled, places) {
    const whole = scaled / ONE;
    const frac = (scaled % ONE).toString().padStart(Number(SCALE), '0').slice(0, places);
    return `${whole}.${frac}`;
}
