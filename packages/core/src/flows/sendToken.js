// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// sendToken: convenience wrapper for the SEND action (§Phase 1
// authoring surface; protocol docs: xchain-documentation/protocol/
// actions/SEND.md). Maps JS-friendly params to the protocol's
// uppercase field names and forwards to submitAction.
//
// For multi-destination SEND (protocol formats v1–v3) or advanced
// encoder options, call submitAction directly.

import { submitAction } from './submitAction.js';

/**
 * @typedef {Object} SourceRef
 * @property {string} address
 * @property {string} publicKey                  hex, compressed (SDK expects this form)
 * @property {string | null} [derivationPath]    HD path; null/omitted for imported-WIF
 * @property {string} [addressId]                Address record id; required when derivationPath is null
 */

/**
 * @typedef {Object} SendTokenOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} [password]                     required for software wallets; omit when `signer` is supplied
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {SourceRef | import('../schemas/address.js').Address} from   source address (Address record or explicit triple)
 * @property {string} to                              DESTINATION
 * @property {string} tick                           TICK (or `^<id>` for TICK_ID)
 * @property {string | number} amount                 AMOUNT
 * @property {string} [memo]                          MEMO (protocol rejects `|` or `;`)
 * @property {number} [fee]                           absolute sats
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {import('../signers/Signer.js').Signer} [signer]    pre-built signer (RemoteSigner for HW)
 * @property {(txid: string, opts?: object) => Promise<unknown>} [waitForTxid]
 * @property {object} [waitOpts]
 * @property {(phase: string, data: object) => void} [onProgress]
 * @property {(entry: { signedTxHex: string, txid: string, chainId: string, signedAt: number, summary: string, error: string }) => void | Promise<void>} [onBroadcastFailure]   Cluster G FOLLOWUP 1; passes through to submitAction.
 */

/**
 * @param {SendTokenOpts} opts
 * @returns {Promise<import('../sdk/submitWithSigner.js').SubmitResult>}
 */
export async function sendToken(opts) {
    if (!opts) throw new Error('sendToken: opts is required');
    if (!opts.to) throw new Error('sendToken: to is required');
    if (!opts.tick) throw new Error('sendToken: tick is required');
    if (opts.amount === undefined || opts.amount === null || opts.amount === '') {
        throw new Error('sendToken: amount is required');
    }
    const source = normalizeSource(opts.from, 'sendToken');

    /** @type {Record<string, string>} */
    const params = {
        TICK: opts.tick,
        AMOUNT: String(opts.amount),
        DESTINATION: opts.to,
    };
    if (opts.memo !== undefined) params.MEMO = opts.memo;

    const memoTail = opts.memo ? ` (memo: "${opts.memo}")` : '';
    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: opts.to,
        actionSummary: `Send ${opts.amount} ${opts.tick} to ${opts.to}${memoTail}`,
    };

    return submitAction({
        vault: opts.vault,
        walletId: opts.walletId,
        password: opts.password,
        bip39Passphrase: opts.bip39Passphrase,
        chainRegistry: opts.chainRegistry,
        sdkRegistry: opts.sdkRegistry,
        chainId: opts.chainId,
        actionData: { action: 'SEND', params },
        encoderOpts: {
            pubkey: source.publicKey,
            ...(opts.fee !== undefined && { fee: opts.fee }),
            ...(opts.feePerKb !== undefined && { feePerKb: opts.feePerKb }),
            ...(opts.rbf !== undefined && { rbf: opts.rbf }),
        },
        signingPaths: [source.derivationPath
            ? { inputIndex: 0, path: source.derivationPath }
            : { inputIndex: 0, addressId: source.addressId }],
        signer: opts.signer,
        pendingTxMeta,
        waitForTxid: opts.waitForTxid,
        waitOpts: opts.waitOpts,
        onProgress: opts.onProgress,
        onBroadcastFailure: opts.onBroadcastFailure,
    });
}

/**
 * Normalize the `from` argument to a SourceRef. Accepts either an
 * Address schema record (including imported-WIF addresses from a
 * wif-only wallet or HD+imported) or a plain object with the same
 * fields. Shared by sendToken and sweepToken.
 *
 * HD source: needs `address`, `publicKey`, `derivationPath`.
 * Imported-WIF source: needs `address`, `publicKey`, plus `addressId`
 * (the Address record id; the signer resolves the WIF from
 * `Wallet.importedKeys[addressId]`). Watch-only addresses are rejected.
 *
 * @param {unknown} from
 * @param {string} fnName
 * @returns {SourceRef}
 */
export function normalizeSource(from, fnName = 'flow') {
    if (!from || typeof from !== 'object') {
        throw new Error(`${fnName}: from is required`);
    }
    const source = /** @type {SourceRef & { source?: string, id?: string }} */ (from);
    const { address, publicKey, derivationPath } = source;
    if (typeof address !== 'string' || address.length === 0) {
        throw new Error(`${fnName}: from.address must be a non-empty string`);
    }
    if (typeof publicKey !== 'string' || publicKey.length === 0) {
        throw new Error(`${fnName}: from.publicKey must be a non-empty string`);
    }
    if (source.source === 'watch-only') {
        throw new Error(
            `${fnName}: from.source = "watch-only"; this address has no signer`,
        );
    }
    // HW sources ('trezor' / 'ledger') are valid here. The caller is
    // expected to supply a pre-built RemoteSigner via submitAction's
    // `signer` param so the action flow routes signing over the
    // renderer↔background bridge instead of the password-unlock path.
    if (typeof derivationPath === 'string' && derivationPath.length > 0) {
        return { address, publicKey, derivationPath };
    }
    // Imported-WIF path. `addressId` is required and taken from the
    // Address record's `id` field (which is what the Address schema
    // puts there), or from an explicit `addressId` on a plain triple.
    const addressId = typeof source.addressId === 'string' && source.addressId.length > 0
        ? source.addressId
        : (typeof source.id === 'string' && source.id.length > 0 ? source.id : null);
    if (!addressId) {
        throw new Error(
            `${fnName}: from.derivationPath is null; imported-WIF source must include an addressId (Address record's id)`,
        );
    }
    return { address, publicKey, derivationPath: null, addressId };
}
