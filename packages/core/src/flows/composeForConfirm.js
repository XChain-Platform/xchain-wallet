// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Single-encode pipeline compose step ( §5.3.1).
//
// The load-bearing v3 fix: today submitWithSigner runs
// createAction -> encoder.createTx -> sign ATOMICALLY on Approve, so any
// modal preview would be a throwaway encode and the signed PSBT a
// rebuild (different UTXO selection, different fee). composeForConfirm
// hoists the whole build to BEFORE the modal opens:
//
//   createAction -> native-fee quote -> side-effect-free ADS plan ->
//   encoder.createTx
//
// It returns the exact PSBT the modal previews AND the checks run
// against; submitWithSigner then signs that PSBT byte-identically via
// its `prebuiltPsbt` option. The ADS accumulator is NOT advanced here
// (that stays a post-broadcast concern, §1 decision) - only the
// donation OUTPUT is resolved and folded into the PSBT.
//
// Runs PRE-OPEN (before any modal-open state flips): compose failures
// reject the confirm() promise unwrapped so each form's existing error
// rendering works unmodified (§5.6 migration keystone).

import { applyNativeFeePreflight } from '../sdk/nativeFeePreflight.js';
import { annotateEncoderFeeRequirement } from '../sdk/encoderErrors.js';
import { nativeFeeOutputOf, isChunkEncoding, withoutCustomOutput } from './nativeFeeLane.js';
import { applyOracleFeePreflight } from '../sdk/oracleFeePreflight.js';
import { applyAdsPlanToEncoderOpts } from './ads.js';
import { buildExpectedOutputs } from './confirmChecks.js';
import { isBareNativePayment, nativePaymentOutput } from './nativePayment.js';

// UTF-8 byte length of a string, portable across the host (Node) and any
// worker/browser build of core. Used to size the expected carrier-output count
// for chunk-lane encodings (D-24); the base64 CODE in a DEPLOY is ASCII, but a
// MEMO or FILE payload can be multi-byte, and undercounting would reject a
// legitimate deploy.
function byteLen(s) {
    const str = String(s);
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str).length;
    if (typeof Buffer !== 'undefined') return Buffer.byteLength(str, 'utf8');
    return str.length; // last-resort (ASCII-equivalent)
}

/**
 * @typedef {Object} ComposedAction
 * @property {string} actionString
 * @property {string} action
 * @property {number|string} version
 * @property {string} psbt                     the PSBT hex the modal previews and the signer signs
 * @property {string} encoding                 chosen by the encoder
 * @property {string[]} carrierScripts         P2SH/P2WSH redeem scripts create_tx committed to; [] off the chunk lanes
 * @property {object|null} quote               native-fee quote, when native-fee mode was active
 * @property {object} adsPlan                  resolved ADS plan (donationAmount / canSubmit / ...)
 * @property {ReturnType<typeof buildExpectedOutputs>} expectedOutputs
 * @property {object} encoderOpts              the FINAL encoderOpts used to build the PSBT (fee + ADS folded in)
 */

/**
 * @param {Object} args
 * @param {import('../sdk/SDKRegistry.js').SDKRegistry} args.sdkRegistry
 * @param {import('../registry/index.js').ChainRegistry} args.chainRegistry
 * @param {import('../storage/Vault.js').Vault} args.vault
 * @param {string} args.chainId
 * @param {{ action: string, params: object }} args.actionData
 * @param {object} args.encoderOpts            must include pubkey/change per the encoder contract
 * @param {string} [args.source]               spender address for the native-fee quote
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<ComposedAction>}
 */
