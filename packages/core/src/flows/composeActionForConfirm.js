// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// composeActionForConfirm (§5.3): the HOST half of the single-
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
import { isBareNativePayment } from './nativePayment.js';
import { assertNoTamper } from './confirmChecks.js';
import { totalNetworkFeeSats } from './psbtNetworkFee.js';
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
 * What actually crosses the host boundary, which is NOT `ComposedAction`.
 *
 * `ComposedAction` is the INTERNAL shape composeForConfirm returns; the
 * envelope below drops two of its fields (`encoderOpts`, `carrierScripts` -
 * host-side build material the popup neither needs nor can act on) and adds
 * twelve the compose step never had (the fee lane, the deferred reveal set,
 * the exact fees, the projection, the decoded intent). Declaring it as
 * `ComposedAction & { tamperVerified: true }` was wrong in both directions at
 * once, and the three shells each restated a nine-field subset of it whose
 * types also denied the nullability the bare-payment lane relies on. There is
 * no typecheck on these packages, so this typedef is the only contract there
 * is, and JSDoc alone cannot fail a build here. The key-set assertions in
 * `test/unit/flows/composeActionForConfirm.test.js` are what enforce it: they
 * read the @property names below back out of this file and compare them to the
 * keys the function actually returns, so a field added to one and not the
 * other is a red test rather than a fourth stale declaration.
 *
 * @typedef {Object} HostComposeEnvelope
 * @property {string|null} actionString      the composed action string; NULL on a bare native payment
 * @property {string|null} action            action name; NULL on a bare native payment
 * @property {number|string|null} version    action version; NULL on a bare native payment
 * @property {boolean} bareNativePayment     true when there is no XChain action, only a coin payment
 * @property {string} chainId                the chain these bytes were built for
 * @property {string} psbt                   the exact PSBT hex the modal previews and the signer signs
 * @property {string|null} encoding          the encoder's chosen encoding; NULL on a bare native payment
 * @property {object|null} quote             native-fee quote, when native-fee mode was active
 * @property {boolean} payFeeInNativeCoin    which lane pays the protocol fee
 * @property {{ address: string, value: number|string }|null} deferredFeeOutput  protocol-fee output the reveal emits
 * @property {Array<{ address: string, value: number|string }>} deferredOutputs  every output the reveal emits
 * @property {{ change: string|null, rawData: string|null }|null} revealOpts     what the reveal must be built with
 * @property {object} adsPlan                resolved ADS plan
 * @property {ReturnType<typeof import('./confirmChecks.js').buildExpectedOutputs>} expectedOutputs
 * @property {number|null} networkFeeSats    exact miner fee of the built bytes; NULL when not derivable
 * @property {number|null} protocolFeeSats   protocol fee in the native coin; NULL in XCHAIN-fee mode
 * @property {string|null} xchainFee         protocol fee in XCHAIN; NULL in native mode / unquotable
 * @property {{ deltas: object[], sideEffects: object[], notes: string[] }|null} simulation  NULL when uncomputable
 * @property {object|null} decoded           the intent described from the action string; NULL when undescribable
 * @property {true} tamperVerified           reaching the caller at all means the checks passed
 */

