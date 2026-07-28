// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// One reader for "which ACTION_INDEX did this txid get".
//
// Every two-transaction flow (AIRDROP, list fork, attach-content, project
// roster) broadcasts step 1, then polls `messaging.getActionByTxid` until the
// explorer has indexed it and can name the action index step 2 must reference.
//
// The response is the explorer's `/transaction/{txid}/tx_hash` envelope, and
// the index lives INSIDE an array:
//
//   { actions: [{ action_index: '1147', action: 'LIST', status: 'valid', … }],
//     block_index: '6345', source: '…', tx_data: '…', tx_hash: '…' }
//
// There is no top-level `action_index`. Four forms each grew their own private
// copy of this reader; two of them checked only the top-level keys, so their
// poll resolved to null forever while the catch above it treated that as "not
// indexed yet". The visible result was an airdrop that had already broadcast
// and PAID for its recipient list sitting on "Waiting for list to be indexed"
// indefinitely, with nothing in the console (D-87). One reader now, so a fifth
// flow inherits the shape instead of guessing at it.
//
// The top-level keys are kept ahead of the array because a host may hand back
// an already-unwrapped action record, and `actions[0]` is right for this
// endpoint: it returns the actions of ONE transaction, and these flows
// broadcast one action per transaction.

/**
 * @param {any} resp  response from `messaging.getActionByTxid`
 * @returns {string | null}  the action index as a string, or null when the
 *   transaction is not indexed yet (which is a normal, retryable state)
 */
export function extractActionIndex(resp) {
    if (!resp || typeof resp !== 'object') return null;
    const first = Array.isArray(resp.actions) ? resp.actions[0] : null;
    const raw = resp.action_index
        ?? resp.actionIndex
        ?? first?.action_index
        ?? first?.actionIndex
        ?? null;
    if (raw === null || raw === undefined) return null;
    const s = String(raw);
    return s.length > 0 ? s : null;
}
