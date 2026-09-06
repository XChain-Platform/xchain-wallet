// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// submitWithSigner: §10.4. Reproduces `sdk.submitAction`'s end-to-end
// lifecycle (create → encode → sign → broadcast → wait) but routes
// signing through a Signer interface instead of an in-memory WIF, so the
// same wrapper drives Software, Trezor, and Ledger (once those land).
//
// §26.5 / G068: panic-mode signing freeze is enforced at the top of
// the flow via `assertSigningAllowed()`. See `flows/panicMode.js`.
//
// The wrapper does NOT re-derive the caller's pubkey; supply it via
// `encoderOpts.pubkey`. The caller already knew which address/path they
// were spending from when they built the action; duplicating derivation
// inside the wrapper would hide a signer-mismatch bug rather than
// surface it.
//
// Step 5 (indexer wait) is opt-in via a `waitForTxid` callback. The SDK
// bundles `ActionWaiter` but doesn't expose it on the instance. Shells
// wire this themselves (e.g., via `new ActionWaiter(sdk).waitForTxid`)
// or skip the wait and poll separately.

import { assertSigningAllowed } from '../flows/panicMode.js';
import { nativeFeeOutputOf, isChunkEncoding } from '../flows/nativeFeeLane.js';
import { signerSupportsChunkReveal } from '../flows/signerCapability.js';
import { applyNativeFeePreflight } from './nativeFeePreflight.js';
import { annotateEncoderFeeRequirement } from './encoderErrors.js';
import { applyOracleFeePreflight } from './oracleFeePreflight.js';
import {
    isBareNativePayment, withNativePaymentOutput, hasNativePaymentOutput,
} from '../flows/nativePayment.js';
import { recordPendingCommit, clearPendingCommit } from '../shared/utils/envelopeRecoveryMemory.js';

/**
 * Thrown when a transaction was signed successfully but the broadcast
 * leg failed (encoder unreachable, network timeout, etc.). Carries the
 * signed hex so callers (typically `submitAction` and the bridge
 * background handlers) can hand it off to the queued-broadcast surface
 * (§49.5) instead of dropping the work.
 *
 * Cluster G FOLLOWUP 1.
 */
export class BroadcastFailedError extends Error {
    /**
     * @param {{
     *   cause: unknown,
     *   signedTxHex: string,
     *   txid: string,
     *   chainId: string,
     *   signedAt: number,
     *   encoding: string,
     *   phase: 'phase1' | 'phase2',
     * }} fields
     */
    constructor({ cause, signedTxHex, txid, chainId, signedAt, encoding, phase }) {
        const inner = cause && typeof cause === 'object' && 'message' in cause
            ? /** @type {{ message: string }} */ (cause).message
            : String(cause);
        super(`broadcast failed (${phase}): ${inner}`);
        this.name = 'BroadcastFailedError';
        this.cause = cause;
        this.signedTxHex = signedTxHex;
        this.txid = txid;
        this.chainId = chainId;
        this.signedAt = signedAt;
        this.encoding = encoding;
        this.phase = phase;
    }
}

/**
 * Thrown BEFORE anything is signed or broadcast when the encoder chose the
 * P2SH/P2WSH two-phase lane and the injected signer cannot sign its reveal.
 *
 * The reveal is dispatched after the phase-1 commit is on chain, so a signer
 * that refuses (or fails inside its vendor layer) at that point has already
 * spent coin into a script nothing can open. This is the pre-dispatch
 * capability check `Signer.js#assertCannotSignEnvelopeReveal` says must live
 * here rather than at the signer. Typed and `userFacing` so the forms render
 * the remedy instead of "Couldn't send."
 */
export class HardwareChunkLaneError extends Error {
    /** @param {{ action: string, encoding: string, signerKind?: string }} fields */
    constructor({ action, encoding, signerKind }) {
        super(`This ${action} is too large for one transaction: the network carries it as a `
            + `${encoding} pair, a commit plus a revealing transaction signed after the first `
            + `is broadcast. ${signerKind ? `A ${signerKind} signer` : 'This signer'} cannot sign `
            + 'that revealing transaction, and broadcasting only the first would spend coin into '
            + 'a script that nothing can open and record no action at all. Use a software wallet '
            + 'key for this action.');
        this.name = 'HardwareChunkLaneError';
        this.userFacing = true;
        this.action = action;
        this.encoding = encoding;
        this.signerKind = signerKind;
    }
}

