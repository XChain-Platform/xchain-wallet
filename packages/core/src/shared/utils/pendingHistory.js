// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Pending (unconfirmed) history entries: the merge that lets History show a
// transaction between "broadcast" and "indexed" instead of going silent for
// the length of a block.
//
// Three sources describe the same in-flight transaction and this module
// reconciles them onto one entry per (chain, tx hash):
//
//   1. Confirmed entries, from the explorer's history feed. Richest: they
//      carry an action index, a block and a timestamp.
//   2. Mempool rows, from `sdk.getUnconfirmed`. The network has seen the
//      transaction; they carry `first_seen` and the matched `destinations`.
//   3. Local PendingTx records, from this wallet's own vault. The only
//      source that exists in the ~85s between our broadcast and the first
//      mempool poll, and the only one that knows about an RBF replacement.
//
// Precedence is that same order: confirmed beats network-seen beats local.
// A confirmed entry does not merely win, it REMOVES the pending entry, so
// the row upgrades in place rather than appearing twice.
//
// Everything here is pure. History owns the fetching, the cadence and the
// observed-at memory; this module owns the shape, and that shape is the
// contract the pending detail branch, the timeline demotion and the pending
// amount annotation all read.

/**
 * @typedef {Object} PendingMeta
 * @property {'mempool' | 'local' | 'both'} origin  which sources described this tx
 * @property {number | null} firstSeenMs   when the NETWORK first saw it, ms; null
 *                                          while the transaction is broadcast but
 *                                          not yet observed in any mempool
 * @property {number} observedAtMs         when THIS wallet first saw the entry, ms;
 *                                          the timestamp floor that keeps the entry
 *                                          inside the default date filter
 * @property {number | null} broadcastAtMs when we broadcast it, ms (local records only)
 * @property {number | null} lastMempoolSeenMs  the last time a mempool read
 *                                          actually listed this transaction, ms.
 *                                          Only meaningful once no mempool
 *                                          lists it any more, which is what
 *                                          separates "dropped" from "never
 *                                          seen at all"
 * @property {'in' | 'out' | null} direction
 * @property {string[]} destinations       matched recipient addresses, refs resolved
 * @property {string | null} data          raw pipe-joined action string
 * @property {string | null} localStatus   PendingTx.status, when we have one
 * @property {string | null} pendingTxId
 * @property {boolean} replaced            superseded by an RBF replacement
 * @property {string | null} replacementTxHash
 */

/**
 * A pending entry is shaped exactly like a confirmed HistoryEntry so every
 * existing consumer (the status/date/action filters, grouping, search, the
 * RBF eligibility check) works on it unchanged. `blockIndex: 0` is what
 * `classifyEntryStatus` already routes to the `pending` bucket, and what
 * `isEntryReplaceable` already requires.
 *
 * @typedef {Object} PendingEntry
 * @property {string} key
 * @property {string} chainId
 * @property {string} address
 * @property {''} actionIndex     absent by definition: nothing has indexed it
 * @property {string} action
 * @property {0} blockIndex
 * @property {number} timestamp   ms; never 0, or the date filter drops the row
 * @property {string} txHash
 * @property {string} source
 * @property {object} raw
 * @property {null} link
 * @property {PendingMeta} pending
 */

/**
 * How long a broadcast transaction may go unseen by any mempool before the UI
 * stops calling it healthy (I-17). Twice the measured worst case: the decoder
 * polls its node every 60s, its getmempool response is cached 5s, the
 * explorer caches its snapshot 15s and the change detector polls every 5s, so
 * ~85s can pass with nothing wrong at all. A window that trips on a healthy
 * send teaches the user to ignore it.
 */
export const NETWORK_SEEN_WINDOW_MS = 180000;

/**
 * How long a transaction that HAS been seen may be absent from the mempool
 * before the UI says so (I-18). Covers the indexer's write lag behind the
 * shared 5s detector poll, so a transaction that is merely mid-confirmation
 * is not announced as dropped.
 */
export const DROPPED_GRACE_MS = 90000;

/** PendingTx statuses that describe a transaction which is ON the network. */
const LIVE_PENDING_STATUSES = new Set(['broadcasting', 'broadcast', 'rbf-replaced']);

/**
 * Statuses worth showing in History. Deliberately excludes the pre-broadcast
 * ones (composing / awaiting-signature / signed / queued: nothing has been
 * sent, and `queued` has its own banner), `indexed` (the confirmed entry is
 * the truth by then) and `failed` (never reached the network).
 *
 * @param {string} status
 */
