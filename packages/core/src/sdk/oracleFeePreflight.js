// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// oracleFeePreflight: compose the PRICE v1 oracle usage fee output for a Mode B dispenser.
//
// A dispenser that names an ORACLE_ADDRESS pays the oracle operator UP FRONT, as a real
// native-coin output inside the DISPENSER transaction itself, sized from the escrow the
// action adds (Counterparty parity):
//
//     oracle_fee = FEE x (oracle_price x GIVE_ESCROW) / validator_coin_price
//
// The indexer REJECTS the create or refill when that output is absent or short, so a
// wallet that composes a Mode B dispenser without it produces a transaction that is
// guaranteed to fail on chain while still burning the miner fee (and forfeiting any
// native-coin protocol fee output it also carried, which is never refunded). Hence a hard
// pre-flight rather than a best-effort hint.
//
// The amount is never computed client-side. `explorer.getOracleFeeQuote` is backed by the
// same indexer code path the consensus check calls, so an output sized from the quote is
// accepted by construction; recomputing it here would open a drift that shows up as either
// a rejected honest create or an underpaid oracle. Same reasoning as the native-fee quote.
//
// Two conditions produce no output at all, both of them normal:
//   - the oracle publishes FEE = 0 (the common case)
//   - the computed fee is below the chain's dust threshold
//
// Mode A dispensers (FIAT_CODE + FIAT_AMOUNT, no ORACLE_ADDRESS) are never charged: they
// read validator snapshots, and validators are compensated through the protocol fee. This
// helper is a no-op for them, and for every non-DISPENSER action.

/**
 * Thrown to refuse a Mode B dispenser whose oracle fee cannot be priced, because the
 * transaction would be rejected on chain with its costs already spent.
 * `reason` is 'unquotable' (the endpoint could not price it, e.g. the oracle has no
 * effective price) or 'unavailable' (no quote surface on this SDK).
 */
export class OracleFeeUnpayableError extends Error {
    /** @param {{ reason: 'unquotable' | 'unavailable', quote: object | null }} fields */
    constructor({ reason, quote }) {
        const detail = (quote && quote.error) ? quote.error : reason;
        super(`oracle usage fee pre-flight failed (${reason}): ${detail}`);
        this.name = 'OracleFeeUnpayableError';
        this.reason = reason;
        this.quote = quote || null;
    }
}

/**
 * User-facing note for the review/sign screen whenever an oracle fee rides along.
 */
export const ORACLE_FEE_NOTE =
    'This dispenser uses a paid price oracle. The oracle operator is paid once, now, from ' +
    'this transaction. The amount is set by the oracle and scales with the escrow you lock.';

// A Mode B dispenser create/refill is the only shape that owes the fee. v0 names the oracle
// in the payload; a v2 refill does not (it targets the dispenser by action index), so its
// caller passes the address it already knows via `encoderOpts.oracleFeeAddress`.
function resolveOracleContext(actionData, encoderOpts) {
    const action = String(actionData?.action || '').toUpperCase();
    if (action !== 'DISPENSER') return null;

    const p = actionData?.params || {};
    const escrow = String(p.GIVE_ESCROW ?? '').trim();
    if (!escrow || !(Number(escrow) > 0)) return null;

    const oracleAddress = String(p.ORACLE_ADDRESS || encoderOpts?.oracleFeeAddress || '').trim();
    if (!oracleAddress) return null;
    // A `^<id>` reference cannot be recognized by the decoder, so the fee output it pays
    // would be invisible and the create rejected as unpaid. The SDK is configured not to
    // compact this field; refuse rather than compose a transaction that cannot succeed.
    if (oracleAddress.charAt(0) === '^') {
        throw new OracleFeeUnpayableError({
            reason: 'unquotable',
            quote: { error: 'ORACLE_ADDRESS must be a full address, not a ^<id> reference' },
        });
    }

    return {
        oracleAddress,
        giveCoin:  String(p.GIVE_COIN  || encoderOpts?.oracleFeeGiveCoin  || '').trim() || undefined,
        giveTick:  String(p.GIVE_TICK  || encoderOpts?.oracleFeeGiveTick  || '').trim() || undefined,
        fiatCode:  String(p.FIAT_CODE  || encoderOpts?.oracleFeeFiatCode  || '').trim() || undefined,
        getCoin:   String(p.GET_COIN   || encoderOpts?.oracleFeeGetCoin   || '').trim() || undefined,
        giveEscrow: escrow,
    };
}

/**
 * @param {Object} opts
 * @param {import('./XChainSDK.js').XChainSDK} opts.sdk
 * @param {{ action: string, params: object }} opts.actionData
 * @param {object} [opts.encoderOpts]
 * @param {(phase: string, data: object) => void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ encoderOpts: object, oracleFeeQuote: object | null }>}
 *   For anything that is not a Mode B dispenser with escrow, returns the original
 *   encoderOpts and a null quote. Otherwise returns a COPY of encoderOpts with the oracle
 *   output appended to `customOutputs` (omitted when the fee is zero or below dust), plus
 *   the quote for display. Throws OracleFeeUnpayableError when it cannot be priced.
 */
export async function applyOracleFeePreflight({ sdk, actionData, encoderOpts = {}, onProgress, signal } = {}) {
    const ctx = resolveOracleContext(actionData, encoderOpts);
    // Strip our own hint fields either way, so they are never forwarded to the encoder as
    // unknown params.
    const { oracleFeeAddress, oracleFeeGiveCoin, oracleFeeGiveTick, oracleFeeFiatCode,
            oracleFeeGetCoin, ...rest } = encoderOpts;
    if (!ctx) return { encoderOpts, oracleFeeQuote: null };

    const explorer = sdk?.explorer;
    if (!explorer || typeof explorer.getOracleFeeQuote !== 'function') {
        throw new OracleFeeUnpayableError({ reason: 'unavailable', quote: null });
    }
    if (signal && signal.aborted) throw new Error('aborted');

    if (typeof onProgress === 'function') onProgress('quoting_oracle_fee', {});

    const quote = await explorer.getOracleFeeQuote({
        oracleAddress: ctx.oracleAddress,
        giveCoin:      ctx.giveCoin,
        giveTick:      ctx.giveTick,
        fiatCode:      ctx.fiatCode,
        getCoin:       ctx.getCoin,
        giveEscrow:    ctx.giveEscrow,
    });
    if (!quote || quote.valid === false) {
        throw new OracleFeeUnpayableError({ reason: 'unquotable', quote: quote || null });
    }

    const outs = Array.isArray(rest.customOutputs) ? rest.customOutputs.slice() : [];
    const sats = Number(quote.requiredFeeSats);
    if (!quote.belowDust && sats > 0) {
        outs.push({ address: quote.oracleAddress || ctx.oracleAddress, value: sats });
    }

    if (typeof onProgress === 'function') onProgress('oracle_fee_quoted', { quote });

    return { encoderOpts: { ...rest, customOutputs: outs }, oracleFeeQuote: quote };
}
