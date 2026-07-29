// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// buildActionPsbt: §20 / Cluster W FOLLOWUP 5. Generalized watcher-mode
// helper that builds an UNSIGNED PSBT for any XChain action without
// unlocking the wallet, calling a signer, or broadcasting. The user
// transports the resulting hex to a separate Signer-mode wallet, gets
// it signed, and brings the signed PSBT back to a Full-mode wallet to
// broadcast.
//
// This is the encode-only path through `submitWithSigner`: Steps 1 + 2
// (createAction + encoder.createTx) and nothing else. SEND has its own
// dedicated `buildSendPsbt` because the Send form layers fee tiering,
// recent-destinations, and ADS donations on top; the rest of the action
// surface (ISSUE / MINT / DESTROY / DISPENSER / ORDER / SWAP / etc.)
// shares this single flow.
//
// Differences from submitAction:
//   - No password / no signer: a watcher-mode wallet has pubkeys but
//     no keys to sign with. We stop after encoding.
//   - No PendingTx record: no in-flight submission to track until the
//     signed PSBT is broadcast elsewhere.
//   - No ADS commit: the broadcast happens on a different wallet, so
//     the donation cannot atomically tie to "this user's broadcast".

import { normalizeSource } from './sendToken.js';
import { logConsole } from '../shared/utils/logConsole.js';
import { applyNativeFeePreflight } from '../sdk/nativeFeePreflight.js';
import { annotateEncoderFeeRequirement } from '../sdk/encoderErrors.js';
import { applyOracleFeePreflight } from '../sdk/oracleFeePreflight.js';

/**
 * @typedef {Object} BuildActionPsbtOpts
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {import('./sendToken.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {{ action: string, params: object }} actionData
 * @property {import('../sdk/submitWithSigner.js').SubmitEncoderOpts} [encoderOpts]
 */

/**
 * @typedef {Object} BuildActionPsbtResult
 * @property {string} psbtHex            unsigned PSBT, hex-encoded
 * @property {string} encoding           encoding chosen by the encoder (OP_RETURN / P2SH / etc.)
 * @property {string} actionString       full XChain action string
 * @property {string} action             mirrored from input
 * @property {number | string} [version] action version when known
 * @property {string} chainId            mirrored from input for downstream routing
 * @property {string} fromAddress        mirrored from input for downstream routing
 * @property {{ address: string, amount: number }} [nativeFeeQuote]  native-coin fee quote used during pre-flight, if native-fee mode was active
 */

/**
 * @param {BuildActionPsbtOpts} opts
 * @returns {Promise<BuildActionPsbtResult>}
 */
export async function buildActionPsbt(opts) {
    if (!opts) throw new Error('buildActionPsbt: opts is required');
    if (!opts.chainRegistry) throw new Error('buildActionPsbt: chainRegistry is required');
    if (!opts.sdkRegistry) throw new Error('buildActionPsbt: sdkRegistry is required');
    if (typeof opts.chainId !== 'string' || !opts.chainId) {
        throw new Error('buildActionPsbt: chainId is required');
    }
    if (!opts.actionData || typeof opts.actionData !== 'object') {
        throw new Error('buildActionPsbt: actionData is required');
    }
    if (typeof opts.actionData.action !== 'string' || !opts.actionData.action) {
        throw new Error('buildActionPsbt: actionData.action is required');
    }
    if (!opts.actionData.params || typeof opts.actionData.params !== 'object') {
        throw new Error('buildActionPsbt: actionData.params is required');
    }
    const source = normalizeSource(opts.from, 'buildActionPsbt');

    const descriptor = opts.chainRegistry.get(opts.chainId);
    if (!descriptor) throw new Error(`buildActionPsbt: unknown chain "${opts.chainId}"`);

    const sdk = opts.sdkRegistry.get(opts.chainId);
    const encoder = sdk?.encoder;
    if (!encoder) {
        throw new Error(
            `buildActionPsbt: SDK encoder not initialized for "${opts.chainId}"; call sdkRegistry.initActive([chainId]) first`,
        );
    }

    const createResult = sdk.actions.createAction(opts.actionData);

    // Native-coin fee pre-flight: size the FEE_DESTINATION output and refuse a doomed
    // (unpriceable) native-fee tx. No-op unless encoderOpts.payFeeInNativeCoin is set.
    const preflight = await applyNativeFeePreflight({
        sdk,
        actionData: opts.actionData,
        encoderOpts: opts.encoderOpts || {},
        source: source.address,
    });
    // Oracle usage fee : the watcher/unsigned path composes the same output the
    // signing path does, so an air-gapped Mode B dispenser is not silently unpayable.
    const oraclePreflight = await applyOracleFeePreflight({
        sdk,
        actionData: opts.actionData,
        encoderOpts: preflight.encoderOpts,
    });
    const encoderOpts = oraclePreflight.encoderOpts;

    logConsole.record({
        source: 'encoder',
        level: 'info',
        message: `createTx action=${opts.actionData.action} chain=${opts.chainId}`,
    });
    // : carry the quoted protocol fee out with a failed build, so the
    // "this address has nothing to spend" sentence can name the amount.
    let encoded;
    try {
        encoded = await encoder.createTx({
            data: createResult.actionString,
            pubkey: source.publicKey,
            // D-120: the same D-7 pair every signing path passes, and the one
            // this lane was missing. `sourceAddress` makes the SDK select the
            // funding UTXOs BY ADDRESS; without it the encoder selects by
            // `pubkey`, which the utxo-tracker cannot resolve to a script, so
            // every watcher-mode build from a bech32 address died on "Error
            // getting utxos: <pubkey> has no matching Script" - the whole
            // air-gapped lane, unusable on the wallet's DEFAULT address type.
            // `change` is the leftover sink, for the same reason
            // composeForConfirm passes it: without one the encoder refuses
            // rather than burn the change as fee. An explicit value in
            // encoderOpts still wins, since it is spread last.
            ...(source.address
                ? { sourceAddress: source.address, change: source.address }
                : {}),
            ...encoderOpts,
        });
    } catch (err) {
        throw annotateEncoderFeeRequirement(err, preflight.quote);
    }
    logConsole.record({
        source: 'encoder',
        level: 'info',
        message: `createTx ok action=${opts.actionData.action} encoding=${encoded.encoding}`,
    });

    return {
        psbtHex: encoded.psbt,
        encoding: encoded.encoding,
        actionString: createResult.actionString,
        action: createResult.action,
        version: createResult.version,
        chainId: opts.chainId,
        fromAddress: source.address,
        nativeFeeQuote: preflight.quote,
    };
}
