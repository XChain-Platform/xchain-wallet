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
 * on resolve — the promise is effectively fire-and-forget.
 *
 * @param {string} id
 * @param {object} result
 * @returns {Promise<{ resolved: boolean }>}
 */
export function resolveApproval(id, result) {
    return /** @type {any} */ (sendMessage('approval.resolve', { id, result }));
}

/**
 * Single-address balance read — feeds the §21.2 simulator preview on
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
