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
// LIST v0 creates token, address, and union lists; v1 edits an existing
// list; v2 shares a list; v3 transfers a list to a new owner; v4 creates
// a list with metadata; and v5 changes a list's metadata. The wallet's
// §40.9 two-transaction airdrop flow emits v0 with TYPE=2.
//
// The wire shape for LIST uses a rest-field: `params.ITEM` is an array
// of strings (tickers for TYPE=1, addresses for TYPE=2, and action
// indexes for TYPE=3). The SDK format serializer expands the array into
// repeating `|ITEM` slots.
//
// MEMO is optional and sits BEFORE that tail on v0 and v1
// (`VERSION|TYPE|MEMO|...ITEM`), unlike every other action, where it
// trails: after a variadic field a memo is indistinguishable from one
// more item. Callers pass it as `params.MEMO`; omitting it serializes an
// empty slot, which the indexer stores as a null memo.

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
 * @property {Record<string, string | string[]>} params   LIST field map
 * @property {number} [fee]
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {import('../sdk/submitWithSigner.js').PrebuiltPsbt} [prebuiltPsbt] single-encode pipeline: sign this exact composed PSBT byte-identically (the one the ConfirmActionModal previewed + tamper-checked) instead of rebuilding.
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
    if (!['0', '1', '2', '3', '4', '5'].includes(version)) {
        throw new Error('createList: params.VERSION must be "0", "1", "2", "3", "4", or "5"');
    }
    const items = opts.params.ITEM;
    const isCreate = version === '0' || version === '4';
    if (isCreate || version === '1') {
        if (!Array.isArray(items) || items.length === 0) {
            throw new Error('createList: params.ITEM must be a non-empty array');
        }
    } else if (items !== undefined) {
        throw new Error(`createList: params.ITEM is not valid for v${version}`);
    }
    if (isCreate) {
        if (!['1', '2', '3'].includes(opts.params.TYPE)) {
            throw new Error('createList: params.TYPE must be "1" (TICK), "2" (ADDRESS), or "3" (UNION)');
        }
        if (opts.params.TYPE === '3') {
            if (items.length > 16) {
                throw new Error('createList: union params.ITEM must contain at most 16 action indexes');
            }
            if (!items.every((item) => typeof item === 'string' && /^[1-9][0-9]*$/.test(item))) {
                throw new Error('createList: union params.ITEM values must be positive-integer action indexes');
            }
        }
        if (version === '4') {
            for (const field of ['NAME', 'DESCRIPTION']) {
                if (opts.params[field] !== undefined && typeof opts.params[field] !== 'string') {
                    throw new Error(`createList: params.${field} must be a string for v4`);
                }
            }
        }
    } else if (version === '1') {
        if (opts.params.EDIT !== '1' && opts.params.EDIT !== '2') {
            throw new Error('createList: params.EDIT must be "1" (ADD) or "2" (REMOVE)');
        }
        if (typeof opts.params.LIST_ACTION_INDEX !== 'string'
            || opts.params.LIST_ACTION_INDEX.length === 0) {
            throw new Error('createList: params.LIST_ACTION_INDEX is required for v1');
        }
    } else {
        if (typeof opts.params.LIST_ACTION_INDEX !== 'string'
            || opts.params.LIST_ACTION_INDEX.length === 0) {
            throw new Error(`createList: params.LIST_ACTION_INDEX is required for v${version}`);
        }
        if (version === '3'
            && (typeof opts.params.DESTINATION !== 'string'
                || opts.params.DESTINATION.length === 0)) {
            throw new Error('createList: params.DESTINATION is required for v3');
        }
        if (version === '5') {
            for (const field of ['NAME', 'DESCRIPTION']) {
                if (opts.params[field] !== undefined && typeof opts.params[field] !== 'string') {
                    throw new Error(`createList: params.${field} must be a string for v5`);
                }
            }
            if (!opts.params.NAME && !opts.params.DESCRIPTION) {
                throw new Error('createList: params.NAME and params.DESCRIPTION contain no change for v5');
            }
        }
    }
    const source = normalizeSource(opts.from, 'createList');

    let summary;
    if (isCreate && version === '4' && opts.params.NAME) {
        const kind = opts.params.TYPE === '3'
            ? 'union'
            : opts.params.TYPE === '2' ? 'address' : 'token';
        summary = `Create ${kind} list "${opts.params.NAME}" of ${items.length} item${items.length === 1 ? '' : 's'}`;
    } else if (isCreate && opts.params.TYPE === '3') {
        summary = `Create union of ${items.length} lists`;
    } else if (isCreate) {
        const kind = opts.params.TYPE === '2' ? 'address' : 'token';
        summary = `Create ${kind} list of ${items.length} item${items.length === 1 ? '' : 's'}`;
    } else if (version === '1') {
        const removing = opts.params.EDIT === '2';
        summary = `${removing ? 'Remove' : 'Add'} ${items.length} item${items.length === 1 ? '' : 's'} ${removing ? 'from' : 'to'} list #${opts.params.LIST_ACTION_INDEX}`;
    } else if (version === '2') {
        summary = `Share list #${opts.params.LIST_ACTION_INDEX}`;
    } else if (version === '3') {
        summary = `Transfer list #${opts.params.LIST_ACTION_INDEX} to ${opts.params.DESTINATION}`;
    } else {
        summary = `Rename list #${opts.params.LIST_ACTION_INDEX}`;
    }

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
            // Name the funding address so the SDK selects UTXOs BY
            // ADDRESS (`sourceAddress` is SDK-side only, never on the create_tx
            // wire) and returns change to the spender. Without it the encoder
            // falls back to resolving UTXOs from the raw `pubkey`, which it
            // turns into a p2pkh script; from a bech32 source that script holds
            // nothing and the lane dies at step 1 with "Error getting utxos:
            // <pubkey> has no matching Script". `change` is required
            // separately - the SDK states outright that it is "deliberately NOT
            // a fallback" for `sourceAddress` (xchain-sdk/src/encoder.js
            // createTx), because a change address is not always the spender.
            //
            // Only the live-build callers were hit: the confirm-modal path
            // hands submitAction a prebuiltPsbt, so createTx (and these opts
            // with it) is skipped. The legacy direct-dispatch publishes -
            // list fork, airdrop and the watcher/HW branches of ListCreateForm
            // build the tx here.
            // Same family as advancedAction's D-17/D-18 and dispenserAction's
            sourceAddress: source.address,
            change: source.address,
            ...(opts.fee !== undefined && { fee: opts.fee }),
            ...(opts.feePerKb !== undefined && { feePerKb: opts.feePerKb }),
            ...(opts.rbf !== undefined && { rbf: opts.rbf }),
            // PC-51: opt-in native-coin protocol fee (quotable action); submitAction's
            // preflight refuses at sign time (NativeFeeForfeitError) if unpriceable.
            ...(opts.payFeeInNativeCoin !== undefined && { payFeeInNativeCoin: opts.payFeeInNativeCoin }),
        },
        signingPaths: [source.derivationPath
            ? { inputIndex: 0, path: source.derivationPath }
            : { inputIndex: 0, addressId: source.addressId }],
        prebuiltPsbt: opts.prebuiltPsbt,
        pendingTxMeta,
        waitForTxid: opts.waitForTxid,
        waitOpts: opts.waitOpts,
        onProgress: opts.onProgress,
        onBroadcastFailure: opts.onBroadcastFailure,
    });
}
