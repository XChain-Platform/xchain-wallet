// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Which chains can ONLY pay a protocol fee in the native coin.
//
// The protocol fee is normally debited from an XCHAIN balance. Paying it with
// a native-coin output instead is an OPTION on Bitcoin and the ONLY option
// everywhere else. The consensus rule lives in the indexer
// (xchain-indexer/src/utility.js detectFeePaymentMode): with a FEE_DESTINATION
// configured, a fee-bearing action carrying no output to that address is
// 'xchain' (balance debit) on BTC and 'rejected' on every other coin, which
// the handlers report as `invalid: insufficient fee (native coin output
// required)`. LTC and DOGE always have a FEE_DESTINATION: the indexer refuses
// to start on those chains without one (src/config.js), precisely so no node
// can silently accept what a correctly-configured node rejects.
//
// So on LTC/DOGE the wallet cannot treat the native fee as an opt-in. A
// fee-bearing action composed with the flag off there is not "cheaper", it is
// guaranteed invalid: the transaction is broadcast, the miner fee is spent,
// and the action never indexes. Forms take the answer from here and force the
// flag on rather than offering a choice that does not exist.
//
// New protocol coins inherit "mandatory" automatically by being in the
// coinTicker map, because BTC's XCHAIN fallback is the exception, not the rule.

import { tickerForCoin, isProtocolCoinTicker } from './coinTicker.js';

/** The one coin that keeps an XCHAIN-balance fee lane as a fallback. */
const XCHAIN_FEE_LANE_TICKER = 'BTC';

/**
 * Normalize any way a caller identifies a chain into a native ticker.
 * Accepts a descriptor (`{ coin }`), a chain id ('litecoin-regtest'), a coin
 * id ('litecoin'), or a ticker ('LTC'); anything else yields ''.
 *
 * @param {{ coin?: string } | string | null | undefined} chainOrCoin
 * @returns {string}
 */
export function nativeFeeTickerFor(chainOrCoin) {
    if (!chainOrCoin) return '';
    if (typeof chainOrCoin === 'object') return tickerForCoin(chainOrCoin.coin);
    const s = String(chainOrCoin).trim();
    if (!s) return '';
    // A chain id is '<coin>-<network>'; a coin id or ticker has no dash.
    return tickerForCoin(s.includes('-') ? s.split('-')[0] : s);
}

/**
 * True when the protocol fee on this chain can only be paid with a native-coin
 * output, so the wallet must build one for every fee-bearing action.
 *
 * Unknown/custom chains answer false: the wallet applies no protocol fee rule
 * to a chain it does not recognize (those chains also hide the fee control).
 *
 * @param {{ coin?: string } | string | null | undefined} chainOrCoin
 *   descriptor, chain id, coin id, or native ticker
 * @returns {boolean}
 */
export function isNativeFeeMandatory(chainOrCoin) {
    const ticker = nativeFeeTickerFor(chainOrCoin);
    if (!isProtocolCoinTicker(ticker)) return false;
    return ticker !== XCHAIN_FEE_LANE_TICKER;
}

/**
 * The ticker to LABEL the fee control with, which is empty on any chain the
 * protocol does not run on. NativeFeeToggle renders nothing for an empty
 * ticker, so this is what keeps a user-added custom chain from being offered a
 * fee mode the protocol has no rule for.
 *
 * Same input shapes as `isNativeFeeMandatory`, so a form derives both from the
 * one value it already has (its chain id or descriptor).
 *
 * @param {{ coin?: string } | string | null | undefined} chainOrCoin
 * @returns {string}   'BTC' | 'LTC' | 'DOGE' | ''
 */
export function protocolCoinTickerFor(chainOrCoin) {
    const ticker = nativeFeeTickerFor(chainOrCoin);
    return isProtocolCoinTicker(ticker) ? ticker : '';
}
