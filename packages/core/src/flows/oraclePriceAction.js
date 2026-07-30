// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// oraclePriceAction (PC-30): publish a PRICE v1 user oracle quote
// (VERSION|COIN|TICK|FIAT|VALUE|FEE|MEMO, protocol doc PRICE.md).
//
// Permissionless: any address may publish, no stake required. What it
// buys the publisher is the  oracle usage fee, paid up front as a
// real coin output by whoever opens a Mode B dispenser against this
// address, at FEE x the dispenser's projected total proceeds.
//
// Two properties make this not an ordinary form submit, and the wallet
// form is built around both:
//
//   - It has NO UNDO for 24 hours. The quote becomes effective at
//     block_time + 86400 and nothing can retract it in between; the
//     soonest correction is another publish, which itself matures a day
//     later. A wrong digit is live for a day.
//   - Somebody else's money settles against it. Dispensers pointing at
//     this address dispense at whatever price matures, so a publish is an
//     action on third parties, not just on the publisher.
//
// The SDK validator enforces the field rules (FIAT allow-list, positive
// 8-decimal VALUE, FEE in [0,1]); this flow guards only what it composes.

import { submitAction } from './submitAction.js';
import { normalizeSource } from './sendToken.js';

/**
 * @typedef {Object} OraclePriceActionOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {import('./sendToken.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {Record<string, string>} params            PRICE field map (VERSION, COIN, TICK, FIAT, VALUE, optional FEE / MEMO)
 * @property {number} [fee]
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {import('../sdk/submitWithSigner.js').PrebuiltPsbt} [prebuiltPsbt]   single-encode pipeline: sign this exact composed PSBT byte-identically instead of rebuilding.
 * @property {(txid: string, opts?: object) => Promise<unknown>} [waitForTxid]
 * @property {object} [waitOpts]
 * @property {(phase: string, data: object) => void} [onProgress]
 * @property {boolean} [trackPendingTx]
 */

/**
 * @param {OraclePriceActionOpts} opts
 * @returns {Promise<import('../sdk/submitWithSigner.js').SubmitResult>}
 */
export async function oraclePriceAction(opts) {
    if (!opts) throw new Error('oraclePriceAction: opts is required');
    if (!opts.params || typeof opts.params !== 'object') {
        throw new Error('oraclePriceAction: params is required');
    }
    // v0 is the validator federation's COIN/FIAT snapshot, PBFT-broadcast and
    // not user-encodable at all. A wallet that composed one would be building
    // a transaction the network cannot accept from it, so refuse loudly here
    // rather than let a caller pass VERSION through from a form field.
    const version = String(opts.params.VERSION ?? '1');
    if (version !== '1') {
        throw new Error('oraclePriceAction: only PRICE v1 (user oracle) is publishable from a wallet');
    }
    for (const field of ['COIN', 'TICK', 'FIAT', 'VALUE']) {
        const v = opts.params[field];
        if (typeof v !== 'string' || v.length === 0) {
            throw new Error(`oraclePriceAction: params.${field} is required`);
        }
    }
    const source = normalizeSource(opts.from, 'oraclePriceAction');

    const tick = String(opts.params.TICK).toUpperCase();
    const fiat = String(opts.params.FIAT).toUpperCase();
    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: null,
        actionSummary: `Publish oracle price ${tick} = ${opts.params.VALUE} ${fiat}`,
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
        actionData: { action: 'PRICE', params: { ...opts.params, VERSION: '1' } },
        encoderOpts: {
            pubkey: source.publicKey,
            // Name the funding ADDRESS, not just its public key. Two separate
            // things read it, and this form is on the legacy sign path where
            // both run live rather than against a prebuilt PSBT:
            //   - the native-coin fee pre-flight, which passes it to the
            //     indexer as the quoted action's SOURCE. Without it the PRICE
            //     dry run has no source to write and answers `valid:false`
            //     with a raw SQL error, which the wallet then reports as
            //     "the LTC fee price is temporarily unavailable" - so PRICE
            //     could not be published at all on a chain where the coin fee
            //     is the only lane . D-146.
            //   - the encoder's UTXO selection, which cannot turn a bare
            //     pubkey into a script ("has no matching Script"): the D-7
            //     family, same two lines advancedAction.js carries.
            sourceAddress: source.address,
            change: source.address,
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
