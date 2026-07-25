// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// listQueries: thin read-only wrappers around LIST/action explorer
// reads. Grew out of the §40.9 airdrop flow ((a) resolve a broadcast
// LIST's ACTION_INDEX after it's indexed, (b) fetch the canonical
// LIST row for the stage-5 "review AIRDROP" confirmation display) and
// now also backs the PC-10 "My Lists" manager: `listsForSource` finds
// the LIST actions a wallet address has authored, and
// `listByActionIndex` doubles as the membership + fork-lineage read
// for ListDetail/ListForkForm (the explorer's per-action LIST detail
// already returns `list` (current members) and `edits` (the v1 delta
// history), see xchain-explorer/src/db.js getActionData).
//
// `actionByTxid` isn't list-specific at the SDK level either (it also
// resolves the AIRDROP's own action after stage 6 of that flow).

/**
 * Fetch the indexed action for a given tx hash. Returns null when the
 * transaction hasn't been indexed yet (the explorer 404s); the form
 * uses that null as "not yet indexed; keep polling". Any other error
 * propagates so the caller can surface it.
 *
 * @param {{ sdkRegistry: any, chainId: string, txid: string }} params
 * @returns {Promise<unknown>}
 */
export async function actionByTxid({ sdkRegistry, chainId, txid }) {
    if (!sdkRegistry) throw new Error('actionByTxid: sdkRegistry is required');
    if (!chainId) throw new Error('actionByTxid: chainId is required');
    if (!txid) throw new Error('actionByTxid: txid is required');
    const sdk = sdkRegistry.get(chainId);
    try {
        return await sdk.getTransaction(txid, 'hash');
    } catch (err) {
        // Treat 404 / not-found as "not yet indexed". The SDK's HTTP
        // layer may surface this as an error with a status field or
        // simply resolve to null; handle both shapes.
        const status = /** @type {any} */ (err)?.status
            ?? /** @type {any} */ (err)?.response?.status;
        if (status === 404) return null;
        if (/not found|404/i.test(/** @type {any} */ (err)?.message || '')) return null;
        throw err;
    }
}

/**
 * Fetch a LIST action by its ACTION_INDEX. Used by the stage-5
 * AIRDROP review to confirm the list's TYPE + item-count match what
 * the user pasted before they sign the AIRDROP.
 *
 * @param {{ sdkRegistry: any, chainId: string, actionIndex: string }} params
 */
export async function listByActionIndex({ sdkRegistry, chainId, actionIndex }) {
    if (!sdkRegistry) throw new Error('listByActionIndex: sdkRegistry is required');
    if (!chainId) throw new Error('listByActionIndex: chainId is required');
    if (!actionIndex) throw new Error('listByActionIndex: actionIndex is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getAction(actionIndex);
}

/**
 * PC-10 "My Lists": find the LIST actions authored from a given source
 * address. Backs MyLists.jsx, which fans this out over every address
 * the wallet holds on a chain (mirroring how DispensersList fans out
 * `getDispensersForSource`).
 *
 * @param {{ sdkRegistry: any, chainId: string, address: string }} params
 * @returns {Promise<unknown>}   explorer's `/lists/{address}/address` shape
 */
export async function listsForSource({ sdkRegistry, chainId, address }) {
    if (!sdkRegistry) throw new Error('listsForSource: sdkRegistry is required');
    if (!chainId) throw new Error('listsForSource: chainId is required');
    if (!address) throw new Error('listsForSource: address is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getLists(address, 'address');
}
