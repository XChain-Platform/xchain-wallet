// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// orderAction: convenience wrapper for the ORDER action (§41.3.4;
// protocol docs: xchain-documentation/protocol/actions/ORDER.md).
// Mirrors dispenserAction: takes vault + registries + chain + source
// address + ORDER params, forwards to submitAction.
//
// ORDER is the limit-order action. A buy order for tick1/tick2 means
// "give N tick2, get M tick1" at an implied price of N/M. The form
// composes the pair into (GIVE_TICK, GIVE_AMOUNT, GET_TICK, GET_AMOUNT)
// and this wrapper forwards the whole thing to the SDK's validator.
//
// Optional fields (EXPIRATION, FEE_REQUIRED, FEE_PROVIDED) pass
// through unchanged. Phase 3 Step 6 uses EXPIRATION in blocks.

import { submitAction } from './submitAction.js';
import { normalizeSource } from './sendToken.js';

/**
 * @typedef {Object} OrderActionOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {import('./sendToken.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {Record<string, string>} params   ORDER field map (GIVE_TICK, GIVE_AMOUNT, GET_TICK, GET_AMOUNT, EXPIRATION, …)
 * @property {number} [fee]
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {(txid: string, opts?: object) => Promise<unknown>} [waitForTxid]
 * @property {object} [waitOpts]
 * @property {(phase: string, data: object) => void} [onProgress]
 * @property {boolean} [trackPendingTx]
 * @property {import('../sdk/submitWithSigner.js').PrebuiltPsbt} [prebuiltPsbt]   single-encode pipeline: sign this exact composed PSBT byte-identically (the one the ConfirmActionModal previewed + tamper-checked) instead of rebuilding.
 */

/**
 * @param {OrderActionOpts} opts
 */
export async function orderAction(opts) {
    if (!opts) throw new Error('orderAction: opts is required');
    if (!opts.params || typeof opts.params !== 'object') {
        throw new Error('orderAction: params is required');
    }
    // Amounts drop out of the required set when the matching side trades
    // ownership (selling a token name escrows the ownership record, not a
    // balance, so GIVE_AMOUNT is empty); the SDK validator additionally enforces
    // they're empty. GET_TICK is not required; native-coin orders leave it
    // empty (the coin is GET_COIN). Field order preserved so the surfaced
    // error matches the SDK validator's. GIVE_TICK stays required: every
    // wallet-composed order names the token it's giving.
    const giveOwn = Number(opts.params.GIVE_OWNERSHIP || 0) === 1;
    const getOwn = Number(opts.params.GET_OWNERSHIP || 0) === 1;
    const required = ['GIVE_TICK'];
    if (!giveOwn) required.push('GIVE_AMOUNT');
    if (!getOwn) required.push('GET_AMOUNT');
    for (const field of required) {
        if (typeof opts.params[field] !== 'string' || opts.params[field].length === 0) {
            throw new Error(`orderAction: params.${field} is required`);
        }
    }
    const source = normalizeSource(opts.from, 'orderAction');

    const giveTick = opts.params.GIVE_TICK;
    const giveAmount = opts.params.GIVE_AMOUNT;
    const getTick = opts.params.GET_TICK;
    const getAmount = opts.params.GET_AMOUNT;
    // Native-coin get side leaves GET_TICK empty; show the coin instead.
    const getLabel = getTick || opts.params.GET_COIN || '';
    const giveDesc = giveOwn ? `ownership of ${giveTick}` : `${giveAmount} ${giveTick}`;
    const getDesc = getOwn ? `ownership of ${getTick}` : `${getAmount} ${getLabel}`.trim();
    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: null,
        actionSummary: `Place order: give ${giveDesc}, get ${getDesc}`,
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
        actionData: { action: 'ORDER', params: opts.params },
        encoderOpts: {
            pubkey: source.publicKey,
            ...(opts.fee !== undefined && { fee: opts.fee }),
            ...(opts.feePerKb !== undefined && { feePerKb: opts.feePerKb }),
            ...(opts.rbf !== undefined && { rbf: opts.rbf }),
            ...(opts.payFeeInNativeCoin !== undefined && { payFeeInNativeCoin: opts.payFeeInNativeCoin }),
        },
        signingPaths: [source.derivationPath
            ? { inputIndex: 0, path: source.derivationPath }
            : { inputIndex: 0, addressId: source.addressId }],
        pendingTxMeta,
        prebuiltPsbt: opts.prebuiltPsbt,
        waitForTxid: opts.waitForTxid,
        waitOpts: opts.waitOpts,
        onProgress: opts.onProgress,
    });
}

/**
 * cancelOrder: wrapper for the CANCEL action (§41.3.5). Cancels an
 * open ORDER by its action index. Signs a tx from the order's source
 * address.
 *
 * CANCEL format (v0): OFFER_ACTION_INDEX referencing the order to
 * cancel. The indexer validates the caller is the order's owner.
 *
 * @param {OrderActionOpts & { orderActionIndex: string }} opts
 */
export async function cancelOrder(opts) {
    if (!opts) throw new Error('cancelOrder: opts is required');
    const actionIndex = opts.orderActionIndex || opts.params?.OFFER_ACTION_INDEX;
    if (typeof actionIndex !== 'string' || actionIndex.length === 0) {
        throw new Error('cancelOrder: orderActionIndex is required');
    }
    const source = normalizeSource(opts.from, 'cancelOrder');
    const params = {
        VERSION: '0',
        OFFER_ACTION_INDEX: String(actionIndex),
        ...(opts.params || {}),
    };
    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: null,
        actionSummary: `Cancel order #${actionIndex}`,
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
        actionData: { action: 'CANCEL', params },
        encoderOpts: {
            pubkey: source.publicKey,
            ...(opts.fee !== undefined && { fee: opts.fee }),
            ...(opts.feePerKb !== undefined && { feePerKb: opts.feePerKb }),
            ...(opts.rbf !== undefined && { rbf: opts.rbf }),
            ...(opts.payFeeInNativeCoin !== undefined && { payFeeInNativeCoin: opts.payFeeInNativeCoin }),
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
