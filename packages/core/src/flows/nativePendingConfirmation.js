// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A plain native-coin payment never becomes an XChain action, so none of the
// feeds that retire our own PendingTx records can ever see it: the explorer's
// address history, its decoded mempool and the NEW_ACTION events are all
// action-only. Left alone, every native send the wallet makes sits at
// "pending" until the 180s window expires and then reads "not seen by
// network" for good, while the coins moved days ago.
//
// The confirmation source for a plain transfer is the coin's own UTXO set,
// which the wallet already reads through the encoder for input liveness. The
// tracker serves each output with the transaction that created it and its
// confirmation count, and it withholds an output the mempool is spending. So
// a transaction we sent is on the network once one of its outputs shows up
// against the recipient or ourselves with zero confirmations, and it is in a
// block once that count reaches one. That is a positive fact about the
// transaction itself, where "our inputs are gone" would also be true of a
// replacement or a double-spend and could retire the wrong record.
//
// Only sends whose ticker is the chain's native coin are examined: a token
// SEND carries an action and is retired by the feeds above, and asking the
// tracker about it would be a second clock for the same answer.

import { markPendingTxIndexed, markPendingTxMempoolSeen } from '../notifications/pendingTxBridge.js';
import { isLivePendingStatus } from '../shared/utils/pendingHistory.js';
import { tickerForCoin } from '../registry/coinTicker.js';

/**
 * @typedef {{ txid?: string, confirmations?: number | string }} TrackerUtxo
 * @typedef {'confirmed' | 'seen' | 'unknown'} NativeVerdict
 */

/** @param {unknown} v */
const lower = (v) => String(v || '').trim().toLowerCase();

/**
 * Is this record a native-coin send the action feeds cannot retire?
 *
 * The record's `tick` is the ticker the SEND moved; when it is the chain's
 * own coin the transaction carried no OP_RETURN and no feed will ever name
 * it. The descriptor names the coin (`litecoin`) while the record carries
 * the ticker (`LTC`), so the comparison goes through the same map
 * `isBareNativePayment` consults to call the send plain in the first
 * place. Pre-broadcast and terminal statuses are excluded the same way
 * History excludes them.
 *
 * @param {{ status?: string, txid?: string | null, tick?: string | null } | null | undefined} record
 * @param {{ coin?: string } | null | undefined} descriptor
 */
export function isNativePendingTx(record, descriptor) {
    if (!record || !record.txid) return false;
    if (!isLivePendingStatus(record.status)) return false;
    if (!descriptor?.coin) return false;
    const nativeTicker = tickerForCoin(descriptor.coin);
    return Boolean(nativeTicker) && String(record.tick || '').trim().toUpperCase() === nativeTicker;
}

/**
 * What the UTXO sets say about one transaction.
 *
 * `utxosByAddress` carries only the addresses that ANSWERED, exactly as the
 * input-liveness check requires: an address that threw or timed out is absent
 * rather than present-and-empty, so a tracker outage reads as `unknown` and
 * never as evidence. The deepest confirmation count wins because one address
 * can hold the transaction in both stores during the tracker's post-mine
 * cleanup window.
 *
 * @param {object} args
 * @param {string} args.txid
 * @param {Record<string, TrackerUtxo[]>} args.utxosByAddress
 * @returns {{ verdict: NativeVerdict, confirmations: number | null }}
 */
export function nativeSendVerdict({ txid, utxosByAddress }) {
    const wanted = lower(txid);
    if (!wanted) return { verdict: 'unknown', confirmations: null };
    let deepest = null;
    for (const list of Object.values(utxosByAddress || {})) {
        for (const u of Array.isArray(list) ? list : []) {
            if (!u || lower(u.txid) !== wanted) continue;
            const c = Number(u.confirmations);
            if (!Number.isFinite(c) || c < 0) continue;
            if (deepest == null || c > deepest) deepest = c;
        }
    }
    if (deepest == null) return { verdict: 'unknown', confirmations: null };
    return { verdict: deepest >= 1 ? 'confirmed' : 'seen', confirmations: deepest };
}

