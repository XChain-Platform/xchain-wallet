// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// nativeFeePreflight: hard client-side guardrail for native-coin protocol fees.
//
// A protocol fee normally paid in the XCHAIN token can instead be paid in the native coin
// (BTC/LTC/DOGE) at the USD-equivalent, by adding an on-chain output to the chain's
// FEE_DESTINATION. Unlike an XCHAIN-balance fee (debited only when the action succeeds), a
// native-coin fee is a REAL on-chain payment that is FORFEITED if the action is rejected (no
// refund). So before we ever sign/broadcast a native-fee transaction we run the indexer's
// read-only pre-flight (`sdk.quoteNativeFee`, proxied through the explorer) and REFUSE to build
// one that can't be priced or sized correctly:
//   - supported === false → the indexer can't price this action's fee (client should pay in XCHAIN)
//   - valid === false      → the oracle price is missing/stale, or a proposed output is too small
// When the quote is good we size the FEE_DESTINATION output to `requiredFeeSats` so the on-chain
// check lands inside the tolerance band.
//
// a later change added a THIRD answer, `valid === null` (`staticQuote:true, validated:false`): the VM
// actions (DEPLOY/EXECUTE) are priced from the indexer's gas schedule WITHOUT a dry-run, because
// the public pre-flight will not run caller-supplied VM code. The fee is authoritative, so the
// output can be sized and the transaction broadcast; what was never judged is whether the action
// ITSELF will be accepted. That is a payable answer, not a refusal, and it is the only way those
// two are payable at all on LTC/DOGE (no XCHAIN fee lane to fall back to). The forfeiture risk is
// real and unhedged there, so a form that submits on a null verdict must SAY so:
// NATIVE_FEE_UNVERIFIED_NOTICE is that sentence.
//
// Both build paths (submitWithSigner for sign+broadcast; buildActionPsbt for watcher/unsigned) call
// this single helper, so the guardrail covers every action surface.

/**
 * Thrown to refuse a native-coin-fee transaction that would forfeit the fee on-chain.
 * `reason` is 'unsupported' (indexer can't price it), 'invalid' (stale price / bad sizing),
 * or 'dust' (priced fine, but below the chain's dust threshold - see the check below).
 */
export class NativeFeeForfeitError extends Error {
    /** @param {{ reason: 'unsupported' | 'invalid' | 'dust', quote: object | null }} fields */
    constructor({ reason, quote }) {
        // The amount rides in the MESSAGE, not just in `quote`: a form in the popup receives
        // this error across the messaging boundary, which keeps only { name, message }, and
        // "too small to send" is a much weaker sentence when it cannot say how small.
        const detail = reason === 'dust' && quote && quote.requiredFeeNative
            ? `${quote.requiredFeeNative} is below the dust threshold`
            : (quote && quote.error) ? quote.error : reason;
        super(`native-coin fee pre-flight failed (${reason}): ${detail}`);
        this.name = 'NativeFeeForfeitError';
        this.reason = reason;
        this.quote = quote || null;
    }
}

/**
 * The sentence to show a user when a NativeFeeForfeitError stopped their submission.
 *
 * The advice depends on whether the chain HAS another fee lane. On Bitcoin the fee can
 * fall back to an XCHAIN balance, so "turn it off" is a real fix. On LTC/DOGE the native-coin
 * output is the only way to pay a protocol fee, so telling the user to turn it off would send
 * them to build a transaction the network rejects outright.
 *
 * @param {{ reason?: string } | null | undefined} err   the NativeFeeForfeitError
 * @param {{ coinTicker?: string, mandatory?: boolean }} [chain]
 * @returns {string}
 */
