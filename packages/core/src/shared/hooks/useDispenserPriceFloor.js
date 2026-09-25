// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The dispenser create form's dust-floor guard. A coin price under the chain's
// smallest relayable payment makes a dispenser that can only be bought from in
// bulk (see flows/dispenserDustFloor.js), so the plain coin lane refuses one and
// offers the bundle that keeps the unit price. A fiat price is converted at
// trigger time, so the most the form can do there is warn at today's rate.

import { useMemo } from 'react';
import { useFiatRate } from './useFiatRate.js';
import { fiatToCoin } from '../../flows/priceLookup.js';
import { dispenserPriceFloor, dispenserFloorBundle } from '../../flows/dispenserDustFloor.js';

// What the form pushes into its bottom error slot on Review, matched by
// identity so the form can retract it once the price is fixed.
export const PRICE_BELOW_FLOOR_ERROR =
    'The trigger price is below the smallest payment buyers can send. See the note under Trigger price.';

function belowFloorCopy(reading, price, ticker) {
    return `At ${price} ${ticker} per fill, nobody can buy a single fill: ${ticker} payments under `
        + `${reading.floor} ${ticker} are refused by every node, so the smallest purchase would be `
        + `${reading.minFills} fills (${reading.minPayment} ${ticker}). Set the trigger price to at least `
        + `${reading.floor} ${ticker}, or sell a bigger bundle per fill.`;
}

function fiatBelowFloorCopy(reading, coinAmount, fiatAmount, fiatCode, ticker) {
    return `At today's rate ${fiatAmount} ${fiatCode} is about ${coinAmount} ${ticker}, under the `
        + `${reading.floor} ${ticker} smallest payment the network carries, so buyers could only purchase `
        + `${reading.minFills} fills at a time. The rate moves, but consider a higher fiat amount or a `
        + 'bigger bundle per fill.';
}

/**
 * The form's price notes, as a pure function of its fields so it can be tested
 * without rendering. `block` refuses Review (plain coin lane only); `bundle` is
 * the one-click fix for it; `fiatWarning` is advisory.
 *
 * @param {object} args
 * @param {string | null | undefined} args.coin      chain-registry coin family
 * @param {string} args.coinTicker                   'DOGE' etc.
 * @param {'coin' | 'token'} args.payWith
 * @param {string} args.triggerPrice
 * @param {string} args.giveAmount
 * @param {string} args.fiatCode
 * @param {string} args.fiatAmount
 * @param {string} args.oracleAddress
 * @param {import('../../flows/priceLookup.js').FiatRate | null} [args.fiatRate]
 * @returns {{ block: string | null, bundle: { fills: number, giveAmount: string, getAmount: string } | null,
 *             fiatWarning: string | null }}
 */
export function dispenserPriceNotes(args) {
    const { coin, coinTicker, payWith, triggerPrice, giveAmount, fiatCode, fiatAmount, oracleAddress, fiatRate } = args;
    const notes = { block: null, bundle: null, fiatWarning: null };
    if (payWith !== 'coin') return notes;
    const fiat = String(fiatAmount || '').trim();
    const fiatLane = Boolean(fiatCode && fiat);
    if (!fiatLane && !String(oracleAddress || '').trim()) {
        const price = String(triggerPrice || '').trim();
        const reading = dispenserPriceFloor({ coin, getAmount: price });
        if (reading && reading.belowFloor) {
            notes.block = belowFloorCopy(reading, price, coinTicker);
            notes.bundle = dispenserFloorBundle({ coin, getAmount: price, giveAmount });
        }
        return notes;
    }
    if (fiatLane && fiatRate) {
        const coinAmount = fiatToCoin(fiat, fiatRate);
        const reading = dispenserPriceFloor({ coin, getAmount: coinAmount });
        if (reading && reading.belowFloor) {
            notes.fiatWarning = fiatBelowFloorCopy(reading, coinAmount, fiat, fiatCode, coinTicker);
        }
    }
    return notes;
}

/**
 * @param {Omit<Parameters<typeof dispenserPriceNotes>[0], 'fiatRate'> & { allowCoingeckoFallback?: boolean }} args
 */
export function useDispenserPriceFloor(args) {
    const { coin, coinTicker, payWith, triggerPrice, giveAmount, fiatCode, fiatAmount, oracleAddress } = args;
    const wantsRate = payWith === 'coin' && Boolean(fiatCode && String(fiatAmount || '').trim());
    const fiatRate = useFiatRate({
        chainCoin: wantsRate ? coin : null,
        fiatCurrency: fiatCode || 'USD',
        allowCoingeckoFallback: args.allowCoingeckoFallback !== false,
    });
    return useMemo(
        () => dispenserPriceNotes({
            coin, coinTicker, payWith, triggerPrice, giveAmount, fiatCode, fiatAmount, oracleAddress, fiatRate,
        }),
        [coin, coinTicker, payWith, triggerPrice, giveAmount, fiatCode, fiatAmount, oracleAddress, fiatRate],
    );
}
