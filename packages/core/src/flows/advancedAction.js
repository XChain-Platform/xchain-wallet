// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Generic submit-any-action flow (§40.10). The authoring form is the
// only caller; this wrapper exists so the background host can mount a
// single `action.advanced` handler rather than exposing a raw
// `submitAction` path (which would let a malicious renderer skip the
// validation layer).
//
// The action + params are passed straight through to submitAction;
// the SDK's validator runs inside createAction() before signing, so
// malformed params fail at sign time with a structured error rather
// than silently broadcasting bad data.

import { submitAction } from './submitAction.js';
import { normalizeSource } from './sendToken.js';

/**
 * @typedef {Object} AdvancedActionOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {import('./sendToken.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {string} action                              action name (will be uppercased)
 * @property {Record<string, unknown>} params             action-specific fields
 * @property {number} [fee]
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {import('../sdk/submitWithSigner.js').PrebuiltPsbt} [prebuiltPsbt] single-encode pipeline: sign this exact composed PSBT byte-identically (the one the ConfirmActionModal previewed + tamper-checked) instead of rebuilding.
 * @property {(txid: string, opts?: object) => Promise<unknown>} [waitForTxid]
 * @property {object} [waitOpts]
 * @property {(phase: string, data: object) => void} [onProgress]
 * @property {boolean} [trackPendingTx]
 */

/**
 * @param {AdvancedActionOpts} opts
 * @returns {Promise<import('../sdk/submitWithSigner.js').SubmitResult>}
 */
export async function advancedAction(opts) {
    if (!opts) throw new Error('advancedAction: opts is required');
    if (typeof opts.action !== 'string' || opts.action.length === 0) {
        throw new Error('advancedAction: action is required');
    }
    if (!opts.params || typeof opts.params !== 'object') {
        throw new Error('advancedAction: params is required');
    }
    const source = normalizeSource(opts.from, 'advancedAction');
    const actionName = String(opts.action).toUpperCase();

    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: null,
        actionSummary: `Submit ${actionName}`,
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
        actionData: { action: actionName, params: opts.params },
        encoderOpts: {
            pubkey: source.publicKey,
            // Make the SDK select funding UTXOs BY ADDRESS (sourceAddress is
            // SDK-side only, never on the create_tx wire) and return change to
            // the spender. Without these the encoder falls back to selecting by
            // `pubkey`, which the utxo-tracker cannot turn into a script and
            // rejects with "has no matching Script" - the same D-7 failure the
            // Send path fixed in composeForConfirm.js. The confirm-modal flows
            // avoid it by supplying a prebuiltPsbt (createTx is skipped); this
            // generic path builds the tx live, so it must pass them itself.
            sourceAddress: source.address,
            change: source.address,
            ...(opts.fee !== undefined && { fee: opts.fee }),
            ...(opts.feePerKb !== undefined && { feePerKb: opts.feePerKb }),
            ...(opts.rbf !== undefined && { rbf: opts.rbf }),
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
