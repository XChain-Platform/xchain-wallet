// stakeAction — STAKE composer for the §42.7.1 "Stake on Bitcoin"
// form. Mirrors broadcastAction / deployAction. BTC-only per §10.3
// (SDK staking actions are bitcoin-exclusive).
//
// Amount is not a user-chosen field — the protocol fixes it per tier
// (Tier 1: 1,000 XCHAIN; Tier 2: 5,000 XCHAIN; Tier 3: 500 XCHAIN per
// STAKE.md). The indexer looks up the tier-amount at processing time.
// CHAINS is only populated for Tier 2 (comma-separated BTC/LTC/DOGE
// subset); Tier 1 passes an empty string.

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
 * @property {{ VERSION: string, TIER: string, CHAINS?: string, SIGNING_PUBKEY: string }} params
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
    if (!opts.params.TIER) throw new Error('stakeAction: params.TIER is required');
    if (!opts.params.SIGNING_PUBKEY) {
        throw new Error('stakeAction: params.SIGNING_PUBKEY is required');
    }
    if (!/^[0-9a-fA-F]{64}$/.test(opts.params.SIGNING_PUBKEY)) {
        throw new Error('stakeAction: SIGNING_PUBKEY must be 64 hex chars');
    }
    if (opts.params.TIER === '2' || opts.params.TIER === 2) {
        if (!opts.params.CHAINS) {
            throw new Error('stakeAction: CHAINS is required for Tier 2');
        }
    }
    const source = normalizeSource(opts.from, 'stakeAction');
    const tierLabel = {
        '1': 'Tier 1 (Oracle)',
        '2': 'Tier 2 (Cross-chain validator)',
        '3': 'Tier 3 (Oracle publisher)',
    }[String(opts.params.TIER)] || `Tier ${opts.params.TIER}`;

    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: null,
        actionSummary: `Stake as ${tierLabel}${opts.params.CHAINS ? ` for ${opts.params.CHAINS}` : ''}`,
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
