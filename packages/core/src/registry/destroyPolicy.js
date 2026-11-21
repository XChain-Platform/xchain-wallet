// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { isProtocolCoinTicker, tickerForCoin } from './coinTicker.js';

export const GAS_TICK = 'XCHAIN';

/** Normalize a descriptor coin name or native ticker to its native ticker. */
function normalizeCoinTicker(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (isProtocolCoinTicker(raw)) return raw.toUpperCase();
    return tickerForCoin(raw.toLowerCase());
}

/** Return the origin and bare name for a bridged copy on this chain. */
export function parseBridgedTick(tick, localCoin) {
    const raw = String(tick || '').trim();
    const parts = raw.split('.');
    if (parts.length !== 2 || !parts[1]) return null;
    const origin = parts[0].toUpperCase();
    if (!isProtocolCoinTicker(origin)) return null;
    if (localCoin && origin === normalizeCoinTicker(localCoin)) return null;
    return { origin, name: parts[1] };
}

/** Explain why the indexer will unconditionally refuse this destroy. */
export function destroyRefusalFor({ tick, sourceCoin }) {
    const token = String(tick || '').trim();
    const coin = normalizeCoinTicker(sourceCoin);
    if (!token || !coin) return null;
    if (token.toUpperCase() === GAS_TICK && coin !== 'BTC') {
        return {
            rule: 'use-xbridge-v1',
            reason: 'XCHAIN cannot be destroyed on this network. Use Move to send it back to Bitcoin instead.',
        };
    }
    const bridged = parseBridgedTick(token, coin);
    if (bridged) {
        return {
            rule: 'use-xbridge-v4',
            reason: `${bridged.name} is a bridged copy. Use Move to send it back to ${bridged.origin} instead.`,
        };
    }
    return null;
}

/** Refuse any tick whose DESTROY action cannot be accepted on this chain. */
export function assertDestroyAllowedOnChain(chainRegistry, chainId, ticks, who) {
    const sourceCoin = chainRegistry?.get?.(chainId)?.coin;
    for (const tick of [].concat(ticks || [])) {
        const refusal = destroyRefusalFor({ tick, sourceCoin });
        if (refusal) throw new Error(`${who}: ${refusal.reason}`);
    }
}