/**
 * @typedef {Object} SubmitEncoderOpts
 * @property {string} pubkey                 hex; caller-supplied (we do NOT derive from the signer)
 * @property {string} [change]               change address
 * @property {unknown[]} [utxos]             hand-selected utxos (otherwise encoder selects)
 * @property {string} [rawData]            binary string (Latin-1): gated-FILE ciphertext, ECIES envelopes
 * @property {string} [encoding]             'OP_RETURN' | 'P2SH' | 'P2WSH' | ... (encoder chooses if omitted)
 * @property {number} [fee]                  absolute fee in sats
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {number} [dust]
 * @property {boolean} [unconfirmed]
 * @property {boolean} [compressedPubKey]
 * @property {unknown[]} [customOutputs]
 * @property {{ address: string, amount: number }} [feeQuote]  protocol fee output to inject directly (address + amount in satoshis)
 * @property {boolean} [payFeeInNativeCoin]  when true, native-coin fee pre-flight runs and the fee destination output is sized automatically
 */

/**
 * @typedef {Object} PrebuiltPsbt
 * @property {string} psbtHex        the exact PSBT the modal previewed + checked (signed byte-identically)
 * @property {string} encoding       the encoding composeForConfirm chose
 * @property {string} actionString   for the two-phase reveal + result
 * @property {number|string} [version]
 * @property {{ address: string, value: string | number } | null} [deferredFeeOutput]
 * @property {Array<{ address: string, value: string | number }>} [deferredOutputs]
 * @property {{ change?: string | null, rawData?: string | null } | null} [revealOpts]  what the compose built the commit with, so the phase-2 reveal agrees
 * @property {{ included: boolean } | null} [adsDonation]  whether THESE bytes carry the ADS donation
 */

/**
 * @typedef {Object} SubmitWithSignerOpts
 * @property {import('./SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {{ action: string, params: object }} actionData
 * @property {SubmitEncoderOpts} encoderOpts
 * @property {import('../signers/Signer.js').Signer} signer
 * @property {Array<{ inputIndex: number, path: string, sighashType?: number }>} signingPaths
 * @property {PrebuiltPsbt} [prebuiltPsbt] single-encode pipeline: when set, skip
 *                                           createAction + encoder.createTx and sign THIS PSBT
 *                                           byte-identically (the one composeForConfirm built,
 *                                           the modal previewed, and the tamper checks passed).
 * @property {(txid: string, opts?: { timeout?: number, pollInterval?: number, requireValid?: boolean }) => Promise<unknown>} [waitForTxid]
 * @property {{ timeout?: number, pollInterval?: number, requireValid?: boolean }} [waitOpts]
 * @property {(phase: SubmitPhase, data: object) => void} [onProgress]
 */

/**
 * @typedef {'creating' | 'encoding' | 'signing' | 'broadcasting' | 'p2sh_spending' | 'waiting' | 'confirmed'} SubmitPhase
 */

/**
 * @typedef {Object} SubmitResult
 * @property {string} txid                   final txid (phase-2 in P2SH/P2WSH case)
 * @property {string} actionString
 * @property {string} action
 * @property {number | string} [version]
 * @property {string} encoding               chosen by the encoder
 * @property {{ signedPsbtHex: string, txHex: string, txid: string }} signed
 * @property {unknown} indexed               result from `waitForTxid` if supplied, else null
 * @property {{ address: string, amount: number }} [nativeFeeQuote]  native-coin fee quote used during pre-flight, if native-fee mode was active
 */

/**
 * @param {SubmitWithSignerOpts} opts
 * @returns {Promise<SubmitResult>}
 */
