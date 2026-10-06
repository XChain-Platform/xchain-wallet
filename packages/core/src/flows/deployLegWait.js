// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Patience for one leg of a chunked deploy.
//
// Every leg must be INDEXED before the next one is built, and the SDK's
// indexer wait gives up after one round (two minutes by default). An indexer
// can hold a mined block for longer than that, for example while it waits on
// an oracle price barrier, and giving up then stops the run between chunks
// over a transaction that is already safely on chain.
//
// So a round that ends in CONFIRMATION_TIMEOUT is not the end of the leg. The
// coin's own view of the transaction, read through the encoder's UTXO
// tracker, decides what happens next: confirmed or still in the mempool means
// keep waiting for the indexer, up to a total patience per leg; neither means
// the network dropped it. The explorer's transaction record is no help here,
// because it is written by the same indexer that is behind.

import { inclusionOf } from './txInclusionProbe.js';

/** Total time one leg may wait for the indexer, across every round. */
export const INDEXER_PATIENCE_MS = 15 * 60 * 1000;

/** The SDK waiter's own round length when the caller sets none. */
const DEFAULT_ROUND_MS = 120000;

/** Shortest gap between rounds, so a waiter that gives up early cannot spin. */
const MIN_ROUND_MS = 5000;

/** Error code the flow throws when a leg's wait ends without an index. */
export const LEG_NOT_INDEXED = 'DEPLOY_LEG_NOT_INDEXED';

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** @param {unknown} v */
const lower = (v) => String(v || '').trim().toLowerCase();

/**
 * The UTXO list out of an encoder `get_utxos` reply (`{ utxos: [...] }`, or a
 * bare array from an older encoder); anything else is "did not answer".
 *
 * @param {any} res
 * @returns {any[] | null}
 */
function utxoListOf(res) {
    if (Array.isArray(res)) return res;
    return res && Array.isArray(res.utxos) ? res.utxos : null;
}

/**
 * Did the SDK's indexer wait end because its round ran out, rather than
 * because the action was rejected or the explorer failed? The message check
 * covers an error that crossed a boundary which keeps only name and message.
 *
 * @param {any} err
 */
export function isIndexerTimeout(err) {
    if (!err) return false;
    if (err.code === 'CONFIRMATION_TIMEOUT') return true;
    return /was not indexed within \d+ ?ms/i.test(String(err.message || ''));
}

/**
 * Where the coin network has this transaction, independent of the indexer.
 *
 *   confirmed  the tracker places it in a block
 *   mempool    the network holds it unconfirmed
 *   dropped    the block index AND a mempool read both answered, and neither
 *              holds it
 *   unknown    a read failed, so nothing can be said either way
 *   null       this SDK has no read to ask with at all
 *
 * The mempool is read two ways because change can be rotated to another
 * address: the tracker's outputs for the source address, and the explorer's
 * unconfirmed rows for that address, which list the leg by its source.
 *
 * @param {{ sdk: any, txid: string, address: string }} args
 * @returns {Promise<'confirmed'|'mempool'|'dropped'|'unknown'|null>}
 */
export async function legChainStatus({ sdk, txid, address }) {
    const encoder = sdk && sdk.encoder;
    const canBlock = Boolean(encoder && typeof encoder.getTxBlock === 'function');
    const canUtxos = Boolean(encoder && typeof encoder.getUTXOs === 'function' && address);
    const canMempool = Boolean(sdk && typeof sdk.getUnconfirmed === 'function' && address);
    if (!canBlock && !canUtxos && !canMempool) return null;
    const wanted = lower(txid);

    // Block index first: it answers for a confirmed leg whatever address its
    // change paid, which is also why "dropped" needs this read to have answered.
    let blockAnswered = false;
    if (canBlock) {
        try {
            const res = await encoder.getTxBlock(String(txid));
            if (inclusionOf(res)) return 'confirmed';
            blockAnswered = true;
        } catch { /* unknown, never a verdict */ }
    }

    let mempoolAnswered = false;
    if (canUtxos) {
        try {
            const list = utxoListOf(await encoder.getUTXOs(address));
            if (list) {
                mempoolAnswered = true;
                const own = list.filter((u) => u && lower(u.txid) === wanted);
                if (own.some((u) => Number(u.confirmations) >= 1)) return 'confirmed';
                if (own.length > 0) return 'mempool';
            }
        } catch { /* unknown, never a verdict */ }
    }
    if (canMempool) {
        try {
            const rows = await sdk.getUnconfirmed(address);
            if (Array.isArray(rows)) {
                mempoolAnswered = true;
                if (rows.some((r) => r && lower(r.tx_hash) === wanted)) return 'mempool';
            }
        } catch { /* unknown, never a verdict */ }
    }
    return blockAnswered && mempoolAnswered ? 'dropped' : 'unknown';
}

/**
 * The error a leg ends with when its wait runs out. It names which case it
 * is, and only the dropped case invites sending the leg again: re-sending a
 * leg that is on chain or in the mempool spends a second fee on a duplicate.
 *
 * @param {{ chainState: string, legLabel: string, txid: string, patienceMs: number, isChunk: boolean }} args
 */
