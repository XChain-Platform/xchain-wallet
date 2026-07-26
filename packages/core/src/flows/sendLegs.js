// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// sendLegs (PC-52): the one place a SEND's recipient list is shaped, shared by
// every path that composes a SEND (sendToken, buildSendPsbt, and the host's
// action.composeForConfirm single-encode step). Three call sites built the wire
// params by hand before this, which is exactly how a multi-recipient send would
// have reached one of them and not the others.
//
// Wire background: SEND v1/v2/v3 repeat a per-leg field group (v1 repeats
// AMOUNT|DESTINATION under a shared TICK, v2 repeats TICK|AMOUNT|DESTINATION,
// v3 adds a per-leg MEMO). The SDK  expands a `LEGS` array positionally
// into that group and REFUSES a flat field map against a repeated format, so
// version choice belongs to the SDK selector and not here: hand it the legs and
// hoist anything every leg agrees on, and it picks the shortest format that can
// carry them (one leg => v0, byte-identical to the single-send this wallet has
// always emitted).
//
// What DOES belong here is refusing the combinations the rest of the send
// pipeline cannot honor. Two of them, both refused rather than half-supported:
//
//   Native coin. A "send" of BTC/LTC/DOGE carries no action at all : the
//   value moves in a real output built by nativePaymentOutput, which pays ONE
//   destination. Multi-recipient native payments are a customOutputs feature,
//   not a SEND-format feature, and nothing downstream (bare-payment detection,
//   the tamper matcher's expected-output set, the reservation ledger) is built
//   for a set of them yet.
//
//   Gated ticks. A gated tick's SEND is only valid inside BATCH(SEND, MESSAGE)
//   with a per-recipient ECIES key handoff (PC-26). prepareGatedSend composes
//   that for one recipient; the multi-recipient shape needs one handoff per
//   (recipient x pack) and has never been round-tripped, so a multi-leg send of
//   a gated tick is refused with the single-send path named as the way through.

import { tickerForCoin } from '../registry/coinTicker.js';
import { getGatedGroupsForSend } from './gatedSendGuard.js';

/*
 * Recipient cap. Not a protocol limit (the indexer parses any leg count) and
 * not an encoder limit: it is a wallet guardrail. Every leg past the first
 * pushes the action out of the 80-byte OP_RETURN lane into the multi-chunk
 * P2SH lane, where each recipient costs real fee, and the fan-out surfaces
 * (AIRDROP over a LIST, PC-10/PC-11) exist for anything larger.
 */
export const MAX_SEND_LEGS = 10;

/**
 * A multi-recipient send the wallet deliberately refuses to compose. Carries a
 * `code` so a form can react without matching on message text.
 */
export class MultiSendUnsupportedError extends Error {
    /**
     * @param {string} code
     * @param {string} message
     * @param {object} [detail]
     */
    constructor(code, message, detail = {}) {
        super(message);
        this.name = 'MultiSendUnsupportedError';
        this.code = code;
        Object.assign(this, detail);
    }
}

/**
 * @typedef {Object} SendLeg
 * @property {string} to        DESTINATION
 * @property {string} tick      TICK (or `^<id>`)
 * @property {string} amount    AMOUNT, plain decimal string
 * @property {string} [memo]    per-leg MEMO (v3); omitted when the leg has none
 */

/**
 * Shape a send request into its leg list.
 *
 * The flat `to`/`tick`/`amount`/`memo` call shape stays the single-leg case, so
 * every existing caller is unchanged. `legs` (when supplied) wins, with the
 * top-level `tick`/`memo` acting as the default for legs that omit them, which
 * is what lets the Send form carry one token choice across its recipient rows.
 *
 * @param {{ to?: string, tick?: string, amount?: string|number, memo?: string, legs?: any }} opts
 * @param {string} fnName   caller name, for error messages
 * @returns {{ legs: SendLeg[], isMulti: boolean }}
 */
export function normalizeSendLegs(opts, fnName = 'send') {
    const raw = opts?.legs;
    if (raw === undefined || raw === null) {
        return {
            legs: [singleLeg(opts, fnName)],
            isMulti: false,
        };
    }
    if (!Array.isArray(raw)) {
        throw new MultiSendUnsupportedError('INVALID_LEGS', `${fnName}: legs must be an array of recipients`);
    }
    if (raw.length === 0) {
        throw new MultiSendUnsupportedError('INVALID_LEGS', `${fnName}: legs must contain at least one recipient`);
    }
    if (raw.length > MAX_SEND_LEGS) {
        throw new MultiSendUnsupportedError(
            'TOO_MANY_LEGS',
            `${fnName}: a single send carries at most ${MAX_SEND_LEGS} recipients (got ${raw.length}). `
            + 'Use an airdrop for a larger distribution.',
            { legCount: raw.length, max: MAX_SEND_LEGS },
        );
    }
    const legs = raw.map((leg, i) => {
        if (!leg || typeof leg !== 'object' || Array.isArray(leg)) {
            throw new MultiSendUnsupportedError('INVALID_LEGS', `${fnName}: legs[${i}] must be a recipient object`);
        }
        return singleLeg(
            {
                to: leg.to,
                tick: leg.tick !== undefined && leg.tick !== null && String(leg.tick).trim() !== ''
                    ? leg.tick : opts?.tick,
                amount: leg.amount,
                memo: leg.memo !== undefined ? leg.memo : opts?.memo,
            },
            `${fnName}: legs[${i}]`,
        );
    });
    return { legs, isMulti: legs.length > 1 };
}

