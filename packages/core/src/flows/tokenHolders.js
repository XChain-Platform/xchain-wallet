// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// tokenHolders (PC-03): a holder-distribution summary over
// `sdk.getHolders(tick)`, backing two callback surfaces:
//
//   1. The ISSUE v4 config editor's editability gate. The indexer only
//      permits CALLBACK_BLOCK/TICK/AMOUNT edits while supply is
//      UNDISTRIBUTED (issue.js "(supply distributed)"), and defines
//      distributed as >1 holder OR a single non-owner holder
//      (db.js isDistributed). We mirror that exactly so the form can
//      disable the fields with an honest reason before the user signs.
//
//   2. The CALLBACK execution preview. CALLBACK force-recalls all
//      supply and pays every non-owner holder CALLBACK_AMOUNT of
//      CALLBACK_TICK per unit held (callback.js). The owner must hold
//      the summed CALLBACK_TICK cost, and the protocol fee scales with
//      holder count, so the preview shows the live count + total payout
//      with the dust-split griefing caveat.
//
// Indicative only: the holder set can change between this read and the
// CALLBACK confirming (holders can dust-split to inflate the recall
// cost), which the preview copy states.

/**
 * Multiply two non-negative decimal strings and floor to `decimals`
 * places, matching the indexer's bcmulfloor (callback.js). BigInt-exact:
 * scales each operand to an integer by its own fractional width, then
 * places the decimal. Returns a plain decimal string.
 *
 * @param {string} a
 * @param {string} b
 * @param {number} decimals
 * @returns {string}
 */
export function mulFloorDecimal(a, b, decimals) {
    const pa = parseDecimal(a);
    const pb = parseDecimal(b);
    if (pa == null || pb == null) return '0';
    const scale = pa.frac + pb.frac;
    const product = pa.int * pb.int; // scaled by 10^scale
    const targetFrac = Math.max(0, Math.trunc(decimals) || 0);
    // Reduce the scaled integer to targetFrac fractional digits, flooring.
    let scaled = product;
    if (scale > targetFrac) {
        scaled = scaled / (10n ** BigInt(scale - targetFrac));
    } else if (scale < targetFrac) {
        scaled = scaled * (10n ** BigInt(targetFrac - scale));
    }
    return placeDecimal(scaled, targetFrac);
}

/**
 * Add two non-negative decimal strings exactly, keeping `decimals`
 * fractional places.
 * @param {string} a
 * @param {string} b
 * @param {number} decimals
 * @returns {string}
 */
export function addDecimal(a, b, decimals) {
    const targetFrac = Math.max(0, Math.trunc(decimals) || 0);
    const sa = toScaledInt(a, targetFrac);
    const sb = toScaledInt(b, targetFrac);
    if (sa == null || sb == null) return placeDecimal(sa ?? sb ?? 0n, targetFrac);
    return placeDecimal(sa + sb, targetFrac);
}

function parseDecimal(v) {
    const s = String(v == null ? '' : v).trim();
    const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
    if (!m) return null;
    const frac = m[2] || '';
    return { int: BigInt(m[1] + frac), frac: frac.length };
}

function toScaledInt(v, decimals) {
    const p = parseDecimal(v);
    if (p == null) return null;
    if (p.frac === decimals) return p.int;
    if (p.frac > decimals) return p.int / (10n ** BigInt(p.frac - decimals));
    return p.int * (10n ** BigInt(decimals - p.frac));
}

function placeDecimal(scaled, decimals) {
    const neg = scaled < 0n;
    let digits = (neg ? -scaled : scaled).toString();
    if (decimals === 0) return (neg ? '-' : '') + digits;
    digits = digits.padStart(decimals + 1, '0');
    const int = digits.slice(0, digits.length - decimals);
    const frac = digits.slice(digits.length - decimals).replace(/0+$/, '');
    return (neg ? '-' : '') + int + (frac ? '.' + frac : '');
}

