// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// deployAction — DEPLOY composer for the §42.6 "Deploy new contract"
// form. Mirrors broadcastAction / dispenserAction: takes vault +
// registries + chain + source address + DEPLOY params, forwards to
// submitAction.
//
// The contract source code is hex-encoded by the SDK validator chain
// before it reaches the encoder; callers pass raw UTF-8 source as
// params.CODE and the SDK sets CODE_ENCODING='hex' internally (see
// xchain-sdk validator.js). GAS_LIMIT is a decimal string per the
// protocol; NAME and CONSTRUCTOR_PARAMS are optional.

import { submitAction } from './submitAction.js';
import { normalizeSource } from './sendToken.js';

/**
 * @typedef {Object} DeployActionOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {import('./sendToken.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {Record<string, string>} params      DEPLOY fields (VERSION, CODE, GAS_LIMIT; optional NAME, CONSTRUCTOR_PARAMS)
 * @property {number} [fee]
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {(txid: string, opts?: object) => Promise<unknown>} [waitForTxid]
 * @property {object} [waitOpts]
 * @property {(phase: string, data: object) => void} [onProgress]
 * @property {boolean} [trackPendingTx]
 */

/**
 * @param {DeployActionOpts} opts
 * @returns {Promise<import('../sdk/submitWithSigner.js').SubmitResult>}
 */
export async function deployAction(opts) {
    if (!opts) throw new Error('deployAction: opts is required');
    if (!opts.params || typeof opts.params !== 'object') {
        throw new Error('deployAction: params is required');
    }
    if (!opts.params.CODE || typeof opts.params.CODE !== 'string') {
        throw new Error('deployAction: params.CODE is required');
    }
    if (!opts.params.GAS_LIMIT) {
        throw new Error('deployAction: params.GAS_LIMIT is required');
    }
    const source = normalizeSource(opts.from, 'deployAction');

    const name = opts.params.NAME || '(unnamed)';
    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: null,
        actionSummary: `Deploy contract "${name}" (gas ${opts.params.GAS_LIMIT})`,
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
        actionData: { action: 'DEPLOY', params: opts.params },
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
