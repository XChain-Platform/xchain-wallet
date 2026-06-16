// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// executeAction — EXECUTE composer for the §42.4 "Execute contract
// method" form. Mirrors broadcastAction / deployAction: takes vault +
// registries + chain + source + params (VERSION, CONTRACT_ACTION_INDEX,
// METHOD, optional PARAMS array), forwards to submitAction.
//
// PARAMS is variadic in the protocol format (...PARAMS after METHOD).
// The SDK validator accepts an array; pipe-serialization happens in
// the encoder. Callers collecting a pipe-delimited string from the UI
// must split before passing in — this flow does NOT split for them,
// so the split rule stays visible at the call site.

import { submitAction } from './submitAction.js';
import { normalizeSource } from './sendToken.js';

/**
 * @typedef {Object} ExecuteActionOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {import('./sendToken.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {{ VERSION: string, CONTRACT_ACTION_INDEX: string, METHOD: string, PARAMS?: string[], GAS_LIMIT?: string }} params
 * @property {number} [fee]
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {(txid: string, opts?: object) => Promise<unknown>} [waitForTxid]
 * @property {object} [waitOpts]
 * @property {(phase: string, data: object) => void} [onProgress]
 * @property {boolean} [trackPendingTx]
 */

/**
 * @param {ExecuteActionOpts} opts
 * @returns {Promise<import('../sdk/submitWithSigner.js').SubmitResult>}
 */
export async function executeAction(opts) {
    if (!opts) throw new Error('executeAction: opts is required');
    if (!opts.params || typeof opts.params !== 'object') {
        throw new Error('executeAction: params is required');
    }
    if (!opts.params.CONTRACT_ACTION_INDEX) {
        throw new Error('executeAction: params.CONTRACT_ACTION_INDEX is required');
    }
    if (!opts.params.METHOD) {
        throw new Error('executeAction: params.METHOD is required');
    }
    const source = normalizeSource(opts.from, 'executeAction');

    const paramSummary = Array.isArray(opts.params.PARAMS) && opts.params.PARAMS.length > 0
        ? ` (${opts.params.PARAMS.length} arg${opts.params.PARAMS.length === 1 ? '' : 's'})`
        : '';
    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: null,
        actionSummary: `Execute ${opts.params.METHOD}${paramSummary} on contract #${opts.params.CONTRACT_ACTION_INDEX}`,
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
        actionData: { action: 'EXECUTE', params: opts.params },
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
