// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-16 auto-pay decision policy. Pure functions only: every input is
// passed in, nothing here touches the network, the vault, or a clock,
// so the whole cap/timing surface is unit-testable byte-for-byte.
//
// Trust model (spec §PC-16): the counterparty payee, fill size, and
// ORDER_MATCH index cannot be derived from locally stored order terms,
// so auto-pay explicitly accepts indexer/API trust for those fields,
// bounded by the hard caps below, all denominated on the GIVE side of
// the consented order (auto-pay only ever arms on coin-GIVE orders):
//
//   1. depth gate: never act on a WS event or an unconfirmed match;
//      the match must be >= CONFIRM_DEPTH blocks deep, and the caller
//      re-reads the obligation fresh after depth is reached.
//   2. per-fill cap: the obligation's coin_amount must equal the
//      match's coin-side fill, and that fill must price out at or
//      under the consented GIVE/GET ratio (<= 1 base unit rounding
//      slack), and never exceed the remaining GIVE budget.
//   3. one payment per ORDER_MATCH, cumulative payments capped at the
//      order's total GIVE amount.
//   4. pre-sign re-check: the caller re-verifies pending + unexpired
//      immediately before signing (coinpayAction's verified preamble).
//
// Timing (spec-resolved numbers): broadcast as soon as depth is
// reached; a FIRST attempt is refused once inside ARMING_CUTOFF
// (45 min) of the deadline, and an already-attempted payment is not
// rebroadcast once inside RETRY_CUTOFF (30 min) - both degrade to the
// high-urgency manual notification, never to a silent skip. The
// deadline is wall-clock but its enforcement is block-gated
// (COINPAY_EXPIRE fires at the first block past it), so these margins
// deliberately budget for block cadence, not just wall time.
//
// Failure direction: this engine signs real coin unattended, so every
// ambiguous input fails toward NOT paying plus a manual notification -
// the exact opposite of the PC-15 display rule (which fails toward
// payability on display data). A human can still pay manually from
// the queue; an engine that pays on garbage cannot be un-paid.

import { AT_RISK_SECONDS, classifyObligation } from './obligationStatus.js';

/** First-attempt cutoff: no depth-confirmed match by T-45min => manual. */
export const ARMING_CUTOFF_SECONDS = 45 * 60;

/** Retry cutoff: no rebroadcasts inside T-30min (= the PC-15 at-risk band). */
export const RETRY_CUTOFF_SECONDS = AT_RISK_SECONDS;

/** Confirmations a match needs before auto-pay will act on it. */
export const DEFAULT_CONFIRM_DEPTH = 2;

// Per-chain overrides (spec: raise depth on high-reorg coins). All
// three launch chains currently share the default; the map exists so a
// raise is a one-line change with the policy tests pinning it.
const CONFIRM_DEPTH_BY_CHAIN = {};

/** Native-coin precision (BTC/LTC/DOGE base units per coin). */
const COIN_DECIMALS = 8n;
const COIN_SCALE = 10n ** COIN_DECIMALS;

/**
 * @param {string} chainId
 * @returns {number}
 */
export function confirmDepthForChain(chainId) {
    return CONFIRM_DEPTH_BY_CHAIN[chainId] ?? DEFAULT_CONFIRM_DEPTH;
}

/**
 * Exact decimal-string -> base-unit BigInt at coin scale (8dp).
 * Returns null on garbage or on more fractional digits than the coin
 * has (which would silently truncate value).
 *
 * @param {unknown} decimalStr
 * @returns {bigint | null}
 */
export function decimalToBaseUnits(decimalStr) {
    if (typeof decimalStr !== 'string') return null;
    const m = /^(\d+)(?:\.(\d+))?$/.exec(decimalStr.trim());
    if (!m) return null;
    const frac = m[2] ?? '';
    if (BigInt(frac.length) > COIN_DECIMALS) return null;
    return BigInt(m[1]) * COIN_SCALE + BigInt(frac.padEnd(8, '0') || '0');
}

/**
 * Scale two decimal strings to a common integer basis so ratios can be
 * cross-multiplied exactly (token decimals cancel out). Returns null
 * when either is not a plain decimal amount.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {{ a: bigint, b: bigint } | null}
 */
function toCommonScale(a, b) {
    const pa = typeof a === 'string' && /^(\d+)(?:\.(\d+))?$/.exec(a.trim());
    const pb = typeof b === 'string' && /^(\d+)(?:\.(\d+))?$/.exec(b.trim());
    if (!pa || !pb) return null;
    const fa = pa[2] ?? '';
    const fb = pb[2] ?? '';
    const k = Math.max(fa.length, fb.length);
    return {
        a: BigInt(pa[1] + fa.padEnd(k, '0')),
        b: BigInt(pb[1] + fb.padEnd(k, '0')),
    };
}

