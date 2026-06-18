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
 * the explorer already returns:
 *
 *   - **Broadcast**: txHash is present (mempool or confirmed)
 *   - **In mempool**: blockIndex === 0 (waiting for inclusion)
 *   - **Confirmed**: blockIndex > 0; cell labels the block + timestamp.
 *                     When `chainTip` is supplied and at or above the
 *                     entry's block, the cell adds a confirmation count
 *                     ("· N confirmations") so the user can read tx
 *                     safety at a glance.
 *
 * Future work (cluster FOLLOWUP): a "Signed" stage when we start
 * tracking pendingTx records before broadcast, and an "Indexed" stage
 * once the indexer-sync watermark is exposed via messaging.
 *
 * @param {object} props
 * @param {{ blockIndex: number, timestamp: number, txHash: string, action: string }} props.entry
 * @param {number} [props.chainTip] highest block index seen for the
 *        entry's chain. Used to render a confirmation count on
 *        confirmed rows. When omitted or <= entry.blockIndex - 1, the
 *        count is hidden.
 */
export function TxStatusTimeline({ entry, chainTip }) {
    const txHash = typeof entry?.txHash === 'string' ? entry.txHash : '';
    const blockIndex = Number(entry?.blockIndex ?? 0);
    const timestamp = Number(entry?.timestamp ?? 0);
    const inMempool = blockIndex === 0 && txHash.length > 0;
    const confirmed = blockIndex > 0;
    const tip = Number.isFinite(Number(chainTip)) ? Number(chainTip) : 0;
    const confirmations = confirmed && tip >= blockIndex ? tip - blockIndex + 1 : 0;
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
            key: 'broadcast',
            label: 'Broadcast',
            done: txHash.length > 0,
            sub: txHash || 'No txid yet',
        },
        {
            key: 'mempool',
            label: inMempool ? 'In mempool' : (confirmed ? 'Mempool' : 'Pending broadcast'),
            done: inMempool || confirmed,
            sub: inMempool
                ? 'Waiting for a miner to include the tx'
                : confirmed
                    ? 'Cleared mempool when the block was mined'
                    : '',
        },
        {
            key: 'confirmed',
            label: confirmed ? `Confirmed at block ${blockIndex.toLocaleString()}` : 'Confirmed',
            done: confirmed,
            sub: confirmedSub,
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
