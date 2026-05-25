// stakeAction — STAKE composer for the §42.7.1 "Stake on Bitcoin"
// form. Mirrors broadcastAction / deployAction. BTC-only per §10.3
// (SDK staking actions are bitcoin-exclusive).
//
// Capability-staking model (capability-staking-model.md §3): one STAKE
// action, no tier. User picks the AMOUNT; capabilities (price,
// cross_chain, oracle_publish, attestation) auto-qualify when the
// pubkey's total stake reaches each capability's MIN_STAKE.
//   - VERSION '1' — new stake for a fresh signing pubkey
//   - VERSION '2' — top-up an existing pubkey owned by SOURCE
// CHAINS and DOGE_ADDRESS were dropped from the action format — those
// sub-features now live in the operator's hub config (spec §8).

import { submitAction } from './submitAction.js';
import { normalizeSource } from './sendToken.js';

/**
 * @typedef {Object} StakeActionOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {import('./sendToken.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {{ VERSION: string, AMOUNT: string, SIGNING_PUBKEY: string }} params
 * @property {number} [fee]
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {(txid: string, opts?: object) => Promise<unknown>} [waitForTxid]
 * @property {object} [waitOpts]
 * @property {(phase: string, data: object) => void} [onProgress]
 * @property {boolean} [trackPendingTx]
 */

/**
 * @param {StakeActionOpts} opts
 */
export async function stakeAction(opts) {
    if (!opts) throw new Error('stakeAction: opts is required');
    if (!opts.params || typeof opts.params !== 'object') {
        throw new Error('stakeAction: params is required');
    }
    const version = String(opts.params.VERSION || '');
    if (version !== '1' && version !== '2') {
        throw new Error('stakeAction: params.VERSION must be "1" (new stake) or "2" (top-up)');
    }
    if (!opts.params.AMOUNT) {
        throw new Error('stakeAction: params.AMOUNT is required');
    }
    if (!/^[0-9]+(\.[0-9]{1,8})?$/.test(String(opts.params.AMOUNT))) {
        throw new Error('stakeAction: AMOUNT must be a positive decimal with at most 8 fractional digits');
    }
    if (Number(opts.params.AMOUNT) <= 0) {
        throw new Error('stakeAction: AMOUNT must be greater than 0');
    }
    if (!opts.params.SIGNING_PUBKEY) {
        throw new Error('stakeAction: params.SIGNING_PUBKEY is required');
    }
    if (!/^[0-9a-fA-F]{64}$/.test(opts.params.SIGNING_PUBKEY)) {
        throw new Error('stakeAction: SIGNING_PUBKEY must be 64 hex chars');
    }
    const source = normalizeSource(opts.from, 'stakeAction');
    const verb = version === '2' ? 'Top up stake' : 'Stake';

    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: null,
        actionSummary: `${verb} ${opts.params.AMOUNT} XCHAIN`,
    };

    return submitAction({
        vault: opts.vault,
        walletId: opts.walletId,
        password: opts.password,
        bip39Passphrase: opts.bip39Passphrase,
        chainRegistry: opts.chainRegistry,
        sdkRegistry: opts.sdkRegistry,
        chainId: opts.chainId,
        actionData: { action: 'STAKE', params: opts.params },
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