/**
 * Base units already auto-paid under a consent record.
 *
 * @param {import('../schemas/autopayOrder.js').AutopayOrder} consent
 * @returns {bigint}
 */
export function paidBase(consent) {
    let sum = 0n;
    for (const p of consent.payments ?? []) {
        if (typeof p?.coinAmountBase === 'string' && /^\d+$/.test(p.coinAmountBase)) {
            sum += BigInt(p.coinAmountBase);
        }
    }
    return sum;
}

/**
 * Remaining GIVE-side budget in base units (total minus payments).
 * Null when the stored total does not parse (a record that fails its
 * own schema shape must never authorize a payment).
 *
 * @param {import('../schemas/autopayOrder.js').AutopayOrder} consent
 * @returns {bigint | null}
 */
export function remainingGiveBase(consent) {
    const total = decimalToBaseUnits(consent.giveCoinAmount);
    if (total === null) return null;
    const left = total - paidBase(consent);
    return left > 0n ? left : 0n;
}

/**
 * Orient an explorer order_matches row against the consented order:
 * which side is mine (the coin side), and the two fill amounts.
 *
 * @param {object} matchRow   explorer order_matches row
 * @param {string} orderActionIndex  the consented order's action index
 * @returns {{ coinFill: string, tokenFill: string } | null}
 *          null when the row does not reference the order or lacks amounts
 */
export function orientMatch(matchRow, orderActionIndex) {
    if (!matchRow || !orderActionIndex) return null;
    const mine = String(orderActionIndex);
    const give = matchRow.give_action_index != null ? String(matchRow.give_action_index) : null;
    const get = matchRow.get_action_index != null ? String(matchRow.get_action_index) : null;
    let coinFill;
    let tokenFill;
    if (give === mine) {
        coinFill = matchRow.give_amount;
        tokenFill = matchRow.get_amount;
    } else if (get === mine) {
        coinFill = matchRow.get_amount;
        tokenFill = matchRow.give_amount;
    } else {
        return null;
    }
    if (typeof coinFill !== 'string' || coinFill.length === 0 ||
        typeof tokenFill !== 'string' || tokenFill.length === 0) {
        return null;
    }
    return { coinFill, tokenFill };
}

/**
 * The full pay/skip/notify decision for one pending obligation.
 *
 * The caller (CoinpayAutopayWatcher) is responsible for the I/O around
 * this: matching obligation -> consent, fetching the match row from
 * the obligation's block, reading the tip height, and - on 'pay' -
 * the reservation hold, the pre-sign re-verify, and the signer.
 *
 * @param {object} input
 * @param {object} input.obligation        explorer coinpay_obligations row
 * @param {import('../schemas/autopayOrder.js').AutopayOrder} input.consent
 * @param {object | null} input.matchRow   order_matches row for obligation.action_index (null = not fetched/found)
 * @param {number | null} input.tipHeight  current indexer tip for the chain
 * @param {number} input.nowSeconds
 * @param {boolean} input.alreadyAttempted a payment for this match was broadcast before (this session or in payments[])
 * @returns {{ action: 'pay' | 'wait' | 'skip' | 'notify-manual', reason: string, payAmountBase?: string }}
 */
