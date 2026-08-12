// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// dispenserAction: convenience wrapper for the DISPENSER action
// (§40.7; protocol docs: xchain-documentation/protocol/actions/
// DISPENSER.md). Mirrors broadcastAction: takes vault + registries +
// chain + source address + DISPENSER params, forwards to submitAction.
//
// DISPENSER has three lanes:
//   v0 Create: open a new dispenser (GIVE_* + GET_* fields).
//   v1 Cancel: close an existing dispenser via DISPENSER_ACTION_INDEX.
//   v2 Edit:   refill / reschedule / update lists via DISPENSER_ACTION_INDEX.
//
// The SDK validator enforces version-specific field requirements (see
// xchain-sdk@1.8.1's _validateDispenser). This flow only guards the
// baseline shape so bad callers get a loud error before the signer.
// SDK validation is the authoritative rule set.

import { submitAction } from './submitAction.js';
import { normalizeSource } from './sendToken.js';

/**
 * @typedef {Object} DispenserActionOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {import('./sendToken.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {Record<string, string>} params    DISPENSER field map (VERSION + create / cancel / edit fields)
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
 * @param {DispenserActionOpts} opts
 * @returns {Promise<import('../sdk/submitWithSigner.js').SubmitResult>}
 */
export async function dispenserAction(opts) {
    if (!opts) throw new Error('dispenserAction: opts is required');
    if (!opts.params || typeof opts.params !== 'object') {
        throw new Error('dispenserAction: params is required');
    }
    const version = typeof opts.params.VERSION === 'string' ? opts.params.VERSION : '0';
    const isIndexOp = typeof opts.params.DISPENSER_ACTION_INDEX === 'string'
        && opts.params.DISPENSER_ACTION_INDEX.length > 0;
    // Ownership dispenser (vend a token's name, single-shot): GIVE_OWNERSHIP=1
    // escrows the ownership record instead of a balance, so GIVE_AMOUNT /
    // GIVE_ESCROW must be empty (the SDK validator enforces that) and
    // GET_AMOUNT is the sale price.
    const giveOwn = Number(opts.params.GIVE_OWNERSHIP || 0) === 1;

    if (!isIndexOp) {
        // Create mode: match the SDK validator's baseline: GIVE_TICK +
        // GIVE_AMOUNT + GET_AMOUNT + one of (GET_TICK, GET_COIN). GIVE_AMOUNT
        // drops out for an ownership dispenser.
        if (typeof opts.params.GIVE_TICK !== 'string' || opts.params.GIVE_TICK.length === 0) {
            throw new Error('dispenserAction: params.GIVE_TICK is required for create');
        }
        if (!giveOwn && (typeof opts.params.GIVE_AMOUNT !== 'string' || opts.params.GIVE_AMOUNT.length === 0)) {
            throw new Error('dispenserAction: params.GIVE_AMOUNT is required for create');
        }
        if (typeof opts.params.GET_AMOUNT !== 'string' || opts.params.GET_AMOUNT.length === 0) {
            throw new Error('dispenserAction: params.GET_AMOUNT is required for create');
        }
        const hasGetTick = typeof opts.params.GET_TICK === 'string' && opts.params.GET_TICK.length > 0;
        const hasGetCoin = typeof opts.params.GET_COIN === 'string' && opts.params.GET_COIN.length > 0;
        if (!hasGetTick && !hasGetCoin) {
            throw new Error('dispenserAction: params.GET_TICK (token-paid) or params.GET_COIN (coin-paid) is required for create');
        }
    } else if (version !== '1' && version !== '2') {
        // DISPENSER_ACTION_INDEX is only valid with v1 (cancel) / v2 (edit).
        throw new Error('dispenserAction: DISPENSER_ACTION_INDEX requires VERSION 1 or 2');
    }

    const source = normalizeSource(opts.from, 'dispenserAction');

    const giveTick = opts.params.GIVE_TICK;
    const giveAmount = opts.params.GIVE_AMOUNT;
    const giveEscrow = opts.params.GIVE_ESCROW;
    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: opts.params.GET_ADDRESS || null,
        actionSummary: isIndexOp
            ? (version === '1'
                ? `Cancel dispenser #${opts.params.DISPENSER_ACTION_INDEX}`
                : `Edit dispenser #${opts.params.DISPENSER_ACTION_INDEX}`)
            : (giveOwn
                ? `Open dispenser: sell ownership of ${giveTick} for ${opts.params.GET_AMOUNT || '?'} ${opts.params.GET_TICK || opts.params.GET_COIN || ''}`.trim()
                : `Open dispenser: ${giveAmount} ${giveTick} per fill (escrow ${giveEscrow || '?'})`),
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
        actionData: { action: 'DISPENSER', params: opts.params },
        encoderOpts: {
            pubkey: source.publicKey,
            // The owner's address is both the funding source and the change sink,
            // so it goes in twice on purpose: `sourceAddress` is what makes the SDK
            // select UTXOs by address, `change` supplies the change output, and the
            // SDK states outright that `change` is "deliberately NOT a fallback" for
            // `sourceAddress` (xchain-sdk/src/encoder.js createTx). Passing neither
            // left the encoder resolving UTXOs from the raw `pubkey`, which fails as
            // "<pubkey> has no matching Script" - the same D-36 shape found in
            // sendToken. It surfaced here only once Refill/Edit/Close became
            // reachable; the create lane composes through the confirm modal,
            // which passes the address, so only these three were affected (D-43).
            change: source.address,
            sourceAddress: source.address,
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