export function isLivePendingStatus(status) {
    return LIVE_PENDING_STATUSES.has(String(status || ''));
}

/** @param {unknown} hash */
function normalizeHash(hash) {
    return String(hash || '').trim().toLowerCase();
}

/** @param {string} chainId @param {string} txHash */
function pendingKeyFor(chainId, txHash) {
    return `pending:${chainId}:${normalizeHash(txHash)}`;
}

/**
 * `first_seen` is unix SECONDS on the wire (the decoder column) but History
 * works in milliseconds throughout. Tolerate a value already in ms so a
 * future explorer change can't silently push every pending row 50,000 years
 * into the future.
 *
 * @param {unknown} firstSeen
 * @returns {number | null}
 */
export function firstSeenToMs(firstSeen) {
    const n = Number(firstSeen);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
}

/** @param {unknown} iso */
function isoToMs(iso) {
    if (typeof iso !== 'string' || iso === '') return null;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : null;
}

/**
 * Direction badge source (I-9). `out` wins over `in` so a self-send reads as
 * what the user did rather than what they received. No badge at all when
 * neither side is ours: the segment scan that produced `destinations` has a
 * known false-positive class, and a wrong "received" badge is worse than none.
 *
 * @param {{ source?: string, destinations?: string[] }} row
 * @param {Set<string>} ownAddresses  lowercased
 * @returns {'in' | 'out' | null}
 */
export function directionFor(row, ownAddresses) {
    const own = ownAddresses instanceof Set ? ownAddresses : new Set();
    const source = String(row?.source || '').toLowerCase();
    if (source && own.has(source)) return 'out';
    const dests = Array.isArray(row?.destinations) ? row.destinations : [];
    for (const d of dests) {
        if (own.has(String(d || '').toLowerCase())) return 'in';
    }
    return null;
}

/**
 * Build a pending entry from a mempool row (`sdk.getUnconfirmed`).
 *
 * @param {object} params
 * @param {string} params.chainId
 * @param {string} params.address        the wallet address this row was fetched for
 * @param {object} params.row            `{tx_hash, source, action, data, first_seen, destinations}`
 * @param {Set<string>} params.ownAddresses
 * @param {number} params.observedAtMs   local first-observed fallback, ms
 * @returns {PendingEntry | null}
 */
export function mempoolRowToEntry({ chainId, address, row, ownAddresses, observedAtMs }) {
    const txHash = normalizeHash(row?.tx_hash ?? row?.txHash);
    if (!txHash) return null;
    const destinations = Array.isArray(row?.destinations)
        ? row.destinations.map((d) => String(d || '')).filter(Boolean)
        : [];
    const source = String(row?.source || '');
    const firstSeenMs = firstSeenToMs(row?.first_seen ?? row?.firstSeen);
    return {
        key: pendingKeyFor(chainId, txHash),
        chainId,
        address,
        actionIndex: '',
        action: String(row?.action || 'ACTION').toUpperCase(),
        blockIndex: 0,
        // The date filter drops null-timestamp rows outright and History
        // defaults a 30-day window on, so a pending entry without a real
        // timestamp is an invisible entry. Network time when we have it,
        // our own first sighting when we don't.
        timestamp: firstSeenMs ?? observedAtMs,
        txHash,
        source,
        raw: {
            source,
            destination: destinations[0] || '',
            data: String(row?.data || ''),
        },
        link: null,
        pending: {
            origin: 'mempool',
            firstSeenMs,
            observedAtMs,
            broadcastAtMs: null,
            lastMempoolSeenMs: observedAtMs,
            direction: directionFor({ source, destinations }, ownAddresses),
            destinations,
            data: row?.data == null ? null : String(row.data),
            localStatus: null,
            pendingTxId: null,
            replaced: false,
            replacementTxHash: null,
        },
    };
}

/**
 * Build a pending entry from a local PendingTx record. This is the entry the
 * user sees the instant a broadcast returns, before any mempool poll has run.
 *
 * @param {object} params
 * @param {string} params.chainId
 * @param {string} params.address
 * @param {object} params.pendingTx
 * @param {Set<string>} params.ownAddresses
 * @param {number} params.observedAtMs
 * @param {number | null} [params.lastMempoolSeenMs]  when a mempool read last
 *        listed this transaction, if it ever did
 * @returns {PendingEntry | null}
 */
