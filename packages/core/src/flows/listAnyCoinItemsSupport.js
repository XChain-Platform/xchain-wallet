// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Which coins' addresses an address LIST (TYPE=2) on this chain accepts.
//
// Once token-policy inheritance is active, the indexer takes a list item that
// is an address for ANY configured coin on the same network, not only the
// list's own coin. The wallet has no copy of that activation height, and a
// hand-copied height can drift from the chain's, which would sell the user an
// item the indexer then drops into list_items_invalid. So the explorer's own
// reading decides: /api/status publishes `list_any_coin_items` keyed by
// explorer coin code (`TBTC`, `RLTC`, ...). The chain's own flag must be
// exactly true, and the other coins are the ones the same status lists on the
// same network. Any failure, a missing flag or a flag that is not true answers
// [], which keeps the list on its own coin, the pre-activation rule.

import { explorerCoinCode } from '../registry/coinTicker.js';

// The coins whose addresses the wallet can validate (addressValidation.js).
const WALLET_COINS = ['bitcoin', 'litecoin', 'dogecoin'];
const STATUS_READ_CAP_MS = 10_000;

function withCap(promise, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('list item gate read timed out')), ms);
        promise.then(
            (value) => { clearTimeout(timer); resolve(value); },
            (error) => { clearTimeout(timer); reject(error); },
        );
    });
}

/**
 * The wallet coins (`bitcoin`, `litecoin`, ...) whose addresses a list on the
 * given chain may hold, read off an explorer status body. Empty unless the
 * chain's own flag is exactly true; never crosses networks, because each coin
 * is looked up under its code for THIS network kind.
 *
 * @param {any} status  /api/status body
 * @param {{ coin?: string, networkKind?: string }} chain
 * @returns {string[]}
 */
export function anyCoinItemCoins(status, chain) {
    const flags = status?.list_any_coin_items;
    if (!flags || typeof flags !== 'object') return [];
    const ownCode = explorerCoinCode(chain);
    if (!ownCode || flags[ownCode] !== true) return [];
    return WALLET_COINS.filter((coin) => coin === chain.coin
        || Object.prototype.hasOwnProperty.call(flags, explorerCoinCode({ coin, networkKind: chain.networkKind })));
}

/**
 * Read the explorer flag for `chainId` through its SDK's explorer client.
 *
 * @param {{ sdkRegistry: any, chainId: string, coin: string, networkKind: string }} params
 * @returns {Promise<string[]>} the coins a list item may belong to, or [] when the gate is off
 */
export async function listAnyCoinItemsSupport({ sdkRegistry, chainId, coin, networkKind }) {
    try {
        const explorer = sdkRegistry?.get(chainId)?.explorer;
        if (typeof explorer?.getStatus !== 'function') return [];
        const status = await withCap(Promise.resolve().then(() => explorer.getStatus()), STATUS_READ_CAP_MS);
        return anyCoinItemCoins(status, { coin, networkKind });
    } catch {
        return [];
    }
}
