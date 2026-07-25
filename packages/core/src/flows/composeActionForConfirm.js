// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// composeActionForConfirm ( §5.3): the HOST half of the single-
// encode pipeline. Every SDK primitive the confirm pipeline needs -
// createAction, the encoder, the vault (for ADS settings), decomposePsbt,
// and decodeActionFromPsbt - lives host-side (the React tree only ever
// talks to the host over `messaging`, there is no client-side SDK). So
// compose AND the tamper check both run here, and the popup receives a
// fully-serializable, already-tamper-verified ComposedAction.
//
//   composeForConfirm (build the one PSBT + resolve ADS/fee) ->
//   assertNoTamper (output-set + inline action-byte, HOST-side) ->
//   return the serializable envelope
//
// A tamper failure THROWS (TamperDetectedError): it crosses the messaging
// boundary as a plain error and the invoking form renders it exactly like
// any other compose failure (§5.3.1 - compose failures reject unwrapped,
// the modal never opens). Reaching the return means the bytes the user is
// about to preview are the bytes that will be signed.

import { composeForConfirm } from './composeForConfirm.js';
import { assertNoTamper } from './confirmChecks.js';
import { exactNetworkFeeSats } from './psbtNetworkFee.js';

/**
 * @typedef {Object} ComposeActionForConfirmOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {{ action: string, params: object }} actionData
 * @property {import('../sdk/submitWithSigner.js').SubmitEncoderOpts} encoderOpts  must include pubkey
 * @property {string} source                     spender address (native-fee quote + own-change baseline)
 * @property {string[]} [ownAddresses]           wallet-owned addresses on this chain (change is allowed there)
 * @property {AbortSignal} [signal]
 */

/**
 * @typedef {import('./composeForConfirm.js').ComposedAction & { tamperVerified: true }} VerifiedComposedAction
 */

/**
 * @param {ComposeActionForConfirmOpts} opts
 * @returns {Promise<VerifiedComposedAction>}
 */
export async function composeActionForConfirm({
    vault, chainRegistry, sdkRegistry, chainId, actionData, encoderOpts, source, ownAddresses, signal,
}) {
    if (!sdkRegistry) throw new Error('composeActionForConfirm: sdkRegistry is required');
    if (!chainRegistry) throw new Error('composeActionForConfirm: chainRegistry is required');
    if (!vault) throw new Error('composeActionForConfirm: vault is required');
    if (!actionData?.action) throw new Error('composeActionForConfirm: actionData.action is required');
    if (!encoderOpts?.pubkey) throw new Error('composeActionForConfirm: encoderOpts.pubkey is required');

    const composed = await composeForConfirm({
        sdkRegistry, chainRegistry, vault, chainId, actionData, encoderOpts, source, signal,
    });

    // Tamper check on the exact built PSBT, HOST-side (this is where
    // decomposePsbt + decodeActionFromPsbt live). Throws on any mismatch.
    // The source address always counts as own (encoder funds change back
    // to it when no explicit change address is supplied).
    const sdk = sdkRegistry.get(chainId);
    const own = new Set(Array.isArray(ownAddresses) ? ownAddresses : []);
    if (source) own.add(source);
    // §5.2.5: the EXACT fee of the PSBT that will broadcast, taken from the
    // built bytes rather than a rate estimate. Decomposed once here and reused
    // for the fee; null when an input value is missing from the PSBT, in which
    // case the UI falls back to its estimate and says so.
    const decomposed = sdk.wallet.decomposePsbt(composed.psbt);
    const networkFeeSats = exactNetworkFeeSats(decomposed);
    assertNoTamper({
        psbtHex: composed.psbt,
        expected: composed.expectedOutputs,
        ownAddresses: [...own],
        decomposePsbt: (hex) => sdk.wallet.decomposePsbt(hex),
        actionString: composed.actionString,
        decodeActionFromPsbt: (hex) => sdk.decoder.decodeActionFromPsbt(hex),
    });

    // Serializable envelope for the popup. `encoderOpts` (which carries the
    // ADS-folded customOutputs and is not needed client-side) is dropped;
    // everything returned here survives structured-clone / JSON transport.
    return {
        actionString: composed.actionString,
        action: composed.action,
        version: composed.version,
        // The chain these bytes were built for. Carried so display code can
        // resolve chain-scoped formatting (the native ticker for the §5.2.5 fee
        // line) from the envelope itself, instead of every one of the ~24
        // confirm call sites having to thread it separately.
        chainId,
        psbt: composed.psbt,
        encoding: composed.encoding,
        quote: composed.quote,
        adsPlan: composed.adsPlan,
        expectedOutputs: composed.expectedOutputs,
        // §5.2.5: exact fee in the chain's smallest unit, or null when the PSBT
        // does not carry every input value. Never a rate estimate.
        networkFeeSats,
        tamperVerified: true,
    };
}