export function nativeFeeErrorMessage(err, { coinTicker, mandatory = false } = {}) {
    const coin = coinTicker || 'the native coin';
    const reason = forfeitReason(err);
    if (reason === 'dust') {
        const quoted = (err && err.quote && err.quote.requiredFeeNative)
            || dustAmountFromMessage(err);
        const amount = quoted ? ` (${quoted} ${coin})` : '';
        return mandatory
            ? `This action's protocol fee${amount} is too small to send as a ${coin} payment, and ${coin} is ` +
              `the only way to pay a protocol fee on this chain, so it cannot be submitted here.`
            : `This action's protocol fee${amount} is too small to send as a ${coin} payment - the network will ` +
              `not relay it. Turn off ${coin} fee payment to pay in XCHAIN instead.`;
    }
    if (reason === 'unsupported') {
        return mandatory
            ? `This action cannot be submitted on this chain: its protocol fee has no ${coin} price, ` +
              `and ${coin} is the only way to pay a protocol fee here.`
            : `Paying the protocol fee in ${coin} is not available for this action. Turn it off to pay in XCHAIN.`;
    }
    // `invalid` is two different situations wearing one name (see the class doc:
    // "stale price / bad sizing"). Only the price half is temporary. The indexer's own
    // verdict rides in the message, so read it back and let it decide: a rejection that
    // is not about price must not be reported as one, or the user is told to wait for a
    // feed that is working while the thing they could actually fix goes unmentioned.
    // Found live: a stake larger than the balance answered `invalid: insufficient funds
    // (AMOUNT)`, and the wallet said the LTC fee price was temporarily unavailable.
    const detail = invalidDetailFromMessage(err);
    // The USER-ORACLE verdicts have to be read before the price heuristic below,
    // because they are the one family that contains the words the heuristic looks
    // for while being neither temporary nor about the validator price feed
    // (D-146). `ORACLE_ADDRESS (no effective oracle price)` matched both "oracle"
    // and "price", so a Mode B dispenser pointed at a quote that has not matured
    // was reported as "the LTC fee price is temporarily unavailable. Try again in
    // a moment" - and a moment is 24 hours short.
    const oracleCopy = oracleVerdictMessage(detail, coin);
    if (oracleCopy) return oracleCopy;
    if (detail && !PRICE_REJECTION.test(detail)) {
        return `The network would refuse this action as it stands: ${detail}. Nothing was signed or ` +
               'sent. Waiting will not change this, so adjust the action and try again.';
    }
    return mandatory
        ? `The ${coin} fee price is temporarily unavailable. Try again in a moment.`
        : 'The native-coin fee price is temporarily unavailable. Try again in a moment, or turn off ' +
          'native-coin fee payment.';
}

// Whether an indexer verdict is about the price feed, which is the only part of the
// `invalid` bucket that a user fixes by waiting.
const PRICE_REJECTION = /price|oracle|stale/i;

/**
 * The sentence for an `ORACLE_ADDRESS (...)` verdict, or null when the verdict is
 * not one.
 *
 * These come from the oracle usage fee a Mode B dispenser owes its price
 * publisher, and they reach this function rather than oracleFeePreflight's own
 * error because the indexer's dry run performs that check too: on a chain where
 * the coin fee is the only lane, the native-fee quote refuses first and the
 * dedicated oracle pre-flight is never reached.
 *
 * Kept as an explicit table rather than a passthrough of the indexer's own words:
 * the verdict names a wire field and a stage, and each of the four has a different
 * remedy - one of which is "wait a day", one "wait a moment", and two "this wallet
 * built the transaction wrong".
 *
 * @param {string | null} detail   the indexer verdict, "invalid: " already stripped
 * @param {string} coin
 * @returns {string | null}
 */
function oracleVerdictMessage(detail, coin) {
    if (!detail || !/^ORACLE_ADDRESS\b/i.test(detail)) return null;
    if (/no effective oracle price/i.test(detail)) {
        return 'The price oracle this dispenser names has no price in effect yet. A published '
            + 'price starts pricing 24 hours after the block it lands in, so a quote published '
            + 'today cannot be used until tomorrow. Nothing was signed or sent.';
    }
    if (/no validator price/i.test(detail)) {
        return `The oracle's usage fee cannot be priced right now: the network has no current `
            + `${coin} rate to value it against. Nothing was signed or sent; try again in a moment.`;
    }
    if (/missing oracle fee output|insufficient oracle fee/i.test(detail)) {
        return 'This dispenser owes its price oracle a usage fee, and the amount this wallet '
            + 'attached does not satisfy the network. Nothing was signed or sent. Try again; if '
            + 'it keeps failing, the oracle repriced its fee mid-compose.';
    }
    return `The network would refuse this action as it stands: ${detail}. Nothing was signed or `
        + 'sent. Waiting will not change this, so adjust the action and try again.';
}

