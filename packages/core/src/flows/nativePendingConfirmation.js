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
// An output only exists while it is unspent, and both outputs of a send are
// spent in the ordinary course of using the wallet. Past that point the UTXO
// set has nothing to say, so a record the outputs cannot settle and that is
// older than the pending window gets two further, equally positive, checks:
//
//   - A confirmed transaction of ours that SPENDS one of its outputs. The
//     spend is in a block, so the parent it names is in a block at or before
//     it. Read off the records already in the vault, at no network cost, and
//     it covers the common shape of the problem: the change (and, for a send
//     between our own addresses, the payment) is spent by a later send.
//   - The explorer's transaction record, looked up by hash. The service
//     writes that row for every transaction it decoded before it judges the
//     action, so an action the indexer rejected still answers with its
//     block. This is also the only check that reaches such a record: it
//     carries an action, so the outputs check never looks at it, and it has
//     no action row, so the feeds never retire it. A plain transfer is never
//     decoded and gets no answer here; the child check above is its route.
//
// Nothing here retires a record on a silence. A tracker that refuses, an
// explorer that errors or answers with no block, and a hash no sibling spends
// all leave the record exactly as it was.

import { markPendingTxIndexed, markPendingTxMempoolSeen } from '../notifications/pendingTxBridge.js';
import { isLivePendingStatus, NETWORK_SEEN_WINDOW_MS } from '../shared/utils/pendingHistory.js';
import { tickerForCoin } from '../registry/coinTicker.js';
import { parseRawTx } from '../signers/verifySignedTx.js';
import { probeTxInclusion } from './txInclusionProbe.js';

/**
 * @typedef {{ txid?: string, confirmations?: number | string, height?: number | string }} TrackerUtxo
 * @typedef {'confirmed' | 'seen' | 'unknown'} NativeVerdict
 */

/**
 * How long a record may sit unresolved before the hash lookups run. The
 * same window after which History stops calling the record healthy: a
 * lookup before that would fire on every young send for nothing, and one
 * after it is what keeps a settled transaction from being called lost.
 */
export const INCLUSION_PROBE_AFTER_MS = NETWORK_SEEN_WINDOW_MS;

/**
 * How long one negative explorer answer stands before the same hash is
 * asked again. History reads every 20s while open; a record the explorer
 * does not know is asked about once per interval, not once per read.
 */
export const INCLUSION_PROBE_INTERVAL_MS = 5 * 60 * 1000;

/** When each hash was last asked of the explorer, ms; shared across reads in one host. */
const lastProbedAt = new Map();

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
 * cleanup window. `blockIndex` is the height the tracker serves beside a
 * confirmed output, null when it served none.
 *
 * @param {object} args
 * @param {string} args.txid
 * @param {Record<string, TrackerUtxo[]>} args.utxosByAddress
 * @returns {{ verdict: NativeVerdict, confirmations: number | null, blockIndex: number | null }}
 */
