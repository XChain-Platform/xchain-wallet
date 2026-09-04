// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// One shape difference, three silent failures.
//
// The explorer's history rows do NOT carry their per-action fields at the top
// level. `projectActionSummary` (xchain-explorer `src/db.js`) collects every
// field in ACTION_SUMMARY_FIELDS - coin, tick, amount, source, destination,
// memo, name, and the rest - into a `details` SUB-OBJECT, and leaves only
// `status` and the row's own identity fields (action, action_index,
// block_index, timestamp, tx_hash) beside it.
//
// Everything on the wallet side read them at the top level, so on this build:
//
//   * every History row's source chip rendered `-`,
//   * `historyGrouping`'s `pickField` never found a tick, so issue-mint,
//     dispenser-dispense and order-fill grouping did nothing at all - Grouped
//     mode silently returned the flat list, and
//   * `historyFilter`'s payload search matched nothing, leaving only action
//     name, address and txid searchable.
//
// None of the three announced itself. A Grouped mode that never groups looks
// like a chain with nothing to group, and a search that quietly cannot see
// memos or ticks looks like a wallet with no matching history.
//
// All three consumers read `entry.raw`, which is why this is one normalization
// at ingestion rather than a patch in each of them.

/**
 * An explorer history row with its `details` fields lifted alongside the row's
 * own, so a reader can ask for `tick` and get one.
 *
 * CONSERVATIVE ON PURPOSE: a lifted field never overwrites a top-level value
 * that is already present and non-empty, and a null inside `details` never
 * clobbers anything. The two shapes overlap (`action_index` is in both), and
 * the row's own copy is the one the rest of the pipeline already keys on, so
 * where they disagree the row wins and nothing downstream shifts underneath.
 *
 * Returns the row unchanged when there is no `details` object, so this is safe
 * to apply to rows from any other source.
 *
 * @param {any} row A history row as the explorer publishes it.
 * @returns {any} The same row, or a flattened copy of it.
 */
export function flattenActionDetails(row) {
    if (!row || typeof row !== 'object') return row;
    const { details } = row;
    if (!details || typeof details !== 'object' || Array.isArray(details)) return row;

    const flat = { ...row };
    for (const [key, value] of Object.entries(details)) {
        if (value == null) continue;
        if (flat[key] == null || flat[key] === '') flat[key] = value;
    }
    return flat;
}

/**
 * Turn one explorer history row into the entry shape every History consumer
 * reads. Extracted so the list and the standalone detail page agree by
 * construction: a pending entry has to be able to UPGRADE into a confirmed one
 * without the two sides normalizing the same row differently.
 *
 * @param {any} row              a history row as the explorer publishes it
 * @param {object} ctx
 * @param {string} ctx.chainId
 * @param {string} ctx.address   the wallet address this row was fetched for
 * @param {any} [ctx.link]       the cross-chain LINK record, when this row is one side of a pair
 * @returns {any | null}         null when the row carries no action index
 */
export function normalizeHistoryRow(row, { chainId, address, link = null }) {
    const actionIndex = String(row?.action_index ?? row?.actionIndex ?? '');
    if (!actionIndex) return null;
    const flat = flattenActionDetails(row);
    return {
        key: `${chainId}:${actionIndex}:${address}`,
        chainId,
        address,
        actionIndex,
        action: String(row.action || row.ACTION || 'ACTION'),
        blockIndex: Number(row.block_index ?? row.blockIndex ?? 0),
        timestamp: Number(row.timestamp ?? row.block_time ?? 0),
        txHash: String(row.tx_hash ?? row.txHash ?? ''),
        source: String(flat.source ?? flat.SOURCE ?? ''),
        raw: flat,
        link,
    };
}
