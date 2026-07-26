// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// buildSendPsbt (§20 / G040): Watcher-mode helper that builds an
// UNSIGNED PSBT for a SEND action without unlocking the wallet, calling
// any signer, or broadcasting. The user transports the resulting hex to
// a separate Signer-mode wallet (or any PSBT-capable signer), gets it
// signed, and brings the signed PSBT back to a Full-mode wallet to
// broadcast.
//
// Differences from sendToken:
//   - No password / no signer: a watcher-mode wallet has pubkeys but no
//     keys to sign with. We stop after encoding.
//   - No ADS donation: the watcher path does not commit ADS counters
//     (the broadcast happens on a different wallet, so we cannot
//     atomically tie the donation to "this user's broadcast"). When
//     the broadcast eventually lands the donation can ride along on
//     the broadcast-side flow if that wallet has ADS enabled.
//   - No PendingTx record: no in-flight submission to track until the
//     signed PSBT is broadcast elsewhere.
//
// Output is the same envelope shape PsbtSignForm consumes, so a watcher
// → signer → watcher round-trip is symmetrical at the wire format.

import { normalizeSource } from './sendToken.js';
import { isBareNativePayment, nativePaymentOutput } from './nativePayment.js';
import { prepareGatedSend } from './gatedSendGuard.js';
import {
    assertMultiSendSupported,
    assertNoGatedLegs,
    buildSendParams,
    normalizeSendLegs,
} from './sendLegs.js';

/**
 * @typedef {Object} BuildSendPsbtOpts
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {import('../storage/Vault.js').Vault} [vault]     PC-26: source of gatedKeys rows; a watcher CAN compose a gated send when it holds the pack key (e.g. it published the pack), since ECIES needs no private key
 * @property {string} [walletId]
 * @property {string} chainId
 * @property {import('./sendToken.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {string} to
 * @property {string} tick
 * @property {string | number} amount
 * @property {string} [memo]
 * @property {import('./sendLegs.js').SendLeg[]} [legs]   PC-52 multi-recipient / multi-tick SEND (v1–v3); same shape and refusals as sendToken
 * @property {number} [fee]
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 */

/**
 * @typedef {Object} BuildSendPsbtResult
 * @property {string} psbtHex            unsigned PSBT, hex-encoded
 * @property {string} encoding           encoding chosen by the encoder (OP_RETURN / P2SH / etc.)
 * @property {string} actionString       full action string (DESTINATION + TICK + AMOUNT + MEMO)
 * @property {string} action             'SEND'
 * @property {number | string} [version]
 * @property {string} chainId            mirrored from input for downstream routing
 * @property {string} fromAddress        mirrored from input for downstream routing
 */

/**
 * @param {BuildSendPsbtOpts} opts
 * @returns {Promise<BuildSendPsbtResult>}
 */
export async function buildSendPsbt(opts) {
    if (!opts) throw new Error('buildSendPsbt: opts is required');
    if (!opts.chainRegistry) throw new Error('buildSendPsbt: chainRegistry is required');
    if (!opts.sdkRegistry) throw new Error('buildSendPsbt: sdkRegistry is required');
    if (typeof opts.chainId !== 'string' || !opts.chainId) {
        throw new Error('buildSendPsbt: chainId is required');
    }
    const { legs, isMulti } = normalizeSendLegs(opts, 'buildSendPsbt');
    const source = normalizeSource(opts.from, 'buildSendPsbt');

    const descriptor = opts.chainRegistry.get(opts.chainId);
    if (!descriptor) throw new Error(`buildSendPsbt: unknown chain "${opts.chainId}"`);
    // PC-52: the watcher builds the same bytes the signer will sign, so it
    // makes the same multi-recipient refusals as sendToken.
    assertMultiSendSupported({ legs, descriptor });
    if (isMulti) {
        await assertNoGatedLegs({
            sdkRegistry: opts.sdkRegistry,
            chainRegistry: opts.chainRegistry,
            chainId: opts.chainId,
            legs,
        });
    }

    const sdk = opts.sdkRegistry.get(opts.chainId);
    const encoder = sdk?.encoder;
    if (!encoder) {
        throw new Error(
            `buildSendPsbt: SDK encoder not initialized for "${opts.chainId}". Call sdkRegistry.initActive([chainId]) first`,
        );
    }

    const params = buildSendParams(legs);

    // PC-26: rewrite a gated tick's SEND into BATCH(SEND, MESSAGE) so the
    // watcher-built PSBT is one the indexer will accept. Same guard and
    // typed errors as sendToken; key source is the vault (a watcher has no
    // in-session scan cache). Multi-leg sends never reach it: a gated tick
    // among the legs was refused above.
    let actionData = { action: 'SEND', params };
    const gatedPlan = isMulti ? null : await prepareGatedSend({
        sdkRegistry: opts.sdkRegistry,
        chainRegistry: opts.chainRegistry,
        vault: opts.vault || null,
        walletId: opts.walletId || null,
        chainId: opts.chainId,
        source,
        to: legs[0].to,
        tick: legs[0].tick,
        amount: legs[0].amount,
        memo: legs[0].memo,
    });
    if (gatedPlan) actionData = gatedPlan.actionData;

    // : a plain native-coin payment carries no XChain action. The watcher
    // path builds the same bytes the signer will sign, so it has to make the
    // same choice as the confirm path or the two would disagree about what the
    // transaction is.
    const bareNativePayment = isBareNativePayment(actionData, descriptor);
    const createResult = bareNativePayment ? null : sdk.actions.createAction(actionData);

    // D-9: a native-coin send must pay the recipient a real output; the SEND
    // OP_RETURN alone moves no value. Token sends return null and are unchanged.
    const nativeOut = nativePaymentOutput({
        tick: legs[0].tick,
        amount: legs[0].amount,
        destination: legs[0].to,
        descriptor,
    });

    const encoded = await encoder.createTx({
        ...(bareNativePayment ? {} : { data: createResult.actionString }),
        pubkey: source.publicKey,
        // D-7: give the encoder the funding/change address explicitly.
        //  - `sourceAddress` (SDK-side only, not on the wire) makes the SDK select
        //    UTXOs BY ADDRESS; without it the encoder selects by `pubkey`, which the
        //    utxo-tracker cannot resolve to a script ("has no matching Script").
        //  - `change` is the address the leftover value returns to. The wallet's
        //    own source address is the change sink for a self-send; without it the
        //    encoder refuses to build ("CHANGE_ADDRESS_REQUIRED": it will not burn
        //    the change as fee).
        sourceAddress: source.address,
        change: source.address,
        ...(nativeOut ? { customOutputs: [nativeOut] } : {}),
        ...(opts.fee !== undefined && { fee: opts.fee }),
        ...(opts.feePerKb !== undefined && { feePerKb: opts.feePerKb }),
        ...(opts.rbf !== undefined && { rbf: opts.rbf }),
    });

    return {
        psbtHex: encoded.psbt,
        encoding: encoded.encoding,
        actionString: bareNativePayment ? null : createResult.actionString,
        action: createResult.action,
        version: createResult.version,
        chainId: opts.chainId,
        fromAddress: source.address,
    };
}
