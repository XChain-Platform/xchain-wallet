// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// "Is this transaction in a block?", asked by hash.
//
// The one surface the wallet can reach for that question is the explorer's
// transaction record: the service writes a row for every transaction it
// decoded BEFORE it judges the action, so a rejected action still answers
// with its block. What it cannot answer is a plain coin transfer, which
// carries no action and is never decoded; for that the reply names no block
// and reads as `unknown` here, never as absent-from-chain. The tracker and
// the encoder expose no lookup by hash at all, so there is no second source
// to fall through to.
//
// Only a positive fact is ever returned. A transport error, a 404, a stale
// or misconfigured coin and an empty record all collapse to "no answer",
// because a caller that retires a record on this must never do so on a
// silence.

/**
 * @typedef {object} TxInclusion
 * @property {number} blockIndex
 * @property {boolean} actionRecorded  the service holds a valid action for
 *           it, so its own feed lists the transaction and a caller need not
 *           keep a record of its own to stand in for one
 */

/** How many hash lookups run at once; History reads batch a handful of records. */
const PROBE_CONCURRENCY = 4;

/** @param {unknown} v */
const lower = (v) => String(v || '').trim().toLowerCase();

/**
 * The inclusion fact out of one explorer transaction reply, in either shape
 * the client surfaces (the bare record or `{ data: record }`).
 *
 * @param {unknown} res
 * @returns {TxInclusion | null}  null when no block is named
 */
export function inclusionOf(res) {
    const raw = /** @type {any} */ (res);
    if (!raw || typeof raw !== 'object') return null;
    const data = raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) ? raw.data : raw;
    const block = Number(data.block_index ?? data.blockIndex);
    if (!Number.isInteger(block) || block <= 0) return null;
    const actions = Array.isArray(data.actions) ? data.actions : [];
    const actionRecorded = actions.some((a) => a && String(a.status || '').toLowerCase() === 'valid');
    return { blockIndex: block, actionRecorded };
}

/**
 * Look up each hash once and return the ones a block carries.
 *
 * @param {object} args
 * @param {{ getTransaction?: (query: string, type: string) => Promise<unknown> } | null | undefined} args.sdk
 * @param {Iterable<string>} args.txids
 * @returns {Promise<Map<string, TxInclusion>>}  keyed by lowercased txid; a
 *          hash with no positive answer is simply absent
 */
export async function probeTxInclusion({ sdk, txids }) {
    /** @type {Map<string, TxInclusion>} */
    const found = new Map();
    if (!sdk || typeof sdk.getTransaction !== 'function') return found;
    const queue = [...new Set([...txids].map(lower).filter(Boolean))];
    const worker = async () => {
        for (let txid = queue.shift(); txid !== undefined; txid = queue.shift()) {
            try {
                const hit = inclusionOf(await sdk.getTransaction(txid, 'tx_hash'));
                if (hit) found.set(txid, hit);
            } catch { /* no answer is not an answer */ }
        }
    };
    await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, queue.length) }, worker));
    return found;
}
