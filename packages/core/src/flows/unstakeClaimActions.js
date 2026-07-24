// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// UNSTAKE + COLLECT composers for the §42.7.2 (unstake-lane) +
// §42.7.3 (rewards) authoring surfaces. Both actions are small:
// UNSTAKE is `VERSION|SIGNING_PUBKEY[|AMOUNT]`, COLLECT is
// `VERSION[|AMOUNT]`, so they share a file and the UI combines them
// in StakingActionForm.jsx via a `mode` prop (same pattern as §42.5
// ContractFundsForm).
//
// Capability-staking model (capability-staking-model.md §3): UNSTAKE
// addresses a specific signing pubkey, not a tier. AMOUNT is the
//  optional partial (indexer gate PARTIAL_UNSTAKE_COLLECT):
// absent = full sweep of the pubkey's active balance / full pending
// rewards, exactly the legacy behavior; present = only that much is
// unstaked/claimed and the residual stays staked/pending. The
// indexer rejects an over-ask, so the UI bounds the field by the
// available balance before submit.

import { submitAction } from './submitAction.js';
import { normalizeSource } from './sendToken.js';

/**
 * @typedef {Object} UnstakeActionOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {import('./sendToken.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {{ VERSION: string, SIGNING_PUBKEY: string, AMOUNT?: string }} params  AMOUNT optional: partial unstake ; absent = full sweep
 * @property {number} [fee]
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {import('../sdk/submitWithSigner.js').PrebuiltPsbt} [prebuiltPsbt]   single-encode pipeline: sign this exact composed PSBT byte-identically (the one the ConfirmActionModal previewed + tamper-checked) instead of rebuilding.
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
    if (!opts.params.SIGNING_PUBKEY) {
        throw new Error('unstakeAction: params.SIGNING_PUBKEY is required');
    }
    if (!/^[0-9a-fA-F]{64}$/.test(opts.params.SIGNING_PUBKEY)) {
        throw new Error('unstakeAction: SIGNING_PUBKEY must be 64 hex chars');
    }
    if (opts.params.AMOUNT !== undefined) {
        if (!/^[0-9]+(\.[0-9]+)?$/.test(String(opts.params.AMOUNT)) || Number(opts.params.AMOUNT) <= 0) {
            throw new Error('unstakeAction: AMOUNT must be a positive decimal when present');
        }
    }
    const source = normalizeSource(opts.from, 'unstakeAction');
    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: null,
        actionSummary: opts.params.AMOUNT !== undefined
            ? `Unstake ${opts.params.AMOUNT} XCHAIN (${opts.params.SIGNING_PUBKEY.slice(0, 12)}…)`
            : `Unstake (${opts.params.SIGNING_PUBKEY.slice(0, 12)}…)`,
    };
    return submitAction({
        vault: opts.vault,
        walletId: opts.walletId,
        password: opts.password,
        signer: opts.signer,
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
        prebuiltPsbt: opts.prebuiltPsbt,
        pendingTxMeta,
        waitForTxid: opts.waitForTxid,
        waitOpts: opts.waitOpts,
        onProgress: opts.onProgress,
    });
}

/**
 * @typedef {Object} CollectActionOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {import('./sendToken.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {{ VERSION: string, AMOUNT?: string }} params  AMOUNT optional: partial claim ; absent = claim all pending rewards
 * @property {number} [fee]
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {import('../sdk/submitWithSigner.js').PrebuiltPsbt} [prebuiltPsbt]   single-encode pipeline: sign this exact composed PSBT byte-identically (the one the ConfirmActionModal previewed + tamper-checked) instead of rebuilding.
 * @property {(txid: string, opts?: object) => Promise<unknown>} [waitForTxid]
 * @property {object} [waitOpts]
 * @property {(phase: string, data: object) => void} [onProgress]
 * @property {boolean} [trackPendingTx]
 */

/** @param {CollectActionOpts} opts */
export async function collectAction(opts) {
    if (!opts) throw new Error('collectAction: opts is required');
    if (!opts.params || typeof opts.params !== 'object') {
        throw new Error('collectAction: params is required');
    }
    if (opts.params.AMOUNT !== undefined) {
        if (!/^[0-9]+(\.[0-9]+)?$/.test(String(opts.params.AMOUNT)) || Number(opts.params.AMOUNT) <= 0) {
            throw new Error('collectAction: AMOUNT must be a positive decimal when present');
        }
    }
    const source = normalizeSource(opts.from, 'collectAction');
    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: null,
        actionSummary: opts.params.AMOUNT !== undefined
            ? `Collect ${opts.params.AMOUNT} XCHAIN staking rewards`
            : 'Collect staking rewards',
    };
    return submitAction({
        vault: opts.vault,
        walletId: opts.walletId,
        password: opts.password,
        signer: opts.signer,
        bip39Passphrase: opts.bip39Passphrase,
        chainRegistry: opts.chainRegistry,
        sdkRegistry: opts.sdkRegistry,
        chainId: opts.chainId,
        actionData: { action: 'COLLECT', params: opts.params },
        encoderOpts: {
            pubkey: source.publicKey,
            ...(opts.fee !== undefined && { fee: opts.fee }),
            ...(opts.feePerKb !== undefined && { feePerKb: opts.feePerKb }),
            ...(opts.rbf !== undefined && { rbf: opts.rbf }),
        },
        signingPaths: [source.derivationPath
            ? { inputIndex: 0, path: source.derivationPath }
            : { inputIndex: 0, addressId: source.addressId }],
        prebuiltPsbt: opts.prebuiltPsbt,
        pendingTxMeta,
        waitForTxid: opts.waitForTxid,
        waitOpts: opts.waitOpts,
        onProgress: opts.onProgress,
    });
}
