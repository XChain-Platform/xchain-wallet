// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Coin codes: the platform-wide short identifier that folds coin + network
// into a single token. Convention: BTC/LTC/DOGE for mainnet, T-prefix for
// testnet (TBTC/TLTC/TDOGE), R-prefix for regtest (RBTC/RLTC/RDOGE).
// Already used in explorer/encoder/hub URL paths and surfaced to users in
// the XChain platform UI; this module is the wallet's bridge between those
// short codes and the descriptor.id form ('bitcoin-mainnet' / etc.).
//
// Adding a chain means adding entries to the two maps below.

const TICKER_BY_COIN = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };
const NETWORK_PREFIX = { mainnet: '', testnet: 'T', regtest: 'R' };

const COIN_BY_TICKER = Object.fromEntries(
    Object.entries(TICKER_BY_COIN).map(([coin, ticker]) => [ticker, coin]),
);

/**
 * Resolve a chainId to its short coin code.
 *
 * @param {string} chainId         e.g. 'bitcoin-testnet'
 * @param {{ descriptorFor: (id: string) => any }} chainRegistry
 * @returns {string | null}         e.g. 'TBTC'; null if the chain isn't mapped
 */
export function coinCodeForChainId(chainId, chainRegistry) {
    if (!chainId || !chainRegistry) return null;
    const desc = chainRegistry.descriptorFor
        ? chainRegistry.descriptorFor(chainId)
        : chainRegistry.get?.(chainId);
    if (!desc) return null;
    const ticker = TICKER_BY_COIN[desc.coin];
    if (!ticker) return null;
    const prefix = NETWORK_PREFIX[desc.networkKind];
    if (prefix === undefined) return null;
    return prefix + ticker;
}

/**
 * Resolve a short coin code back to a chainId. Strips the T/R network
 * prefix only when the rest matches a known ticker so a non-standard
 * code like 'TRON' isn't accidentally parsed as testnet-RON.
 *
 * @param {string} code            e.g. 'TBTC'
 * @param {{ chainIdFor: (coin: string, networkKind: string) => string | null }} chainRegistry
 * @returns {string | null}         e.g. 'bitcoin-testnet'; null if unknown
 */
export function chainIdForCoinCode(code, chainRegistry) {
    if (typeof code !== 'string' || !chainRegistry?.chainIdFor) return null;
    const up = code.toUpperCase();
    let coin = null;
    let networkKind = null;
    if (COIN_BY_TICKER[up]) {
        coin = COIN_BY_TICKER[up];
        networkKind = 'mainnet';
    } else if (up.length > 1) {
        const prefix = up[0];
        const rest = up.slice(1);
        if (prefix === 'T' && COIN_BY_TICKER[rest]) {
            coin = COIN_BY_TICKER[rest];
            networkKind = 'testnet';
        } else if (prefix === 'R' && COIN_BY_TICKER[rest]) {
            coin = COIN_BY_TICKER[rest];
            networkKind = 'regtest';
        }
    }
    if (!coin || !networkKind) return null;
    return chainRegistry.chainIdFor(coin, networkKind);
}

/**
 * Cheap predicate used by parseXchainUri to decide between the new
 * `xchain:<CODE>/<action>` opaque form and the legacy BIP21-style
 * `xchain:<address>` form. Does NOT need the registry; it just checks
 * the code shape against the bundled coin set.
 *
 * @param {string} code
 * @returns {boolean}
 */
export function isKnownCoinCode(code) {
    if (typeof code !== 'string') return false;
    const up = code.toUpperCase();
    if (COIN_BY_TICKER[up]) return true;
    if (up.length > 1 && (up[0] === 'T' || up[0] === 'R') && COIN_BY_TICKER[up.slice(1)]) {
        return true;
    }
    return false;
}
