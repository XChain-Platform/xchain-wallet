// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Tokens an address has locked in its own open offers. The explorer's balance
// read reports only FREE amounts and drops zero rows, so a token whose whole
// balance sits in a dispenser, order or swap vanished from Home: a TLTC user
// escrowed all 12 BEER in DISPENSER 18 and reported the token gone. The escrow
// is still theirs (closing the offer returns it), so Home shows it as such.
//
// Ownership offers escrow the ticker's ownership, not a balance, and are left
// out; so is any offer whose give side is not a token.

import { openOfferRows } from './sweepPreview.js';

// Exact decimal addition on plain decimal strings, at the wider of the two
// scales, so summing two offers of an 18-place tick never rounds. Exported for
// Home, which sums the same amounts across addresses.
export function addPlainDecimals(a, b) {
    const [aw, af = ''] = String(a).split('.');
    const [bw, bf = ''] = String(b).split('.');
    const scale = Math.max(af.length, bf.length);
    const sum = BigInt(aw + af.padEnd(scale, '0')) + BigInt(bw + bf.padEnd(scale, '0'));
    if (!scale) return sum.toString();
    const digits = sum.toString().padStart(scale + 1, '0');
    const frac = digits.slice(-scale).replace(/0+$/, '');
    const whole = digits.slice(0, -scale);
    return frac ? `${whole}.${frac}` : whole;
}

const PLAIN_POSITIVE = /^(?=.*[1-9])\d+(\.\d+)?$/;

function offerLegs(offers) {
    return [
        { kind: 'order', leg: offers.orders, amountOf: (r) => r.giveAmount, tickOf: (r) => r.giveTick },
        { kind: 'swap', leg: offers.swaps, amountOf: (r) => r.giveAmount, tickOf: (r) => r.giveTick },
        { kind: 'dispenser', leg: offers.dispensers, amountOf: (r) => r.escrowRemaining, tickOf: (r) => r.tick },
    ];
}

/**
 * Sum an address's open-offer escrow per tick.
 *
 * @param {{ orders: { rows: any[], error: string | null }, swaps: { rows: any[], error: string | null },
 *           dispensers: { rows: any[], error: string | null } }} offers   openOfferRows' result
 * @returns {{ rows: Array<{ tick: string, amount: string, offers: Record<string, number> }>, partial: boolean }}
 */
export function sumEscrowByTick(offers) {
    const byTick = new Map();
    let partial = false;
    for (const { kind, leg, amountOf, tickOf } of offerLegs(offers)) {
        if (leg.error) partial = true;
        for (const r of leg.rows) {
            const tick = tickOf(r);
            const amount = amountOf(r);
            if (r.giveOwnership || !tick || !PLAIN_POSITIVE.test(String(amount ?? ''))) continue;
            const acc = byTick.get(tick) || { tick, amount: '0', offers: {} };
            acc.amount = addPlainDecimals(acc.amount, amount);
            acc.offers[kind] = (acc.offers[kind] || 0) + 1;
            byTick.set(tick, acc);
        }
    }
    return { rows: [...byTick.values()], partial };
}

/**
 * @param {{ sdkRegistry: import('../sdk/SDKRegistry.js').SDKRegistry, chainId: string, address: string }} params
 * @returns {Promise<{ rows: Array<{ tick: string, amount: string, offers: Record<string, number> }>, partial: boolean }>}
 */
export async function escrowedTokens({ sdkRegistry, chainId, address }) {
    if (!sdkRegistry) throw new Error('escrowedTokens: sdkRegistry is required');
    if (!chainId) throw new Error('escrowedTokens: chainId is required');
    if (typeof address !== 'string' || address.trim().length === 0) return { rows: [], partial: false };
    const sdk = sdkRegistry.get(chainId);
    return sumEscrowByTick(await openOfferRows({ sdk, address }));
}
