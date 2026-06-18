// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// createList: authors a LIST action (§40.9; protocol docs:
// xchain-documentation/protocol/actions/LIST.md). Mirrors
// dividendAction / broadcastAction: takes vault + registries + chain +
// source address + LIST params, forwards to submitAction.
//
// LIST has two format versions. The wallet's §40.9 two-transaction
// airdrop flow emits v0 (create) with TYPE=2 (ADDRESS list); v1
// (edit-existing) is exposed here for future LIST-management surfaces
// but has no authoring form yet.
//
// The wire shape for LIST uses a rest-field: `params.ITEM` is an array
// of strings (addresses for TYPE=2, tickers for TYPE=1). The SDK
// format serializer expands the array into repeating `|ITEM` slots.

import { submitAction } from './submitAction.js';
import { normalizeSource } from './sendToken.js';

/**
 * @typedef {Object} CreateListOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {import('./sendToken.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {Record<string, string | string[]>} params   LIST field map (VERSION, TYPE, ITEM[], and v1's EDIT + LIST_ACTION_INDEX)
 * @property {number} [fee]
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {(txid: string, opts?: object) => Promise<unknown>} [waitForTxid]
 * @property {object} [waitOpts]
 * @property {(phase: string, data: object) => void} [onProgress]
 * @property {boolean} [trackPendingTx]
 */

/**
 * @param {CreateListOpts} opts
 * @returns {Promise<import('../sdk/submitWithSigner.js').SubmitResult>}
 */
export async function createList(opts) {
    if (!opts) throw new Error('createList: opts is required');
    if (!opts.params || typeof opts.params !== 'object') {
        throw new Error('createList: params is required');
    }
    const version = opts.params.VERSION;
    if (version !== '0' && version !== '1') {
        throw new Error('createList: params.VERSION must be "0" or "1"');
    }
    const items = opts.params.ITEM;
    if (!Array.isArray(items) || items.length === 0) {
        throw new Error('createList: params.ITEM must be a non-empty array');
    }
    if (version === '0') {
        if (opts.params.TYPE !== '1' && opts.params.TYPE !== '2') {
            throw new Error('createList: params.TYPE must be "1" (TICK) or "2" (ADDRESS)');
        }
    } else {
        if (opts.params.EDIT !== '1' && opts.params.EDIT !== '2') {
            throw new Error('createList: params.EDIT must be "1" (ADD) or "2" (REMOVE)');
        }
        if (typeof opts.params.LIST_ACTION_INDEX !== 'string'
            || opts.params.LIST_ACTION_INDEX.length === 0) {
            throw new Error('createList: params.LIST_ACTION_INDEX is required for v1');
        }
    }
    const source = normalizeSource(opts.from, 'createList');

    const kind = version === '0'
        ? (opts.params.TYPE === '2' ? 'address' : 'token')
        : (opts.params.EDIT === '2' ? 'remove' : 'add');
    const summary = version === '0'
        ? `Create ${kind} list of ${items.length} item${items.length === 1 ? '' : 's'}`
        : `${kind === 'remove' ? 'Remove' : 'Add'} ${items.length} item${items.length === 1 ? '' : 's'} ${kind === 'remove' ? 'from' : 'to'} list #${opts.params.LIST_ACTION_INDEX}`;

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
        actionData: { action: 'LIST', params: opts.params },
        encoderOpts: {
            pubkey: source.publicKey,
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