export async function composeForConfirm({
    sdkRegistry, chainRegistry, vault, chainId, actionData, encoderOpts, source, signal,
}) {
    const descriptor = chainRegistry.get(chainId);
    if (!descriptor) throw new Error(`composeForConfirm: unknown chain "${chainId}"`);
    const sdk = sdkRegistry.get(chainId);
    if (!sdk.encoder) {
        throw new Error('composeForConfirm: SDK encoder not initialized; call sdkRegistry.initActive([chainId]) first');
    }

    // : a plain native-coin payment carries no XChain action at all, so
    // there is nothing to format, encode or cross-check. It used to compose a
    // SEND the indexer could only ever reject (no native token exists), which
    // cost an output on every send and, once the pre-flight dry-run became
    // reachable, blocked Approve behind a "Sign anyway" override.
    const bareNativePayment = isBareNativePayment(actionData, descriptor);

    // 1. Action string (pure formatting, no network). None for a bare payment.
    const createResult = bareNativePayment ? null : sdk.actions.createAction(actionData);

    // 2. Native-coin fee pre-flight (folds the FEE_DESTINATION output into
    // customOutputs when payFeeInNativeCoin is set; throws NativeFeeForfeitError
    // when the action can't be safely priced). No-op otherwise.
    const feePreflight = await applyNativeFeePreflight({
        sdk, actionData, encoderOpts, source, signal,
    });

    // 2b. PRICE v1 oracle usage fee : a Mode B dispenser pays its oracle
    // operator up front as a real output, and the indexer rejects the create when
    // that output is absent or short. Folded in BEFORE the tamper matcher below so
    // it is inside the previewed and signed PSBT like every other output. No-op for
    // Mode A, for a zero/dust fee, and for every non-DISPENSER action.
    const oraclePreflight = await applyOracleFeePreflight({
        sdk, actionData, encoderOpts: feePreflight.encoderOpts, signal,
    });

    // 3. ADS plan resolution, side-effect-free: fold the donation output
    // into customOutputs now (pre-modal) so it is inside the previewed and
    // signed PSBT. The accumulator advances only on broadcast success.
    const settingsSnapshot = await vault.settings.get();
    const { encoderOpts: encoderOptsWithAds, adsPlan } = applyAdsPlanToEncoderOpts(
        settingsSnapshot, chainId, chainRegistry, oraclePreflight.encoderOpts);

    // 3b. D-9: a native-coin SEND ("SEND BTC ...") writes only an OP_RETURN, which
    // moves no value (the indexer has no native-coin ledger to credit). Append a
    // real destination payment output so the recipient is actually paid; the
    // encoder folds its value into the change math. Token sends return null here
    // and are unchanged. The output is added to the SAME customOutputs the tamper
    // matcher reads below, so the built PSBT and the expected set stay in sync.
    const nativeOut = nativePaymentOutput({
        tick: actionData?.params?.TICK,
        amount: actionData?.params?.AMOUNT,
        destination: actionData?.params?.DESTINATION,
        descriptor,
    });
    const withNativeOut = nativeOut
        ? { ...encoderOptsWithAds, customOutputs: [ ...(encoderOptsWithAds.customOutputs || []), nativeOut ] }
        : encoderOptsWithAds;

    // 3c . The protocol fee must ride the transaction that carries the
    // ACTION, which on the two-phase lane is the phase-2 REVEAL, not the
    // phase-1 commit this function builds. Leaving it on phase 1 spends the fee
    // on a transaction with no action and the action is rejected for not paying
    // it - on LTC/DOGE, where native is the only fee lane, that was every
    // DEPLOY and every large FILE, gated publish or multi-recipient SEND.
    //
    // : the fee output is still HANDED to the build below. On the chunk
    // lane the encoder does not emit it on the commit, but it does fold its
    // value (and its reveal-side byte cost) into the script output the reveal
    // spends, and that reservation is the only thing that lets the reveal
    // afford it. Removing it from the build was the first cut of  and it
    // made every chunked native-fee action unbalanced ("Outputs are spending
    // more than Inputs") once the quote outgrew the commit's incidental slack.
    //
    // So only the EXPECTED-OUTPUT set drops it, below: the §5.3.2 check must
    // describe the phase-1 transaction as it actually is, and that transaction
    // does not carry the output. Which transaction pays it is decided after the
    // build from the encoding the encoder chose, so no prediction can be wrong.
    const feeOutput = nativeFeeOutputOf(feePreflight.quote);
    const finalEncoderOpts = withNativeOut;

    // 4. Encode to the ONE PSBT the modal previews and the signer signs.
    // D-7: give the encoder the spender address so it can build the tx:
    //  - `sourceAddress` (SDK-side only, not on the wire) makes the SDK select the
    //    funding UTXOs BY ADDRESS. Without it the encoder selects by `pubkey`, which
    //    the utxo-tracker cannot resolve to a script ("has no matching Script").
    //  - `change` is the address the leftover value returns to; the spender is the
    //    change sink. Without it the encoder refuses to build ("CHANGE_ADDRESS_REQUIRED"
    //    rather than burn the change as fee). An explicit change in encoderOpts wins
    //    (the spread below overrides this default).
    // : the quote taken moments ago is the one thing that makes an
    // "address has no coin" failure actionable ("it needs about 20 DOGE"), and
    // this is the last frame that still has it. Stamp it on the way out so the
    // form's message can say the amount.
    let encoded;
    try {
        encoded = await sdk.encoder.createTx({
            ...(bareNativePayment ? {} : { data: createResult.actionString }),
            ...(source ? { sourceAddress: source, change: source } : {}),
            ...finalEncoderOpts,
        });
    } catch (err) {
        throw annotateEncoderFeeRequirement(err, feePreflight.quote);
    }

    // /: now that the encoder has answered, place the fee output.
    // A chunk encoding means the action rides a reveal, so the fee rides it too
    // and the submit path emits it there; anything else carries the action in
    // the transaction just built, which already contains the output.
    const deferredFeeOutput = feeOutput && !bareNativePayment && isChunkEncoding(encoded.encoding)
        ? feeOutput
        : null;

    //  solved this for the protocol fee and for nothing else, and the gap is a
    // money leak rather than a rejection: on the chunk lane the encoder emits NO custom
    // output on the commit (it folds each one's value and reveal-side byte cost into the
    // script output), and the reveal is built by the submit path, which was handed only
    // the fee. So every OTHER custom output - a Mode B dispenser's oracle usage fee
    // , an ADS donation, a native payment output - was paid for by the commit's
    // reservation and then burned as miner fee on the reveal, because nothing emitted it.
    // Measured on Litecoin regtest 2026-07-31: a Mode B dispenser reserved 0.05005464 LTC
    // in its carrier and the reveal spent all of it as fee, so the oracle was not paid and
    // the create indexed `invalid: ORACLE_ADDRESS (missing oracle fee output)`.
    // The WHOLE set is handed along, fee included, so the reveal emits what the commit
    // reserved. Placement is still read off the encoding the encoder chose, never
    // predicted.
    const deferredOutputs = !bareNativePayment && isChunkEncoding(encoded.encoding)
        ? (Array.isArray(finalEncoderOpts.customOutputs) ? finalEncoderOpts.customOutputs.slice() : [])
        : [];

    const adsOutput = adsPlan.canSubmit
        ? { address: adsPlan.donationAddress, value: adsPlan.donationAmount }
        : null;
    // A bare payment expects NO carrier leg. The encoder still reports
    // 'OP_RETURN' as its encoding (every downstream single-tx branch keys off
    // that), so the encoding is deliberately not taken from the response here:
    // passing it through would let the matcher wave through one OP_RETURN
    // output that this transaction must not contain. Null tightens the check.
    const expectedOutputs = buildExpectedOutputs({
        customOutputs: deferredFeeOutput
            ? withoutCustomOutput(finalEncoderOpts, deferredFeeOutput).customOutputs
            : finalEncoderOpts.customOutputs,
        encoding: bareNativePayment ? null : encoded.encoding,
        adsOutput,
        // D-24 : a P2SH/P2WSH/MULTISIGN payload larger than one on-chain
        // chunk is carried by SEVERAL data-carrier outputs; the tamper check
        // derives how many to allow from the action size, so a real contract
        // DEPLOY (or large FILE / gated publish) is not falsely flagged. Byte
        // length, not char length, since the base64 CODE can push the payload
        // past a chunk boundary that char length would under-count.
        actionByteLen: bareNativePayment || !createResult?.actionString
            ? undefined
            : byteLen(createResult.actionString),
    });

    return {
        // Null on the bare-payment path: there is no action, and callers must
        // branch rather than be handed a plausible-looking empty string.
        actionString: bareNativePayment ? null : createResult.actionString,
        action: bareNativePayment ? null : createResult.action,
        version: bareNativePayment ? null : createResult.version,
        bareNativePayment,
        psbt: encoded.psbt,
        encoding: bareNativePayment ? null : encoded.encoding,
        // §5.3.2 check 3 needs the redeem scripts create_tx committed to, and
        // this is the only place they exist: the verifier fails CLOSED when
        // they are missing (SCRIPTS_MISSING), by design, so dropping them here
        // did not weaken the check - it made every chunk-lane action
        // unsendable. A three-recipient SEND is past one OP_RETURN, so it
        // takes the P2SH lane, and the confirm pipeline refused it with "The
        // action encoded in the transaction does not match what you approved."
        // before the modal ever opened. Every unit test around the check
        // passed its own scripts in, so nothing saw the gap; the UI-driven
        // regtest round trip did, immediately .
        carrierScripts: Array.isArray(encoded.carrierScripts) ? encoded.carrierScripts : [],
        quote: feePreflight.quote,
        // Which lane this PSBT actually pays its protocol fee through. Stated
        // rather than inferred because the dry run's verdict DEPENDS on it: the
        // XCHAIN mode debits the payer's balance and the native mode pays a coin
        // output, so asking the wrong question gets a confident wrong answer
        // (measured: "invalid: insufficient funds (FEE)" for an action the same
        // endpoint calls valid when asked in native mode).
        // Read off the QUOTE, not off encoderOpts: applyNativeFeePreflight
        // deliberately strips `payFeeInNativeCoin` from the opts it returns once
        // the fee has become a real output, so the flag is gone by this point
        // and reading it there quietly yields false - which is how the first
        // version of this fix looked right and changed nothing on screen. A
        // quote exists exactly when a coin fee was priced and attached.
        payFeeInNativeCoin: !!feePreflight.quote,
        // : present when the protocol fee was moved off this PSBT and on
        // to the reveal the submit path builds. The confirm surface still shows
        // the fee (it reads the quote); this tells the submit path where to put
        // it without re-quoting.
        deferredFeeOutput,
        // Every output the phase-1 transaction reserved value for but did not emit, so
        // the submit path can emit them all on the reveal. Supersedes deferredFeeOutput,
        // which it contains; that field stays for callers built against  alone.
        deferredOutputs,
        oracleFeeQuote: oraclePreflight.oracleFeeQuote,
        adsPlan,
        expectedOutputs,
        encoderOpts: finalEncoderOpts,
    };
}
