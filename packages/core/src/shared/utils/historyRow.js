// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Lift explorer action fields from `details` once at ingestion because History
// display, grouping, and filtering all consume the normalized raw row.

import { compareMergedEntries } from './pendingHistory.js';

/** Lift non-null `details` beside a row; non-empty top-level values win.
 * Rows without an object-shaped `details` field pass through unchanged. */
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

/** Most rows the Home Activity tab lists; History holds the complete feed. */
export const RECENT_ACTIVITY_LIMIT = 50;

/** The row array of one explorer list response, or an empty array. */
export function historyResponseRows(response) {
    if (!response) return [];
    if (Array.isArray(response)) return response;
    if (Array.isArray(response.data)) return response.data;
    if (Array.isArray(response.rows)) return response.rows;
    return [];
}

function compareActionIndex(a, b) {
    const left = String(a || '');
    const right = String(b || '');
    if (left.length !== right.length) return left.length - right.length;
    return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * The newest entries of a wallet's history, at most `limit` of them. An action
 * read once per own address (a send between two of the wallet's addresses)
 * lists once. Pending entries lead, then entries order newest first by their
 * own time; same-chain ties use block and action order.
 *
 * @param {any[] | null | undefined} entries  normalized history entries
 * @param {number} [limit]
 * @returns {any[]}
 */
export function recentActivityEntries(entries, limit = RECENT_ACTIVITY_LIMIT) {
    if (!Array.isArray(entries)) return [];
    const seen = new Set();
    const unique = [];
    for (const entry of entries) {
        if (!entry || !entry.chainId || !entry.actionIndex) continue;
        const id = `${entry.chainId}:${entry.actionIndex}`;
        if (seen.has(id)) continue;
        seen.add(id);
        unique.push(entry);
    }
    unique.sort((a, b) => {
        const mergedOrder = compareMergedEntries(a, b);
        if (mergedOrder) return mergedOrder;
        if (a.chainId !== b.chainId) return 0;
        return compareActionIndex(b.actionIndex, a.actionIndex);
    });
    return unique.slice(0, Math.max(0, limit));
}
