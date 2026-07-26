// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// linkAction: convenience wrapper for the LINK action (§42.8.1;
// protocol docs: xchain-documentation/protocol/actions/LINK.md).
// Mirrors swapAction / coinpayAction: takes vault + registries +
// submit-chain + source + the two ends of the cross-chain pair, and
// forwards to submitAction.
//
// LINK is a free-standing cross-chain anchor that pairs two existing
// actions (one on each chain) without consuming or producing tokens.
// On-chain shape per `xchain-sdk` formats: `VERSION|COIN1|
// COIN1_ACTION_INDEX|COIN2|COIN2_ACTION_INDEX|MEMO`. The LINK action
// itself is submitted on a single chain (`submitOn` = chain1 by
// default), but the indexer's `links` table records both sides so
// the History route's §23.5 thread rendering works regardless of
// which side the user opens.
//
// Coin codes (COIN1 / COIN2) are tickers: 'BTC' / 'DOGE' / 'LTC'.
// The form layer is responsible for resolving chainId → ticker; this
// flow validates non-empty strings and integer-string action indices
// but does not enforce any specific ticker set.

import { submitAction } from './submitAction.js';
import { normalizeSource } from './sendToken.js';

/**
 * @typedef {Object} LinkActionOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId                  chain hosting the LINK action (`submitOn`)
 * @property {import('./sendToken.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {string} coin1                    ticker (e.g. 'BTC')
 * @property {string | number} coin1ActionIndex
 * @property {string} coin2                    ticker (e.g. 'DOGE')
 * @property {string | number} coin2ActionIndex
 * @property {string} [memo]
 * @property {number} [fee]
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {(txid: string, opts?: object) => Promise<unknown>} [waitForTxid]
 * @property {object} [waitOpts]
 * @property {(phase: string, data: object) => void} [onProgress]
 * @property {boolean} [trackPendingTx]
 */

/**
 * @param {LinkActionOpts} opts
 * @returns {Promise<import('../sdk/submitWithSigner.js').SubmitResult>}
 */
export async function linkAction(opts) {
    if (!opts) throw new Error('linkAction: opts is required');
    if (typeof opts.coin1 !== 'string' || opts.coin1.length === 0) {
        throw new Error('linkAction: coin1 is required');
    }
    if (typeof opts.coin2 !== 'string' || opts.coin2.length === 0) {
        throw new Error('linkAction: coin2 is required');
    }
    const idx1 = String(opts.coin1ActionIndex ?? '');
    const idx2 = String(opts.coin2ActionIndex ?? '');
    if (idx1.length === 0 || !/^\d+$/.test(idx1)) {
        throw new Error('linkAction: coin1ActionIndex must be a non-empty integer string');
    }
    if (idx2.length === 0 || !/^\d+$/.test(idx2)) {
        throw new Error('linkAction: coin2ActionIndex must be a non-empty integer string');
    }
    if (opts.coin1.toUpperCase() === opts.coin2.toUpperCase() && idx1 === idx2) {
        throw new Error('linkAction: cannot link an action to itself');
    }

    const source = normalizeSource(opts.from, 'linkAction');

    const params = {
        VERSION: '0',
        COIN1: String(opts.coin1).toUpperCase(),
        COIN1_ACTION_INDEX: idx1,
        COIN2: String(opts.coin2).toUpperCase(),
        COIN2_ACTION_INDEX: idx2,
        MEMO: typeof opts.memo === 'string' ? opts.memo : '',
    };

    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: null,
        actionSummary:
            `Link ${params.COIN1} #${params.COIN1_ACTION_INDEX} ↔ ${params.COIN2} #${params.COIN2_ACTION_INDEX}`,
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
        actionData: { action: 'LINK', params },
        encoderOpts: {
            pubkey: source.publicKey,
            // Select funding UTXOs BY ADDRESS and return change to the spender.
            // LinkForm calls this flow live (no prebuiltPsbt), so without these
            // the encoder selects by `pubkey` and the utxo-tracker rejects it
            // with "has no matching Script" (the D-7 failure). Mirrors
            // advancedAction.js / swapAction.js / composeForConfirm.js.
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
        pendingTxMeta,
        waitForTxid: opts.waitForTxid,
        waitOpts: opts.waitOpts,
        onProgress: opts.onProgress,
    });
}
