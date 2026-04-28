// buildActionPsbt — §20 / Cluster W FOLLOWUP 5. Generalized watcher-mode
// helper that builds an UNSIGNED PSBT for any XChain action without
// unlocking the wallet, calling a signer, or broadcasting. The user
// transports the resulting hex to a separate Signer-mode wallet, gets
// it signed, and brings the signed PSBT back to a Full-mode wallet to
// broadcast.
//
// This is the encode-only path through `submitWithSigner` — Steps 1 + 2
// (createAction + encoder.createTx) and nothing else. SEND has its own
// dedicated `buildSendPsbt` because the Send form layers fee tiering,
// recent-destinations, and ADS donations on top; the rest of the action
// surface (ISSUE / MINT / DESTROY / DISPENSER / ORDER / SWAP / etc.)
// shares this single flow.
//
// Differences from submitAction:
//   - No password / no signer: a watcher-mode wallet has pubkeys but
//     no keys to sign with. We stop after encoding.
//   - No PendingTx record: no in-flight submission to track until the
//     signed PSBT is broadcast elsewhere.
//   - No ADS commit: the broadcast happens on a different wallet, so
//     the donation cannot atomically tie to "this user's broadcast".

import { normalizeSource } from './sendAsset.js';

/**
 * @typedef {Object} BuildActionPsbtOpts
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {import('./sendAsset.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {{ action: string, params: object }} actionData
 * @property {import('../sdk/submitWithSigner.js').SubmitEncoderOpts} [encoderOpts]
 */

/**
 * @typedef {Object} BuildActionPsbtResult
 * @property {string} psbtHex            unsigned PSBT, hex-encoded
 * @property {string} encoding           encoding chosen by the encoder (OP_RETURN / P2SH / etc.)
 * @property {string} actionString       full XChain action string
 * @property {string} action             mirrored from input
 * @property {number | string} [version] action version when known
 * @property {string} chainId            mirrored from input for downstream routing
 * @property {string} fromAddress        mirrored from input for downstream routing
 */

/**
 * @param {BuildActionPsbtOpts} opts
 * @returns {Promise<BuildActionPsbtResult>}
 */
export async function buildActionPsbt(opts) {
    if (!opts) throw new Error('buildActionPsbt: opts is required');
    if (!opts.chainRegistry) throw new Error('buildActionPsbt: chainRegistry is required');
    if (!opts.sdkRegistry) throw new Error('buildActionPsbt: sdkRegistry is required');
    if (typeof opts.chainId !== 'string' || !opts.chainId) {
        throw new Error('buildActionPsbt: chainId is required');
    }
    if (!opts.actionData || typeof opts.actionData !== 'object') {
        throw new Error('buildActionPsbt: actionData is required');
    }
    if (typeof opts.actionData.action !== 'string' || !opts.actionData.action) {
        throw new Error('buildActionPsbt: actionData.action is required');
    }
    if (!opts.actionData.params || typeof opts.actionData.params !== 'object') {
        throw new Error('buildActionPsbt: actionData.params is required');
    }
    const source = normalizeSource(opts.from, 'buildActionPsbt');

    const descriptor = opts.chainRegistry.get(opts.chainId);
    if (!descriptor) throw new Error(`buildActionPsbt: unknown chain "${opts.chainId}"`);

    const sdk = opts.sdkRegistry.get(opts.chainId);
    const encoder = sdk?.encoder;
    if (!encoder) {
        throw new Error(
            `buildActionPsbt: SDK encoder not initialized for "${opts.chainId}" — call sdkRegistry.initActive([chainId]) first`,
        );
    }

    const createResult = sdk.actions.createAction(opts.actionData);

    const encoderOpts = opts.encoderOpts || {};
    const encoded = await encoder.createTx({
        data: createResult.actionString,
        pubkey: source.publicKey,
        ...encoderOpts,
    });

    return {
        psbtHex: encoded.psbt,
        encoding: encoded.encoding,
        actionString: createResult.actionString,
        action: createResult.action,
        version: createResult.version,
        chainId: opts.chainId,
        fromAddress: source.address,
    };
}
