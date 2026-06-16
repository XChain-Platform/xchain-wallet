// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// mintToken — convenience wrapper for the MINT action (§Phase 2
// authoring surface; protocol docs: xchain-documentation/protocol/
// actions/MINT.md). Mirrors issueToken's shape: takes vault +
// registries + chain + source address + MINT params, forwards to
// submitAction, returns the standard SubmitResult.
//
// Callers on the UI side (MintForm, messaging.mintToken) build the
// params themselves — the SDK's Actions.createAction runs the
// authoritative validator. The flow only guards required inputs so
// bad callers get a loud error before we hit the signer.

import { submitAction } from './submitAction.js';
import { normalizeSource } from './sendToken.js';

/**
 * @typedef {Object} MintTokenOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {import('./sendToken.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {Record<string, string>} params            MINT field map (TICK, AMOUNT, optional DESTINATION)
 * @property {number} [fee]
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {(txid: string, opts?: object) => Promise<unknown>} [waitForTxid]
 * @property {object} [waitOpts]
 * @property {(phase: string, data: object) => void} [onProgress]
 * @property {boolean} [trackPendingTx]
 */

/**
 * @param {MintTokenOpts} opts
 * @returns {Promise<import('../sdk/submitWithSigner.js').SubmitResult>}
 */
export async function mintToken(opts) {
    if (!opts) throw new Error('mintToken: opts is required');
    if (!opts.params || typeof opts.params !== 'object') {
        throw new Error('mintToken: params is required');
    }
    if (typeof opts.params.TICK !== 'string' || opts.params.TICK.length === 0) {
        throw new Error('mintToken: params.TICK is required');
    }
    if (typeof opts.params.AMOUNT !== 'string' || opts.params.AMOUNT.length === 0) {
        throw new Error('mintToken: params.AMOUNT is required');
    }
    const source = normalizeSource(opts.from, 'mintToken');

    const tick = opts.params.TICK;
    const amount = opts.params.AMOUNT;
    const destination = opts.params.DESTINATION;
    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: destination || null,
        actionSummary: destination
            ? `Mint ${amount} ${tick} to ${destination}`
            : `Mint ${amount} ${tick}`,
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
        actionData: { action: 'MINT', params: opts.params },
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
