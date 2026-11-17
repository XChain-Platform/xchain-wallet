// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// What each pending COINPAY payment buys, for the Payments due list
// ("Buying 600 XCHAIN"), read in bulk.
//
// An obligation row names the match, payee, coin amount and deadline but not
// the token bought. The explorer's match list carries the two order indexes
// and both amounts but no ticks, and the payer's own order carries the ticks.
// So each payer address costs two list reads (its matches and its orders),
// whatever the number of payments due: the reads grow with the wallet's
// addresses, never with the rows on the page. CoinpayForm reads one match's
// action detail for the same answer; that is one read per row, which a list
// must not do.

import { obligationBaseUnits } from '../market/obligationStatus.js';
import { extractCoinpayRows } from './coinpayQueries.js';

/**
 * @typedef {{
 *   chainId: string,
 *   address: string,
 *   orderMatchActionIndex: string,
 *   coinAmount: unknown,
 *   coinTicker?: string,
 * }} MatchSideRequest
 *
 * @typedef {{ tick: string, amount: string, matchedAt: number | null }} MatchSide
 */

/** The answer's key for one payment. */
export function matchSideKey(chainId, orderMatchActionIndex) {
    return `${chainId}:${orderMatchActionIndex}`;
}

/**
 * The bought side of every listed payment.
 *
 * Answers an object keyed by matchSideKey. A payment whose match or order is
 * not on the read page, or whose coin side does not equal the amount owed,
 * answers null: the list then says so rather than show a guess. One failed
 * address answers null for its own payments only.
 *
 * @param {{ sdkRegistry: any, obligations: MatchSideRequest[] }} params
 * @returns {Promise<Record<string, MatchSide | null>>}
 */
export async function getCoinpayMatchSides({ sdkRegistry, obligations }) {
    if (!sdkRegistry) throw new Error('getCoinpayMatchSides: sdkRegistry is required');
    const list = Array.isArray(obligations) ? obligations : [];
    /** @type {Map<string, { chainId: string, address: string, items: MatchSideRequest[] }>} */
    const groups = new Map();
    for (const o of list) {
        if (!o || !o.chainId || !o.address || o.orderMatchActionIndex == null) continue;
        const id = `${o.chainId}\u0000${o.address}`;
        let g = groups.get(id);
        if (!g) {
            g = { chainId: o.chainId, address: o.address, items: [] };
            groups.set(id, g);
        }
        g.items.push(o);
    }
    /** @type {Record<string, MatchSide | null>} */
    const out = {};
    await Promise.all(Array.from(groups.values()).map(async (g) => {
        let matches = null;
        let orders = null;
        try {
            const sdk = sdkRegistry.get(g.chainId);
            const [m, o] = await Promise.all([
                sdk.getOrderMatches(g.address, 'address'),
                sdk.getOrders(g.address, 'address'),
            ]);
            matches = extractCoinpayRows(m);
            orders = extractCoinpayRows(o);
        } catch {
            matches = null;
        }
        for (const item of g.items) {
            out[matchSideKey(g.chainId, item.orderMatchActionIndex)] = matches && orders
                ? boughtSide(item, g.address, matches, orders)
                : null;
        }
    }));
    return out;
}

/**
 * The token side of one payment, from the match row and the payer's order.
 *
 * The match row's amounts belong to the order named by get_action_index (the
 * order that triggered the match; see autopayPolicy orientMatch), so the
 * payer's coin and token fills swap when the payer's order is the other one.
 */
function boughtSide(item, payer, matches, orders) {
    const index = String(item.orderMatchActionIndex);
    const match = matches.find((m) => String(m?.action_index ?? '') === index);
    if (!match) return null;
    const owed = obligationBaseUnits(item.coinAmount);
    if (owed === null) return null;
    const native = (tick) => {
        const text = String(tick ?? '').trim().toUpperCase();
        return text.length === 0 || (Boolean(item.coinTicker) && text === String(item.coinTicker).toUpperCase());
    };
    const sides = [
        { mine: String(match.get_action_index ?? ''), coin: match.give_amount, token: match.get_amount },
        { mine: String(match.give_action_index ?? ''), coin: match.get_amount, token: match.give_amount },
    ];
    for (const side of sides) {
        const order = orders.find((o) => String(o?.action_index ?? '') === side.mine
            && String(o?.source ?? '') === payer);
        if (!order) continue;
        // The payer's order gives the coin and gets the token it is buying.
        if (!native(order.give_tick) || native(order.get_tick)) continue;
        if (obligationBaseUnits(side.coin) !== owed) continue;
        const amount = String(side.token ?? '').trim();
        if (!/^\d+(\.\d+)?$/.test(amount) || !/[1-9]/.test(amount)) continue;
        const at = Number(match.timestamp);
        return {
            tick: String(order.get_tick).trim(),
            amount,
            matchedAt: Number.isFinite(at) && at > 0 && at < 10_000_000_000 ? at : null,
        };
    }
    return null;
}
