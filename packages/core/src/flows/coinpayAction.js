// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// coinpayAction: convenience wrapper for the COINPAY action (§41.4;
// protocol docs: xchain-documentation/protocol/actions/COINPAY.md).
// Mirrors orderAction: takes vault + registries + chain + source +
// obligation details, forwards to submitAction.
//
// COINPAY is the buyer-side settlement for matched orders that trade a
// token against a native coin (BTC/LTC/DOGE). The match creates a
// coinpay_obligation on the buyer's address; the buyer broadcasts a
// COINPAY transaction carrying both the action data (OP_RETURN
// referencing the ORDER_MATCH action index) and a native-coin output
// paying the seller the amount owed.
//
// The obligation details (payer, payee, coin_amount, order_match
// action index, expiration) come from
// `sdk.getCoinpayObligations(address, 'address')`; the wallet hydrates
// them into the form and passes them through here. Anyone can
// broadcast the COINPAY on the buyer's behalf (the protocol doesn't
// require it to come from the buyer's address), but in practice we
// always sign from the obligation's `payer_address` because that's
// the address the user has keys for.

import { submitAction } from './submitAction.js';
import { buildActionPsbt } from './buildActionPsbt.js';
import { assertValidDestination, normalizeSource } from './sendToken.js';
import { verifyCoinpayObligation } from './coinpayQueries.js';

/**
 * @typedef {Object} CoinpayActionOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {import('./sendToken.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {string} orderMatchActionIndex   ACTION_INDEX of the ORDER_MATCH being paid
 * @property {string} payeeAddress            Address that receives the native-coin output
 * @property {string | number} coinAmount     Native-coin amount in base units (satoshis / litoshis / ...); >= obligation's coin_amount
 * @property {number} [fee]
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {(txid: string, opts?: object) => Promise<unknown>} [waitForTxid]
 * @property {object} [waitOpts]
 * @property {(phase: string, data: object) => void} [onProgress]
 * @property {boolean} [trackPendingTx]
 */

/**
 * Validate a base-unit native amount as an integer that survives JS number
 * precision. A large DOGE obligation (supply ~1.3e18 koinu) can exceed
 * Number.MAX_SAFE_INTEGER (~9e15 = ~90M DOGE); silently coercing it through
 * Number() would round the native-coin output, underpaying (COINPAY rejected,
 * buyer loses the coin with no settlement) or overpaying.
 *
 * : the encoder/SDK now carry >2^53-1 amounts exactly (BigInt money
 * path; the value travels as an exact decimal string over JSON-RPC), so a
 * big amount is no longer refused here. It must arrive as an exact decimal
 * STRING and is returned as one; a Number past safe-integer precision is
 * still rejected because it was already rounded before it reached us.
 * Safe-range values keep returning a Number, unchanged.
 *
 * @param {string | number} value
 * @param {string} fnName
 * @returns {number | string} base units; a string iff the exact value exceeds 2^53-1
 */
function normalizeCoinAmount(value, fnName) {
    const raw = typeof value === 'string' ? value.trim() : value;
    if (typeof raw === 'string' && !/^\d+$/.test(raw)) {
        throw new Error(`${fnName}: coinAmount must be an integer (base units)`);
    }
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error(`${fnName}: coinAmount must be a positive number (base units)`);
    }
    if (!Number.isInteger(amount)) {
        throw new Error(`${fnName}: coinAmount must be an integer (base units)`);
    }
    if (!Number.isSafeInteger(amount)) {
        if (typeof raw !== 'string') {
            throw new Error(`${fnName}: coinAmount exceeds safe integer precision (base units); pass it as an exact decimal string`);
        }
        // 2^64-1 is the transaction output value field's wire ceiling; the
        // encoder enforces the same bound (validator.js MAX_SATOSHI_U64).
        if (BigInt(raw) > 0xffffffffffffffffn) {
            throw new Error(`${fnName}: coinAmount exceeds the maximum 64-bit base-unit amount`);
        }
        return raw;
    }
    return amount;
}

