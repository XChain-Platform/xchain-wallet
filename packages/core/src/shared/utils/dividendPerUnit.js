// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A DIVIDEND's AMOUNT is a RATE - dividend tokens paid per one
// unit of the holder-of token - so the wallet balance is the wrong
// DIMENSION for it, not merely the wrong quantity. Dropping the whole
// balance in (what the Max button used to do) proposes a payout of
// balance x total-units-held, which on a 500-unit token is 500x what the
// source address owns. The per-unit ceiling is balance / eligible units,
// floored to the dividend token's divisibility so the product can never
// round back above the balance.
//
// AIRDROP has the same shape and shares this math: its AMOUNT is per
// RECIPIENT, so the divisor is the recipient count instead of the units
// held, and Max had the identical whole-balance bug (same, found
// as the second half of E2E D-86). `perUnitMax` is written in terms of
// "balance / divisor", not dividends, for that reason.
//
// Balances and holder amounts arrive as pre-formatted decimal strings, so
// every step here is exact BigInt decimal math (same reasoning as
// utils/mintHeadroom.js: float division would hand back a rate whose
// product overshoots the balance by an ulp and fails preflight).

/**
 * Split a decimal string into a sign-carrying BigInt of its digits plus
 * the number of fractional places. Anything that isn't a plain decimal
 * (exponents, thousands separators, empty) reads as null, i.e. "unknown",
 * so a surprise shape disables Max instead of inventing a number.
 *
 * @param {unknown} value
 * @returns {{ digits: bigint, scale: number } | null}
 */
function parseDecimal(value) {
    if (value === null || value === undefined) return null;
    const raw = String(value).trim();
    if (!/^-?\d*(\.\d*)?$/.test(raw) || raw === '' || raw === '.' || raw === '-') return null;
    const negative = raw.startsWith('-');
    const body = negative ? raw.slice(1) : raw;
    const [intPart = '', fracPart = ''] = body.split('.');
    if (intPart === '' && fracPart === '') return null;
    const digits = BigInt(`${intPart || '0'}${fracPart}` || '0');
    return { digits: negative ? -digits : digits, scale: fracPart.length };
}

/** Render a scaled BigInt back to a plain decimal string. */
function render(digits, scale) {
    const negative = digits < 0n;
    const abs = (negative ? -digits : digits).toString().padStart(scale + 1, '0');
    const intPart = abs.slice(0, abs.length - scale);
    const fracPart = scale ? abs.slice(abs.length - scale).replace(/0+$/, '') : '';
    return `${negative ? '-' : ''}${intPart}${fracPart ? `.${fracPart}` : ''}`;
}

/**
 * Compare two decimal strings; null when either side is unparseable, so
 * callers can tell "not bigger" apart from "unknown".
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {-1 | 0 | 1 | null}
 */
export function compareDecimal(a, b) {
    const pa = parseDecimal(a);
    const pb = parseDecimal(b);
    if (!pa || !pb) return null;
    const scale = Math.max(pa.scale, pb.scale);
    const da = pa.digits * 10n ** BigInt(scale - pa.scale);
    const db = pb.digits * 10n ** BigInt(scale - pb.scale);
    if (da < db) return -1;
    if (da > db) return 1;
    return 0;
}

/**
 * Exact `a * b` as a decimal string. Null when either side is
 * unparseable.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {string | null}
 */
export function multiplyDecimal(a, b) {
    const pa = parseDecimal(a);
    const pb = parseDecimal(b);
    if (!pa || !pb) return null;
    return render(pa.digits * pb.digits, pa.scale + pb.scale);
}

/**
 * Total units held across a holder set. Null when ANY row's amount is
 * unreadable: an understated divisor would hand Max a rate that overpays,
 * which is the very defect this module exists to stop.
 *
 * @param {Array<{ amount?: unknown }> | null | undefined} rows
 * @returns {string | null}   '0' for an empty set
 */
export function sumHolderUnits(rows) {
    if (!Array.isArray(rows)) return null;
    let scale = 0;
    const parsed = [];
    for (const row of rows) {
        const p = parseDecimal(row?.amount);
        if (!p || p.digits < 0n) return null;
        parsed.push(p);
        if (p.scale > scale) scale = p.scale;
    }
    let total = 0n;
    for (const p of parsed) total += p.digits * 10n ** BigInt(scale - p.scale);
    return render(total, scale);
}

/**
 * The largest per-unit dividend rate this balance can actually pay.
 *
 * @param {object} args
 * @param {unknown} args.balance         source address's balance of the DIVIDEND token
 * @param {unknown} args.eligibleUnits   units of the holder-of token held by eligible holders
 * @param {number | null} [args.divisibility]  dividend token decimals (0-8); 8 when unknown
 * @returns {string | null}  decimal string, '0' when the balance cannot cover even the
 *                           smallest payable rate, null when either input is unknown or
 *                           there is nothing to divide by
 */
export function perUnitMax({ balance, eligibleUnits, divisibility = null } = {}) {
    const b = parseDecimal(balance);
    const u = parseDecimal(eligibleUnits);
    if (!b || !u || b.digits <= 0n || u.digits <= 0n) return null;
    const raw = Number(divisibility);
    // Null/absent divisibility means the explorer didn't say; 8 is the
    // protocol maximum, so it floors to the finest rate any token allows.
    const places = (divisibility !== null && divisibility !== undefined
        && Number.isFinite(raw) && raw >= 0)
        ? Math.min(8, Math.trunc(raw))
        : 8;
    // floor((balance / units) * 10^places), kept in integers throughout:
    //   balance = bDigits / 10^bScale, units = uDigits / 10^uScale
    const numerator = b.digits * 10n ** BigInt(u.scale + places);
    const denominator = u.digits * 10n ** BigInt(b.scale);
    return render(numerator / denominator, places);
}

/**
 * True when a projected total payout is strictly larger than the balance
 * backing it. False whenever either value is unknown, so an explorer
 * hiccup leaves the form ungated rather than blocking every dividend.
 *
 * @param {unknown} total
 * @param {unknown} balance
 * @returns {boolean}
 */
export function exceedsBalance(total, balance) {
    return compareDecimal(total, balance) === 1;
}
