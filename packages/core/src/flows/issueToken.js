// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// issueToken — convenience wrapper for the ISSUE action (§Phase 2
// authoring surface; protocol docs: xchain-documentation/protocol/
// actions/ISSUE.md). Mirrors sendToken's shape: takes the vault +
// registries + chain + source address + params, forwards to
// submitAction, returns the standard SubmitResult with the PendingTx
// record written by the flow.
//
// Params are the ISSUE v0 / v1-v5 field map already composed by the
// caller (the Token Creation Wizard's composeIssueParams). We don't
// re-validate here — the SDK's Actions.createAction runs the
// authoritative validator. Callers who need a dry-run should call
// sdk.Actions.validateAction directly before submitting.

import { submitAction } from './submitAction.js';
import { normalizeSource } from './sendToken.js';

/**
 * @typedef {Object} IssueTokenOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {import('./sendToken.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {Record<string, string>} params            ISSUE field map (TICK, MAX_SUPPLY, ...)
 * @property {number} [fee]
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {(txid: string, opts?: object) => Promise<unknown>} [waitForTxid]
 * @property {object} [waitOpts]
 * @property {(phase: string, data: object) => void} [onProgress]
 * @property {boolean} [trackPendingTx]
 */

/**
 * @param {IssueTokenOpts} opts
 * @returns {Promise<import('../sdk/submitWithSigner.js').SubmitResult>}
 */
export async function issueToken(opts) {
    if (!opts) throw new Error('issueToken: opts is required');
    if (!opts.params || typeof opts.params !== 'object') {
        throw new Error('issueToken: params is required');
    }
    if (typeof opts.params.TICK !== 'string' || opts.params.TICK.length === 0) {
        throw new Error('issueToken: params.TICK is required');
    }
    const source = normalizeSource(opts.from, 'issueToken');

    const tick = opts.params.TICK;
    const maxSupply = opts.params.MAX_SUPPLY;
    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: opts.params.TRANSFER || null,
        actionSummary: maxSupply
            ? `Create token ${tick} with max supply ${maxSupply}`
            : `Configure token ${tick}`,
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
        actionData: { action: 'ISSUE', params: opts.params },
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