/**
 * @param {ComposeActionForConfirmOpts} opts
 * @returns {Promise<HostComposeEnvelope>}
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

    // The XCHAIN lane's own protocol-fee quote, for the confirm
    // screen's disclosure line.
    //
    // That line used to read only `report.quote.xchainFee`, i.e. the fee record
    // the Tier-1 dry run staged - and the dry run is BEST-EFFORT: it has a
    // 4000ms budget and the wallet drops the verdict when the indexer misses
    // it. So on a merely busy venue the fee silently stopped being disclosed
    // and the screen went back to quoting the miner fee alone, which is
    // that screen. Measured twice in one hour on the same action (campaign
    // §11.1).
    //
    // Asked here, concurrently, from the same `/feequote` call the NATIVE lane
    // sizes a real on-chain output from - a number good enough to spend is good
    // enough to display - and only in the XCHAIN lane, because the native lane
    // discloses its fee as a coin debit and must not also state it in XCHAIN.
    // Pre-rejected to null: a fee the wallet cannot quote is a line it does not
    // draw, never a compose that fails.
    // Skipped for a bare native payment for the same reason a later change skips the
    // dry run on one: there is no XChain action to price, and asking anyway
    // spends a round trip on the wallet's commonest operation.
    const quotable = source
        && !encoderOpts.payFeeInNativeCoin
        && !isBareNativePayment(actionData, chainRegistry.get(chainId));
    const xchainFeePromise = quotable
        ? quoteXchainFee({ sdkRegistry, chainId, actionData, source, signal }).catch(() => null)
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
    //
    // totalNetworkFeeSats, not exactNetworkFeeSats, because a chunk-lane
    // action is TWO transactions and this PSBT is only the first. The reveal's
    // miner fee is pre-funded by the carrier outputs this PSBT creates, so it is
    // knowable here and belongs in the number the user is asked to approve.
    // Off the chunk lanes the two functions agree exactly.
    const decomposed = sdk.wallet.decomposePsbt(composed.psbt);
    // Everything the reveal re-emits as a real output, which is the WHOLE
    // deferred set and not the protocol fee alone: a Mode B dispenser's oracle
    // usage fee, an ADS donation and a native payment output all ride the reveal
    // too. Subtracting only the fee reported the rest of the carrier value as
    // miner fee, and the confirm screen presents that number as the exact
    // network fee - so a 1,000-sat commit fee carrying 6,000 sats of reveal
    // payments in an 8,000-sat carrier read as 8,000 instead of 3,000.
    //
    // Same precedence submitWithSigner applies when it BUILDS the reveal (the
    // whole set, else the fee alone, else nothing), so the number on screen and
    // the outputs on chain cannot come from different rules. The quote is the
    // last fallback, for an envelope from a composer that carries neither field.
    const revealOutputs = Array.isArray(composed.deferredOutputs) && composed.deferredOutputs.length
        ? composed.deferredOutputs
        : (composed.deferredFeeOutput ? [composed.deferredFeeOutput] : []);
    const networkFeeSats = totalNetworkFeeSats(decomposed, {
        carrierScripts: composed.carrierScripts,
        ownAddresses: own,
        revealOutputSats: revealOutputs.length
            ? revealOutputs.reduce((sum, o) => sum + (Number(o?.value) || 0), 0)
            : Number(composed.quote?.requiredFeeSats) || 0,
    });
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
    // A bare native payment has no action string to parse. Its
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
    // that true, and makes it true ONCE instead of per form: the VOTE
    // mirror and the MESSAGE ciphertext both needed bespoke fixes to keep the
    // rendered intent honest, and a surface that describes the composed bytes
    // needs none.
    //
    // Described by `sdk.decoder.describe`, not by the wallet's own
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

    // The miner fee is not the whole cost. A fee-bearing action
    // (ISSUE, the BET_* and VM_* families, per-recipient AIRDROP/DIVIDEND)
    // also pays a protocol fee, and `networkFeeSats` cannot see it: in
    // native-coin mode it is an extra OUTPUT to FEE_DESTINATION, and
    // `inputs - outputs` excludes outputs by construction. The quote that
    // sized that output is right here on the envelope, so the projection
    // gets the same number the transaction pays. Null in XCHAIN-fee mode -
    // no quote was fetched there, and the simulator must stay silent rather
    // than project a fee it does not know.
    const protocolFeeSats = Number(composed.quote?.requiredFeeSats);
    const protocolFee = Number.isFinite(protocolFeeSats) && protocolFeeSats > 0
        ? { amount: satsToCoinDecimal(protocolFeeSats) }
        : null;

    // And only for the disclosure LINE: the XCHAIN-lane fee is not fed
    // to the simulator above. The projection folds a fee into a balance row,
    // and in this lane the debit is contingent on acceptance rather than spent
    // on broadcast, so it belongs in a sentence that can say so. Kept as the
    // wire's own 8dp string; the line trims it for display and never parses it
    // through a float.
    const xchainFee = await xchainFeePromise;

    let simulation = null;
    try {
        const sdkBalances = await balancesPromise;
        if (parsed?.ok && sdkBalances) {
            simulation = simulateAction({
                action: parsed.action,
                params: parsed.params,
                balances: balancesFromSdk(sdkBalances),
                // NULL, not '0'. `networkFeeSats` is null exactly when the fee
                // could not be read from the built bytes (a PSBT missing an
                // input value, a carrier count that does not match the scripts),
                // and '0' told the simulator the transaction was free: a 1 BTC
                // send from 10 BTC then projected a flat 10 -> 9 with the charge
                // nowhere on the screen and nothing saying it was missing. The
                // same rule as the catch below, one step earlier: a number the
                // wallet cannot compute is absent, never a zero.
                feeEstimate: Number.isFinite(networkFeeSats)
                    ? satsToCoinDecimal(networkFeeSats)
                    : null,
                protocolFee,
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
        // WHICH LANE these bytes pay the protocol fee through. It has to cross
        // the boundary, and this whitelist is where D-119 actually broke: the
        // compose knew, the confirm screen did not, so the network dry run was
        // asked about the chain default and told a payer with no XCHAIN that a
        // correct action would fail. A field the popup cannot see may as well
        // not exist.
        payFeeInNativeCoin: !!composed.payFeeInNativeCoin,
        // The protocol fee output the two-phase lane moved to the
        // reveal. Rides the envelope so the form can hand it back on Approve
        // and the submit path attaches it without re-quoting.
        deferredFeeOutput: composed.deferredFeeOutput || null,
        // ...and every OTHER output the commit reserved but did not emit (a Mode B
        // dispenser's oracle usage fee, an ADS donation, a native payment output).
        // Left out of the envelope they were burned as miner fee on the reveal.
        deferredOutputs: composed.deferredOutputs || [],
        // The change (and rawData) the phase-2 reveal has to be built with to
        // agree with this commit. The full `encoderOpts` is still dropped below;
        // this is the one slice the submit path cannot re-derive, because it
        // builds the reveal fresh from opts that never saw the rotated change.
        revealOpts: composed.revealOpts || null,
        adsPlan: composed.adsPlan,
        expectedOutputs: composed.expectedOutputs,
        // §5.2.5: exact fee in the chain's smallest unit, or null when the PSBT
        // does not carry every input value. Never a rate estimate.
        networkFeeSats,
        // The action's own protocol fee in the chain's smallest unit,
        // when it is being paid in the native coin and therefore known. Null
        // in XCHAIN-fee mode, which pays no coin output.
        protocolFeeSats: protocolFee ? protocolFeeSats : null,
        // The same fee in XCHAIN, when THAT is the lane paying it. The
        // confirm screen's disclosure line prefers the dry run's own staged fee
        // record and falls back to this, so the fee stays on screen when the
        // dry run does not answer. Null in native mode and whenever the quote
        // was unavailable, refused or zero.
        xchainFee,
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

/**
 * The action's protocol fee in XCHAIN, or null when the venue will not say.
 *
 * Read through `sdk.quoteNativeFee`, whose name is about the lane it was built
 * for rather than what it returns: `/feequote` answers `xchainFee` in every
 * payment mode, because the fee row is XCHAIN-denominated and the mode only
 * decides how it settles.
 *
 * Null - never zero, and never a guess - on every unusable answer:
 *   - a quote the indexer refused (`supported: false` / `valid: false`), whose
 *     `xchainFee` is either absent or about an action that will not run. The
 *     native lane REFUSES to sign on those (NativeFeeForfeitError) because it
 *     is about to spend coin; this one only draws a line, so it stays quiet and
 *     leaves the dry run's own verdict to say what is wrong;
 *   - `valid: null`, which is the third answer, not a failure (DEPLOY/EXECUTE
 *     are priced from the gas schedule without a dry run) - so those DO get a
 *     line, and the unverified-ness is already stated elsewhere on the screen;
 *   - a zero fee, i.e. the action genuinely charges nothing. Saying so would be
 * the opposite failure and just as wrong.
 */
async function quoteXchainFee({ sdkRegistry, chainId, actionData, source, signal }) {
    const sdk = sdkRegistry.get(chainId);
    if (!sdk || typeof sdk.quoteNativeFee !== 'function') return null;
    const quote = await sdk.quoteNativeFee(actionData, { source, signal });
    if (!quote || quote.supported === false || quote.valid === false) return null;
    const raw = quote.xchainFee;
    if (raw === undefined || raw === null) return null;
    const amount = String(raw).trim();
    // A plain non-negative decimal that is not all zeros. Tested as a STRING:
    // an 8dp fee through a float is the one thing a fee display must not do.
    if (!/^\d+(\.\d+)?$/.test(amount) || !/[1-9]/.test(amount)) return null;
    return amount;
}