/**
 * The UTXO list out of an encoder `get_utxos` reply, in either shape the
 * SDK client documents (`{ utxos: [...] }` today, a bare array on older
 * encoders). Anything else is "did not answer".
 *
 * @param {unknown} res
 * @returns {TrackerUtxo[] | null}
 */
export function utxoListOf(res) {
    if (Array.isArray(res)) return res;
    const list = /** @type {any} */ (res)?.utxos;
    return Array.isArray(list) ? list : null;
}

/**
 * Reconcile this address's live native sends against the chain's UTXO set,
 * writing what it proves onto the records: a sighting stamps
 * `mempoolSeenAt` (first one wins, as the WS path does) and a block retires
 * the record to `indexed`. Runs on History's own beat, from the host handler
 * that lists the records, so the row that was stuck is the row that gets
 * corrected while the user is looking at it.
 *
 * Asks the tracker about the recipient and about ourselves: the recipient's
 * output is the one that exists for every send, and our own address covers a
 * self-send and an un-rotated change output. A rotated change output lands on
 * an internal address this record does not name, which is why the recipient
 * comes first. Each address is fetched once per call however many records
 * name it.
 *
 * Best-effort throughout: a tracker that is lagging, halted or unreachable
 * makes the encoder refuse the fetch, and that refusal leaves every verdict
 * `unknown` and every record untouched.
 *
 * @param {object} args
 * @param {import('../storage/Vault.js').Vault} args.vault
 * @param {{ get: (chainId: string) => any }} args.sdkRegistry
 * @param {{ get?: (chainId: string) => any } | null | undefined} args.chainRegistry
 * @param {string} args.chainId
 * @param {string} [args.address]   only records sent FROM this address; all of the chain's when absent
 * @param {{ now?: () => string }} [args.opts]
 * @returns {Promise<{ seenNow: Set<string>, confirmed: Set<string> }>}  lowercased txids
 */
export async function reconcileNativePendingTxs({ vault, sdkRegistry, chainRegistry, chainId, address, opts = {} }) {
    const seenNow = new Set();
    const confirmed = new Set();
    if (!vault || !chainId) return { seenNow, confirmed };
    const descriptor = chainRegistry?.get?.(chainId) || null;
    if (!descriptor?.coin) return { seenNow, confirmed };

    const wanted = address ? lower(address) : null;
    const all = await vault.pendingTxs.list();
    const records = [];
    for (const r of Array.isArray(all) ? all : []) {
        if (!isNativePendingTx(r, descriptor)) continue;
        if (r.chain !== descriptor.coin || r.network !== descriptor.networkKind) continue;
        if (wanted && lower(r.fromAddress) !== wanted) continue;
        records.push(r);
    }
    if (records.length === 0) return { seenNow, confirmed };

    const encoder = sdkRegistry?.get?.(chainId)?.encoder;
    if (!encoder || typeof encoder.getUTXOs !== 'function') return { seenNow, confirmed };

    const addresses = new Set();
    for (const r of records) {
        if (r.toAddress) addresses.add(String(r.toAddress));
        if (r.fromAddress) addresses.add(String(r.fromAddress));
    }
    /** @type {Record<string, TrackerUtxo[]>} */
    const utxosByAddress = {};
    await Promise.all([...addresses].map(async (addr) => {
        try {
            const list = utxoListOf(await encoder.getUTXOs(addr));
            if (list) utxosByAddress[addr] = list;
        } catch { /* absent => unknown, never a verdict */ }
    }));

    for (const r of records) {
        const { verdict } = nativeSendVerdict({ txid: r.txid, utxosByAddress });
        const key = lower(r.txid);
        if (verdict === 'confirmed') {
            await markPendingTxIndexed(vault, r.txid, opts);
            confirmed.add(key);
        } else if (verdict === 'seen') {
            await markPendingTxMempoolSeen(vault, r.txid, opts);
            seenNow.add(key);
        }
    }
    return { seenNow, confirmed };
}
