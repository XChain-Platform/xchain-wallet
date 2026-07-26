// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// airdropAction: authors an AIRDROP action (§40.9; protocol docs:
// xchain-documentation/protocol/actions/AIRDROP.md). Mirrors
// dividendAction / broadcastAction: takes vault + registries + chain +
// source address + AIRDROP params, forwards to submitAction.
//
// The §40.9 UX composes two transactions (LIST first, AIRDROP
// referencing the LIST's ACTION_INDEX once indexed). This flow handles
// only the AIRDROP half; the LIST half lives in createList.js. The
// coordinating form (AirdropForm) owns the stage machine that waits
// for the LIST to be indexed between the two signs.
//
// Only v0 (single airdrop) is exposed at the flow level today; multi-
// airdrop variants (v1/v2/v3) are decoded but have no authoring path.

import { submitAction } from './submitAction.js';
import { normalizeSource } from './sendToken.js';

/**
 * @typedef {Object} AirdropActionOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {import('./sendToken.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {Record<string, string>} params   AIRDROP field map (VERSION, TICK, AMOUNT, LIST_ACTION_INDEX, optional MEMO)
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
 * @param {AirdropActionOpts} opts
 * @returns {Promise<import('../sdk/submitWithSigner.js').SubmitResult>}
 */
export async function airdropAction(opts) {
    if (!opts) throw new Error('airdropAction: opts is required');
    if (!opts.params || typeof opts.params !== 'object') {
        throw new Error('airdropAction: params is required');
    }
    if (typeof opts.params.TICK !== 'string' || opts.params.TICK.length === 0) {
        throw new Error('airdropAction: params.TICK is required');
    }
    if (typeof opts.params.AMOUNT !== 'string' || opts.params.AMOUNT.length === 0) {
        throw new Error('airdropAction: params.AMOUNT is required');
    }
    if (typeof opts.params.LIST_ACTION_INDEX !== 'string'
        || opts.params.LIST_ACTION_INDEX.length === 0) {
        throw new Error('airdropAction: params.LIST_ACTION_INDEX is required');
    }
    const source = normalizeSource(opts.from, 'airdropAction');

    const tick = opts.params.TICK;
    const amount = opts.params.AMOUNT;
    const listIdx = opts.params.LIST_ACTION_INDEX;
    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: null,
        actionSummary: `Airdrop ${amount} ${tick} to list #${listIdx}`,
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
        actionData: { action: 'AIRDROP', params: opts.params },
        encoderOpts: {
            pubkey: source.publicKey,
            ...(opts.fee !== undefined && { fee: opts.fee }),
            ...(opts.feePerKb !== undefined && { feePerKb: opts.feePerKb }),
            ...(opts.rbf !== undefined && { rbf: opts.rbf }),
            // PC-51: opt-in native-coin protocol fee (quotable action); submitAction's
            // preflight refuses at sign time (NativeFeeForfeitError) if unpriceable.
            ...(opts.payFeeInNativeCoin !== undefined && { payFeeInNativeCoin: opts.payFeeInNativeCoin }),
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