export function nativeSendVerdict({ txid, utxosByAddress }) {
    const wanted = lower(txid);
    if (!wanted) return { verdict: 'unknown', confirmations: null, blockIndex: null };
    let deepest = null;
    let blockIndex = null;
    for (const list of Object.values(utxosByAddress || {})) {
        for (const u of Array.isArray(list) ? list : []) {
            if (!u || lower(u.txid) !== wanted) continue;
            const c = Number(u.confirmations);
            if (!Number.isFinite(c) || c < 0) continue;
            if (deepest == null || c > deepest) {
                deepest = c;
                const h = Number(u.height);
                blockIndex = c >= 1 && Number.isInteger(h) && h > 0 ? h : null;
            }
        }
    }
    if (deepest == null) return { verdict: 'unknown', confirmations: null, blockIndex: null };
    return { verdict: deepest >= 1 ? 'confirmed' : 'seen', confirmations: deepest, blockIndex };
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
 * The transactions among `txids` that a confirmed record in `siblings`
 * spends an output of. A record is confirmed evidence once its status is
 * `indexed`: every path that writes that status has a block behind it.
 * Only the signed hex is read, and a record without one, or with one that
 * does not parse, contributes nothing.
 *
 * @param {object} args
 * @param {Iterable<string>} args.txids
 * @param {Array<{ status?: string, txHex?: string | null, txid?: string | null }>} args.siblings
 * @returns {Set<string>}  lowercased txids proven by a confirmed spend
 */
export function spentByConfirmedSibling({ txids, siblings }) {
    const wanted = new Set([...txids].map(lower).filter(Boolean));
    const proven = new Set();
    if (wanted.size === 0) return proven;
    for (const s of Array.isArray(siblings) ? siblings : []) {
        if (!s || s.status !== 'indexed' || typeof s.txHex !== 'string' || !s.txHex) continue;
        // A record cannot vouch for itself, whatever its hex says.
        const own = lower(s.txid);
        let inputs;
        try {
            ({ inputs } = parseRawTx(s.txHex));
        } catch {
            continue;
        }
        for (const i of inputs) {
            const parent = lower(i.prevTxHash);
            if (parent !== own && wanted.has(parent)) proven.add(parent);
        }
    }
    return proven;
}

/** @param {{ broadcastAt?: string | null, createdAt?: string | null }} r */
function sentAtMs(r) {
    for (const iso of [r.broadcastAt, r.createdAt]) {
        const ms = typeof iso === 'string' ? Date.parse(iso) : NaN;
        if (Number.isFinite(ms)) return ms;
    }
    return null;
}

/**
 * Reconcile this address's live sends against what the chain can prove
 * about them, writing what it proves onto the records: a sighting stamps
 * `mempoolSeenAt` (first one wins, as the WS path does) and a block retires
 * the record to `indexed`, marked as chain-confirmed so History keeps
 * showing it. Runs on History's own beat, from the host handler that lists
 * the records, so the row that was stuck is the row that gets corrected
 * while the user is looking at it.
 *
 * Native sends go to the tracker first: it asks about the recipient and
 * about ourselves, since the recipient's output is the one that exists for
 * every send and our own address covers a self-send and an un-rotated change
 * output. A rotated change output lands on an internal address this record
 * does not name, which is why the recipient comes first. Each address is
 * fetched once per call however many records name it.
 *
 * What the outputs leave unresolved, and every action-carrying record, is
 * then checked past the pending window: first against the vault's own
 * confirmed records for a spend of one of its outputs, then by hash against
 * the explorer, each hash at most once per `INCLUSION_PROBE_INTERVAL_MS`.
 *
 * Best-effort throughout: a tracker that is lagging, halted or unreachable
 * makes the encoder refuse the fetch, an explorer that errors answers
 * nothing, and either leaves every verdict `unknown` and every record
 * untouched.
 *
 * @param {object} args
 * @param {import('../storage/Vault.js').Vault} args.vault
 * @param {{ get: (chainId: string) => any }} args.sdkRegistry
 * @param {{ get?: (chainId: string) => any } | null | undefined} args.chainRegistry
 * @param {string} args.chainId
 * @param {string} [args.address]   only records sent FROM this address; all of the chain's when absent
 * @param {{ now?: () => string, probeAfterMs?: number, probeIntervalMs?: number, probeMemo?: Map<string, number> }} [args.opts]
 *        `now` is the ISO-timestamp source the stamps and the age gate share
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
    /** Every record of this chain, whatever its address or status: the child check reads them all. */
    const chainRecords = [];
    const natives = [];
    const actions = [];
    for (const r of Array.isArray(all) ? all : []) {
        if (!r || r.chain !== descriptor.coin || r.network !== descriptor.networkKind) continue;
        chainRecords.push(r);
        if (!r.txid || !isLivePendingStatus(r.status)) continue;
        if (wanted && lower(r.fromAddress) !== wanted) continue;
        if (isNativePendingTx(r, descriptor)) natives.push(r);
        else actions.push(r);
    }
    if (natives.length === 0 && actions.length === 0) return { seenNow, confirmed };

    const sdk = sdkRegistry?.get?.(chainId) || null;
    const nowIso = typeof opts.now === 'function' ? opts.now() : new Date().toISOString();
    const parsedNow = Date.parse(nowIso);
    const nowMs = Number.isFinite(parsedNow) ? parsedNow : Date.now();
    const stampOpts = { now: () => nowIso };

    /** @type {Array<{ txid: string, fromAddress?: string, toAddress?: string | null }>} */
    const unresolved = [];

    const encoder = sdk?.encoder;
    if (natives.length > 0 && encoder && typeof encoder.getUTXOs === 'function') {
        const addresses = new Set();
        for (const r of natives) {
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

        for (const r of natives) {
            const { verdict, blockIndex } = nativeSendVerdict({ txid: r.txid, utxosByAddress });
            const key = lower(r.txid);
            if (verdict === 'confirmed') {
                await markPendingTxIndexed(vault, r.txid, { ...stampOpts, inclusion: { blockIndex } });
                confirmed.add(key);
            } else if (verdict === 'seen') {
                await markPendingTxMempoolSeen(vault, r.txid, stampOpts);
                seenNow.add(key);
            } else {
                unresolved.push(r);
            }
        }
    } else {
        unresolved.push(...natives);
    }
    unresolved.push(...actions);

    // Past the window only: a young record is still the feeds' or the
    // outputs' to settle, and asking about it would cost a lookup per send.
    const probeAfterMs = Number(opts.probeAfterMs) >= 0 ? Number(opts.probeAfterMs) : INCLUSION_PROBE_AFTER_MS;
    const aged = unresolved.filter((r) => {
        const sent = sentAtMs(r);
        return sent != null && nowMs - sent >= probeAfterMs;
    });
    if (aged.length === 0) return { seenNow, confirmed };

    // The records the outputs settled a moment ago are in-memory copies
    // still reading `broadcast`; they count as the confirmed evidence they
    // now are, so a send whose change they spent retires in this same pass.
    const siblings = chainRecords.map((s) => (confirmed.has(lower(s.txid)) ? { ...s, status: 'indexed' } : s));
    const byChild = spentByConfirmedSibling({ txids: aged.map((r) => r.txid), siblings });
    const toProbe = [];
    for (const r of aged) {
        const key = lower(r.txid);
        if (byChild.has(key)) {
            await markPendingTxIndexed(vault, r.txid, { ...stampOpts, inclusion: { blockIndex: null } });
            confirmed.add(key);
        } else {
            toProbe.push(key);
        }
    }
    // No explorer client, no lookup and no memo entry: a client that appears
    // later must be asked straight away, not after a silence it never gave.
    if (toProbe.length === 0 || typeof sdk?.getTransaction !== 'function') return { seenNow, confirmed };

    const memo = opts.probeMemo instanceof Map ? opts.probeMemo : lastProbedAt;
    const intervalMs = Number(opts.probeIntervalMs) >= 0 ? Number(opts.probeIntervalMs) : INCLUSION_PROBE_INTERVAL_MS;
    const due = toProbe.filter((key) => {
        const last = memo.get(key);
        return last == null || nowMs - last >= intervalMs;
    });
    if (due.length === 0) return { seenNow, confirmed };

    const inBlock = await probeTxInclusion({ sdk, txids: due });
    for (const key of due) {
        const hit = inBlock.get(key);
        if (hit) {
            const r = aged.find((x) => lower(x.txid) === key);
            // A valid action means the explorer's own feed lists this
            // transaction (the sighting the feeds missed while the wallet was
            // closed); retire it plainly and let that row be the record. Only
            // one with no valid action needs our record to stand in for it.
            const inclusion = hit.actionRecorded ? undefined : { blockIndex: hit.blockIndex };
            await markPendingTxIndexed(vault, r ? r.txid : key, { ...stampOpts, inclusion });
            confirmed.add(key);
            memo.delete(key);
        } else {
            memo.set(key, nowMs);
        }
    }
    return { seenNow, confirmed };
}
