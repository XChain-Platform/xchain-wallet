// destroyAsset — convenience wrapper for the DESTROY action (§Phase 2
// authoring surface; protocol docs: xchain-documentation/protocol/
// actions/DESTROY.md). Mirrors issueToken / mintAsset: takes vault +
// registries + chain + source address + DESTROY params, forwards to
// submitAction.
//
// DESTROY is irreversible — the action burns the caller's balance of
// TICK. The SDK validator enforces ownership; this flow only guards
// required inputs to catch obvious programming errors before hitting
// the signer.

import { submitAction } from './submitAction.js';
import { normalizeSource } from './sendAsset.js';

/**
 * @typedef {Object} DestroyAssetOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {import('./sendAsset.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {Record<string, string>} params            DESTROY field map (TICK, AMOUNT)
 * @property {number} [fee]
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {(txid: string, opts?: object) => Promise<unknown>} [waitForTxid]
 * @property {object} [waitOpts]
 * @property {(phase: string, data: object) => void} [onProgress]
 * @property {boolean} [trackPendingTx]
 */

/**
 * @param {DestroyAssetOpts} opts
 * @returns {Promise<import('../sdk/submitWithSigner.js').SubmitResult>}
 */
export async function destroyAsset(opts) {
    if (!opts) throw new Error('destroyAsset: opts is required');
    if (!opts.params || typeof opts.params !== 'object') {
        throw new Error('destroyAsset: params is required');
    }
    if (typeof opts.params.TICK !== 'string' || opts.params.TICK.length === 0) {
        throw new Error('destroyAsset: params.TICK is required');
    }
    if (typeof opts.params.AMOUNT !== 'string' || opts.params.AMOUNT.length === 0) {
        throw new Error('destroyAsset: params.AMOUNT is required');
    }
    const source = normalizeSource(opts.from, 'destroyAsset');

    const tick = opts.params.TICK;
    const amount = opts.params.AMOUNT;
    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: null,
        actionSummary: `Destroy ${amount} ${tick}`,
    };

    return submitAction({
        vault: opts.vault,
        walletId: opts.walletId,
        password: opts.password,
        bip39Passphrase: opts.bip39Passphrase,
        chainRegistry: opts.chainRegistry,
        sdkRegistry: opts.sdkRegistry,
        chainId: opts.chainId,
        actionData: { action: 'DESTROY', params: opts.params },
        encoderOpts: {
            pubkey: source.publicKey,
            ...(opts.fee !== undefined && { fee: opts.fee }),
            ...(opts.feePerKb !== undefined && { feePerKb: opts.feePerKb }),
            ...(opts.rbf !== undefined && { rbf: opts.rbf }),
        },
        signingPaths: [source.derivationPath
            ? { inputIndex: 0, path: source.derivationPath }
            : { inputIndex: 0, addressId: source.addressId }],
        pendingTxMeta,
        waitForTxid: opts.waitForTxid,
        waitOpts: opts.waitOpts,
        onProgress: opts.onProgress,
    });
}
