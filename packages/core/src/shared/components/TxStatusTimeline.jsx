// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import styles from './TxStatusTimeline.module.css';
import { pendingDisplayState } from '../utils/pendingHistory.js';

// Copy for the mempool stage, one entry per state `pendingDisplayState` can
// return. Written so each line is a claim the wallet can defend from what it
// actually knows (§7): a mempool sighting is pre-validation, so nothing here
// says confirmed or accepted, and the stage is only `done` once some node has
// told us it holds the transaction.
//
// `warn` marks the two states the user may need to act on. It is a different
// KIND of not-done from "waiting", so it gets its own styling rather than
// sitting muted at the bottom of the list where an unreached stage sits.
const MEMPOOL_STAGE_COPY = {
    seen: {
        label: 'In mempool',
        done: true,
        sub: 'A node is holding it, waiting for a miner to include it in a block',
    },
    'awaiting-network': {
        label: 'Broadcast, awaiting network',
        done: false,
        sub: 'Sent. No node has reported holding it yet, which can take a minute',
    },
    'not-seen': {
        label: 'Not seen by the network',
        done: false,
        warn: true,
        sub: 'No node has reported holding this transaction. It may not have reached the network',
    },
    dropped: {
        label: 'Dropped or replaced?',
        done: false,
        warn: true,
        sub: 'A node was holding this transaction and no longer is, and no block has included it',
    },
    replaced: {
        label: 'Replaced',
        done: false,
        sub: 'You replaced this transaction with a higher-fee version',
    },
};

/**
 * §28.3 / G079: Transaction status timeline. Renders a compact vertical
 * stage list for a History entry, computing stage state from the fields
 * the explorer already returns plus two optional data sources:
 *
 *   - **Signed**: the entry carries a `signedAt` timestamp (queued-
 *                 broadcast / hardware-signer records), OR a `txHash` is
 *                 present (a broadcast tx was necessarily signed first).
 *   - **Broadcast**: txHash is present (mempool or confirmed)
 *   - **In mempool**: only once a node has actually reported holding the
 *                     transaction. `pendingDisplayState` decides that, from
 *                     the entry's pending metadata; a blockless entry with a
 *                     hash used to be enough, which claimed the network had
 *                     it off no network evidence at all (§4 M2.2).
 *   - **Confirmed**: blockIndex > 0; cell labels the block + timestamp.
 *                     When `chainTip` is supplied and at or above the
 *                     entry's block, the cell adds a confirmation count
 *                     ("· N confirmations") so the user can read tx
 *                     safety at a glance.
 *   - **Indexed**: the indexer has processed the block carrying this
 *                  action. Driven by `indexerWatermark` (the latest block
 *                  the indexer has processed, from `getIndexerWatermark`):
 *                  done when it is at or above the entry's block. With no
 *                  watermark supplied, a confirmed row falls back to done,
 *                  since a row the wallet can display was, by construction,
 *                  read back from the indexer.
 *
 * @param {object} props
 * @param {{ blockIndex: number, timestamp: number, txHash: string, action: string, signedAt?: number, pending?: import('../utils/pendingHistory.js').PendingMeta }} props.entry
 *        a merged History entry. `pending` is present only on a blockless one;
 *        every confirmed row arrives without it, which is why the mempool
 *        stage checks the block before it checks anything else.
 * @param {number} [props.chainTip] highest block index seen for the
 *        entry's chain. Used to render a confirmation count on
 *        confirmed rows. When omitted or <= entry.blockIndex - 1, the
 *        count is hidden.
 * @param {number} [props.indexerWatermark] latest block index the indexer
 *        has processed for the entry's chain. Drives the Indexed stage:
 *        the row is indexed once the watermark reaches the entry's block.
 * @param {number} [props.seenWindowMs] per-network override (I-17) for how
 *        long a broadcast transaction may go unreported before this timeline
 *        warns. Defaults to `NETWORK_SEEN_WINDOW_MS`. A slow venue (a regtest
 *        chain whose decoder polls lazily) can widen it without the constant
 *        moving for everyone.
 * @param {number} [props.droppedGraceMs] per-network override for the
 *        "dropped or replaced?" grace window. Defaults to `DROPPED_GRACE_MS`.
 */
