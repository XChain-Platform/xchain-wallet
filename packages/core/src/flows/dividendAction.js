// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// dividendAction: convenience wrapper for the DIVIDEND action (§40.8;
// protocol docs: xchain-documentation/protocol/actions/DIVIDEND.md).
// Mirrors broadcastAction / dispenserAction: takes vault + registries
// + chain + source address + DIVIDEND params, forwards to submitAction.
//
// DIVIDEND has a single format version (v0) that distributes AMOUNT
// of DIVIDEND_TICK to every holder of TICK at the snapshot block.
// Source address is excluded from receiving. Any address can pay out
// a dividend on any TICK per the protocol rules.

import { submitAction } from './submitAction.js';
import { normalizeSource } from './sendToken.js';

/**
 * @typedef {Object} DividendActionOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {import('./sendToken.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {Record<string, string>} params   DIVIDEND field map (VERSION, TICK, DIVIDEND_TICK, AMOUNT, optional MEMO)
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
 * @param {DividendActionOpts} opts
 * @returns {Promise<import('../sdk/submitWithSigner.js').SubmitResult>}
 */
export async function dividendAction(opts) {
    if (!opts) throw new Error('dividendAction: opts is required');
    if (!opts.params || typeof opts.params !== 'object') {
        throw new Error('dividendAction: params is required');
    }
    if (typeof opts.params.TICK !== 'string' || opts.params.TICK.length === 0) {
        throw new Error('dividendAction: params.TICK is required');
    }
    if (typeof opts.params.DIVIDEND_TICK !== 'string' || opts.params.DIVIDEND_TICK.length === 0) {
        throw new Error('dividendAction: params.DIVIDEND_TICK is required');
    }
    if (typeof opts.params.AMOUNT !== 'string' || opts.params.AMOUNT.length === 0) {
        throw new Error('dividendAction: params.AMOUNT is required');
    }
    const source = normalizeSource(opts.from, 'dividendAction');

    const tick = opts.params.TICK;
    const dividendTick = opts.params.DIVIDEND_TICK;
    const amount = opts.params.AMOUNT;
    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: null,
        actionSummary: `Pay ${amount} ${dividendTick} per unit of ${tick} held`,
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
        actionData: { action: 'DIVIDEND', params: opts.params },
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

/**
 * List holders of a token. Used by DividendForm's cost preview so the
 * user sees "N holders / ~TOTAL distribution" before signing.
 *
 * @param {{ sdkRegistry: any, chainId: string, tick: string, opts?: object }} params
 * @returns {Promise<unknown>}
 */
export async function holdersFor({ sdkRegistry, chainId, tick, opts }) {
    if (!sdkRegistry) throw new Error('holdersFor: sdkRegistry is required');
    if (!chainId) throw new Error('holdersFor: chainId is required');
    if (!tick) throw new Error('holdersFor: tick is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getHolders(tick, opts);
}
