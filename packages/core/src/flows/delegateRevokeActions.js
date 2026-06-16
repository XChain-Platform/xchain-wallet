// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// DELEGATE composers (rotate + revoke) for the §42.7.2 delegation-lane
// authoring surfaces. The wire-level DELEGATE action has four versions:
//   v0 — capability rotate     (VERSION|NEW_SIGNING_PUBKEY)
//   v1 — contract rotate       (VERSION|NEW_SIGNING_PUBKEY|TARGET_CONTRACT_INDEX|TICK)
//   v2 — capability revoke     (VERSION|SIGNING_PUBKEY)
//   v3 — contract revoke       (VERSION|SIGNING_PUBKEY|TARGET_CONTRACT_INDEX|TICK)
// The capability variants (v0/v2) are exposed here as `delegateAction`
// and `revokeDelegationAction` (the UI label for v2 stays "Revoke
// delegation" for clarity even though both share the DELEGATE wire
// name). Contract-targeted variants live in contractStakeAction.js.
//
// All signing pubkey fields are 64-hex Ed25519 pubkeys. The composers
// guard the format up-front so a malformed input short-circuits before
// we hit the SDK encoder. UI is in DelegationActionForm.jsx.

import { submitAction } from './submitAction.js';
import { normalizeSource } from './sendToken.js';

/**
 * @typedef {Object} DelegateActionOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {import('./sendToken.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {{ VERSION: string, NEW_SIGNING_PUBKEY: string }} params
 * @property {number} [fee]
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {(txid: string, opts?: object) => Promise<unknown>} [waitForTxid]
 * @property {object} [waitOpts]
 * @property {(phase: string, data: object) => void} [onProgress]
 * @property {boolean} [trackPendingTx]
 */

/** @param {DelegateActionOpts} opts */
export async function delegateAction(opts) {
    if (!opts) throw new Error('delegateAction: opts is required');
    if (!opts.params || typeof opts.params !== 'object') {
        throw new Error('delegateAction: params is required');
    }
    if (!opts.params.NEW_SIGNING_PUBKEY) {
        throw new Error('delegateAction: params.NEW_SIGNING_PUBKEY is required');
    }
    if (!/^[0-9a-fA-F]{64}$/.test(opts.params.NEW_SIGNING_PUBKEY)) {
        throw new Error('delegateAction: NEW_SIGNING_PUBKEY must be 64 hex chars');
    }
    const source = normalizeSource(opts.from, 'delegateAction');
    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: null,
        actionSummary: `Delegate signing key ${opts.params.NEW_SIGNING_PUBKEY.slice(0, 12)}…`,
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
        actionData: { action: 'DELEGATE', params: opts.params },
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
 * @typedef {Object} RevokeDelegationActionOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {import('./sendToken.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {{ VERSION: string, SIGNING_PUBKEY: string }} params
 * @property {number} [fee]
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {(txid: string, opts?: object) => Promise<unknown>} [waitForTxid]
 * @property {object} [waitOpts]
 * @property {(phase: string, data: object) => void} [onProgress]
 * @property {boolean} [trackPendingTx]
 */

/** @param {RevokeDelegationActionOpts} opts */
export async function revokeDelegationAction(opts) {
    if (!opts) throw new Error('revokeDelegationAction: opts is required');
    if (!opts.params || typeof opts.params !== 'object') {
        throw new Error('revokeDelegationAction: params is required');
    }
    if (!opts.params.SIGNING_PUBKEY) {
        throw new Error('revokeDelegationAction: params.SIGNING_PUBKEY is required');
    }
    if (!/^[0-9a-fA-F]{64}$/.test(opts.params.SIGNING_PUBKEY)) {
        throw new Error('revokeDelegationAction: SIGNING_PUBKEY must be 64 hex chars');
    }
    const source = normalizeSource(opts.from, 'revokeDelegationAction');
    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: null,
        actionSummary: `Revoke delegation ${opts.params.SIGNING_PUBKEY.slice(0, 12)}…`,
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
        // DELEGATE v2 = capability revoke (was its own REVOKE_DELEGATION action pre-consolidation)
        actionData: { action: 'DELEGATE', params: { VERSION: '2', ...opts.params } },
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
