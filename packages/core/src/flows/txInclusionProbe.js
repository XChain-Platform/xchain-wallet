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
// The encoder's tracker index answers that question for every transaction,
// including a plain coin transfer. Older encoders and an index that has not
// caught up may answer nothing, so the explorer transaction record remains a
// fallback for decoded actions.
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
 * The inclusion fact out of an encoder block reply or explorer transaction
 * reply, in either shape the clients surface (the bare record or
 * `{ data: record }`).
 *
 * @param {unknown} res
 * @returns {TxInclusion | null}  null when no block is named
 */
export function inclusionOf(res) {
    const raw = /** @type {any} */ (res);
    if (!raw || typeof raw !== 'object') return null;
    const data = raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) ? raw.data : raw;
    const block = Number(data.block_height ?? data.block_index ?? data.blockIndex);
    if (!Number.isInteger(block) || block <= 0) return null;
    const actions = Array.isArray(data.actions) ? data.actions : [];
    const actionRecorded = actions.some((a) => a && String(a.status || '').toLowerCase() === 'valid');
    return { blockIndex: block, actionRecorded };
}

/**
 * Look up each hash once and return the ones a block carries.
 *
 * @param {object} args
 * @param {{ encoder?: { getTxBlock?: (txid: string) => Promise<unknown> }, getTransaction?: (query: string, type: string) => Promise<unknown> } | null | undefined} args.sdk
 * @param {Iterable<string>} args.txids
 * @returns {Promise<Map<string, TxInclusion>>}  keyed by lowercased txid; a
 *          hash with no positive answer is simply absent
 */
export async function probeTxInclusion({ sdk, txids }) {
    /** @type {Map<string, TxInclusion>} */
    const found = new Map();
    const getTxBlock = sdk?.encoder?.getTxBlock;
    const getTransaction = sdk?.getTransaction;
    if (typeof getTxBlock !== 'function' && typeof getTransaction !== 'function') return found;
    const queue = [...new Set([...txids].map(lower).filter(Boolean))];
    const worker = async () => {
        for (let txid = queue.shift(); txid !== undefined; txid = queue.shift()) {
            let hit = null;
            if (typeof getTxBlock === 'function') {
                try {
                    hit = inclusionOf(await getTxBlock.call(sdk.encoder, txid));
                } catch { /* fall through */ }
            }
            if (!hit && typeof getTransaction === 'function') {
                try {
                    hit = inclusionOf(await getTransaction.call(sdk, txid, 'tx_hash'));
                } catch { /* no answer is not an answer */ }
            }
            if (hit) found.set(txid, hit);
        }
    };
    await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, queue.length) }, worker));
    return found;
}