/**
 * Validate and trim one recipient. The required-field errors match the strings
 * the flat path already threw, so single-send callers see no change.
 *
 * @param {{ to?: string, tick?: string, amount?: string|number, memo?: string }} leg
 * @param {string} fnName
 * @returns {SendLeg}
 */
function singleLeg(leg, fnName) {
    if (!leg?.to) throw new Error(`${fnName}: to is required`);
    if (!leg?.tick) throw new Error(`${fnName}: tick is required`);
    if (leg.amount === undefined || leg.amount === null || String(leg.amount).trim() === '') {
        throw new Error(`${fnName}: amount is required`);
    }
    /** @type {SendLeg} */
    const out = {
        to: String(leg.to).trim(),
        tick: String(leg.tick).trim(),
        amount: String(leg.amount).trim(),
    };
    // An empty memo is the absence of a memo, not a memo of "": the serializer
    // would spend a wire slot on it and v3 would win over the shorter v1.
    if (leg.memo !== undefined && leg.memo !== null && String(leg.memo) !== '') {
        out.memo = String(leg.memo);
    }
    return out;
}

/**
 * Build the SEND action params for a leg list.
 *
 * One leg produces the flat map the wallet has always sent (no LEGS key), which
 * keeps single-send bytes identical. Two or more produce `LEGS`, with TICK and
 * MEMO hoisted to the top level when every leg agrees on them: the hoist is what
 * lets the SDK pick v1 (shared TICK, one shared MEMO) over the longer v2/v3, and
 * it matches the indexer, which applies a v1/v2 trailing MEMO to every leg.
 *
 * @param {SendLeg[]} legs
 * @returns {Record<string, any>}
 */
export function buildSendParams(legs) {
    if (!Array.isArray(legs) || legs.length === 0) {
        throw new MultiSendUnsupportedError('INVALID_LEGS', 'buildSendParams: legs must contain at least one recipient');
    }
    if (legs.length === 1) {
        const [leg] = legs;
        /** @type {Record<string, string>} */
        const params = { TICK: leg.tick, AMOUNT: leg.amount, DESTINATION: leg.to };
        if (leg.memo !== undefined) params.MEMO = leg.memo;
        return params;
    }

    const sharedTick = allAgree(legs.map((l) => l.tick));
    const sharedMemo = allAgree(legs.map((l) => (l.memo === undefined ? '' : l.memo)));

    /** @type {Record<string, any>} */
    const params = {};
    if (sharedTick !== null) params.TICK = sharedTick;
    if (sharedMemo !== null && sharedMemo !== '') params.MEMO = sharedMemo;
    params.LEGS = legs.map((leg) => {
        /** @type {Record<string, string>} */
        const entry = { AMOUNT: leg.amount, DESTINATION: leg.to };
        if (sharedTick === null) entry.TICK = leg.tick;
        if (sharedMemo === null) entry.MEMO = leg.memo === undefined ? '' : leg.memo;
        return entry;
    });
    return params;
}

/**
 * The one value every entry shares, or null when they differ.
 * @param {string[]} values
 * @returns {string | null}
 */
function allAgree(values) {
    const [first] = values;
    return values.every((v) => v === first) ? first : null;
}

/**
 * Refuse a multi-recipient send the pipeline cannot honor. Single-leg sends are
 * always allowed: this only guards what the LEGS path adds.
 *
 * @param {{ legs: SendLeg[], descriptor?: { coin?: string } | null }} args
 */
export function assertMultiSendSupported({ legs, descriptor }) {
    if (!Array.isArray(legs) || legs.length < 2) return;
    const nativeTicker = descriptor?.coin ? tickerForCoin(descriptor.coin) : null;
    if (!nativeTicker) return;
    const native = legs.filter((leg) => String(leg.tick).trim().toUpperCase() === nativeTicker);
    if (native.length === 0) return;
    throw new MultiSendUnsupportedError(
        'NATIVE_MULTI_SEND',
        `${nativeTicker} cannot be sent to several recipients in one transaction. `
        + `A ${nativeTicker} send pays a real output rather than writing an XChain action, `
        + 'so each recipient needs their own send.',
        { tick: nativeTicker },
    );
}

