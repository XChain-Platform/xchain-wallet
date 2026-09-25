// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A coin-paid dispenser is triggered by a plain payment of GET_AMOUNT (or a
// multiple of it) to its address, and that payment is an ordinary output: one
// under the chain's dust floor is refused by every node. The indexer fills
// floor(paid / GET_AMOUNT) times, so a dispenser priced under the floor still
// works, but only in bulk: at 0.00001985 DOGE per fill against DOGE's 0.001
// floor, the smallest payment anyone can make buys 50 fills and nobody can buy
// one. Seen on Dogecoin testnet, where users opened exactly those dispensers.
//
// Both sides of the wallet ask the same question: the create form (is this
// price below the floor, and what bundle would clear it) and the buy panel
// (what is the fewest fills a buyer can pay for). All math is exact BigInt on
// the 8-dp coin grid, the grid GET_AMOUNT is written in.

import { dustThresholdForCoin } from '../sdk/nativeFeePreflight.js';

const SATS_PER_COIN = 100000000n;

// Plain decimal string -> BigInt sats on the 8-dp grid, or null. Digits past
// the eighth place are dropped, the same truncation the Send form applies.
function satsFromDecimal(raw) {
    const m = /^(\d*)(?:\.(\d+))?$/.exec(String(raw ?? '').trim());
    if (!m || (!m[1] && !m[2])) return null;
    const frac = (m[2] || '').slice(0, 8).padEnd(8, '0');
    return BigInt(m[1] || '0') * SATS_PER_COIN + BigInt(frac);
}

// BigInt sats -> plain decimal string without trailing zeros.
function decimalFromSats(sats) {
    const whole = (sats / SATS_PER_COIN).toString();
    const frac = (sats % SATS_PER_COIN).toString().padStart(8, '0').replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : whole;
}

// A token amount times a whole number, exact at whatever divisibility the
// amount was typed with (ticks carry up to 18 places, so the coin grid is the
// wrong tool here). Null for anything that is not a plain decimal.
function multiplyDecimal(raw, factor) {
    const m = /^(\d*)(?:\.(\d+))?$/.exec(String(raw ?? '').trim());
    if (!m || (!m[1] && !m[2])) return null;
    const fracDigits = (m[2] || '').length;
    const scaled = BigInt((m[1] || '0') + (m[2] || '')) * BigInt(factor);
    const digits = scaled.toString().padStart(fracDigits + 1, '0');
    if (!fracDigits) return digits;
    const whole = digits.slice(0, digits.length - fracDigits);
    const frac = digits.slice(digits.length - fracDigits).replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : whole;
}

/**
 * The dust-floor reading for a coin-paid dispenser price. Null when there is
 * nothing to judge: an unrecognized coin (null floor means "cannot judge", never
 * zero), or a price that is empty, malformed or zero (a zero GET_AMOUNT is a
 * FIAT-priced dispenser, priced at trigger time instead).
 *
 * @param {{ coin: string | null | undefined, getAmount: string | null | undefined }} args
 * @returns {{ floorSats: bigint, priceSats: bigint, belowFloor: boolean,
 *             minFills: number, floor: string, minPayment: string } | null}
 */
export function dispenserPriceFloor({ coin, getAmount }) {
    const floor = dustThresholdForCoin(coin);
    if (!floor) return null;
    const priceSats = satsFromDecimal(getAmount);
    if (priceSats === null || priceSats <= 0n) return null;
    const floorSats = BigInt(floor);
    const fills = (floorSats + priceSats - 1n) / priceSats;
    return {
        floorSats,
        priceSats,
        belowFloor: priceSats < floorSats,
        minFills: Number(fills),
        floor: decimalFromSats(floorSats),
        minPayment: decimalFromSats(fills * priceSats),
    };
}

/**
 * The bundle that keeps a below-floor dispenser's unit price but makes one fill
 * payable: GIVE_AMOUNT and GET_AMOUNT both scaled by the fewest fills whose
 * total clears the floor. Null when the price is not below the floor or the
 * give amount is not a plain positive decimal.
 *
 * @param {{ coin: string | null | undefined, getAmount: string, giveAmount: string }} args
 * @returns {{ fills: number, giveAmount: string, getAmount: string } | null}
 */
export function dispenserFloorBundle({ coin, getAmount, giveAmount }) {
    const reading = dispenserPriceFloor({ coin, getAmount });
    if (!reading || !reading.belowFloor) return null;
    const scaledGive = multiplyDecimal(giveAmount, reading.minFills);
    if (scaledGive === null || !/[1-9]/.test(scaledGive)) return null;
    return { fills: reading.minFills, giveAmount: scaledGive, getAmount: reading.minPayment };
}
