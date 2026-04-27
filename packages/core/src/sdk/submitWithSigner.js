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

/**
 * @typedef {Object} SubmitEncoderOpts
 * @property {string} pubkey                 hex; caller-supplied — we do NOT derive from the signer
 * @property {string} [change]               change address
 * @property {unknown[]} [utxos]             hand-selected utxos (otherwise encoder selects)
 * @property {boolean} [rawData]
 * @property {string} [encoding]             'OP_RETURN' | 'P2SH' | 'P2WSH' | ... (encoder chooses if omitted)
 * @property {number} [fee]                  absolute fee in sats
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {number} [dust]
 * @property {boolean} [unconfirmed]
 * @property {boolean} [compressedPubKey]
 * @property {unknown[]} [customOutputs]
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

    // Step 2 — encode to PSBT via the encoder service.
    onProgress('encoding', { actionString: createResult.actionString });
    const encoded = await encoder.createTx({
        data: createResult.actionString,
        ...encoderOpts,
    });

    // Step 3 — sign via the injected Signer.
    onProgress('signing', { encoding: encoded.encoding });
    const signed = await signer.signPsbt({
        psbtHex: encoded.psbt,
        chainId,
        signingPaths,
    });

    // Step 4 — broadcast phase-1 tx.
    onProgress('broadcasting', { txid: signed.txid });
    await encoder.broadcastTx(signed.txHex);

    // Step 4b — P2SH/P2WSH two-phase: encoder paid to a script, we now
    // spend that output with a second tx. Signer signs phase-2 too.
    let finalTxid = signed.txid;
    let finalSigned = signed;
    const needsPhase2 = encoded.encoding === 'P2SH' || encoded.encoding === 'P2WSH';
    if (needsPhase2) {
        onProgress('p2sh_spending', { phase1Txid: signed.txid });
        const spendResult = await encoder.spendP2sh({
            pubkey: encoderOpts.pubkey,
            p2shHash: encoded.p2shHash ?? encoded.hash,
            p2shHex: signed.txHex,
            change: encoderOpts.change,
            fee: encoderOpts.fee,
            feePerKb: encoderOpts.feePerKb,
        });
        const phase2Signed = await signer.signPsbt({
            psbtHex: spendResult.psbt,
            chainId,
            signingPaths,
        });
        await encoder.broadcastTx(phase2Signed.txHex);
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
