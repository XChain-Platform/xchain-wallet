// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Single-encode pipeline compose step ( §5.3.1).
//
// The load-bearing v3 fix: today submitWithSigner runs
// createAction -> encoder.createTx -> sign ATOMICALLY on Approve, so any
// modal preview would be a throwaway encode and the signed PSBT a
// rebuild (different UTXO selection, different fee). composeForConfirm
// hoists the whole build to BEFORE the modal opens:
//
//   createAction -> native-fee quote -> side-effect-free ADS plan ->
//   encoder.createTx
//
// It returns the exact PSBT the modal previews AND the checks run
// against; submitWithSigner then signs that PSBT byte-identically via
// its `prebuiltPsbt` option. The ADS accumulator is NOT advanced here
// (that stays a post-broadcast concern, §1 decision) - only the
// donation OUTPUT is resolved and folded into the PSBT.
//
// Runs PRE-OPEN (before any modal-open state flips): compose failures
// reject the confirm() promise unwrapped so each form's existing error
// rendering works unmodified (§5.6 migration keystone).

import { applyNativeFeePreflight } from '../sdk/nativeFeePreflight.js';
import { applyAdsPlanToEncoderOpts } from './ads.js';
import { buildExpectedOutputs } from './confirmChecks.js';
import { nativePaymentOutput } from './nativePayment.js';

/**
 * @typedef {Object} ComposedAction
 * @property {string} actionString
 * @property {string} action
 * @property {number|string} version
 * @property {string} psbt                     the PSBT hex the modal previews and the signer signs
 * @property {string} encoding                 chosen by the encoder
 * @property {object|null} quote               native-fee quote, when native-fee mode was active
 * @property {object} adsPlan                  resolved ADS plan (donationAmount / canSubmit / ...)
 * @property {ReturnType<typeof buildExpectedOutputs>} expectedOutputs
 * @property {object} encoderOpts              the FINAL encoderOpts used to build the PSBT (fee + ADS folded in)
 */

/**
 * @param {Object} args
 * @param {import('../sdk/SDKRegistry.js').SDKRegistry} args.sdkRegistry
 * @param {import('../registry/index.js').ChainRegistry} args.chainRegistry
 * @param {import('../storage/Vault.js').Vault} args.vault
 * @param {string} args.chainId
 * @param {{ action: string, params: object }} args.actionData
 * @param {object} args.encoderOpts            must include pubkey/change per the encoder contract
 * @param {string} [args.source]               spender address for the native-fee quote
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<ComposedAction>}
 */
export async function composeForConfirm({
    sdkRegistry, chainRegistry, vault, chainId, actionData, encoderOpts, source, signal,
}) {
    const descriptor = chainRegistry.get(chainId);
    if (!descriptor) throw new Error(`composeForConfirm: unknown chain "${chainId}"`);
    const sdk = sdkRegistry.get(chainId);
    if (!sdk.encoder) {
        throw new Error('composeForConfirm: SDK encoder not initialized; call sdkRegistry.initActive([chainId]) first');
    }

    // 1. Action string (pure formatting, no network).
    const createResult = sdk.actions.createAction(actionData);

    // 2. Native-coin fee pre-flight (folds the FEE_DESTINATION output into
    // customOutputs when payFeeInNativeCoin is set; throws NativeFeeForfeitError
    // when the action can't be safely priced). No-op otherwise.
    const feePreflight = await applyNativeFeePreflight({
        sdk, actionData, encoderOpts, source, signal,
    });

    // 3. ADS plan resolution, side-effect-free: fold the donation output
    // into customOutputs now (pre-modal) so it is inside the previewed and
    // signed PSBT. The accumulator advances only on broadcast success.
    const settingsSnapshot = await vault.settings.get();
    const { encoderOpts: encoderOptsWithAds, adsPlan } = applyAdsPlanToEncoderOpts(
        settingsSnapshot, chainId, chainRegistry, feePreflight.encoderOpts);

    // 3b. D-9: a native-coin SEND ("SEND BTC ...") writes only an OP_RETURN, which
    // moves no value (the indexer has no native-coin ledger to credit). Append a
    // real destination payment output so the recipient is actually paid; the
    // encoder folds its value into the change math. Token sends return null here
    // and are unchanged. The output is added to the SAME customOutputs the tamper
    // matcher reads below, so the built PSBT and the expected set stay in sync.
    const nativeOut = nativePaymentOutput({
        tick: actionData?.params?.TICK,
        amount: actionData?.params?.AMOUNT,
        destination: actionData?.params?.DESTINATION,
        descriptor,
    });
    const finalEncoderOpts = nativeOut
        ? { ...encoderOptsWithAds, customOutputs: [ ...(encoderOptsWithAds.customOutputs || []), nativeOut ] }
        : encoderOptsWithAds;

    // 4. Encode to the ONE PSBT the modal previews and the signer signs.
    // D-7: give the encoder the spender address so it can build the tx:
    //  - `sourceAddress` (SDK-side only, not on the wire) makes the SDK select the
    //    funding UTXOs BY ADDRESS. Without it the encoder selects by `pubkey`, which
    //    the utxo-tracker cannot resolve to a script ("has no matching Script").
    //  - `change` is the address the leftover value returns to; the spender is the
    //    change sink. Without it the encoder refuses to build ("CHANGE_ADDRESS_REQUIRED"
    //    rather than burn the change as fee). An explicit change in encoderOpts wins
    //    (the spread below overrides this default).
    const encoded = await sdk.encoder.createTx({
        data: createResult.actionString,
        ...(source ? { sourceAddress: source, change: source } : {}),
        ...finalEncoderOpts,
    });

    const adsOutput = adsPlan.canSubmit
        ? { address: adsPlan.donationAddress, value: adsPlan.donationAmount }
        : null;
    const expectedOutputs = buildExpectedOutputs({
        customOutputs: finalEncoderOpts.customOutputs,
        encoding: encoded.encoding,
        adsOutput,
    });

    return {
        actionString: createResult.actionString,
        action: createResult.action,
        version: createResult.version,
        psbt: encoded.psbt,
        encoding: encoded.encoding,
        quote: feePreflight.quote,
        adsPlan,
        expectedOutputs,
        encoderOpts: finalEncoderOpts,
    };
}
