// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// nativePayment (D-9): a "Send" of a chain's NATIVE coin (BTC/LTC/DOGE) is a
// real on-chain payment, not an XChain asset transfer. The SEND action string
// only writes an OP_RETURN; on its own it moves no value to the recipient (the
// indexer has no BTC ledger to credit). So for a native-coin send we ALSO emit
// a real destination output, passed to the encoder as a customOutput. The
// encoder folds customOutput values into its change math
// (XChainEncoder.js, "COINPay native coin payment outputs"), so change is sized
// correctly. Token sends are unaffected: this returns null and the caller
// changes nothing.

import { tickerForCoin } from '../registry/coinTicker.js';

/**
 * Base-unit (satoshi) integer, as a string, from a plain decimal amount.
 * 8-decimal fixed scale, BigInt-exact (no float round-trip). Mirrors
 * `exactSatsBigIntFromDecimalString` in shared/routes/Send.jsx; reimplemented
 * here so flows/ does not import a route module. Returns null when the input is
 * not a non-negative plain decimal.
 * @param {string | number} raw
 * @returns {string | null}
 */
function satsStringFromDecimal(raw) {
    const s = String(raw).trim();
    const m = /^(\d*)(?:\.(\d+))?$/.exec(s);
    if (!m || (!m[1] && !m[2])) return null;
    const frac = (m[2] || '').slice(0, 8).padEnd(8, '0');
    const sats = BigInt(m[1] || '0') * 100000000n + BigInt(frac);
    return sats.toString();
}

/**
 * When `tick` is the chain's native coin, return the destination payment output
 * to append to the encoder's customOutputs; otherwise null (a token send, which
 * settles via the OP_RETURN action and needs no native output).
 *
 * @param {object} args
 * @param {string} args.tick          the SEND asset ticker (e.g. 'BTC')
 * @param {string | number} args.amount   plain decimal amount in coin units
 * @param {string} args.destination   recipient address (paid the native output)
 * @param {{ coin?: string } | null | undefined} args.descriptor   chain descriptor
 * @returns {{ address: string, value: string } | null}
 */
export function nativePaymentOutput({ tick, amount, destination, descriptor }) {
    if (!descriptor?.coin || !tick || !destination) return null;
    const nativeTicker = tickerForCoin(descriptor.coin);
    if (String(tick).trim().toUpperCase() !== nativeTicker) return null;
    const value = satsStringFromDecimal(amount);
    // A native send with a non-positive / unparseable amount is not a payment;
    // let the normal validation path surface it rather than emitting a bad output.
    if (value === null || value === '0') return null;
    return { address: String(destination).trim(), value };
}