export function TxStatusTimeline({
    entry, chainTip, indexerWatermark, seenWindowMs, droppedGraceMs,
}) {
    const txHash = typeof entry?.txHash === 'string' ? entry.txHash : '';
    const blockIndex = Number(entry?.blockIndex ?? 0);
    const timestamp = Number(entry?.timestamp ?? 0);
    const signedAt = Number(entry?.signedAt ?? 0);
    const confirmed = blockIndex > 0;
    // Only a blockless entry with a hash has a pending state to read. The
    // guard matters: every historical row reaches this component with no
    // pending metadata at all, and `pendingDisplayState` would answer
    // 'awaiting-network' for it, which is true of nothing that is in a block.
    const pendingState = !confirmed && txHash.length > 0
        ? pendingDisplayState(entry, Date.now(), { seenWindowMs, droppedGraceMs })
        : null;
    const tip = Number.isFinite(Number(chainTip)) ? Number(chainTip) : 0;
    const watermark = Number.isFinite(Number(indexerWatermark)) ? Number(indexerWatermark) : 0;
    const confirmations = confirmed && tip >= blockIndex ? tip - blockIndex + 1 : 0;

    // Signed: a broadcast tx was necessarily signed first, so a present
    // txHash implies this stage is done. An explicit signedAt marks it
    // done for a queued/pre-broadcast entry that has no hash yet.
    const signed = signedAt > 0 || txHash.length > 0;
    const signedSub = signedAt > 0
        ? (relativeTime(signedAt) || 'Approved and signed')
        : (signed
            ? 'Approved and signed'
            : 'Waiting for you to approve and sign');

    // Indexed: the indexer has caught up to (or past) this action's block.
    // A supplied watermark decides it; without one, a confirmed row is
    // treated as indexed because the wallet only ever displays rows the
    // indexer has already returned.
    const indexed = confirmed && (watermark > 0 ? watermark >= blockIndex : true);
    const indexedSub = indexed
        ? (watermark > 0
            ? `Fully processed · indexer at block ${watermark.toLocaleString()}`
            : 'Fully processed and searchable')
        : (confirmed
            ? 'Indexer is still catching up to this block'
            : 'Waiting to confirm before it can be processed');
    const confirmedSubBase = confirmed && timestamp > 0
        ? relativeTime(timestamp)
        : '';
    const confirmedSub = confirmations > 0
        ? (confirmedSubBase === ''
            ? `${confirmations.toLocaleString()} confirmation${confirmations === 1 ? '' : 's'}`
            : `${confirmedSubBase} · ${confirmations.toLocaleString()} confirmation${confirmations === 1 ? '' : 's'}`)
        : confirmedSubBase;

    // The mempool stage in three situations: an in-flight transaction (the
    // pending state answers it), one already in a block, and one not yet sent.
    const mempoolStage = pendingState
        ? (MEMPOOL_STAGE_COPY[pendingState] || MEMPOOL_STAGE_COPY['awaiting-network'])
        : confirmed
            ? { label: 'Accepted', done: true, sub: 'Picked up when the block was mined' }
            : { label: 'Pending broadcast', done: false, sub: '' };

    const stages = [
        {
            key: 'signed',
            label: 'Signed',
            done: signed,
            sub: signedSub,
        },
        {
            key: 'broadcast',
            label: 'Broadcast',
            done: txHash.length > 0,
            sub: txHash || 'Not sent yet',
        },
        {
            key: 'mempool',
            ...mempoolStage,
        },
        {
            key: 'confirmed',
            label: confirmed ? `Confirmed at block ${blockIndex.toLocaleString()}` : 'Confirmed',
            done: confirmed,
            sub: confirmedSub,
        },
        {
            key: 'indexed',
            label: 'Indexed',
            done: indexed,
            sub: indexedSub,
        },
    ];

    return (
        <ol className={styles.timeline} aria-label="Transaction status">
            {stages.map((s, i) => (
                <li
                    key={s.key}
                    className={`${styles.row} ${s.done ? styles.rowDone : styles.rowPending}`
                        + (s.warn ? ` ${styles.rowWarn}` : '')}
                >
                    {/* The dot is decorative for a normal stage, but a warning
                        must not be carried by color alone; the marker changes
                        shape too, and the label itself states the problem. */}
                    <span className={styles.dot} aria-hidden="true">
                        {s.warn ? '!' : (s.done ? '●' : '○')}
                    </span>
                    {i < stages.length - 1 ? (
                        <span className={`${styles.spine} ${s.done ? styles.spineDone : ''}`} aria-hidden="true" />
                    ) : null}
                    <div className={styles.body}>
                        <div className={styles.label}>{s.label}</div>
                        <div className={styles.sub}>{s.sub}</div>
                    </div>
                </li>
            ))}
        </ol>
    );
}

function short(s) {
    if (typeof s !== 'string' || s.length <= 14) return s;
    return `${s.slice(0, 8)}…${s.slice(-6)}`;
}

// Human-readable "X ago" for the confirmed-stage sub label. Accepts
// unix seconds or ms; returns '' for invalid input so the caller can
// fall back to a static placeholder.
function relativeTime(ts) {
    if (!ts) return '';
    const ms = ts < 1e12 ? ts * 1000 : ts;
    const diffSec = Math.floor((Date.now() - ms) / 1000);
    if (diffSec < 5) return 'just now';
    if (diffSec < 60) return `${diffSec} seconds ago`;
    const min = Math.floor(diffSec / 60);
    if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
    const hr = Math.floor(diffSec / 3600);
    if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
    const day = Math.floor(diffSec / 86400);
    if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`;
    const month = Math.floor(day / 30);
    if (month < 12) return `${month} month${month === 1 ? '' : 's'} ago`;
    const year = Math.floor(day / 365);
    return `${year} year${year === 1 ? '' : 's'} ago`;
}