export function evaluateObligation({
    obligation,
    consent,
    matchRow,
    tipHeight,
    nowSeconds,
    alreadyAttempted,
}) {
    if (!obligation || !consent) return { action: 'skip', reason: 'missing-input' };

    // Terminal / foreign states first: nothing to do, nothing to say.
    const status = obligation.coinpay_status ?? obligation.coinpayStatus;
    if (status !== 'pending_coinpay') {
        return { action: 'skip', reason: 'not-pending' };
    }
    if (consent.autopay !== true) {
        return { action: 'skip', reason: 'consent-revoked' };
    }

    const matchIndex = String(obligation.action_index ?? obligation.actionIndex ?? '');
    if (!matchIndex) return { action: 'notify-manual', reason: 'no-match-index' };
    const paidAlready = (consent.payments ?? []).some(
        (p) => String(p.orderMatchActionIndex) === matchIndex,
    );
    if (paidAlready) return { action: 'skip', reason: 'already-paid' };

    // Deadline. Unattended signing refuses rows with no usable deadline
    // (display-side PC-15 keeps them payable; see header note).
    const { state, secondsLeft } = classifyObligation(
        obligation.expiration, nowSeconds,
    );
    if (state === 'expired') return { action: 'skip', reason: 'expired' };
    if (secondsLeft === null) return { action: 'notify-manual', reason: 'no-deadline' };
    if (alreadyAttempted && secondsLeft <= RETRY_CUTOFF_SECONDS) {
        return { action: 'notify-manual', reason: 'past-retry-cutoff' };
    }
    if (!alreadyAttempted && secondsLeft <= ARMING_CUTOFF_SECONDS) {
        return { action: 'notify-manual', reason: 'past-arming-cutoff' };
    }

    // Depth gate: the match must be CONFIRM_DEPTH blocks deep. The
    // obligation was created in the match's block, so its block_index
    // is the match's block_index.
    const blockIndex = Number(obligation.block_index ?? obligation.blockIndex);
    if (!Number.isFinite(blockIndex) || blockIndex <= 0 ||
        !Number.isFinite(Number(tipHeight)) || Number(tipHeight) <= 0) {
        return { action: 'wait', reason: 'awaiting-depth' };
    }
    const depth = Number(tipHeight) - blockIndex + 1;
    if (depth < confirmDepthForChain(consent.chainId)) {
        return { action: 'wait', reason: 'awaiting-depth' };
    }

    // Cross-check against the order_matches row (trust-anchor cap 3).
    if (!matchRow) return { action: 'notify-manual', reason: 'match-unavailable' };
    if (String(matchRow.action_index) !== matchIndex) {
        return { action: 'notify-manual', reason: 'match-mismatch' };
    }
    if (matchRow.settlement_type !== 'coinpay') {
        return { action: 'notify-manual', reason: 'match-shape' };
    }
    if (typeof matchRow.status === 'string' && /^invalid/i.test(matchRow.status)) {
        return { action: 'skip', reason: 'match-invalid' };
    }
    if (!consent.orderActionIndex) {
        return { action: 'wait', reason: 'order-index-unresolved' };
    }
    const oriented = orientMatch(matchRow, consent.orderActionIndex);
    if (!oriented) {
        // Row doesn't reference the consented order, or the explorer
        // doesn't expose fill amounts (pre-PC-16 deployment): never pay
        // on unverifiable data.
        return { action: 'notify-manual', reason: 'amounts-unavailable' };
    }

    // Per-fill cap (cap 2): the obligation's coin_amount must equal the
    // match's coin-side fill exactly, and that fill must price out at
    // or under the consented GIVE/GET ratio.
    const owedBase = (() => {
        const s = String(obligation.coin_amount ?? obligation.coinAmount ?? '').trim();
        return /^\d+$/.test(s) ? BigInt(s) : null;
    })();
    const coinFillBase = decimalToBaseUnits(oriented.coinFill);
    if (owedBase === null || coinFillBase === null || owedBase !== coinFillBase) {
        return { action: 'notify-manual', reason: 'amount-mismatch' };
    }

    const giveTotalBase = decimalToBaseUnits(consent.giveCoinAmount);
    const scaled = toCommonScale(oriented.tokenFill, consent.getAmount);
    if (giveTotalBase === null || scaled === null || scaled.b === 0n) {
        return { action: 'notify-manual', reason: 'terms-unparseable' };
    }
    // expected = giveTotal * (tokenFill / getTotal), floored, +1 base
    // unit rounding slack for the indexer's own fill arithmetic.
    const expectedBase = (giveTotalBase * scaled.a) / scaled.b + 1n;
    if (coinFillBase > expectedBase) {
        return { action: 'notify-manual', reason: 'price-exceeds-terms' };
    }

    // Cumulative cap (cap 3): never push total payments past the
    // order's GIVE-side total.
    const remaining = remainingGiveBase(consent);
    if (remaining === null || coinFillBase > remaining) {
        return { action: 'notify-manual', reason: 'exceeds-give-budget' };
    }

    return { action: 'pay', reason: 'ok', payAmountBase: owedBase.toString() };
}

/**
 * Lease arbitration (pure part). A lease is live while renewed within
 * ttlMs; an expired or absent lease is claimable by anyone.
 *
 * @param {import('../schemas/autopayLease.js').AutopayLease | null | undefined} lease
 * @param {string} holderId  this engine instance's id
 * @param {number} nowMs
 * @param {number} ttlMs
 * @returns {'mine' | 'other-live' | 'claimable'}
 */
export function leaseState(lease, holderId, nowMs, ttlMs) {
    if (!lease || typeof lease.renewedAt !== 'string') return 'claimable';
    const renewed = Date.parse(lease.renewedAt);
    if (!Number.isFinite(renewed) || nowMs - renewed > ttlMs) return 'claimable';
    return lease.holderId === holderId ? 'mine' : 'other-live';
}
