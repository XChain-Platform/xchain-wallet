// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// swapAction — convenience wrapper for the SWAP action (§41.5;
// protocol docs: xchain-documentation/protocol/actions/SWAP.md).
// Mirrors orderAction: takes vault + registries + chain + source +
// SWAP params, forwards to submitAction.
//
// SWAP is the atomic cross-chain / token-pair swap primitive. Unlike
// ORDER, a SWAP settles atomically without a COINPAY follow-up — it
// does NOT work with native coin (use DISPENSER for token ↔ native
// coin). Phase 3 Step 10 exposes the v0 Create lane via SwapForm;
// Cancel (v1) and Edit (v2) use the same action name with different
// params and can be driven through this wrapper unchanged.
//
// v0 create requires GIVE_TICK / GIVE_AMOUNT / GET_TICK / GET_AMOUNT
// (per the SDK validator's `_validateSwap`). GIVE_COIN / GET_COIN are
// the network tickers (BTC / LTC / DOGE) — set by the form from the
// chain registry rather than user input.
//
// Ownership trading (token-name trades): when GIVE_OWNERSHIP=1 the swap
// escrows the *ownership record* of GIVE_TICK instead of a balance, so
// GIVE_AMOUNT must be empty; likewise GET_OWNERSHIP=1 requires the
// matcher to own GET_TICK and GET_AMOUNT must be empty. Either or both
// sides may be ownership (ownership-for-ownership swaps). The SDK
// validator enforces the empty-amount rule; this wrapper just relaxes
// the required-field check to match.

import { submitAction } from './submitAction.js';
import { normalizeSource } from './sendToken.js';

/**
 * @typedef {Object} SwapActionOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {import('./sendToken.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {Record<string, string>} params   SWAP field map (v0 create / v1 cancel / v2 edit)
 * @property {number} [fee]
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {(txid: string, opts?: object) => Promise<unknown>} [waitForTxid]
 * @property {object} [waitOpts]
 * @property {(phase: string, data: object) => void} [onProgress]
 * @property {boolean} [trackPendingTx]
 */

/**
 * @param {SwapActionOpts} opts
 * @returns {Promise<import('../sdk/submitWithSigner.js').SubmitResult>}
 */
export async function swapAction(opts) {
    if (!opts) throw new Error('swapAction: opts is required');
    if (!opts.params || typeof opts.params !== 'object') {
        throw new Error('swapAction: params is required');
    }
    const isIndexOp = typeof opts.params.SWAP_ACTION_INDEX === 'string'
        && opts.params.SWAP_ACTION_INDEX.length > 0;

    if (!isIndexOp) {
        // v0 create — match the SDK validator's baseline. Amounts drop out
        // of the required set when the matching side trades ownership (the
        // SDK validator additionally enforces they're empty). Field order is
        // preserved so the surfaced error matches the validator's.
        const giveOwn = Number(opts.params.GIVE_OWNERSHIP || 0) === 1;
        const getOwn = Number(opts.params.GET_OWNERSHIP || 0) === 1;
        const required = ['GIVE_TICK'];
        if (!giveOwn) required.push('GIVE_AMOUNT');
        required.push('GET_TICK');
        if (!getOwn) required.push('GET_AMOUNT');
        for (const field of required) {
            if (typeof opts.params[field] !== 'string' || opts.params[field].length === 0) {
                throw new Error(`swapAction: params.${field} is required for create`);
            }
        }
    }

    const source = normalizeSource(opts.from, 'swapAction');
    const version = typeof opts.params.VERSION === 'string' ? opts.params.VERSION : '0';
    const giveDesc = Number(opts.params.GIVE_OWNERSHIP || 0) === 1
        ? `ownership of ${opts.params.GIVE_TICK}`
        : `${opts.params.GIVE_AMOUNT} ${opts.params.GIVE_TICK}`;
    const getDesc = Number(opts.params.GET_OWNERSHIP || 0) === 1
        ? `ownership of ${opts.params.GET_TICK}`
        : `${opts.params.GET_AMOUNT} ${opts.params.GET_TICK}`;
    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: opts.params.GET_ADDRESS || null,
        actionSummary: isIndexOp
            ? (version === '1'
                ? `Cancel swap #${opts.params.SWAP_ACTION_INDEX}`
                : `Edit swap #${opts.params.SWAP_ACTION_INDEX}`)
            : `Swap: give ${giveDesc}, get ${getDesc}`,
    };

    return submitAction({
        vault: opts.vault,
        walletId: opts.walletId,
        password: opts.password,
        bip39Passphrase: opts.bip39Passphrase,
        chainRegistry: opts.chainRegistry,
        sdkRegistry: opts.sdkRegistry,
        chainId: opts.chainId,
        actionData: { action: 'SWAP', params: opts.params },
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
