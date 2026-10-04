// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// UNSTAKE + COLLECT composers for the §42.7.2 (unstake-lane) +
// §42.7.3 (rewards) authoring surfaces. Both actions are small:
// UNSTAKE is `VERSION|SIGNING_PUBKEY[|AMOUNT]`, COLLECT is
// `VERSION[|AMOUNT]`, so they share a file and the UI combines them
// in StakingActionForm.jsx via a `mode` prop (same pattern as §42.5
// ContractFundsForm).
//
// Capability-staking model (capability-staking-model.md §3): UNSTAKE
// addresses a specific signing pubkey, not a tier. AMOUNT is the
// optional partial (indexer gate PARTIAL_UNSTAKE_COLLECT):
// absent = full sweep of the pubkey's active balance / full pending
// rewards, exactly the legacy behavior; present = only that much is
// unstaked/claimed and the residual stays staked/pending. The
// indexer rejects an over-ask, so the UI bounds the field by the
// available balance before submit.

import { submitAction } from './submitAction.js';
import { normalizeSource } from './sendToken.js';
import { fundingEncoderOpts } from '../util/funding_encoder_opts.js';
import { assertValidatorLaneChain } from '../registry/actions.js';
import { compareAmounts } from '../market/orderMath.js';

// A positive XCHAIN amount at the token's 8-decimal precision.
const AMOUNT_RE = /^[0-9]+(\.[0-9]{1,8})?$/;

/**
 * The wire params for a COLLECT or UNSTAKE from what the user typed. The
 * absent-AMOUNT form means "everything", so it is produced only when the
 * typed amount EQUALS a known total; any other valid amount is sent as
 * AMOUNT even when the total is unknown, and an amount that does not parse
 * produces no params at all.
 *
 * @param {{ isUnstake: boolean, signingPubkey?: string, amount: string, availableAmt: string | null | undefined }} args
 * @returns {{ params: object | null, amountValid: boolean, isWholeAmount: boolean, normalizedAmount: string }}
 */
export function stakingActionParams({ isUnstake, signingPubkey = '', amount, availableAmt }) {
    const normalizedAmount = String(amount ?? '').replace(/,/g, '').trim();
    const amountValid = AMOUNT_RE.test(normalizedAmount) && compareAmounts(normalizedAmount, '0') === 1;
    const isWholeAmount = availableAmt != null && amountValid
        && compareAmounts(normalizedAmount, String(availableAmt)) === 0;
    const base = isUnstake
        ? { VERSION: '0', SIGNING_PUBKEY: String(signingPubkey).trim().toLowerCase() }
        : { VERSION: '0' };
    let params = null;
    if (isWholeAmount) params = base;
    else if (amountValid) params = { ...base, AMOUNT: normalizedAmount };
    return { params, amountValid, isWholeAmount, normalizedAmount };
}

/**
 * @typedef {Object} UnstakeActionOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {import('./sendToken.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {{ VERSION: string, SIGNING_PUBKEY: string, AMOUNT?: string }} params AMOUNT optional: partial unstake; absent = full sweep, only with full: true
 * @property {boolean} [full] required true when AMOUNT is absent: the explicit request to unstake everything
 * @property {number} [fee]
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {import('../sdk/submitWithSigner.js').PrebuiltPsbt} [prebuiltPsbt] single-encode pipeline: sign this exact composed PSBT byte-identically (the one the ConfirmActionModal previewed + tamper-checked) instead of rebuilding.
 * @property {(txid: string, opts?: object) => Promise<unknown>} [waitForTxid]
 * @property {object} [waitOpts]
 * @property {(phase: string, data: object) => void} [onProgress]
 * @property {boolean} [trackPendingTx]
 */

