// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Coin-qualified token-list items: `COIN:tick` names a token on another coin's
// chain, a bare item means the list's own coin. The separator and the coin set
// mirror the SDK twin xchain-sdk/src/protocol/list_tick_coin.js.

export const LIST_TICK_COIN_SEPARATOR = ':';
export const LIST_TICK_COINS = ['BTC', 'LTC', 'DOGE'];

const COIN_REGISTRY_ROOT = { BTC: 'bitcoin', LTC: 'litecoin', DOGE: 'dogecoin' };
const CHAIN_ID_NETWORK = /^(?:bitcoin|litecoin|dogecoin)-(mainnet|testnet|regtest)$/;

/**
 * Split an item at its first colon. Returns the upper-cased coin and the rest
 * when the text before the colon is one of the list coins (any case), else null.
 *
 * @param {string} item
 * @returns {{ coin: string, rest: string } | null}
 */
export function splitTickCoinItem(item) {
    const text = String(item ?? '');
    const at = text.indexOf(LIST_TICK_COIN_SEPARATOR);
    if (at < 0) return null;
    const coin = text.slice(0, at).toUpperCase();
    if (!LIST_TICK_COINS.includes(coin)) return null;
    return { coin, rest: text.slice(at + 1) };
}

/**
 * The stored spelling of an item: bare on the list's own coin, else `COIN:rest`.
 *
 * @param {string} coin
 * @param {string} rest
 * @param {string} listCoin
 * @returns {string}
 */
export function qualifyTickItem(coin, rest, listCoin) {
    const c = String(coin ?? '').toUpperCase();
    if (c === String(listCoin ?? '').toUpperCase()) return rest;
    return `${c}${LIST_TICK_COIN_SEPARATOR}${rest}`;
}

/**
 * Registry chain id for a coin on the same network as `chainId`, e.g.
 * ('LTC', 'bitcoin-testnet') gives 'litecoin-testnet'. Null when the coin is
 * unknown or `chainId` has no network suffix.
 *
 * @param {string} coin
 * @param {string} chainId
 * @returns {string | null}
 */
export function chainIdForCoin(coin, chainId) {
    const root = COIN_REGISTRY_ROOT[String(coin ?? '').toUpperCase()];
    const network = CHAIN_ID_NETWORK.exec(String(chainId ?? ''))?.[1];
    return root && network ? `${root}-${network}` : null;
}