/**
 * Refuse a multi-recipient send of a token that has active gated content.
 *
 * Detection mirrors prepareGatedSend (same TTL-memoized group lookup, same
 * native / `^id` skips), so a tick that would compose as BATCH(SEND, MESSAGE)
 * on the single path is exactly the tick refused here. A detection failure
 * degrades to allowing the send, matching the guard's own policy: the indexer
 * rejects an unpaired gated send, so the failure mode is a rejected action
 * rather than stranded funds.
 *
 * @param {{
 *   sdkRegistry: object,
 *   chainRegistry: object,
 *   chainId: string,
 *   legs: SendLeg[],
 * }} args
 */
export async function assertNoGatedLegs({ sdkRegistry, chainRegistry, chainId, legs }) {
    if (!Array.isArray(legs) || legs.length < 2) return;
    const sdk = sdkRegistry?.get?.(chainId);
    if (!sdk?.gatedFile || !sdk?.messaging) return;
    const descriptor = chainRegistry?.get?.(chainId);
    const nativeTicker = descriptor?.coin ? tickerForCoin(descriptor.coin) : null;

    const ticks = [...new Set(legs.map((leg) => String(leg.tick).trim().toUpperCase()))]
        .filter((t) => t && t !== nativeTicker && !t.startsWith('^'));
    for (const tick of ticks) {
        let groups = [];
        try {
            groups = await getGatedGroupsForSend({ sdk, chainId, tick });
        } catch {
            continue;
        }
        if (groups.length > 0) {
            throw new MultiSendUnsupportedError(
                'GATED_MULTI_SEND',
                `${tick} has token-gated content, and each recipient needs their own unlock-key handoff. `
                + `Send ${tick} to one recipient at a time.`,
                { tick },
            );
        }
    }
}

/**
 * Human-readable summary for the pending-transaction record and the confirm
 * screens. Single leg keeps the wording the wallet already used.
 *
 * @param {SendLeg[]} legs
 * @returns {string}
 */
export function summarizeSendLegs(legs) {
    if (!Array.isArray(legs) || legs.length === 0) return 'Send';
    if (legs.length === 1) {
        const [leg] = legs;
        const memoTail = leg.memo ? ` (memo: "${leg.memo}")` : '';
        return `Send ${leg.amount} ${leg.tick} to ${leg.to}${memoTail}`;
    }
    /** @type {Map<string, string>} */
    const totals = new Map();
    for (const leg of legs) {
        const tick = leg.tick.toUpperCase();
        totals.set(tick, addDecimals(totals.get(tick) || '0', leg.amount));
    }
    const totalsText = [...totals.entries()].map(([tick, amount]) => `${amount} ${tick}`).join(', ');
    return `Send ${totalsText} to ${legs.length} recipients`;
}

/**
 * Per-tick totals for a leg list, as plain decimal strings. Used by the form to
 * check one balance per token and by the reservation descriptor.
 *
 * @param {SendLeg[]} legs
 * @returns {Array<{ tick: string, amount: string }>}
 */
export function totalsByTick(legs) {
    /** @type {Map<string, string>} */
    const totals = new Map();
    for (const leg of (Array.isArray(legs) ? legs : [])) {
        const tick = String(leg.tick).trim().toUpperCase();
        totals.set(tick, addDecimals(totals.get(tick) || '0', leg.amount));
    }
    return [...totals.entries()].map(([tick, amount]) => ({ tick, amount }));
}

/**
 * Exact addition of two plain decimals at the protocol's 8-decimal scale.
 * Float addition would drift on the large DOGE-scale amounts these totals reach,
 * and these numbers are shown next to a balance the user checks them against.
 *
 * @param {string} a
 * @param {string|number} b
 * @returns {string}
 */
function addDecimals(a, b) {
    const sa = satsOf(a);
    const sb = satsOf(b);
    if (sa === null || sb === null) return String(a);
    return decimalOf(sa + sb);
}

/** @param {string|number} raw @returns {bigint | null} */
function satsOf(raw) {
    const m = /^(\d*)(?:\.(\d+))?$/.exec(String(raw).trim());
    if (!m || (!m[1] && !m[2])) return null;
    const frac = (m[2] || '').slice(0, 8).padEnd(8, '0');
    return BigInt(m[1] || '0') * 100000000n + BigInt(frac);
}

/** @param {bigint} sats @returns {string} */
function decimalOf(sats) {
    const whole = sats / 100000000n;
    const frac = (sats % 100000000n).toString().padStart(8, '0').replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : String(whole);
}
