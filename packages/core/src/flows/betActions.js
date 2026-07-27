// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// BET (parimutuel betting) composers. The wire-level BET action has four
// formats (spec: xchain-documentation/protocol/actions/BET.md):
//   v0: create a market   v1: cancel a market
//   v2: place a bet       v3: resolve a market to its winning outcome
//
// The BET-shape knowledge (outcome indexing, DETAILS schema, size caps, fee
// formatting) lives in the SDK's betting helpers, so each composer takes the
// UI-level camelCase object, runs it through the matching sdk.betting.*Params
// builder, then hands it to submitAction like every other single-action flow.
// Mirrors voteActions.js.
//
// The builders PIN the format version rather than letting anything infer it.
// That is load-bearing here: a resolve and a place-bet differ on the wire only
// by AMOUNT, so an inferred version could silently turn an intended stake into
// a payout decision.

import { submitAction } from './submitAction.js';
import { normalizeSource } from './sendToken.js';

/**
 * @typedef {Object} BetActionOpts
 * @property {object} [vault]
 * @property {string} [walletId]
 * @property {string} [password]
 * @property {string} [bip39Passphrase]
 * @property {import('../signers/Signer.js').Signer} [signer]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {import('./sendToken.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {object} params            UI-level camelCase params for the matching sdk.betting builder
 * @property {number} [fee]
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {boolean} [payFeeInNativeCoin]   pay the protocol fee with a native-coin
 *   output instead of an XCHAIN-balance debit (the only lane on LTC/DOGE)
 * @property {import('../sdk/submitWithSigner.js').PrebuiltPsbt} [prebuiltPsbt]
 * @property {(txid: string, opts?: object) => Promise<unknown>} [waitForTxid]
 * @property {object} [waitOpts]
 * @property {(phase: string, data: object) => void} [onProgress]
 * @property {boolean} [trackPendingTx]
 */

// Shared submit chassis: build the wire params via the named sdk.betting
// builder, then submit as a BET action from the source address.
function submitBet(opts, builderName, buildInput, summary) {
    if (!opts) throw new Error('betActions: opts is required');
    if (!opts.sdkRegistry) throw new Error('betActions: sdkRegistry is required');
    if (!opts.chainId) throw new Error('betActions: chainId is required');
    const sdk = opts.sdkRegistry.get(opts.chainId);
    if (!sdk?.betting || typeof sdk.betting[builderName] !== 'function') {
        throw new Error(`betActions: sdk.betting.${builderName} is unavailable`);
    }
    // Validates + normalizes the UI input into wire params, throwing on bad
    // input BEFORE any signing prompt.
    const params = sdk.betting[builderName](buildInput);
    const source = normalizeSource(opts.from, 'betActions');
    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: null,
        actionSummary: summary,
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
        actionData: { action: 'BET', params },
        encoderOpts: {
            pubkey: source.publicKey,
            ...(opts.fee !== undefined && { fee: opts.fee }),
            ...(opts.feePerKb !== undefined && { feePerKb: opts.feePerKb }),
            ...(opts.rbf !== undefined && { rbf: opts.rbf }),
            // : the native-coin protocol fee. Only the two fee-bearing
            // formats set it (create, place); resolve and cancel are free by
            // design, so their surfaces leave it undefined and nothing is
            // quoted or paid for them.
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
 * Open a betting market (BET v0). `opts.params` is the sdk.betting.createMarketParams
 * input: { label, outcomes, tick, fee?, deadline, refundWindow?, minAmount?,
 * allowList?, blockList?, details?, memo? }.
 *
 * Markets are immutable from creation: there is no edit format, by design.
 * @param {BetActionOpts} opts
 */
export async function createMarketAction(opts) {
    if (!opts?.params?.label) throw new Error('createMarketAction: params.label is required');
    if (!opts?.params?.tick) throw new Error('createMarketAction: params.tick is required');
    const l = ` "${String(opts.params.label).slice(0, 40)}"`;
    return submitBet(opts, 'createMarketParams', opts.params, `Open ${opts.params.tick} betting market${l}`);
}

/**
 * Place a bet on an existing market (BET v2). `opts.params` is the
 * sdk.betting.placeBetParams input: { feedActionIndex, outcome, amount, outcomes?, memo? }.
 *
 * Bets are FINAL once confirmed: there is no cancel path for a bettor.
 * @param {BetActionOpts} opts
 */
export async function placeBetAction(opts) {
    if (opts?.params?.feedActionIndex === undefined || opts?.params?.feedActionIndex === null) {
        throw new Error('placeBetAction: params.feedActionIndex is required');
    }
    return submitBet(opts, 'placeBetParams', opts.params, `Bet on market ${opts.params.feedActionIndex}`);
}

/**
 * Resolve a market to its winning outcome (BET v3). Oracle only, and only
 * between the deadline and the end of the refund window.
 * @param {BetActionOpts} opts
 */
export async function resolveMarketAction(opts) {
    if (opts?.params?.feedActionIndex === undefined || opts?.params?.feedActionIndex === null) {
        throw new Error('resolveMarketAction: params.feedActionIndex is required');
    }
    return submitBet(opts, 'resolveMarketParams', opts.params, `Resolve market ${opts.params.feedActionIndex}`);
}

/**
 * Cancel a market and refund every open bet in full (BET v1). Oracle only,
 * available any time before the market resolves or expires.
 * @param {BetActionOpts} opts
 */
export async function cancelMarketAction(opts) {
    if (opts?.params?.feedActionIndex === undefined || opts?.params?.feedActionIndex === null) {
        throw new Error('cancelMarketAction: params.feedActionIndex is required');
    }
    return submitBet(opts, 'cancelMarketParams', opts.params, `Cancel market ${opts.params.feedActionIndex}`);
}