/**
 * Shared preamble for every COINPAY path (broadcast, hardware, and the
 * air-gapped watcher build). Validates the caller's inputs, re-derives the
 * obligation from the chain, and returns the pieces a COINPAY transaction is
 * built from.
 *
 *  / F4: the payee and the amount decide where real native coin goes, and
 * both reach these flows as plain arguments that originated in an indexer query
 * several layers up. Re-read the obligation here, in the flow that is about to
 * build the payment, and refuse if it disagrees with what we were asked to pay.
 * The native output is then built from the VERIFIED obligation row, never from
 * the caller's copy of it. Also check the payee is a well-formed address on this
 * chain: an output to a malformed address is unspendable, so the coin is lost
 * even if the payee field was honest.
 *
 * @param {CoinpayActionOpts} opts
 * @param {string} fnName
 */
async function prepareCoinpay(opts, fnName) {
    if (!opts) throw new Error(`${fnName}: opts is required`);
    const actionIndex = opts.orderMatchActionIndex;
    if (typeof actionIndex !== 'string' || actionIndex.length === 0) {
        throw new Error(`${fnName}: orderMatchActionIndex is required`);
    }
    if (typeof opts.payeeAddress !== 'string' || opts.payeeAddress.length === 0) {
        throw new Error(`${fnName}: payeeAddress is required`);
    }
    const coinAmount = normalizeCoinAmount(opts.coinAmount, fnName);
    const source = normalizeSource(opts.from, fnName);

    const obligation = await verifyCoinpayObligation({
        sdkRegistry: opts.sdkRegistry,
        chainId: opts.chainId,
        payerAddress: source.address,
        orderMatchActionIndex: actionIndex,
        payeeAddress: opts.payeeAddress,
        coinAmount,
    });

    // Build from the obligation the chain vouches for, not from the request.
    // verifyCoinpayObligation has already proven these equal, so this is belt
    // and braces: it means a future caller cannot reintroduce the bug by
    // threading its own values past the guard.
    const payeeAddress = String(obligation.payee_address ?? obligation.payeeAddress);
    const payAmount = normalizeCoinAmount(
        obligation.coin_amount ?? obligation.coinAmount,
        fnName,
    );
    assertValidDestination(fnName, payeeAddress, opts.chainRegistry, opts.chainId);

    return {
        source,
        actionIndex,
        payeeAddress,
        coinAmount: payAmount,
        params: {
            VERSION: '0',
            ORDER_MATCH_ACTION_INDEX: String(actionIndex),
        },
    };
}

/**
 * Encode-only COINPAY for §20 watcher mode: returns an unsigned PSBT request for
 * an air-gapped signer. No vault, no signer, no broadcast.
 *
 * : this path used to call the GENERIC `buildActionPsbt` with
 * `customOutputs` taken straight from form state, so it was the one COINPAY
 * route that skipped the  verification: a watcher could be talked into
 * building a PSBT that pays an attacker, and the air-gapped signer would only
 * ever see the outputs it was handed. It now runs the same verified preamble as
 * the signing paths, and the native output is built from the verified obligation.
 *
 * @param {CoinpayActionOpts & { encoderOpts?: object }} opts
 */
export async function buildCoinpayPsbtRequest(opts) {
    const prepared = await prepareCoinpay(opts, 'buildCoinpayPsbtRequest');
    return buildActionPsbt({
        chainRegistry: opts.chainRegistry,
        sdkRegistry: opts.sdkRegistry,
        chainId: opts.chainId,
        from: opts.from,
        actionData: { action: 'COINPAY', params: prepared.params },
        encoderOpts: {
            ...(opts.encoderOpts ?? {}),
            customOutputs: [
                { address: prepared.payeeAddress, value: prepared.coinAmount },
            ],
        },
    });
}

/**
 * @param {CoinpayActionOpts} opts
 * @returns {Promise<import('../sdk/submitWithSigner.js').SubmitResult>}
 */
export async function coinpayAction(opts) {
    const {
        source, actionIndex, payeeAddress, coinAmount, params,
    } = await prepareCoinpay(opts, 'coinpayAction');

    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: payeeAddress,
        actionSummary:
            `Pay COINPAY: ${coinAmount} (base units) for ORDER_MATCH #${actionIndex}`,
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
        actionData: { action: 'COINPAY', params },
        encoderOpts: {
            pubkey: source.publicKey,
            customOutputs: [
                { address: payeeAddress, value: coinAmount },
            ],
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