/** @param {UnstakeActionOpts} opts */
export async function unstakeAction(opts) {
    if (!opts) throw new Error('unstakeAction: opts is required');
    if (!opts.params || typeof opts.params !== 'object') {
        throw new Error('unstakeAction: params is required');
    }
    if (!opts.params.SIGNING_PUBKEY) {
        throw new Error('unstakeAction: params.SIGNING_PUBKEY is required');
    }
    if (!/^[0-9a-fA-F]{64}$/.test(opts.params.SIGNING_PUBKEY)) {
        throw new Error('unstakeAction: SIGNING_PUBKEY must be 64 hex chars');
    }
    // Absent AMOUNT is the protocol's "everything", so it is accepted only on
    // an explicit full request; an amount the caller meant but lost must fail
    // here rather than move the whole balance (2026-09-30 testnet: 1 typed,
    // COLLECT|0 paid 130).
    if (opts.params.AMOUNT === undefined) {
        if (opts.full !== true) {
            throw new Error('unstakeAction: AMOUNT is required unless full is true');
        }
    } else if (!AMOUNT_RE.test(String(opts.params.AMOUNT)) || Number(opts.params.AMOUNT) <= 0) {
        throw new Error('unstakeAction: AMOUNT must be a positive decimal with at most 8 places when present');
    }
    // Refuse a chain whose indexer rejects this validator-lane action.
    assertValidatorLaneChain(opts.chainRegistry, opts.chainId, 'unstakeAction');
    const source = normalizeSource(opts.from, 'unstakeAction');
    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: null,
        actionSummary: opts.params.AMOUNT !== undefined
            ? `Unstake ${opts.params.AMOUNT} XCHAIN (${opts.params.SIGNING_PUBKEY.slice(0, 12)}…)`
            : `Unstake (${opts.params.SIGNING_PUBKEY.slice(0, 12)}…)`,
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
        actionData: { action: 'UNSTAKE', params: opts.params },
        encoderOpts: {
            pubkey: source.publicKey,
            ...fundingEncoderOpts(source),
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
        onBroadcastFailure: opts.onBroadcastFailure,
    });
}

/**
 * @typedef {Object} CollectActionOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {import('./sendToken.js').SourceRef | import('../schemas/address.js').Address} from
 * @property {{ VERSION: string, AMOUNT?: string }} params AMOUNT optional: partial claim; absent = claim all pending rewards, only with full: true
 * @property {boolean} [full] required true when AMOUNT is absent: the explicit request to claim everything
 * @property {number} [fee]
 * @property {number} [feePerKb]
 * @property {boolean} [rbf]
 * @property {import('../sdk/submitWithSigner.js').PrebuiltPsbt} [prebuiltPsbt] single-encode pipeline: sign this exact composed PSBT byte-identically (the one the ConfirmActionModal previewed + tamper-checked) instead of rebuilding.
 * @property {(txid: string, opts?: object) => Promise<unknown>} [waitForTxid]
 * @property {object} [waitOpts]
 * @property {(phase: string, data: object) => void} [onProgress]
 * @property {boolean} [trackPendingTx]
 */

/** @param {CollectActionOpts} opts */
export async function collectAction(opts) {
    if (!opts) throw new Error('collectAction: opts is required');
    if (!opts.params || typeof opts.params !== 'object') {
        throw new Error('collectAction: params is required');
    }
    // Absent AMOUNT is the protocol's "everything", so it is accepted only on
    // an explicit full request; an amount the caller meant but lost must fail
    // here rather than move the whole balance (2026-09-30 testnet: 1 typed,
    // COLLECT|0 paid 130).
    if (opts.params.AMOUNT === undefined) {
        if (opts.full !== true) {
            throw new Error('collectAction: AMOUNT is required unless full is true');
        }
    } else if (!AMOUNT_RE.test(String(opts.params.AMOUNT)) || Number(opts.params.AMOUNT) <= 0) {
        throw new Error('collectAction: AMOUNT must be a positive decimal with at most 8 places when present');
    }
    // Refuse a chain whose indexer rejects this validator-lane action.
    assertValidatorLaneChain(opts.chainRegistry, opts.chainId, 'collectAction');
    const source = normalizeSource(opts.from, 'collectAction');
    const pendingTxMeta = opts.trackPendingTx === false ? undefined : {
        fromAddress: source.address,
        toAddress: null,
        actionSummary: opts.params.AMOUNT !== undefined
            ? `Collect ${opts.params.AMOUNT} XCHAIN staking rewards`
            : 'Collect staking rewards',
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
        actionData: { action: 'COLLECT', params: opts.params },
        encoderOpts: {
            pubkey: source.publicKey,
            ...fundingEncoderOpts(source),
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
        onBroadcastFailure: opts.onBroadcastFailure,
    });
}
