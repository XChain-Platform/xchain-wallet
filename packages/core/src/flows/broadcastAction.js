// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// broadcastAction: convenience wrapper for the BROADCAST action
// (§40.6; protocol docs: xchain-documentation/protocol/actions/
// BROADCAST.md). Mirrors issueToken / mintToken / destroyToken: takes
// vault + registries + chain + source address + BROADCAST params,
// forwards to submitAction.
//
// BROADCAST publishes arbitrary text / oracle values / feed references
// on-chain, tied to the source address. The SDK validator (formats.js
// + validator.js) enforces version-specific field requirements; this
// flow only guards that at least MESSAGE or BROADCAST_ACTION_INDEX is
// present so bad callers get a loud error before we hit the signer.

import { submitAction } from './submitAction.js';
import { normalizeSource } from './sendToken.js';

/**
 * @typedef {Object} BroadcastActionOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {import('./sendToken.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {Record<string, string>} params      BROADCAST field map (VERSION, MESSAGE or BROADCAST_ACTION_INDEX, optional VALUE, FEE, MEMO)
 * @property {number} [fee]
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {import('../sdk/submitWithSigner.js').PrebuiltPsbt} [prebuiltPsbt]   single-encode pipeline: sign this exact composed PSBT byte-identically (the one the ConfirmActionModal previewed + tamper-checked) instead of rebuilding.
 * @property {(txid: string, opts?: object) => Promise<unknown>} [waitForTxid]
 * @property {object} [waitOpts]
 * @property {(phase: string, data: object) => void} [onProgress]
 * @property {boolean} [trackPendingTx]
 */

/**
 * @param {BroadcastActionOpts} opts
 * @returns {Promise<import('../sdk/submitWithSigner.js').SubmitResult>}
 */
export async function broadcastAction(opts) {
    if (!opts) throw new Error('broadcastAction: opts is required');
    if (!opts.params || typeof opts.params !== 'object') {
        throw new Error('broadcastAction: params is required');
    }
    const hasMessage = typeof opts.params.MESSAGE === 'string' && opts.params.MESSAGE.length > 0;
    const hasIndex = typeof opts.params.BROADCAST_ACTION_INDEX === 'string'
        && opts.params.BROADCAST_ACTION_INDEX.length > 0;
    if (!hasMessage && !hasIndex) {
        throw new Error('broadcastAction: params.MESSAGE or params.BROADCAST_ACTION_INDEX is required');
    }
    const source = normalizeSource(opts.from, 'broadcastAction');

    const message = opts.params.MESSAGE;
    const value = opts.params.VALUE;
    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: null,
        actionSummary: hasMessage && value
            ? `Broadcast "${message}" (value ${value})`
            : hasMessage
                ? `Broadcast "${message}"`
                : `Broadcast feed result #${opts.params.BROADCAST_ACTION_INDEX}`,
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
        actionData: { action: 'BROADCAST', params: opts.params },
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
