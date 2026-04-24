// UNSTAKE + CLAIM_REWARDS composers for the §42.7.2 (unstake-lane) +
// §42.7.3 (rewards) authoring surfaces. Both actions are trivially
// small — UNSTAKE is `VERSION|TIER`, CLAIM_REWARDS is `VERSION` — so
// they share a file and the UI combines them in StakingActionForm.jsx
// via a `mode` prop (same pattern as §42.5 ContractFundsForm).
//
// §42.7.2 prose mentions an "amount" but the SDK format is
// VERSION|TIER only. Per STAKE.md, UNSTAKE withdraws the FULL tier
// stake (partial unstake isn't a protocol concept). FOLLOWUP 4 in
// the staking followups doc captures the spec/format divergence.

import { submitAction } from './submitAction.js';
import { normalizeSource } from './sendAsset.js';

/**
 * @typedef {Object} UnstakeActionOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {import('./sendAsset.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {{ VERSION: string, TIER: string }} params
 * @property {number} [fee]
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {(txid: string, opts?: object) => Promise<unknown>} [waitForTxid]
 * @property {object} [waitOpts]
 * @property {(phase: string, data: object) => void} [onProgress]
 * @property {boolean} [trackPendingTx]
 */

/** @param {UnstakeActionOpts} opts */
export async function unstakeAction(opts) {
    if (!opts) throw new Error('unstakeAction: opts is required');
    if (!opts.params || typeof opts.params !== 'object') {
        throw new Error('unstakeAction: params is required');
    }
    if (!opts.params.TIER) throw new Error('unstakeAction: params.TIER is required');
    const source = normalizeSource(opts.from, 'unstakeAction');
    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: null,
        actionSummary: `Unstake ${tierLabelFor(opts.params.TIER)}`,
    };
    return submitAction({
        vault: opts.vault,
        walletId: opts.walletId,
        password: opts.password,
        bip39Passphrase: opts.bip39Passphrase,
        chainRegistry: opts.chainRegistry,
        sdkRegistry: opts.sdkRegistry,
        chainId: opts.chainId,
        actionData: { action: 'UNSTAKE', params: opts.params },
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

/**
 * @typedef {Object} ClaimRewardsActionOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {import('./sendAsset.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {{ VERSION: string }} params
 * @property {number} [fee]
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {(txid: string, opts?: object) => Promise<unknown>} [waitForTxid]
 * @property {object} [waitOpts]
 * @property {(phase: string, data: object) => void} [onProgress]
 * @property {boolean} [trackPendingTx]
 */

/** @param {ClaimRewardsActionOpts} opts */
export async function claimRewardsAction(opts) {
    if (!opts) throw new Error('claimRewardsAction: opts is required');
    if (!opts.params || typeof opts.params !== 'object') {
        throw new Error('claimRewardsAction: params is required');
    }
    const source = normalizeSource(opts.from, 'claimRewardsAction');
    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: null,
        actionSummary: 'Claim staking rewards',
    };
    return submitAction({
        vault: opts.vault,
        walletId: opts.walletId,
        password: opts.password,
        bip39Passphrase: opts.bip39Passphrase,
        chainRegistry: opts.chainRegistry,
        sdkRegistry: opts.sdkRegistry,
        chainId: opts.chainId,
        actionData: { action: 'CLAIM_REWARDS', params: opts.params },
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

function tierLabelFor(tier) {
    return {
        '1': 'Tier 1 (Oracle)',
        '2': 'Tier 2 (Cross-chain validator)',
        '3': 'Tier 3 (Oracle publisher)',
    }[String(tier)] || `Tier ${tier}`;
}
