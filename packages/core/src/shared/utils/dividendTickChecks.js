// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// DIVIDEND pays holders of an XChain token named in TICK; the chain's own
// coin (BTC/LTC/DOGE) is not a token the protocol tracks holders of, and a
// TICK or DIVIDEND_TICK naming anything else the indexer has never issued
// gets the same refusal. Both are dead on arrival, so the form catches them
// before the confirm-time dry run has to say so in one generic sentence.

import { explorerCoinCode } from '../../registry/coinTicker.js';

/**
 * True when `tick` names the chain's own native coin rather than an
 * XChain token: its base ticker (DOGE) or this chain's network-prefixed
 * explorer form (TDOGE on testnet, RDOGE on regtest), since a tester off
 * mainnet may type either.
 *
 * @param {unknown} tick
 * @param {{ coinTicker: string, descriptor: object | null | undefined }} args
 * @returns {boolean}
 */
export function isNativeCoinTick(tick, { coinTicker, descriptor }) {
    const trimmed = String(tick ?? '').trim().toUpperCase();
    if (!trimmed || !coinTicker) return false;
    if (trimmed === coinTicker) return true;
    const networkForm = explorerCoinCode(descriptor);
    return Boolean(networkForm) && trimmed === networkForm;
}

/**
 * Inline copy for a TICK that names the chain's own coin: says what the
 * coin actually is and what DIVIDEND needs instead.
 *
 * @param {string} coinTicker   e.g. 'DOGE'
 * @param {string} coinName     e.g. 'Dogecoin'
 * @returns {string}
 */
export function nativeCoinTickMessage(coinTicker, coinName) {
    return `${coinTicker} is ${coinName} itself, not an XChain token. `
        + 'A dividend pays holders of an XChain token, so enter one of those.';
}

/**
 * Inline copy for a TICK or DIVIDEND_TICK that resolved to no token on
 * the selected chain.
 *
 * @param {string} tick
 * @param {string} chainName
 * @returns {string}
 */
export function unknownTickMessage(tick, chainName) {
    return `No token named ${tick} exists on ${chainName}.`;
}