export function pendingTxToEntry({
    chainId, address, pendingTx, ownAddresses, observedAtMs, lastMempoolSeenMs = null,
}) {
    const txHash = normalizeHash(pendingTx?.txid);
    if (!txHash) return null;
    if (!isLivePendingStatus(pendingTx?.status)) return null;
    const source = String(pendingTx?.fromAddress || '');
    const destinations = pendingTx?.toAddress ? [String(pendingTx.toAddress)] : [];
    const broadcastAtMs = isoToMs(pendingTx?.broadcastAt);
    // M2.2 records the network sighting on the record itself; until that row
    // lands the field is simply absent and the entry stays "awaiting network".
    const firstSeenMs = isoToMs(pendingTx?.mempoolSeenAt);
    return {
        key: pendingKeyFor(chainId, txHash),
        chainId,
        address,
        actionIndex: '',
        action: String(pendingTx?.action || 'ACTION').toUpperCase(),
        blockIndex: 0,
        timestamp: firstSeenMs ?? broadcastAtMs ?? observedAtMs,
        txHash,
        source,
        raw: {
            source,
            destination: destinations[0] || '',
            tick: pendingTx?.tick || '',
            amount: pendingTx?.amount == null ? '' : String(pendingTx.amount),
        },
        link: null,
        pending: {
            origin: 'local',
            firstSeenMs,
            observedAtMs,
            broadcastAtMs,
            lastMempoolSeenMs,
            direction: directionFor({ source, destinations }, ownAddresses),
            destinations,
            data: null,
            localStatus: String(pendingTx?.status || ''),
            pendingTxId: pendingTx?.id ? String(pendingTx.id) : null,
            replaced: String(pendingTx?.status || '') === 'rbf-replaced',
            replacementTxHash: pendingTx?.rbfReplacement
                ? normalizeHash(pendingTx.rbfReplacement)
                : null,
        },
    };
}

/**
 * Fold a local entry into the mempool entry for the same transaction. The
 * mempool row wins on everything the network can tell us; the local record
 * contributes only what the network does not know: that it was OUR send, when
 * we broadcast it, and whether we have since replaced it.
 *
 * @param {PendingEntry} networkEntry
 * @param {PendingEntry} localEntry
 * @returns {PendingEntry}
 */
function foldLocalIntoNetwork(networkEntry, localEntry) {
    return {
        ...networkEntry,
        raw: { ...localEntry.raw, ...networkEntry.raw },
        pending: {
            ...networkEntry.pending,
            origin: 'both',
            observedAtMs: Math.min(networkEntry.pending.observedAtMs, localEntry.pending.observedAtMs),
            broadcastAtMs: localEntry.pending.broadcastAtMs,
            lastMempoolSeenMs: networkEntry.pending.lastMempoolSeenMs,
            // Our own record is authoritative about direction: we know we sent
            // it, where the segment scan only guesses who the parties are.
            direction: localEntry.pending.direction || networkEntry.pending.direction,
            localStatus: localEntry.pending.localStatus,
            pendingTxId: localEntry.pending.pendingTxId,
            replaced: localEntry.pending.replaced,
            replacementTxHash: localEntry.pending.replacementTxHash,
        },
    };
}

/**
 * Reconcile pending entries against each other and against the confirmed
 * feed, and return the merged list History should render.
 *
 * A pending entry whose hash is present in the confirmed feed is DROPPED,
 * not appended: that is the "upgrades in place" behavior, and it is also what
 * keeps a phantom (an action the indexer rejected at confirmation) from
 * outliving its mempool row.
 *
 * @param {object} params
 * @param {Array<object>} params.confirmed   entries from the explorer history feed
 * @param {Array<PendingEntry | null>} params.pending
 * @returns {{ entries: object[], pending: PendingEntry[] }}
 */
