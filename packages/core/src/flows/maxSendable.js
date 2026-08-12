// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// maxSendable: what "Max" is allowed to mean on a native-coin send.
//
// THE DEFECT THIS EXISTS FOR, measured on BTC regtest 2026-07-29 from an
// address holding exactly 50,000,000 sats: Max offered 49,998,500, the
// transaction paid 924 of network fee, and 576 satoshis stayed at the address
// the user had just been told they emptied. `onMax` subtracted a fee sized from
// a STATIC assumed vsize (250 vB in flows/feeEstimate.js) times the tier rate -
// 250 x 6 = 1500 - while the encoder charged for the transaction it actually
// built: 154 bytes x 6 = 924. The 576-sat difference is exactly one over-count,
// and it is stranded rather than sent.
//
// WHY IT CANNOT BE FIXED BY A BETTER CONSTANT. The fee depends on the number of
// inputs at that address, on each input's script type, on the destination's
// script type, and on every other output the compose pipeline adds (an ADS
// donation, a native-coin protocol fee). No number written down in the wallet
// tracks those. The only thing that knows the fee is the encoder, and the only
// question that gets an exact answer out of it is the one this module asks.
//
// HOW IT ASKS. It composes the REAL transaction - the same composeForConfirm
// pipeline the confirm modal uses, so every output the send will carry is
// present - but with the destination output set to the address's WHOLE utxo
// total. That transaction cannot balance by construction (the outputs alone
// consume every satoshi, leaving nothing for the fee), so the encoder refuses
// it with a typed INSUFFICIENT_FUNDS whose details carry the three numbers that
// settle the question:
//
//     available  the satoshis it selected (all of them: the break condition
//                `inputSatoshis > outputSatoshis + fee` can never be met)
//     outputs    every output's value, ours plus anything the pipeline added
//     fee        the fee IT would charge for a transaction of that exact shape
//
//   maxSendable = available - fee - (outputs - probe)
//
// and the send built from that amount has outputs + fee == inputs exactly, so
// the encoder's change math lands on zero and emits no change output at all.
// Nothing is left behind.
//
// WHY THE FAILING PROBE IS THE RIGHT SHAPE, and not a wart. A probe that
// SUCCEEDED would be worse in a way that matters: the encoder reserves the
// outpoints a successful build selected for five minutes and exposes no release
// (XChainEncoder.js, RESERVATION_TTL_MS - "the success path keeps its
// reservations on purpose"), so pricing Max with a build that works would lock
// the address against the very send Max is preparing. A build that THROWS hands
// every claim straight back. Pricing through the refusal is therefore
// the only round trip that leaves the address exactly as it found it.
//
// It also never invents a number: every path that cannot reach those three
// details returns null, and the caller keeps the static estimate it has always
// used. Being wrong by 576 sats in the direction of leaving money behind is a
// defect; guessing low would make Max unsendable, which is worse.
//
// WHAT THIS STILL DOES NOT COVER, stated because the bound is worth knowing.
// The probe forces the encoder to select every utxo (its break condition can
// never be met against an output that costs the whole balance), so it prices an
// n-input sweep. The real send selects greedily and stops as soon as the inputs
// cover the outputs plus the fee, which is the same n inputs UNLESS one of them
// is worth less than it costs to spend - about 68 bytes times the rate, so on
// Bitcoin only above roughly 8 sat/vB for a dust-floor utxo. In that corner the
// encoder leaves the uneconomical outpoint unspent and emits change, and a
// remainder survives the sweep. That is the encoder's coin selection declining
// to burn a user's money on a losing input, not the estimate being wrong, and
// no amount computed here can change it.

import { composeForConfirm } from './composeForConfirm.js';
import { tickerForCoin } from '../registry/coinTicker.js';

/** Encoder's machine-readable reason for "the outputs cost more than the inputs hold". */
const INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS';

/**
 * Satoshi count as an exact BigInt, whichever way the encoder serialized it.
 * `jsonSafeSat` emits a string past 2^53-1 and a number below it, so both
 * shapes are real; anything else (null, a float, a non-numeric string) is not
 * a satoshi count and is refused rather than coerced.
 *
 * @param {unknown} value
 * @returns {bigint | null}
 */
function exactSats(value) {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number') {
        return Number.isSafeInteger(value) ? BigInt(value) : null;
    }
    if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
        return BigInt(value.trim());
    }
    return null;
}

/**
 * Decimal string at the chain's 8-decimal scale for a satoshi count. The
 * compose path takes AMOUNT as coin-scale decimal text and converts back to
 * satoshis exactly, so this must be lossless.
 *
 * @param {bigint} sats
 * @returns {string}
 */
function coinDecimalFromSats(sats) {
    const whole = sats / 100000000n;
    const frac = (sats % 100000000n).toString().padStart(8, '0');
    return `${whole}.${frac}`;
}

