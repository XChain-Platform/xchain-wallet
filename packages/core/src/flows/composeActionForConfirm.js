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
import { satsToCoinDecimal } from './feeEstimate.js';
import { addressBalances } from './balances.js';
import { simulateAction } from '../decoder/txSimulator.js';
import { balancesFromSdk } from '../decoder/balanceAdapter.js';

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

    // Kick the balances read off CONCURRENTLY with the compose: the §5.2.3
    // deltas below need it, but it depends only on (chain, source), so
    // serializing it behind the encoder would add its round-trip to the
    // pre-open compose of every single action for no reason. Pre-rejected to
    // null so a dead explorer never fails the compose.
    const balancesPromise = source
        ? addressBalances({ sdkRegistry, chainRegistry, chainId, address: source })
            .catch(() => null)
        : Promise.resolve(null);

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
        // Self-sign byte-match: we already hold the intended action string and
        // only need to prove the PSBT's OP_RETURN encodes exactly those bytes,
        // so use the raw string extractor - NOT decodeActionFromPsbt, whose
        // fail-closed rest/multi-leg refusals are a CO-SIGNER policy concern and
        // would wrongly flag rest-field actions (EXECUTE, LIST) as tampered even
        // when the bytes are correct.
        decodeActionFromPsbt: (hex) => sdk.decoder.decodeActionStringFromPsbt(hex),
        // §5.3.2 check 3: the chunk lanes, which the byte-match above skips.
        // The scripts ride on the encoder's create_tx response, so they are
        // the ones it actually committed to, not a re-derivation. Passed as
        // the PSBT hex, which is what survives the host messaging boundary.
        psbt: composed.psbt,
        carrierScripts: composed.carrierScripts,
        network: sdk.config && sdk.config.network,
        verifyCarrierScripts: sdk.decoder.verifyCarrierScripts,
    });

    // §5.2.3 balance deltas. Computed HERE, not per-form, for the same reason
    // the tamper check is: this is where the SDK, the balances and the canonical
    // parse all live, so one implementation serves every confirm surface
    // instead of ~24 forms each wiring their own simulator (they all passed
    // `simulation={null}`, so the section was dead everywhere).
    //
    // Fed the PARSED COMPOSED action string, never the caller's form params
    // (§5.2.3): intent and deltas must provably read one canonical source. Uses
    // the exact fee from above, so the projected coin delta matches the fee the
    // user is shown. Best-effort: any failure leaves `simulation` null and the
    // section simply does not render, exactly as before.
    // : a bare native payment has no action string to parse. Its
    // canonical source is the payment output itself, and the output-set
    // tamper check above has already proven the PSBT matches exactly the
    // outputs these params produced - so they are as canonical here as a
    // re-parse would be, and there is nothing else to read.
    let parsed = null;
    try {
        parsed = composed.bareNativePayment
            ? { ok: true, action: actionData.action, params: actionData.params }
            : sdk.decoder.parse(composed.actionString);
    } catch {
        parsed = null;
    }

    // §1.1 / §5.2.2: the INTENT the user reads is described from that same
    // parsed composed action, for the same reason the deltas are.
    //
    // It was not, until now. Every form built its own `decoded` by calling
    // `decodeAction` on its FORM PARAMS and passing it down, which is exactly
    // the "renders from form state or a caller's claimed intent" that §1
    // forbids - and the deltas' own comment claimed intent already read one
    // canonical source with them. Describing what was actually composed makes
    // that true, and makes it true ONCE instead of per form: the  VOTE
    // mirror and the MESSAGE ciphertext both needed bespoke fixes to keep the
    // rendered intent honest, and a surface that describes the composed bytes
    // needs none.
    //
    // : described by `sdk.decoder.describe`, not by the wallet's own
    // copy of it. §3.2 promoted the describer to the SDK precisely so the
    // words a signer reads come from the same library that parsed the bytes,
    // and a second implementation is a second thing to drift: the SDK's
    // covers 30 actions to the wallet copy's 13 (ORDER, SWAP, STAKE, VOTE,
    // DEPLOY, EXECUTE and the rest were all landing on the generic
    // "no plain-English summary available" fallback on the signing screen).
    // `ownAddresses` is passed because §3.2's extended ctx marks a
    // destination the user already owns, which is the cheapest way to catch
    // a send that is not going where the signer thinks.
    let decoded = null;
    try {
        if (parsed?.ok) {
            decoded = sdk.decoder.describe(parsed, {
                chainId,
                chainRegistry,
                ownAddresses: [...own],
            });
        }
    } catch {
        // Leave it null and the caller's own `decoded` still renders: a
        // confirm page with no intent line would be worse than one described
        // from the params that built it.
        decoded = null;
    }

    let simulation = null;
    try {
        const sdkBalances = await balancesPromise;
        if (parsed?.ok && sdkBalances) {
            simulation = simulateAction({
                action: parsed.action,
                params: parsed.params,
                balances: balancesFromSdk(sdkBalances),
                feeEstimate: Number.isFinite(networkFeeSats)
                    ? satsToCoinDecimal(networkFeeSats)
                    : '0',
                chainId,
                chainRegistry,
            });
        }
    } catch {
        // Leave simulation null: a delta the wallet cannot compute must be
        // absent, never a zero that reads as "nothing changes".
        simulation = null;
    }

    // Serializable envelope for the popup. `encoderOpts` (which carries the
    // ADS-folded customOutputs and is not needed client-side) is dropped;
    // everything returned here survives structured-clone / JSON transport.
    return {
        actionString: composed.actionString,
        action: composed.action,
        version: composed.version,
        // Lets the confirm surface describe the payment directly and skip
        // pre-flight: there is no XChain action here to dry-run.
        bareNativePayment: !!composed.bareNativePayment,
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
        // §5.2.3: projected balance deltas, or null when they could not be
        // computed. Never a zero that would read as "nothing changes".
        simulation,
        // §1.1 / §5.2.2: the intent, described from the composed action
        // string. Null when it could not be described, in which case the
        // caller's own `decoded` renders.
        decoded,
        tamperVerified: true,
    };
}
