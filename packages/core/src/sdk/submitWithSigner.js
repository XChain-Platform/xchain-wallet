// submitWithSigner — §10.4. Reproduces `sdk.submitAction`'s end-to-end
// lifecycle (create → encode → sign → broadcast → wait) but routes
// signing through a Signer interface instead of an in-memory WIF, so the
// same wrapper drives Software, Trezor, and Ledger (once those land).
//
// §26.5 / G068 — panic-mode signing freeze is enforced at the top of
// the flow via `assertSigningAllowed()`. See `flows/panicMode.js`.
//
// The wrapper does NOT re-derive the caller's pubkey — supply it via
// `encoderOpts.pubkey`. The caller already knew which address/path they
// were spending from when they built the action; duplicating derivation
// inside the wrapper would hide a signer-mismatch bug rather than
// surface it.
//
// Step 5 (indexer wait) is opt-in via a `waitForTxid` callback. The SDK
// bundles `ActionWaiter` but doesn't expose it on the instance — shells
// wire this themselves (e.g., via `new ActionWaiter(sdk).waitForTxid`)
// or skip the wait and poll separately.

import { assertSigningAllowed } from '../flows/panicMode.js';
import { applyNativeFeePreflight } from './nativeFeePreflight.js';

/**
 * Thrown when a transaction was signed successfully but the broadcast
 * leg failed (encoder unreachable, network timeout, etc.). Carries the
 * signed hex so callers — typically `submitAction` and the bridge
 * background handlers — can hand it off to the queued-broadcast surface
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
 * @typedef {Object} SubmitEncoderOpts
 * @property {string} pubkey                 hex; caller-supplied — we do NOT derive from the signer
 * @property {string} [change]               change address
 * @property {unknown[]} [utxos]             hand-selected utxos (otherwise encoder selects)
 * @property {string} [rawData]            binary string (Latin-1) — gated-FILE ciphertext, ECIES envelopes
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
 * @typedef {Object} SubmitWithSignerOpts
 * @property {import('./SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {{ action: string, params: object }} actionData
 * @property {SubmitEncoderOpts} encoderOpts
 * @property {import('../signers/Signer.js').Signer} signer
 * @property {Array<{ inputIndex: number, path: string, sighashType?: number }>} signingPaths
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
    actionData,
    encoderOpts,
    signer,
    signingPaths,
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

    // §26.5 / G068 — refuse to drive any signer while panic mode is on.
    // Cleared automatically once the timer expires.
    assertSigningAllowed();

    const sdk = sdkRegistry.get(chainId);
    const encoder = sdk.encoder;
    if (!encoder) {
        throw new Error(
            'submitWithSigner: SDK encoder not initialized — call sdkRegistry.initActive([chainId]) first',
        );
    }

    // Step 1 — create action string (no network call, just formatting).
    onProgress('creating', { action: actionData.action });
    const createResult = sdk.actions.createAction(actionData);

    // Step 1b — native-coin fee pre-flight. When the caller opted to pay the protocol fee in the
    // native coin, this sizes the FEE_DESTINATION output and REFUSES (throws NativeFeeForfeitError)
    // a transaction that can't be safely priced — a failed native-fee action forfeits the fee.
    // No-op when payFeeInNativeCoin is not set.
    const preflight = await applyNativeFeePreflight({
        sdk,
        actionData,
        encoderOpts,
        source: encoderOpts.change,
        onProgress,
    });
    const effectiveEncoderOpts = preflight.encoderOpts;

    // Step 2 — encode to PSBT via the encoder service.
    onProgress('encoding', { actionString: createResult.actionString });
    const encoded = await encoder.createTx({
        data: createResult.actionString,
        ...effectiveEncoderOpts,
    });

    // Step 3 — sign via the injected Signer.
    onProgress('signing', { encoding: encoded.encoding });
    const signed = await signer.signPsbt({
        psbtHex: encoded.psbt,
        chainId,
        signingPaths,
    });

    // Step 4 — broadcast phase-1 tx. Wrap rejections so submitAction
    // (and ultimately the §49.5 queued-broadcast surface) can recover
    // the signed hex instead of losing it on a network blip.
    onProgress('broadcasting', { txid: signed.txid });
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

    // Step 4b — P2SH/P2WSH two-phase: encoder paid to a script, we now
    // spend that output with a second tx. Signer signs phase-2 too.
    let finalTxid = signed.txid;
    let finalSigned = signed;
    const needsPhase2 = encoded.encoding === 'P2SH' || encoded.encoding === 'P2WSH';
    if (needsPhase2) {
        onProgress('p2sh_spending', { phase1Txid: signed.txid });
        const spendResult = await encoder.spendP2sh({
            pubkey: effectiveEncoderOpts.pubkey,
            // Phase 2 spends the P2SH/P2WSH output created by phase 1. The encoder
            // identifies that output from the phase-1 transaction itself, so p2shHash
            // is the broadcast phase-1 txid (the create_tx response carries only
            // { psbt, encoding } — there is no separate hash field).
            p2shHash: signed.txid,
            p2shHex: signed.txHex,
            // Phase 2 re-derives the P2SH/P2WSH reveal script chunks from the SAME
            // action data + encoding used in phase 1. Omitting these makes the encoder
            // default to empty data and auto-select OP_RETURN, producing reveal outputs
            // that don't match the phase-1 script — the spend would be unspendable and
            // lock funds in the script address. rawData is undefined-safe (the encoder
            // client skips it when absent) and carries gated-FILE / ECIES MESSAGE v2 payloads.
            data: createResult.actionString,
            encoding: encoded.encoding,
            rawData: effectiveEncoderOpts.rawData,
            change: effectiveEncoderOpts.change,
            fee: effectiveEncoderOpts.fee,
            feePerKb: effectiveEncoderOpts.feePerKb,
        });
        const phase2Signed = await signer.signPsbt({
            psbtHex: spendResult.psbt,
            chainId,
            signingPaths,
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
        txid: finalTxid,
        actionString: createResult.actionString,
        action: createResult.action,
        version: createResult.version,
        encoding: encoded.encoding,
        signed: finalSigned,
        indexed: null,
        nativeFeeQuote: preflight.quote,
    };

    // Step 5 — optional indexer confirmation.
    if (waitForTxid) {
        onProgress('waiting', { txid: finalTxid });
        const indexed = await waitForTxid(finalTxid, waitOpts);
        result.indexed = indexed;
        onProgress('confirmed', { txid: finalTxid, action: indexed });
    }

    return result;
}
