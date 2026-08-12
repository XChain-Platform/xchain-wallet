// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// DEPOSIT + WITHDRAW composers for the §42.5 "Deposit / Withdraw"
// forms. Both actions take the same field shape
// (CONTRACT_ACTION_INDEX + TICK + QUANTITY), so they share a helper.
// Kept as two exported flows rather than one mode-switched flow so
// the action-name string stays visible at the call site.

import { submitAction } from './submitAction.js';
import { normalizeSource } from './sendToken.js';

/**
 * @typedef {Object} ContractFundsOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {import('./sendToken.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {{ VERSION: string, CONTRACT_ACTION_INDEX: string, TICK: string, QUANTITY: string }} params
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
 * @param {ContractFundsOpts} opts
 * @param {'DEPOSIT' | 'WITHDRAW'} action
 */
function compose(opts, action) {
    if (!opts) throw new Error(action.toLowerCase() + 'Action: opts is required');
    if (!opts.params || typeof opts.params !== 'object') {
        throw new Error(action.toLowerCase() + 'Action: params is required');
    }
    if (!opts.params.CONTRACT_ACTION_INDEX) {
        throw new Error(action.toLowerCase() + 'Action: params.CONTRACT_ACTION_INDEX is required');
    }
    if (!opts.params.TICK) {
        throw new Error(action.toLowerCase() + 'Action: params.TICK is required');
    }
    if (!opts.params.QUANTITY) {
        throw new Error(action.toLowerCase() + 'Action: params.QUANTITY is required');
    }
    const source = normalizeSource(opts.from, action.toLowerCase() + 'Action');
    const verb = action === 'DEPOSIT' ? 'Deposit' : 'Withdraw';
    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: null,
        actionSummary: `${verb} ${opts.params.QUANTITY} ${opts.params.TICK} ${verb === 'Deposit' ? 'to' : 'from'} contract #${opts.params.CONTRACT_ACTION_INDEX}`,
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
        actionData: { action, params: opts.params },
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

/** @param {ContractFundsOpts} opts */
export function depositAction(opts) {
    return compose(opts, 'DEPOSIT');
}

/** @param {ContractFundsOpts} opts */
export function withdrawAction(opts) {
    return compose(opts, 'WITHDRAW');
}