// The indexer's verdict, recovered from the message the constructor built. Same
// boundary-survival reason as dustAmountFromMessage: the popup receives only
// { name, message }, so `quote` is gone by the time a form renders this. The leading
// "invalid: " the indexer prefixes its own verdicts with is stripped, since the sentence
// around it already says the action was refused.
function invalidDetailFromMessage(err) {
    const m = /pre-flight failed \(invalid\): (.+)$/s.exec(String((err && err.message) || ''));
    if (!m) return null;
    const detail = m[1].trim().replace(/^invalid:\s*/i, '');
    return detail && detail !== 'invalid' ? detail : null;
}

// The refusal reason, read from the error however it reached us. A form running in the
// popup/extension gets this error back ACROSS the messaging boundary, whose envelope carries
// only `{ name, message }` (MessageHost.serializeError), so `err.reason` is undefined there and
// every refusal fell through to the "price is temporarily unavailable" default - including an
// unpriceable action, which is not temporary and is not about price. The constructor writes the
// reason into the message, so parse it back rather than adding a field the boundary would drop.
// The quoted amount the constructor wrote into a dust message, for the same
// boundary-survival reason `forfeitReason` parses the reason back out.
function dustAmountFromMessage(err) {
    const m = /\(dust\): ([0-9.]+) is below the dust threshold/.exec(String((err && err.message) || ''));
    return m ? m[1] : null;
}

function forfeitReason(err) {
    if (!err) return null;
    if (typeof err.reason === 'string' && err.reason) return err.reason;
    const m = /pre-flight failed \(([a-z]+)\)/.exec(String(err.message || ''));
    return m ? m[1] : null;
}

/**
 * The caveat a form must show when its action is priced WITHOUT a verdict (`valid:null`).
 *
 * DEPLOY and EXECUTE are the two actions in that class. Every other action's quote
 * carries an accept/reject verdict, so "the quote came back good" also means "the indexer would
 * have taken it"; for these two it only means "this is the amount". The fee is spent on
 * broadcast either way, so the difference is entirely the user's to price in, and hiding it
 * would read as a guarantee the pre-flight never gave.
 */
export const NATIVE_FEE_UNVERIFIED_NOTICE =
    'The amount is exact, but the network does not check contract actions in advance, so it '
    + 'cannot tell you beforehand whether this one will be accepted. If it is rejected, the fee '
    + 'is still spent.';

/**
 * User-facing warning to surface on the review/sign screen whenever native-coin fee mode is on.
 */
export const NATIVE_FEE_WARNING =
    'You are paying the network protocol fee in the native coin. If this transaction is rejected ' +
    'by the network, that fee is forfeited and will NOT be refunded.';

/**
 * @param {Object} opts
 * @param {import('./XChainSDK.js').XChainSDK} opts.sdk
 * @param {{ action: string, params: object }} opts.actionData
 * @param {import('./submitWithSigner.js').SubmitEncoderOpts} [opts.encoderOpts]
 * @param {string} [opts.source]   spender address (used by the indexer for the fee quote)
 * @param {(phase: string, data: object) => void} [opts.onProgress]
 * @returns {Promise<{ encoderOpts: object, quote: object | null }>}
 *   When `encoderOpts.payFeeInNativeCoin` is falsy, returns the original encoderOpts and a null
 *   quote. Otherwise returns a COPY of encoderOpts with the FEE_DESTINATION output appended (and
 *   the internal `payFeeInNativeCoin` flag stripped so it isn't forwarded to the encoder), plus
 *   the validated quote. Throws NativeFeeForfeitError when the action can't be safely paid natively.
 */
