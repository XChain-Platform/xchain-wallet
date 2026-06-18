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

/**
 * @typedef {Object} BuildSendPsbtOpts
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {import('./sendToken.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {string} to
 * @property {string} tick
 * @property {string | number} amount
 * @property {string} [memo]
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
    if (!opts.to) throw new Error('buildSendPsbt: to is required');
    if (!opts.tick) throw new Error('buildSendPsbt: tick is required');
    if (opts.amount === undefined || opts.amount === null || opts.amount === '') {
        throw new Error('buildSendPsbt: amount is required');
    }
    const source = normalizeSource(opts.from, 'buildSendPsbt');

    const descriptor = opts.chainRegistry.get(opts.chainId);
    if (!descriptor) throw new Error(`buildSendPsbt: unknown chain "${opts.chainId}"`);

    const sdk = opts.sdkRegistry.get(opts.chainId);
    const encoder = sdk?.encoder;
    if (!encoder) {
        throw new Error(
            `buildSendPsbt: SDK encoder not initialized for "${opts.chainId}". Call sdkRegistry.initActive([chainId]) first`,
        );
    }

    /** @type {Record<string, string>} */
    const params = {
        TICK: opts.tick,
        AMOUNT: String(opts.amount),
        DESTINATION: opts.to,
    };
    if (opts.memo !== undefined) params.MEMO = opts.memo;

    const createResult = sdk.actions.createAction({ action: 'SEND', params });

    const encoded = await encoder.createTx({
        data: createResult.actionString,
        pubkey: source.publicKey,
        ...(opts.fee !== undefined && { fee: opts.fee }),
        ...(opts.feePerKb !== undefined && { feePerKb: opts.feePerKb }),
        ...(opts.rbf !== undefined && { rbf: opts.rbf }),
    });

    return {
        psbtHex: encoded.psbt,
        encoding: encoded.encoding,
        actionString: createResult.actionString,
        action: createResult.action,
        version: createResult.version,
        chainId: opts.chainId,
        fromAddress: source.address,
    };
}
