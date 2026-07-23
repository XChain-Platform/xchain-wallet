// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// contractStakeAction: STAKE v3 / UNSTAKE v1 / DELEGATE v1 composer for the
// "Stake on a Contract" form. Mirrors stakeAction.js (capability staking v1/v2)
// but routes to the contract-targeted protocol surface: any token, per-contract
// cooldown, contract-decided slash semantics. See:
//   xchain-documentation/protocol/Contract_Staking.md
//
// Three operations share the same composer, distinguished by `mode`:
//   - 'stake'    → STAKE v3 (AMOUNT + SIGNING_PUBKEY + TARGET_CONTRACT_INDEX + TICK)
//   - 'unstake'  → UNSTAKE v1 (SIGNING_PUBKEY + TARGET_CONTRACT_INDEX + TICK)
//   - 'delegate' → DELEGATE v1 (NEW SIGNING_PUBKEY + TARGET_CONTRACT_INDEX + TICK)
//
// BTC-only (same gate as capability staking); the indexer rejects other chains.

import { submitAction } from './submitAction.js';
import { normalizeSource } from './sendToken.js';

/**
 * @typedef {Object} ContractStakeActionOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {'stake' | 'unstake' | 'delegate'} mode
 * @property {import('./sendToken.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {{
 *   AMOUNT?: string,
 *   SIGNING_PUBKEY: string,
 *   TARGET_CONTRACT_INDEX: string | number,
 *   TICK: string
 * }} params
 * @property {number} [fee]
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {import('../sdk/submitWithSigner.js').PrebuiltPsbt} [prebuiltPsbt]   single-encode pipeline: sign this exact composed PSBT byte-identically (the one the ConfirmActionModal previewed + tamper-checked) instead of rebuilding.
 * @property {(txid: string, opts?: object) => Promise<unknown>} [waitForTxid]
 * @property {object} [waitOpts]
 * @property {(phase: string, data: object) => void} [onProgress]
 * @property {boolean} [trackPendingTx]
 */

/**
 * @param {ContractStakeActionOpts} opts
 */
export async function contractStakeAction(opts) {
    if (!opts) throw new Error('contractStakeAction: opts is required');
    if (!opts.params || typeof opts.params !== 'object') {
        throw new Error('contractStakeAction: params is required');
    }
    const mode = opts.mode;
    if (mode !== 'stake' && mode !== 'unstake' && mode !== 'delegate') {
        throw new Error('contractStakeAction: mode must be "stake", "unstake", or "delegate"');
    }

    // Shared field validation (all three modes)
    if (!opts.params.SIGNING_PUBKEY) {
        throw new Error('contractStakeAction: params.SIGNING_PUBKEY is required');
    }
    if (!/^[0-9a-fA-F]{64}$/.test(String(opts.params.SIGNING_PUBKEY))) {
        throw new Error('contractStakeAction: SIGNING_PUBKEY must be 64 hex chars');
    }
    if (opts.params.TARGET_CONTRACT_INDEX === undefined || opts.params.TARGET_CONTRACT_INDEX === null
        || String(opts.params.TARGET_CONTRACT_INDEX) === '') {
        throw new Error('contractStakeAction: params.TARGET_CONTRACT_INDEX is required');
    }
    if (!/^[0-9]+$/.test(String(opts.params.TARGET_CONTRACT_INDEX))) {
        throw new Error('contractStakeAction: TARGET_CONTRACT_INDEX must be a positive integer');
    }
    if (!opts.params.TICK || typeof opts.params.TICK !== 'string') {
        throw new Error('contractStakeAction: params.TICK is required');
    }

    // STAKE v3 also needs AMOUNT
    if (mode === 'stake') {
        if (!opts.params.AMOUNT) {
            throw new Error('contractStakeAction: params.AMOUNT is required for stake');
        }
        if (!/^[0-9]+(\.[0-9]+)?$/.test(String(opts.params.AMOUNT))) {
            throw new Error('contractStakeAction: AMOUNT must be a positive decimal');
        }
        if (Number(opts.params.AMOUNT) <= 0) {
            throw new Error('contractStakeAction: AMOUNT must be greater than 0');
        }
    }

    const source = normalizeSource(opts.from, 'contractStakeAction');

    // Action name + forced version
    let action;
    let version;
    let summaryVerb;
    if (mode === 'stake')        { action = 'STAKE';    version = '3'; summaryVerb = 'Stake'; }
    else if (mode === 'unstake') { action = 'UNSTAKE';  version = '1'; summaryVerb = 'Unstake'; }
    else                         { action = 'DELEGATE'; version = '1'; summaryVerb = 'Delegate'; }

    const params = { VERSION: version, ...opts.params };

    // Human-readable pending-tx summary
    let actionSummary;
    if (mode === 'stake') {
        actionSummary = `${summaryVerb} ${params.AMOUNT} ${params.TICK} on contract #${params.TARGET_CONTRACT_INDEX}`;
    } else if (mode === 'unstake') {
        actionSummary = `Unstake ${params.TICK} from contract #${params.TARGET_CONTRACT_INDEX}`;
    } else {
        actionSummary = `Rotate signing key for contract #${params.TARGET_CONTRACT_INDEX} (${params.TICK})`;
    }

    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: null,
        actionSummary,
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
        actionData: { action, params },
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
