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