export function mergePendingEntries({ confirmed, pending }) {
    const confirmedList = Array.isArray(confirmed) ? confirmed : [];
    const confirmedHashes = new Set();
    for (const e of confirmedList) {
        const h = normalizeHash(e?.txHash);
        if (h) confirmedHashes.add(`${e.chainId}:${h}`);
    }

    /** @type {Map<string, PendingEntry>} */
    const byHash = new Map();
    for (const entry of Array.isArray(pending) ? pending : []) {
        if (!entry) continue;
        const id = `${entry.chainId}:${entry.txHash}`;
        if (confirmedHashes.has(id)) continue;
        const existing = byHash.get(id);
        if (!existing) {
            byHash.set(id, entry);
            continue;
        }
        // Same transaction seen twice. Either from two of our addresses (both
        // parties are ours) or from two sources. Network-seen beats local.
        if (existing.pending.origin === 'local' && entry.pending.origin === 'mempool') {
            byHash.set(id, foldLocalIntoNetwork(entry, existing));
        } else if (existing.pending.origin === 'mempool' && entry.pending.origin === 'local') {
            byHash.set(id, foldLocalIntoNetwork(existing, entry));
        } else {
            // Two rows of the same rank: keep the one we saw first so the
            // entry's identity and its position do not flicker between polls.
            byHash.set(
                id,
                existing.pending.observedAtMs <= entry.pending.observedAtMs ? existing : entry,
            );
        }
    }

    const pendingEntries = [...byHash.values()];
    return { entries: [...pendingEntries, ...confirmedList], pending: pendingEntries };
}

/**
 * The one answer to "what is going on with this pending transaction". The
 * timeline, the History row badge and the pending detail branch all read it,
 * because three components each deriving their own reading of the same fields
 * is how a row comes to say "waiting to confirm" beside a warning that the
 * network has never seen it.
 *
 * States, and each one is a claim the wallet can defend:
 *   `awaiting-network`  we broadcast it; no mempool has reported it YET, and
 *                       not enough time has passed for that to be worrying
 *   `seen`              a mempool reported it; this is healthy pending
 *   `not-seen`          broadcast, and still unreported past the window
 *   `dropped`           a mempool DID report it and no longer does, with no
 *                       confirmation, past the grace window
 *   `replaced`          we replaced it ourselves via RBF
 *
 * Note what is NOT here: "accepted", "confirmed", or anything implying the
 * indexer has validated the action. A mempool row is pre-validation and the
 * indexer can still reject it at confirmation (§7 honesty rule).
 *
 * @param {{ pending?: PendingMeta }} entry
 * @param {number} nowMs
 * @param {{ seenWindowMs?: number, droppedGraceMs?: number }} [windows]
 * @returns {'awaiting-network' | 'seen' | 'not-seen' | 'dropped' | 'replaced'}
 */
export function pendingDisplayState(entry, nowMs, windows) {
    const meta = entry?.pending;
    if (!meta) return 'awaiting-network';
    if (meta.replaced) return 'replaced';

    const seenWindowMs = Number(windows?.seenWindowMs) > 0
        ? Number(windows.seenWindowMs)
        : NETWORK_SEEN_WINDOW_MS;
    const droppedGraceMs = Number(windows?.droppedGraceMs) > 0
        ? Number(windows.droppedGraceMs)
        : DROPPED_GRACE_MS;

    // Present in a mempool as of the latest read: unambiguously healthy.
    if (meta.origin === 'mempool' || meta.origin === 'both') return 'seen';

    // Local-only from here down, so no mempool is reporting it right now.
    if (meta.lastMempoolSeenMs != null) {
        // It WAS reported and is not any more. Confirmation is the usual
        // reason and it arrives on its own feed, so wait out the grace before
        // saying anything alarming.
        return nowMs - meta.lastMempoolSeenMs > droppedGraceMs ? 'dropped' : 'seen';
    }
    if (meta.firstSeenMs != null) {
        // A network sighting recorded on our own PendingTx (M2.2) without a
        // live row beside it: same situation, timed from that sighting.
        return nowMs - meta.firstSeenMs > droppedGraceMs ? 'dropped' : 'seen';
    }

    // Never reported by anything. The clock runs from our broadcast, not from
    // when this wallet session happened to start looking.
    const since = meta.broadcastAtMs ?? meta.observedAtMs;
    return nowMs - since > seenWindowMs ? 'not-seen' : 'awaiting-network';
}

/**
 * Sort order for a merged list (I-22): pending first, newest first, then the
 * confirmed groups in the order History has always used.
 *
 * Exported so History and its tests agree on one comparator rather than each
 * carrying a copy.
 *
 * @param {object} a
 * @param {object} b
 */
export function compareMergedEntries(a, b) {
    const aPending = Number(a?.blockIndex ?? 0) <= 0;
    const bPending = Number(b?.blockIndex ?? 0) <= 0;
    if (aPending !== bPending) return aPending ? -1 : 1;
    if (aPending) return Number(b?.timestamp ?? 0) - Number(a?.timestamp ?? 0);
    if (b.blockIndex !== a.blockIndex) return b.blockIndex - a.blockIndex;
    return Number(b.actionIndex) - Number(a.actionIndex);
}
