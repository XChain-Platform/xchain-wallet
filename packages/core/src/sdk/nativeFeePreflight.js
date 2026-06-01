// nativeFeePreflight — hard client-side guardrail for native-coin protocol fees.
//
// A protocol fee normally paid in the XCHAIN token can instead be paid in the native coin
// (BTC/LTC/DOGE) at the USD-equivalent, by adding an on-chain output to the chain's
// FEE_DESTINATION. Unlike an XCHAIN-balance fee (debited only when the action succeeds), a
// native-coin fee is a REAL on-chain payment that is FORFEITED if the action is rejected — no
// refund. So before we ever sign/broadcast a native-fee transaction we run the indexer's
// read-only pre-flight (`sdk.quoteNativeFee`, proxied through the explorer) and REFUSE to build
// one that can't be priced or sized correctly:
//   - supported === false → the indexer can't price this action's fee (client should pay in XCHAIN)
//   - valid === false      → the oracle price is missing/stale, or a proposed output is too small
// When the quote is good we size the FEE_DESTINATION output to `requiredFeeSats` so the on-chain
// check lands inside the tolerance band.
//
// Both build paths (submitWithSigner — sign+broadcast; buildActionPsbt — watcher/unsigned) call
// this single helper, so the guardrail covers every action surface.

/**
 * Thrown to refuse a native-coin-fee transaction that would forfeit the fee on-chain.
 * `reason` is 'unsupported' (indexer can't price it) or 'invalid' (stale price / bad sizing).
 */
export class NativeFeeForfeitError extends Error {
    /** @param {{ reason: 'unsupported' | 'invalid', quote: object | null }} fields */
    constructor({ reason, quote }) {
        const detail = (quote && quote.error) ? quote.error : reason;
        super(`native-coin fee pre-flight failed (${reason}): ${detail}`);
        this.name = 'NativeFeeForfeitError';
        this.reason = reason;
        this.quote = quote || null;
    }
}

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
export async function applyNativeFeePreflight({ sdk, actionData, encoderOpts = {}, source, onProgress } = {}) {
    if (!encoderOpts.payFeeInNativeCoin) return { encoderOpts, quote: null };
    if (!sdk || typeof sdk.quoteNativeFee !== 'function') {
        throw new Error('applyNativeFeePreflight: sdk.quoteNativeFee is unavailable');
    }

    if (typeof onProgress === 'function') onProgress('quoting_native_fee', {});

    const quote = await sdk.quoteNativeFee(actionData, { source });
    if (!quote || quote.supported === false) throw new NativeFeeForfeitError({ reason: 'unsupported', quote });
    if (quote.valid === false) throw new NativeFeeForfeitError({ reason: 'invalid', quote });

    const outs = Array.isArray(encoderOpts.customOutputs) ? encoderOpts.customOutputs.slice() : [];
    if (Number(quote.requiredFeeSats) > 0) {
        outs.push({ address: quote.feeDestination, value: Number(quote.requiredFeeSats) });
    }

    if (typeof onProgress === 'function') onProgress('native_fee_quoted', { quote });

    // Strip our own flag so it isn't forwarded to the encoder as an unknown param.
    const { payFeeInNativeCoin, ...rest } = encoderOpts;
    return { encoderOpts: { ...rest, customOutputs: outs }, quote };
}
