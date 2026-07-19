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

/**
 * §28.3 / G079: Transaction status timeline. Renders a compact vertical
 * stage list for a History entry, computing stage state from the fields
 * the explorer already returns plus two optional data sources:
 *
 *   - **Signed**: the entry carries a `signedAt` timestamp (queued-
 *                 broadcast / hardware-signer records), OR a `txHash` is
 *                 present (a broadcast tx was necessarily signed first).
 *   - **Broadcast**: txHash is present (mempool or confirmed)
 *   - **In mempool**: blockIndex === 0 (waiting for inclusion)
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
 * @param {{ blockIndex: number, timestamp: number, txHash: string, action: string, signedAt?: number }} props.entry
 * @param {number} [props.chainTip] highest block index seen for the
 *        entry's chain. Used to render a confirmation count on
 *        confirmed rows. When omitted or <= entry.blockIndex - 1, the
 *        count is hidden.
 * @param {number} [props.indexerWatermark] latest block index the indexer
 *        has processed for the entry's chain. Drives the Indexed stage:
 *        the row is indexed once the watermark reaches the entry's block.
 */
export function TxStatusTimeline({ entry, chainTip, indexerWatermark }) {
    const txHash = typeof entry?.txHash === 'string' ? entry.txHash : '';
    const blockIndex = Number(entry?.blockIndex ?? 0);
    const timestamp = Number(entry?.timestamp ?? 0);
    const signedAt = Number(entry?.signedAt ?? 0);
    const inMempool = blockIndex === 0 && txHash.length > 0;
    const confirmed = blockIndex > 0;
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
            // "Mempool" is protocol jargon; the stage label stays in the
            // house voice and the sub-text carries the plain explanation.
            key: 'mempool',
            label: inMempool ? 'Waiting to confirm' : (confirmed ? 'Accepted' : 'Pending broadcast'),
            done: inMempool || confirmed,
            sub: inMempool
                ? 'Waiting for a miner to include the transaction in a block'
                : confirmed
                    ? 'Picked up when the block was mined'
                    : '',
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
                    className={`${styles.row} ${s.done ? styles.rowDone : styles.rowPending}`}
                >
                    <span className={styles.dot} aria-hidden="true">
                        {s.done ? '●' : '○'}
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