/**
 * The encoder's INSUFFICIENT_FUNDS details, however the error reached us.
 *
 * The SDK wraps a JSON-RPC error as SDKEncoderError with the raw error object
 * on `details.rpcError` and its `data` payload also on `details.context`; the
 * encoder puts the reason and the numbers in that `data`. Both spellings are
 * read because only one of them is load-bearing in any given SDK version, and
 * a missed payload here silently degrades Max back to the defect.
 *
 * @param {unknown} err
 * @returns {{ available: bigint, outputs: bigint, fee: bigint } | null}
 */
export function insufficientFundsQuote(err) {
    if (!err || typeof err !== 'object') return null;
    const details = /** @type {any} */ (err).details;
    const candidates = [details?.context, details?.rpcError?.data, /** @type {any} */ (err).data];
    for (const data of candidates) {
        if (!data || typeof data !== 'object') continue;
        if (data.reason !== INSUFFICIENT_FUNDS) continue;
        const available = exactSats(data.available);
        const outputs = exactSats(data.outputs);
        const fee = exactSats(data.fee);
        if (available == null || outputs == null || fee == null) continue;
        if (available <= 0n || fee <= 0n || outputs <= 0n) continue;
        return { available, outputs, fee };
    }
    return null;
}

/**
 * @typedef {object} MaxSendableQuote
 * @property {string} maxSats     the amount Max should offer, in satoshis
 * @property {string} feeSats     the network fee the resulting send will pay
 * @property {string} inputSats   satoshis the encoder selected (its own utxo view, not the balance API's)
 * @property {string} otherOutputSats  value of outputs the pipeline adds besides the payment (ADS, protocol fee)
 * @property {'encoder-quote'} source
 */

/**
 * Price a "send everything at this address" transaction with the encoder that
 * will build it.
 *
 * Native-coin sends only: a token send moves a ledger balance and its Max is
 * the balance itself, with no fee to subtract.
 *
 * @param {object} args
 * @param {import('../sdk/SDKRegistry.js').SDKRegistry} args.sdkRegistry
 * @param {import('../registry/index.js').ChainRegistry} args.chainRegistry
 * @param {import('../storage/Vault.js').Vault} args.vault
 * @param {string} args.chainId
 * @param {string} args.source           the spending address
 * @param {string} args.destination      where the sweep pays; its script type is part of the price
 * @param {object} args.encoderOpts      pubkey/change/feePerKb/rbf, exactly as the real compose gets them
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<MaxSendableQuote | null>}   null when the encoder could not be made to answer
 */
export async function quoteMaxSendable({
    sdkRegistry, chainRegistry, vault, chainId, source, destination, encoderOpts, signal,
}) {
    const descriptor = chainRegistry?.get?.(chainId);
    const ticker = tickerForCoin(descriptor?.coin);
    if (!ticker) return null;
    if (typeof source !== 'string' || !source.trim()) return null;
    if (typeof destination !== 'string' || !destination.trim()) return null;

    const sdk = sdkRegistry.get(chainId);
    if (!sdk?.encoder) return null;

    // The probe's payment output has to be big enough that no prefix of the
    // input set can cover it, or the encoder stops selecting early and prices a
    // SMALLER transaction than the sweep will be - which would under-quote the
    // fee and make the send unbuildable. The address's own utxo total is the
    // smallest value guaranteed to do that, and it comes from the same tracker
    // the compose selects from.
    let utxoTotal;
    try {
        const res = await sdk.encoder.getUTXOs(source.trim());
        const rows = Array.isArray(res) ? res : (Array.isArray(res?.utxos) ? res.utxos : null);
        if (!rows || rows.length === 0) return null;
        utxoTotal = 0n;
        for (const row of rows) {
            const value = exactSats(row?.value);
            if (value == null || value < 0n) return null;
            utxoTotal += value;
        }
    } catch {
        return null;
    }
    if (utxoTotal <= 0n) return null;

    const probeSats = utxoTotal;
    const actionData = {
        action: 'SEND',
        params: {
            TICK: ticker,
            AMOUNT: coinDecimalFromSats(probeSats),
            DESTINATION: destination.trim(),
        },
    };

    let quote = null;
    try {
        await composeForConfirm({
            sdkRegistry, chainRegistry, vault, chainId, actionData, encoderOpts,
            source: source.trim(), signal,
        });
        // It BUILT a transaction that pays out every satoshi the address holds
        // and still affords a fee. That cannot be true, so something about this
        // probe is not what this module thinks it is; say nothing rather than
        // derive an amount from a premise that just failed.
        return null;
    } catch (err) {
        quote = insufficientFundsQuote(err);
    }
    if (!quote) return null;

    // Outputs the pipeline added on top of the payment (an ADS donation, a
    // native-coin protocol fee). They are paid out of the same coins, so the
    // sweep has to leave room for them too.
    const otherOutputs = quote.outputs - probeSats;
    if (otherOutputs < 0n) return null;

    const maxSats = quote.available - quote.fee - otherOutputs;
    if (maxSats <= 0n) return null;

    return {
        maxSats: maxSats.toString(),
        feeSats: quote.fee.toString(),
        inputSats: quote.available.toString(),
        otherOutputSats: otherOutputs.toString(),
        source: 'encoder-quote',
    };
}