export function legNotIndexedError({ chainState, legLabel, txid, patienceMs, isChunk }) {
    const minutes = Math.max(1, Math.round(patienceMs / 60000));
    const saved = 'The deploy is saved';
    let message;
    if (chainState === 'confirmed') {
        message = `${legLabel} (${txid}) is confirmed on chain, but the indexer has not processed it `
            + `after ${minutes} minutes. Do not send it again. ${saved}: resume it once the indexer `
            + 'catches up and it continues from this point without re-sending anything already on chain.';
    } else if (chainState === 'mempool') {
        message = `${legLabel} (${txid}) is still waiting on the network to be confirmed after ${minutes} `
            + `minutes. It is not lost, so do not send it again. ${saved}: resume it later and it `
            + 'continues once the transaction confirms.';
    } else if (chainState === 'dropped') {
        message = `${legLabel} (${txid}) is neither confirmed on chain nor still pending, so the `
            + `network dropped it and its inputs were not spent. ${saved}: resume it to send this `
            + `${isChunk ? 'chunk' : 'transaction'} again.`;
    } else {
        message = `${legLabel} (${txid}) was not indexed within ${minutes} minutes, and the wallet `
            + `could not read its status from the network. ${saved}: resume it later and the wallet `
            + 'checks the transaction again before sending anything.';
    }
    const err = /** @type {Error & { code: string, chainState: string, txid: string }} */ (new Error(message));
    err.name = 'DeployLegNotIndexedError';
    err.code = LEG_NOT_INDEXED;
    err.chainState = chainState;
    err.txid = String(txid);
    return err;
}

/**
 * May a leg that failed with this error already be on chain? True for every
 * patience-exhausted case except a dropped transaction, so a resume stops
 * instead of paying for a duplicate.
 *
 * @param {any} err
 */
export function legMayBeOnChain(err) {
    return Boolean(err && err.code === LEG_NOT_INDEXED && err.chainState !== 'dropped');
}

/**
 * Wait for one leg to index, across as many waiter rounds as the patience
 * allows.
 *
 * A dropped verdict needs two readings in a row, a round apart: a
 * transaction leaving the mempool for a block can briefly be in neither
 * view. With no chain read available the first timeout is final, since there
 * is nothing to base more patience on.
 *
 * @param {object} args
 * @param {(txid: string, opts?: object) => Promise<unknown>} args.waitForTxid
 * @param {any} args.sdk
 * @param {string} args.txid
 * @param {object} [args.waitOpts]
 * @param {string} args.address          the leg's source address
 * @param {number} [args.patienceMs]
 * @param {string} args.legLabel         "Chunk 2 of 5" or "The assembling transaction"
 * @param {boolean} args.isChunk
 * @param {(state: { chainState: string, waitedMs: number, startedAt: number }) => void} [args.onChainWait]
 */
export async function waitForLegIndexed({
    waitForTxid, sdk, txid, waitOpts, address, patienceMs, legLabel, isChunk, onChainWait,
}) {
    const patience = Number(patienceMs) > 0 ? Number(patienceMs) : INDEXER_PATIENCE_MS;
    const roundMs = waitOpts && Number(waitOpts.timeout) > 0 ? Number(waitOpts.timeout) : DEFAULT_ROUND_MS;
    const startedAt = Date.now();
    let chainState = 'unknown';
    let droppedReadings = 0;
    for (;;) {
        const remaining = patience - (Date.now() - startedAt);
        // The caller's options pass through untouched unless the last round
        // has to be shortened to fit what is left of the patience.
        const roundOpts = remaining < roundMs ? { ...(waitOpts || {}), timeout: Math.max(1, remaining) } : waitOpts;
        const roundStart = Date.now();
        try {
            return await waitForTxid(txid, roundOpts);
        } catch (err) {
            if (!isIndexerTimeout(err)) throw err;
            const status = await legChainStatus({ sdk, txid, address });
            if (status === null) throw err;
            chainState = status;
            droppedReadings = status === 'dropped' ? droppedReadings + 1 : 0;
            if (droppedReadings >= 2) {
                throw legNotIndexedError({ chainState: 'dropped', legLabel, txid, patienceMs: patience, isChunk });
            }
        }
        const waitedMs = Date.now() - startedAt;
        if (waitedMs >= patience) {
            // One dropped reading is not enough to call it dropped; report what is known.
            const finalState = chainState === 'dropped' ? 'unknown' : chainState;
            throw legNotIndexedError({ chainState: finalState, legLabel, txid, patienceMs: patience, isChunk });
        }
        if (typeof onChainWait === 'function') {
            try {
                onChainWait({ chainState: chainState === 'dropped' ? 'unknown' : chainState, waitedMs, startedAt });
            } catch { /* a progress listener must not end the wait */ }
        }
        const roundTook = Date.now() - roundStart;
        if (roundTook < MIN_ROUND_MS) await sleep(MIN_ROUND_MS - roundTook);
    }
}

/**
 * The line the deploy screen shows while a leg waits on the indexer, from the
 * `indexerWait` note the run keeps on its pendingDeploy record. Null when
 * there is nothing to say.
 *
 * @param {{ leg?: number|null, total?: number, chainState?: string } | null | undefined} wait
 * @returns {string|null}
 */
export function indexerWaitMessage(wait) {
    if (!wait || typeof wait !== 'object') return null;
    const isChunk = Number.isInteger(wait.leg) && Number(wait.total) > 0;
    const leg = isChunk ? `Chunk ${Number(wait.leg) + 1} of ${wait.total}` : 'The assembling transaction';
    if (wait.chainState === 'confirmed') {
        return `${leg} ${isChunk ? 'confirmed' : 'is confirmed'} on chain, waiting for the indexer `
            + '(it can take several minutes on this network).';
    }
    if (wait.chainState === 'mempool') {
        return `${leg} is waiting on the network to be confirmed, then for the indexer.`;
    }
    return `${leg} is taking longer than usual to index; still waiting.`;
}
