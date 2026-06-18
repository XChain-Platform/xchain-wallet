// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// fileAction: convenience wrapper for the FILE action (protocol docs:
// xchain-documentation/protocol/actions/FILE.md). Mirrors linkAction:
// takes vault + registries + chain + source + the file's metadata and
// raw bytes, and forwards to submitAction.
//
// On-chain shape per `xchain-sdk` formats v0:
// `VERSION|NAME|TYPE|TITLE|MEMO|GATE_TICKER|ENCRYPTION_METHOD|KEY_HASH`.
// This flow submits PUBLIC files only. The gating fields stay empty
// and the encoder strips them (token-gated publishing is its own flow;
// the read side lives in gatedContent.js).
//
// The file bytes travel as `rawData`, a Latin-1 binary string the
// encoder compiles into the transaction's data push verbatim
// (Buffer.from(rawData, 'binary')). The decoder enforces a compiled
// push ceiling of 8192 bytes (MAX_ACTION_DATA_LENGTH), so the encoder
// rejects oversized payloads at encode time; callers should cap the
// raw file around ~7.5 KB to leave headroom for the action string.

import { submitAction } from './submitAction.js';
import { normalizeSource } from './sendToken.js';

/**
 * @typedef {Object} FileActionOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {import('./sendToken.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {string} name                     filename (NAME)
 * @property {string} type                     MIME type (TYPE)
 * @property {string} [title]                  human title (TITLE)
 * @property {string} [memo]
 * @property {string} rawData                  file bytes as a Latin-1 binary string
 * @property {number} [fee]
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {(txid: string, opts?: object) => Promise<unknown>} [waitForTxid]
 * @property {object} [waitOpts]
 * @property {(phase: string, data: object) => void} [onProgress]
 * @property {boolean} [trackPendingTx]
 */

/**
 * @param {FileActionOpts} opts
 * @returns {Promise<import('../sdk/submitWithSigner.js').SubmitResult>}
 */
export async function fileAction(opts) {
    if (!opts) throw new Error('fileAction: opts is required');
    if (typeof opts.name !== 'string' || opts.name.length === 0) {
        throw new Error('fileAction: name is required');
    }
    if (typeof opts.type !== 'string' || opts.type.length === 0) {
        throw new Error('fileAction: type (MIME) is required');
    }
    if (typeof opts.rawData !== 'string' || opts.rawData.length === 0) {
        throw new Error('fileAction: rawData (file bytes) is required');
    }
    for (const [field, value] of [['name', opts.name], ['type', opts.type], ['title', opts.title], ['memo', opts.memo]]) {
        if (typeof value === 'string' && /[|;]/.test(value)) {
            throw new Error(`fileAction: ${field} cannot contain | or ; characters`);
        }
    }

    const source = normalizeSource(opts.from, 'fileAction');

    const params = {
        VERSION: '0',
        NAME: opts.name.trim(),
        TYPE: opts.type.trim(),
        TITLE: typeof opts.title === 'string' ? opts.title.trim() : '',
        MEMO: typeof opts.memo === 'string' ? opts.memo : '',
    };

    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: null,
        actionSummary: `Upload file ${params.NAME} (${opts.rawData.length} bytes)`,
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
        actionData: { action: 'FILE', params },
        encoderOpts: {
            pubkey: source.publicKey,
            rawData: opts.rawData,
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
