// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// previewCoSignRequest (§22, P4 passive co-signer, "always prompt" transport).
//
// READ-ONLY: builds the decision preview an inbound co-sign request shows the
// user before they approve. It decodes the action FROM the PSBT (never trusts
// the caller) and runs a dry-run policy check, but derives NO key, signs
// NOTHING, and records NO budget. The actual sign happens only after the user
// approves, via passiveCoSignForAccount.
//
// The wallet's co-signer model is "always prompt": the stored policy is a
// safety net (an out-of-policy request is flagged, and the co-signer would
// refuse it anyway), while the human is the final gate. The preview gives the
// approval screen everything it needs: which agent account, the decoded
// action + amount + destinations, and whether it is within policy.

import { buildAccountWindowStore } from '../cosigner/vaultWindowPersistence.js';
import { evaluateAllowedTicks, nativeTickForChain, sdkValueUnreadable } from '../cosigner/allowedTicks.js';
import { CoSignerAccountNotFoundError } from './passiveCoSignForAccount.js';

function tokenRefusalPreview(account, decoded, tokenVerdict, evaluation, clockWarnings) {
    return {
        account,
        decodeOk: true,
        decodeReason: null,
        action: decoded.action,
        params: decoded.params,
        amount: evaluation.amount,
        tick: tokenVerdict.violation.details.tick ?? evaluation.tick,
        destinations: Array.isArray(evaluation.destinations) ? evaluation.destinations : [],
        policyOk: false,
        policyReason: tokenVerdict.violation.code,
        needsConfirmation: false,
        clockWarnings,
    };
}

function windowFailurePreview(account, decoded) {
    return {
        account,
        decodeOk: true,
        decodeReason: null,
        action: decoded.action,
        params: decoded.params,
        amount: undefined,
        tick: undefined,
        destinations: [],
        policyOk: false,
        policyReason: 'WINDOW_STATE_CORRUPT',
        needsConfirmation: false,
        clockWarnings: [],
    };
}

async function loadPreviewWindow(vault, account, now) {
    const store = buildAccountWindowStore({ vault, account, now });
    if (!store) return { failed: false, usage: undefined, warnings: [] };
    try {
        await store.load();
        return {
            failed: false,
            usage: store.snapshot(),
            warnings: typeof store.clockWarnings === 'function' ? store.clockWarnings() : [],
        };
    } catch {
        return { failed: true, usage: undefined, warnings: [] };
    }
}

async function previewDecodedRequest({ vault, sdk, account, accountSummary, decoded, now }) {
    const window = await loadPreviewWindow(vault, account, now);
    const actionData = { action: decoded.action, version: decoded.version, params: decoded.params };
    const tickOptions = {
        nativeTick: nativeTickForChain(account.chainId), valueUnreadable: sdkValueUnreadable(sdk),
    };
    if (window.failed) {
        const tokenVerdict = evaluateAllowedTicks(account.policy, actionData, tickOptions);
        return tokenVerdict.ok
            ? windowFailurePreview(accountSummary, decoded)
            : tokenRefusalPreview(accountSummary, decoded, tokenVerdict, {}, []);
    }
    const verdict = sdk.coSigner.evaluatePolicy(account.policy, actionData, window.usage);
    const evaluation = verdict.evaluation || {};
    const tokenVerdict = verdict.ok === true
        ? evaluateAllowedTicks(account.policy, actionData, tickOptions)
        : null;
    if (tokenVerdict && !tokenVerdict.ok) {
        return tokenRefusalPreview(
            accountSummary, decoded, tokenVerdict, evaluation, window.warnings,
        );
    }
    return {
        account: accountSummary,
        decodeOk: true,
        decodeReason: null,
        action: decoded.action,
        params: decoded.params,
        amount: evaluation.amount,
        tick: evaluation.tick,
        destinations: Array.isArray(evaluation.destinations) ? evaluation.destinations : [],
        policyOk: verdict.ok === true,
        policyReason: verdict.ok ? null : (verdict.violation && verdict.violation.code) || 'POLICY_DENIED',
        needsConfirmation: Boolean(evaluation.needsConfirmation),
        clockWarnings: window.warnings,
    };
}

/**
 * @typedef {Object} CoSignPreview
 * @property {{ id: string, name: string, chainId: string, aggregateAddress: string, enabled: boolean }} account
 * @property {boolean} decodeOk                 false when the PSBT action could not be decoded
 * @property {string|null} decodeReason         decode failure code when decodeOk is false
 * @property {string|null} action               decoded ACTION name (when decodeOk)
 * @property {Object|null} params               decoded action params (when decodeOk)
 * @property {string|undefined} amount
 * @property {string|undefined} tick
 * @property {string[]} destinations
 * @property {boolean} policyOk                 whether the stored policy would allow it
 * @property {string|null} policyReason         violation code when policyOk is false
 * @property {boolean} needsConfirmation        policy flagged it above the confirm threshold
 * @property {string[]} clockWarnings           spending-window clock anomalies noticed at load; empty when none
 */

/**
 * @param {object} opts
 * @param {import('../storage/Vault.js').Vault} opts.vault
 * @param {import('../sdk/SDKRegistry.js').SDKRegistry} opts.sdkRegistry
 * @param {string} opts.accountId
 * @param {import('./passiveCoSign.js').PassiveCoSignRequest} opts.request
 * @param {number} [opts.now]                   injectable clock (ms) for window pruning
 * @returns {Promise<CoSignPreview>}
 */
export async function previewCoSignRequest({ vault, sdkRegistry, accountId, request, now } = {}) {
    if (!vault || !vault.coSignerAccounts) throw new Error('previewCoSignRequest: vault is required');
    if (!sdkRegistry || typeof sdkRegistry.get !== 'function') {
        throw new Error('previewCoSignRequest: sdkRegistry is required');
    }
    if (typeof accountId !== 'string' || accountId.length === 0) {
        throw new Error('previewCoSignRequest: accountId is required');
    }
    if (!request || typeof request.psbt !== 'string' || request.psbt.length === 0) {
        throw new Error('previewCoSignRequest: request.psbt (hex) is required');
    }

    const account = await vault.coSignerAccounts.get(accountId);
    if (!account) throw new CoSignerAccountNotFoundError(accountId);

    const sdk = sdkRegistry.get(account.chainId);
    if (!sdk || !sdk.coSigner
        || typeof sdk.coSigner.decodeActionFromPsbt !== 'function'
        || typeof sdk.coSigner.evaluatePolicy !== 'function') {
        throw new Error('previewCoSignRequest: SDK with sdk.coSigner decode + policy is required');
    }

    const accountSummary = {
        id: account.id,
        name: account.name,
        chainId: account.chainId,
        aggregateAddress: account.aggregateAddress,
        enabled: account.enabled !== false,
    };

    const network = sdk.wallet && typeof sdk.wallet.getBitcoinNetwork === 'function'
        ? sdk.wallet.getBitcoinNetwork()
        : null;

    // 1. Decode the action FROM the PSBT (authority is the PSBT, not the caller).
    const decoded = sdk.coSigner.decodeActionFromPsbt(request.psbt, { network: network || undefined });
    if (!decoded || !decoded.ok) {
        return {
            account: accountSummary,
            decodeOk: false,
            decodeReason: (decoded && decoded.reason) || 'DECODE_FAILED',
            action: null,
            params: null,
            amount: undefined,
            tick: undefined,
            destinations: [],
            policyOk: false,
            policyReason: 'UNDECODABLE',
            needsConfirmation: false,
            clockWarnings: [],
        };
    }

    return previewDecodedRequest({ vault, sdk, account, accountSummary, decoded, now });
}
