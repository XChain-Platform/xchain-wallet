// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// sleepAction (PC-05): convenience wrapper for the SLEEP action (protocol
// doc xchain-documentation/protocol/actions/SLEEP.md). SLEEP pauses
// actions on an ADDRESS (v0: VERSION|RESUME_BLOCK|MEMO) or a TICK (v1:
// VERSION|RESUME_BLOCK|TICK|MEMO) until RESUME_BLOCK.
//
// RESUME_BLOCK is a block height, or one of the special immediate
// methods: 0 = resume now, -1 = pause indefinitely (indexer config
// SLEEP_IMMEDIATE_METHODS).
//
// Two very different risk profiles:
//   - TICK sleep (v1) is owner-only and reversible: the owner can send
//     SLEEP|1|0|TICK to resume any time (unless LOCK_SLEEP is set).
//   - ADDRESS sleep (v0) is a SELF-LOCK: while an address is asleep it
//     cannot submit ANY action, including SLEEP, so a large or -1
//     RESUME_BLOCK freezes the address until that block passes with no
//     way to undo it. The wallet form guards this with a typed confirm.
//
// The SDK validator + indexer enforce authorization, LOCK_SLEEP, and the
// RESUME_BLOCK range; this flow only guards required inputs.

import { submitAction } from './submitAction.js';
import { normalizeSource } from './sendToken.js';

/**
 * @typedef {Object} SleepActionOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {import('./sendToken.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {Record<string, string>} params            SLEEP field map (VERSION, RESUME_BLOCK, TICK on v1, optional MEMO)
 * @property {number} [fee]
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {import('../sdk/submitWithSigner.js').PrebuiltPsbt} [prebuiltPsbt]   single-encode pipeline: sign this exact composed PSBT byte-identically instead of rebuilding.
 * @property {(txid: string, opts?: object) => Promise<unknown>} [waitForTxid]
 * @property {object} [waitOpts]
 * @property {(phase: string, data: object) => void} [onProgress]
 * @property {boolean} [trackPendingTx]
 */

/**
 * @param {SleepActionOpts} opts
 * @returns {Promise<import('../sdk/submitWithSigner.js').SubmitResult>}
 */
export async function sleepAction(opts) {
    if (!opts) throw new Error('sleepAction: opts is required');
    if (!opts.params || typeof opts.params !== 'object') {
        throw new Error('sleepAction: params is required');
    }
    const { RESUME_BLOCK, VERSION } = opts.params;
    if (RESUME_BLOCK === undefined || RESUME_BLOCK === null || String(RESUME_BLOCK).length === 0) {
        throw new Error('sleepAction: params.RESUME_BLOCK is required');
    }
    // v1 (tick sleep) requires a TICK; v0 (address sleep) must not carry one.
    if (String(VERSION) === '1' && (typeof opts.params.TICK !== 'string' || opts.params.TICK.length === 0)) {
        throw new Error('sleepAction: params.TICK is required for a tick sleep (VERSION 1)');
    }
    const source = normalizeSource(opts.from, 'sleepAction');

    const isTick = String(VERSION) === '1';
    const rb = String(RESUME_BLOCK);
    const target = isTick ? opts.params.TICK : source.address;
    const verb = rb === '0' ? 'Resume' : 'Pause';
    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: null,
        actionSummary: `${verb} ${isTick ? target : 'address'}${rb !== '0' ? (rb === '-1' ? ' indefinitely' : ` until block ${rb}`) : ''}`,
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
        actionData: { action: 'SLEEP', params: opts.params },
        encoderOpts: {
            pubkey: source.publicKey,
            ...(opts.fee !== undefined && { fee: opts.fee }),
            ...(opts.feePerKb !== undefined && { feePerKb: opts.feePerKb }),
            ...(opts.rbf !== undefined && { rbf: opts.rbf }),
        },
        signingPaths: [source.derivationPath
            ? { inputIndex: 0, path: source.derivationPath }
            : { inputIndex: 0, addressId: source.addressId }],
        prebuiltPsbt: opts.prebuiltPsbt,
        pendingTxMeta,
        waitForTxid: opts.waitForTxid,
        waitOpts: opts.waitOpts,
        onProgress: opts.onProgress,
    });
}