function rowsOf(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.holders)) return resp.holders;
    return [];
}

/**
 * @typedef {Object} TokenHolderSummary
 * @property {number} holderCount            distinct holders with a positive balance (owner included)
 * @property {number} recipientCount         non-owner holders (the CALLBACK payout set, before allow/block filtering)
 * @property {boolean} isDistributed         mirrors the indexer: >1 holder, or one holder that is not the owner
 * @property {boolean} ownerHolds            the owner address appears in the holder set
 * @property {boolean} partial               the holder list was capped (count is a floor); the real count may be higher
 * @property {string | null} totalPayout     CALLBACK_TICK owed across all non-owner holders (null when no callbackAmount given)
 * @property {Array<{ address: string, amount: string }>} topHolders  a few largest holders for display
 */

/**
 * Summarize a token's holder distribution.
 *
 * @param {{
 *   sdkRegistry: import('../sdk/SDKRegistry.js').SDKRegistry,
 *   chainId: string,
 *   tick: string,
 *   owner?: string | null,
 *   callbackAmount?: string | null,     ISSUE v4 CALLBACK_AMOUNT (per-unit payout), for totalPayout
 *   callbackDecimals?: number,          CALLBACK_TICK decimals (floor precision), default 0
 *   limit?: number,
 * }} params
 * @returns {Promise<TokenHolderSummary>}
 */
export async function tokenHolderSummary({
    sdkRegistry, chainId, tick, owner = null, callbackAmount = null, callbackDecimals = 0, limit = 500,
}) {
    if (!sdkRegistry) throw new Error('tokenHolderSummary: sdkRegistry is required');
    if (!chainId) throw new Error('tokenHolderSummary: chainId is required');
    if (!tick) throw new Error('tokenHolderSummary: tick is required');
    const sdk = sdkRegistry.get(chainId);
    if (typeof sdk.getHolders !== 'function') {
        return {
            holderCount: 0, recipientCount: 0, isDistributed: false, ownerHolds: false,
            partial: false, totalPayout: callbackAmount != null ? '0' : null, topHolders: [],
        };
    }
    const cap = Math.max(1, Math.min(1000, Number(limit) || 500));
    const resp = await sdk.getHolders(String(tick).toUpperCase(), { limit: cap });
    const rows = rowsOf(resp)
        .map((r) => ({
            address: typeof r?.address === 'string' ? r.address : null,
            amount: r?.amount != null ? String(r.amount) : '0',
        }))
        .filter((r) => r.address && Number(r.amount) > 0);
    const total = Number(resp?.total);
    const ownerAddr = owner || null;

    let ownerHolds = false;
    let recipientCount = 0;
    let totalPayout = callbackAmount != null ? '0' : null;
    const cbDec = Math.max(0, Math.trunc(Number(callbackDecimals) || 0));
    for (const r of rows) {
        if (ownerAddr && r.address === ownerAddr) { ownerHolds = true; continue; }
        recipientCount += 1;
        if (callbackAmount != null && Number(callbackAmount) > 0) {
            const owed = mulFloorDecimal(r.amount, String(callbackAmount), cbDec);
            totalPayout = addDecimal(totalPayout || '0', owed, cbDec);
        }
    }

    const holderCount = Number.isFinite(total) && total > 0 ? total : rows.length;
    // Indexer isDistributed: more than one holder, OR one holder that is
    // not the owner. Computed off the fetched rows (the distribution gate
    // only matters pre-distribution, where the holder set is tiny).
    const nonOwnerHolders = rows.filter((r) => !ownerAddr || r.address !== ownerAddr).length;
    const isDistributed = rows.length > 1 || nonOwnerHolders > 0;
    const partial = rows.length >= cap || (Number.isFinite(total) && total > rows.length);

    return {
        holderCount,
        recipientCount,
        isDistributed,
        ownerHolds,
        partial,
        totalPayout,
        topHolders: rows.slice(0, 5),
    };
}
