// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Approval-window messaging helpers. Thin layer over the shared
// `sendMessage` wrapper; each helper documents the host-side message
// type it targets.

import { sendMessage } from '../shared/chromeMessaging.js';

/**
 * List persisted wallets (safe-projected). The approval popup needs
 * this to pick a `walletId` to pass back in sign-result envelopes.
 *
 * @returns {Promise<Array<{ id: string, name: string }>>}
 */
export function listWallets() {
    return /** @type {any} */ (sendMessage('wallet.list'));
}

/**
 * Fetch the parked approval request by id. Thrown errors carry
 * `name: 'ApprovalNotFoundError'` when the broker has no entry for
 * the id (already resolved, or window opened with a bogus param).
 *
 * @param {string} id
 * @returns {Promise<{ id: string, kind: string, payload: unknown }>}
 */
export function fetchApproval(id) {
    return /** @type {any} */ (sendMessage('approval.fetch', { id }));
}

/**
 * Report the user's decision. `result` must match the shape the
 * relevant bridge handler expects (ConnectApprovalResult for connect,
 * SignApprovalResult for the signing kinds). Broker closes the window
 * on resolve; the promise is effectively fire-and-forget.
 *
 * @param {string} id
 * @param {object} result
 * @returns {Promise<{ resolved: boolean }>}
 */
export function resolveApproval(id, result) {
    return /** @type {any} */ (sendMessage('approval.resolve', { id, result }));
}

/**
 * Single-address balance read. Feeds the §21.2 simulator preview on
 * the SignApproval (signAction) screen. Routes to the same
 * `balances.address` host handler the popup + web shells use.
 *
 * @param {string} chainId
 * @param {string} address
 * @returns {Promise<unknown>}
 */
export function getAddressBalances(chainId, address) {
    return /** @type {any} */ (sendMessage('balances.address', { chainId, address }));
}

/**
 * Fetch normalized token info for a ticker reference (name or `^<id>`). Routes
 * to the same `token.info` host handler the popup uses. The dApp approval
 * screen uses the returned `canonicalTick` to display a readable token name in
 * place of a `^<id>` compaction reference.
 *
 * @param {string} chainId
 * @param {string} tick   ticker name or `^<id>` reference
 * @returns {Promise<any>}
 */
export function getTokenInfo(chainId, tick) {
    return /** @type {any} */ (sendMessage('token.info', { chainId, tick }));
}

/**
 * Fetch the persisted Address records for a wallet, grouped by chainId.
 * Used by SignApproval to resolve the signing source address when the
 * dApp request omits it (some dApps just say "sign on Bitcoin" and let
 * the wallet pick the active address).
 *
 * @param {string} walletId
 * @returns {Promise<Record<string, Array<{ address: string }>>>}
 */
export function getAddressesByChain(walletId) {
    return /** @type {any} */ (sendMessage('addresses.byChain', { walletId }));
}

/**
 * Read the live settings record (§35). Approval window uses this to
 * gate the §21.3 / §48.4 raw-PSBT viewer behind `developerMode`. Same
 * `settings.get` host handler the popup + web shells call.
 *
 * @returns {Promise<{ developerMode?: boolean }>}
 */
export function getSettings() {
    return /** @type {any} */ (sendMessage('settings.get'));
}

/**
 * Decompose a PSBT into its inputs and outputs (addresses + values)
 * for the §21.2 / §48 intent cross-check on the signPsbt approval
 * screen. Routes to the same `psbt.parse` host handler the in-wallet
 * PSBT sign form uses, so the dApp-bridge approval shows the same
 * decoded destinations/amounts the user would see signing locally,
 * instead of an opaque truncated hex string a malicious dApp could
 * swap for a drain transaction.
 *
 * @param {{ chainId: string, psbtHex: string }} opts
 * @returns {Promise<{ decomposed: import('@xchain-wallet/core/signers/types').DecomposedPsbt }>}
 */
export function parsePsbt(opts) {
    return /** @type {any} */ (sendMessage('psbt.parse', opts));
}

/**
 * Build the read-only preview for a co-sign approval (§22 / P4): the decoded
 * action + amount + destinations and whether the request is within the agent
 * account's policy. Routes to the `coSign.parse` host handler
 * (flows.previewCoSignRequest); derives no key and signs nothing.
 *
 * @param {{ accountId: string, psbtHex: string }} opts
 * @returns {Promise<import('@xchain-wallet/core/flows/previewCoSignRequest.js').CoSignPreview>}
 */
export function parseCoSign(opts) {
    return /** @type {any} */ (sendMessage('coSign.parse', opts));
}
