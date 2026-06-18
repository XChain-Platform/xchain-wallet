// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Adapter: SDK `getBalances(address)` shape to simulator `BalanceLookup[]`.
//
// The explorer / SDK returns `{ native: { tick, divisibility, quantity },
// tokens: [{ tick, displayName, divisibility, quantity }] }` where every
// `quantity` is a string-encoded base-units integer (sats for BTC/LTC/DOGE,
// raw units for tokens). The §21.2 simulator wants decimal-string
// balances at human scale (`'0.05'` for 5,000,000 sats with divisibility
// 8) so before/after deltas read straight on the sign screen.
//
// Pure function with no I/O or SDK reference. Lives in `decoder/` because
// it pairs 1:1 with `simulateAction`'s input contract.

/**
 * @typedef {Object} SdkBalances
 * @property {{ tick?: string, divisibility?: number | string, quantity?: string | number } | null} [native]
 * @property {Array<{ tick?: string, divisibility?: number | string, quantity?: string | number }>} [tokens]
 */

/**
 * @param {SdkBalances | null | undefined} sdkBalances
 * @returns {import('./txSimulator.js').BalanceLookup[]}
 */
export function balancesFromSdk(sdkBalances) {
    /** @type {import('./txSimulator.js').BalanceLookup[]} */
    const out = [];
    if (!sdkBalances || typeof sdkBalances !== 'object') return out;

    const native = sdkBalances.native;
    if (native && typeof native === 'object') {
        const tick = String(native.tick || '').toUpperCase();
        if (tick) {
            out.push({
                tick,
                amount: scaleDown(native.quantity, native.divisibility),
                isCoin: true,
            });
        }
    }

    const tokens = Array.isArray(sdkBalances.tokens) ? sdkBalances.tokens : [];
    for (const a of tokens) {
        if (!a || typeof a !== 'object') continue;
        const tick = String(a.tick || '').toUpperCase();
        if (!tick) continue;
        out.push({
            tick,
            amount: scaleDown(a.quantity, a.divisibility),
            isCoin: false,
        });
    }

    return out;
}

/**
 * Scale a base-units string by `10^-divisibility`.
 *
 *   ('5000000', 8)   → '0.05'
 *   ('1234', 0)      → '1234'
 *   ('1', 8)         → '0.00000001'
 *   ('100', 2)       → '1'
 *
 * @param {string | number | null | undefined} qty
 * @param {number | string | null | undefined} divisibility
 * @returns {string}
 */
function scaleDown(qty, divisibility) {
    const div = Number(divisibility ?? 0) || 0;
    const raw = qty === null || qty === undefined ? '0' : String(qty).trim();
    if (raw === '' || raw === '0') return '0';
    if (div <= 0) return raw;

    const negative = raw.startsWith('-');
    const body = negative ? raw.slice(1) : raw;
    if (!/^\d+$/.test(body)) {
        // Already-decimal input: pass through verbatim, the simulator
        // accepts decimal strings.
        return raw;
    }
    const padded = body.padStart(div + 1, '0');
    const cut = padded.length - div;
    let whole = padded.slice(0, cut);
    let frac = padded.slice(cut);
    while (frac.endsWith('0')) frac = frac.slice(0, -1);
    const out = frac.length > 0 ? `${whole}.${frac}` : whole;
    return negative ? `-${out}` : out;
}