export async function submitWithSigner({
    sdkRegistry,
    chainId,
    chainRegistry,
    actionData,
    encoderOpts,
    signer,
    signingPaths,
    prebuiltPsbt,
    waitForTxid,
    waitOpts,
    onProgress = () => {},
}) {
    if (!sdkRegistry) throw new Error('submitWithSigner: sdkRegistry is required');
    if (!actionData?.action) throw new Error('submitWithSigner: actionData.action is required');
    if (!encoderOpts?.pubkey) {
        throw new Error('submitWithSigner: encoderOpts.pubkey is required');
    }
    if (!signer) throw new Error('submitWithSigner: signer is required');
    if (!Array.isArray(signingPaths) || signingPaths.length === 0) {
        throw new Error('submitWithSigner: signingPaths must be a non-empty array');
    }

    // §26.5 / G068: refuse to drive any signer while panic mode is on.
    // Cleared automatically once the timer expires.
    assertSigningAllowed();

    const sdk = sdkRegistry.get(chainId);
    const encoder = sdk.encoder;
    if (!encoder) {
        throw new Error(
            'submitWithSigner: SDK encoder not initialized; call sdkRegistry.initActive([chainId]) first',
        );
    }

    // single-encode pipeline: when the caller supplies a prebuilt PSBT
    // (composeForConfirm's output, already previewed + tamper-checked), skip
    // createAction and encoder.createTx entirely and sign THAT PSBT byte-
    // identically. The atomic createAction->createTx->sign path below is the
    // legacy behaviour; both converge at Step 3.
    let createResult, effectiveEncoderOpts, encoded, preflight;
    let bareNativePayment = false;
    // Set when the native-fee output has been moved off the phase-1
    // commit and on to the phase-2 reveal, which is the transaction the
    // indexer validates the protocol fee against.
    let deferredNativeFeeOutput = null;
    // Every output the phase-1 commit reserved value for but did not emit. Supersedes
    // deferredNativeFeeOutput (which it contains): the chunk lane emits NO custom output
    // on the commit, so an oracle usage fee, an ADS donation or a native payment output
    // was burned as miner fee when only the protocol fee was carried across.
    let deferredOutputs = [];
    // What the COMMIT was built with, on the prebuilt path. The reveal is built
    // fresh at submit time and was taking these from the submit flow's own opts,
    // which never saw the change address the compose rotated onto - so the
    // commit's change went to the fresh internal address and the reveal's
    // surplus sweep went back to the spending address (D-9 rotation, defeated).
    let revealOpts = null;
    if (prebuiltPsbt) {
        // Preserve the phase events submitAction's lifecycle tracker consumes,
        // but do NO rebuild: the PSBT is the one the user approved.
        onProgress('creating', { action: actionData.action });
        onProgress('encoding', { actionString: prebuiltPsbt.actionString });
        createResult = {
            actionString: prebuiltPsbt.actionString,
            action: actionData.action,
            version: prebuiltPsbt.version,
        };
        effectiveEncoderOpts = encoderOpts;
        encoded = { psbt: prebuiltPsbt.psbtHex, encoding: prebuiltPsbt.encoding };
        // The fee output is already baked into the prebuilt PSBT (composeForConfirm
        // ran applyNativeFeePreflight before building), so no quote is recomputed here.
        preflight = { quote: null };
        // ...EXCEPT on the two-phase lane, where composeForConfirm deliberately
        // left the protocol fee OFF the previewed PSBT because it belongs on the
        // reveal. It hands the output along so this path can attach it
        // without re-quoting, and so the previewed bytes stay exactly what the
        // §5.3.2 output-set check verified.
        deferredNativeFeeOutput = prebuiltPsbt.deferredFeeOutput || null;
        // A composer built before the whole-set deferral still sends only the fee, so
        // fall back to it rather than silently emitting nothing on the reveal.
        deferredOutputs = Array.isArray(prebuiltPsbt.deferredOutputs) && prebuiltPsbt.deferredOutputs.length
            ? prebuiltPsbt.deferredOutputs
            : (deferredNativeFeeOutput ? [deferredNativeFeeOutput] : []);
        // An envelope from an older composer carries none, and falls back to
        // today's behaviour below rather than to a null change address.
        revealOpts = prebuiltPsbt.revealOpts || null;
    } else {
        // Step 1: create action string (no network call, just formatting).
        onProgress('creating', { action: actionData.action });
        // A plain native-coin payment has no XChain action to create.
        // This atomic path must agree with composeForConfirm, or the same send
        // would produce different bytes depending on which route built it.
        bareNativePayment = isBareNativePayment(actionData, chainRegistry?.get(chainId));
        createResult = bareNativePayment ? null : sdk.actions.createAction(actionData);

        // Step 1b: native-coin fee pre-flight. When the caller opted to pay the protocol fee in the
        // native coin, this sizes the FEE_DESTINATION output and REFUSES (throws NativeFeeForfeitError)
        // a transaction that can't be safely priced. A failed native-fee action forfeits the fee.
        // No-op when payFeeInNativeCoin is not set.
        preflight = await applyNativeFeePreflight({
            sdk,
            actionData,
            encoderOpts,
            // Who is SPENDING, which the dry run behind this quote resolves the
            // holder and the balance from. `sourceAddress` is the address the SDK
            // funds from and is that spender on every flow that sets it; `change`
            // is only where the leftovers land, and it stays as the fallback
            // because a flow that sets one and not the other must still quote
            // with a source rather than none (D-146).
            //
            // Precedence, not equivalence. The two WERE the same address when
            // D-146 landed, and change rotation then broke that: submitAction
            // rotates the self-change default onto a fresh internal address and
            // leaves `sourceAddress` alone, so reading `change` first quoted the
            // rotated address - unfunded, holding none of the token - and the
            // indexer's `valid:false` surfaced as a NativeFeeForfeitError on a
            // transaction that was perfectly fundable.
            source: encoderOpts.sourceAddress || encoderOpts.change,
            onProgress,
        });
        // Step 1c: PRICE v1 oracle usage fee. A Mode B dispenser must pay its oracle
        // operator up front as a real output or the indexer rejects the create, so this
        // sizes that output from the indexer's own quote and refuses one it cannot price.
        // No-op for Mode A and for every non-DISPENSER action.
        const oraclePreflight = await applyOracleFeePreflight({
            sdk,
            actionData,
            encoderOpts: preflight.encoderOpts,
            onProgress,
        });
        effectiveEncoderOpts = oraclePreflight.encoderOpts;

        // Step 1d: the native-fee output must be EMITTED on the
        // transaction that carries the ACTION. The indexer validates the
        // protocol fee against that transaction's outputs
        // (`data['TX_OUTPUTS']`), and on the two-phase lane that is the phase-2
        // REVEAL, not the phase-1 commit. Paying it on phase 1 spends the fee
        // on a transaction with no action, and the action is then rejected for
        // not paying it. On LTC/DOGE, where the native fee is the only lane,
        // that was every DEPLOY plus every large FILE, gated publish and
        // multi-recipient SEND.
        //
        // It is nonetheless PASSED to the phase-1 build below, always.
        // The encoder skips emitting a customOutput on a P2SH/P2WSH funding tx
        // but folds its value and reveal-side byte cost into the script output,
        // and that reservation is what pays for it on the reveal. Withholding
        // it left the reveal unable to balance.
        const feeOutput = nativeFeeOutputOf(preflight.quote);

        // Step 1e: pay the recipient. Suppressing the SEND action string and
        // adding the destination output are ONE decision, and this path made
        // only the first half: it relied on every caller having put the payment
        // in `customOutputs`. `sendToken` and `buildSendPsbt` do; the generic
        // `advancedAction` route forwards pubkey/sourceAddress/change/fee opts
        // and nothing else, so a native SEND through the parallel composer built
        // a transaction with no OP_RETURN and no payment. Idempotent, so the
        // callers that pre-supply it keep their bytes.
        if (bareNativePayment) {
            effectiveEncoderOpts = withNativePaymentOutput({
                actionData,
                descriptor: chainRegistry?.get(chainId),
                encoderOpts: effectiveEncoderOpts,
            });
            // Fail closed rather than sign a send that pays nobody. The fold
            // above makes this unreachable today; it is here so the next route
            // that skips it fails loudly instead of broadcasting.
            if (!hasNativePaymentOutput(actionData, chainRegistry?.get(chainId), effectiveEncoderOpts)) {
                throw new Error(
                    'submitWithSigner: a native-coin send must carry its destination payment output',
                );
            }
        }

        // Step 2: encode to PSBT via the encoder service.
        onProgress('encoding', { actionString: bareNativePayment ? null : createResult.actionString });
        // A build that fails here fails BEFORE signing, and the
        // pre-flight quote is the amount the user is short. Stamp it on so the
        // form's message can say how much, not just that something is missing.
        try {
            encoded = await encoder.createTx({
                ...(bareNativePayment ? {} : { data: createResult.actionString }),
                ...effectiveEncoderOpts,
            });
        } catch (err) {
            throw annotateEncoderFeeRequirement(err, preflight.quote);
        }

        // Placement, read off the encoding the encoder actually chose rather
        // than predicted from the action size: a chunk encoding means the
        // action rides a reveal, so the fee output is emitted there. Anything
        // else carries the action in the transaction just built, which already
        // contains the output.
        if (isChunkEncoding(encoded.encoding)) {
            if (feeOutput) deferredNativeFeeOutput = feeOutput;
            // The oracle usage fee and the ADS donation live in effectiveEncoderOpts
            // alongside the fee and are equally unemitted by the commit.
            deferredOutputs = Array.isArray(effectiveEncoderOpts.customOutputs)
                ? effectiveEncoderOpts.customOutputs.slice()
                : [];
        }
    }

    // P2SH/P2WSH two-phase: the encoder paid to a script and phase 2 spends it
    // with a second transaction the signer must also sign. Decided ONCE here, and
    // gated HERE, before the phase-1 commit is signed or broadcast: the reveal is
    // dispatched after the commit is on chain, so a signer that cannot produce it
    // (hardware and remote signers drop the `reveal` flag and fail inside their
    // vendor format layer) would leave coin in a script nothing can open. That
    // is the stranded-funds event §6 forbids, and the pre-dispatch check
    // Signer.js#assertCannotSignEnvelopeReveal says belongs in this file.
    const needsPhase2 = encoded.encoding === 'P2SH' || encoded.encoding === 'P2WSH';
    if (needsPhase2 && !signerSupportsChunkReveal(signer)) {
        let signerKind;
        try { signerKind = signer.kind; } catch { signerKind = undefined; }
        throw new HardwareChunkLaneError({
            action: actionData.action,
            encoding: encoded.encoding,
            signerKind: typeof signerKind === 'string' ? signerKind : undefined,
        });
    }

    // The software signer signs ONLY the inputs named in signingPaths (so a dApp
    // PSBT cannot get extra UTXOs signed); hardware signers are all-or-refuse
    // and need an entry for EVERY input (Signer.js#assertFullInputCoverage). But
    // this is the wallet's OWN action tx: every input is the active key's (the
    // encoder funds greedily from the change address and can pick more than one
    // UTXO). The flows declare just one signingPaths entry, so expand it to one
    // entry per actual PSBT input, reusing the active key's source, or those
    // extra funding inputs would be left unsigned and the broadcast would fail.
    // (The dApp bridge path keeps its strict user-approved scope and does not
    // call this helper.)
    const expandSigningPaths = (psbtHex) => {
        try {
            const base = signingPaths[0];
            const count = sdk.wallet.decomposePsbt(psbtHex).inputs.length;
            if (count <= signingPaths.length) return signingPaths;
            return Array.from({ length: count }, (_unused, inputIndex) => ({ ...base, inputIndex }));
        } catch {
            // If the PSBT cannot be decomposed for any reason, fall back to the
            // caller-provided paths so behaviour is never worse than before.
            return signingPaths;
        }
    };

    // A TAPROOT envelope comes back as a PAIR from this one
    // call, and the ORDER is the safety property, not merely completing both. §6:
    // "the reveal must be signable before the commit is broadcast; anything else
    // manufactures a stranded-funds event, not an error message". So the reveal is
    // signed HERE, while nothing is on chain and a throw costs only an error, and
    // the recovery record is persisted before either transaction goes out (§3.5).
    const envelopePair = Boolean(encoded && encoded.revealPsbt);
    let envelopeRevealSigned = null;

    // Step 3: sign via the injected Signer.    // Step 3: sign via the injected Signer.
    onProgress('signing', { encoding: encoded.encoding });
    const signed = await signer.signPsbt({
        psbtHex: encoded.psbt,
        chainId,
        signingPaths: expandSigningPaths(encoded.psbt),
    });

    // Step 3b: the envelope reveal, signed while nothing is on chain yet.
    if (envelopePair) {
        envelopeRevealSigned = await signer.signPsbt({
            psbtHex: encoded.revealPsbt,
            chainId,
            signingPaths: expandSigningPaths(encoded.revealPsbt),
            // routes to sdk.wallet.signEnvelopeRevealPsbt: a Schnorr script-path
            // signature over the envelope leaf. A signer that cannot do it throws
            // here, before the commit exists.
            envelopeReveal: true,
        });
        // §3.5: the key-path cancel needs {outpoint, internal key path, tapleaf
        // hash} and cannot be rebuilt without them. recordPendingCommit THROWS if it
        // cannot persist, and a throw here means we never broadcast: an unrecorded
        // commit is an unrecoverable one.
        if (encoded.envelope) {
            recordPendingCommit({
                commitTxid:      encoded.envelope.commitTxid,
                commitVout:      encoded.envelope.commitVout,
                commitValue:     encoded.envelope.commitValue,
                commitAddress:   encoded.envelope.commitAddress,
                internalKeyPath: signingPaths?.[0]?.path || encoded.envelope.internalPubkey,
                tapleafHash:     encoded.envelope.tapleafHash,
                coin:            chainId,
            });
        }
    }

    // Step 4: broadcast phase-1 tx. Wrap rejections so submitAction
    // (and ultimately the §49.5 queued-broadcast surface) can recover
    // the signed hex instead of losing it on a network blip.
    //
    // AWAITED, unlike every other progress call in this file. This is
    // the one phase whose handler writes the DURABLE PendingTx row that says a
    // transaction may be on the network (submitAction's composedOnProgress puts
    // status 'broadcasting'). Fired and forgotten, that write races the broadcast,
    // so a crash in between leaves a durable record claiming nothing was ever sent
    // while the network already holds the tx. Awaiting it restores the same rule
    // recordPendingCommit states above: the record precedes the effect, and a
    // record that cannot be written stops the effect (the rejection propagates to
    // submitAction, which marks the row 'failed' - no money has moved yet).
    await onProgress('broadcasting', { txid: signed.txid });
    try {
        await encoder.broadcastTx(signed.txHex);
    } catch (err) {
        throw new BroadcastFailedError({
            cause: err,
            signedTxHex: signed.txHex,
            txid: signed.txid,
            chainId,
            signedAt: Date.now(),
            encoding: encoded.encoding,
            phase: 'phase1',
        });
    }

    let finalTxid = signed.txid;
    let finalSigned = signed;

    // Step 4a: the envelope reveal, already signed. The decoder indexes the REVEAL,
    // so its txid is the action's identity (§3.1), not the commit's.
    if (envelopePair && envelopeRevealSigned) {
        onProgress('envelope_revealing', { commitTxid: signed.txid });
        try {
            await encoder.broadcastTx(envelopeRevealSigned.txHex);
        } catch (err) {
            // The commit is on chain and the reveal is not: the one stranding path
            // signing-first cannot remove. Surface it as a broadcast failure carrying
            // the signed reveal so the queued-rebroadcast surface can retry it; the
            // recovery record persisted above is what allows a cancel instead.
            throw new BroadcastFailedError({
                cause: err,
                signedTxHex: envelopeRevealSigned.txHex,
                txid: envelopeRevealSigned.txid,
                chainId,
                signedAt: Date.now(),
                encoding: encoded.encoding,
                phase: 'envelope_reveal',
            });
        }
        clearPendingCommit(encoded.envelope?.commitTxid, encoded.envelope?.commitVout);
        finalTxid = envelopeRevealSigned.txid;
        finalSigned = envelopeRevealSigned;
    }

    // Step 4b: P2SH/P2WSH two-phase: encoder paid to a script, we now
    // spend that output with a second tx. Signer signs phase-2 too (its
    // capability to do so was checked above, before phase 1 was signed).
    if (needsPhase2) {
        onProgress('p2sh_spending', { phase1Txid: signed.txid });
        const spendResult = await encoder.spendP2sh({
            pubkey: effectiveEncoderOpts.pubkey,
            // Phase 2 spends the P2SH/P2WSH output created by phase 1. The encoder
            // identifies that output from the phase-1 transaction itself, so p2shHash
            // is the broadcast phase-1 txid (the create_tx response carries only
            // { psbt, encoding }; there is no separate hash field).
            p2shHash: signed.txid,
            p2shHex: signed.txHex,
            // Phase 2 re-derives the P2SH/P2WSH reveal script chunks from the SAME
            // action data + encoding used in phase 1. Omitting these makes the encoder
            // default to empty data and auto-select OP_RETURN, producing reveal outputs
            // that don't match the phase-1 script, making the spend unspendable and
            // lock funds in the script address. rawData is undefined-safe (the encoder
            // client skips it when absent) and carries gated-FILE / ECIES MESSAGE v2 payloads.
            data: createResult.actionString,
            encoding: encoded.encoding,
            // Prefer what the COMMIT was built with; an absent carry (older
            // composer, or the atomic path) falls back to today's behaviour.
            rawData: revealOpts?.rawData ?? effectiveEncoderOpts.rawData,
            // The reveal's surplus sweep / floor pad lands here. Taking it from
            // the submit-side opts sent it to the spending address while the
            // commit's change went to the rotated one. Renderer-supplied, like
            // every other field of this envelope: it names no address the same
            // envelope's `psbtHex` could not already name (§5.3's unbound
            // prebuilt-submit seam is its own item).
            change: revealOpts?.change ?? effectiveEncoderOpts.change,
            fee: effectiveEncoderOpts.fee,
            feePerKb: effectiveEncoderOpts.feePerKb,
            // The protocol fee rides the REVEAL, the transaction that
            // carries the action and therefore the one the indexer checks.
            // spendP2sh has always accepted customOutputs (xchain-sdk
            // encoder.js); the wallet simply never passed any. It is the WHOLE
            // deferred set rather than the fee alone: the commit reserved value
            // for each of them and emitted none, so any left out here is burned.
            ...(deferredOutputs.length ? { customOutputs: deferredOutputs } : {}),
        });
        const phase2Signed = await signer.signPsbt({
            psbtHex: spendResult.psbt,
            chainId,
            signingPaths: expandSigningPaths(spendResult.psbt),
            // The reveal spends non-standard P2SH/P2WSH data-carrier outputs
            // that need the SDK's reveal finalizer, not the default single-sig one
            // (otherwise "Can not finalize input #0"). signingPaths still resolves the
            // signing key; the software signer signs+custom-finalizes every input.
            reveal: true,
        });
        try {
            await encoder.broadcastTx(phase2Signed.txHex);
        } catch (err) {
            throw new BroadcastFailedError({
                cause: err,
                signedTxHex: phase2Signed.txHex,
                txid: phase2Signed.txid,
                chainId,
                signedAt: Date.now(),
                encoding: encoded.encoding,
                phase: 'phase2',
            });
        }
        finalTxid = phase2Signed.txid;
        finalSigned = phase2Signed;
    }

    /** @type {SubmitResult} */
    const result = {
        // Null on the bare-payment path, where there is no action at all and
        // `createResult` is null: composeForConfirm states the same contract,
        // and reading through the null threw AFTER the broadcast.
        txid: finalTxid,
        actionString: createResult ? createResult.actionString : null,
        action: createResult ? createResult.action : null,
        version: createResult ? createResult.version : null,
        encoding: encoded.encoding,
        signed: finalSigned,
        indexed: null,
        nativeFeeQuote: preflight.quote,
        // What compression ACTUALLY did, reported by the
        // encoder rather than inferred here. With the default ON a caller cannot
        // tell from its own request whether the bytes were compressed, and the
        // wallet has to show the real on-chain size. Shape:
        // { compressed, rawLength, storedLength, reason }; absent on lanes that
        // carry no payload at all.
        ...(encoded.compression ? { compression: encoded.compression } : {}),
    };

    // Step 5: optional indexer confirmation.
    if (waitForTxid) {
        onProgress('waiting', { txid: finalTxid });
        const indexed = await waitForTxid(finalTxid, waitOpts);
        result.indexed = indexed;
        onProgress('confirmed', { txid: finalTxid, action: indexed });
    }

    return result;
}