export async function applyNativeFeePreflight({ sdk, actionData, encoderOpts = {}, source, onProgress, signal } = {}) {
    if (!encoderOpts.payFeeInNativeCoin) return { encoderOpts, quote: null };
    if (!sdk || typeof sdk.quoteNativeFee !== 'function') {
        throw new Error('applyNativeFeePreflight: sdk.quoteNativeFee is unavailable');
    }
    if (signal && signal.aborted) throw new Error('aborted');

    if (typeof onProgress === 'function') onProgress('quoting_native_fee', {});

    // `signal` is forwarded when the SDK's quote method accepts it (the
    // compose-time quote can take seconds; Reject/close must be able to
    // abort it). Older SDKs ignore the extra option harmlessly.
    const quote = await sdk.quoteNativeFee(actionData, { source, signal });
    if (!quote || quote.supported === false) throw new NativeFeeForfeitError({ reason: 'unsupported', quote });
    if (quote.valid === false) throw new NativeFeeForfeitError({ reason: 'invalid', quote });

    // A quote can be perfectly valid and still unpayable: the fee scales with the action
    // (AIRDROP/DIVIDEND per recipient, BET per credit), so a small one prices BELOW the chain's
    // dust threshold - a DIVIDEND to a single holder quotes 2 sats on Bitcoin regtest. Attaching
    // that output builds a transaction every node rejects outright ("dust"), and unlike the
    // ORACLE fee (whose consensus check waives a below-dust amount, see oracleFeePreflight)
    // there is no waiver here: omitting the output fails the indexer's own check with
    // "no fee output to FEE_DESTINATION". So neither paying nor skipping works, and the only
    // honest answer is to refuse before signing and point at the XCHAIN lane.
    const feeSats = Number(quote.requiredFeeSats);
    const dustThreshold = resolveDustThreshold(sdk);
    if (feeSats > 0 && feeSats < dustThreshold) {
        throw new NativeFeeForfeitError({ reason: 'dust', quote });
    }

    const outs = Array.isArray(encoderOpts.customOutputs) ? encoderOpts.customOutputs.slice() : [];
    if (feeSats > 0) {
        outs.push({ address: quote.feeDestination, value: feeSats });
    }

    if (typeof onProgress === 'function') onProgress('native_fee_quoted', { quote });

    // Strip our own flag so it isn't forwarded to the encoder as an unknown param.
    const { payFeeInNativeCoin, ...rest } = encoderOpts;
    return { encoderOpts: { ...rest, customOutputs: outs }, quote };
}

// The dust floor per coin, in satoshis, mirroring xchain-sdk/src/coins/{BTC,LTC,DOGE}.js.
// It does not vary by network (mainnet, testnet and regtest all carry the same number),
// so the coin name alone determines it.
//
// This table is a COPY of the SDK's, and it exists because the popup has no SDK: the Send
// form has to answer "is this amount dust?" while the user is still typing, and reaching
// across the messaging boundary for a value that has not changed in the lifetime of any of
// these chains would buy nothing but a race. `resolveDustThreshold` below still prefers the
// SDK's live number wherever an SDK is in hand, so this only ever governs the UI-side check.
export const DUST_THRESHOLD_SATS_BY_COIN = Object.freeze({
    bitcoin: 546,
    litecoin: 5460,
    dogecoin: 100000,
});

/**
 * The dust floor in satoshis for a chain-registry coin name ('bitcoin' / 'litecoin' /
 * 'dogecoin'), or null for anything unrecognized. Null means "cannot judge", so a caller
 * must not treat it as zero and let an amount through unchecked.
 *
 * @param {string | null | undefined} coin
 * @returns {number | null}
 */
export function dustThresholdForCoin(coin) {
    const dust = DUST_THRESHOLD_SATS_BY_COIN[String(coin || '').toLowerCase()];
    return Number.isFinite(dust) ? dust : null;
}

// The chain's dust threshold, read from the SAME coin registry the SDK builds its
// addresses and PSBTs from, so the refusal above tracks the network the transaction is
// actually going to. Falls back to Bitcoin's floor when the SDK was constructed without a
// network: the guardrail must still fire on a 2-sat fee, and a too-low threshold would let
// exactly the doomed transaction through.
export function resolveDustThreshold(sdk) {
    try {
        const params = sdk && sdk.wallet && typeof sdk.wallet.getBitcoinNetwork === 'function'
            ? sdk.wallet.getBitcoinNetwork()
            : null;
        const dust = params && Number(params.dustThreshold);
        if (Number.isFinite(dust) && dust > 0) return dust;
    } catch { /* fall through to the default */ }
    return DUST_THRESHOLD_SATS_BY_COIN.bitcoin;
}
