import styles from './TxStatusTimeline.module.css';

/**
 * §28.3 / G079 — Transaction status timeline. Renders a compact vertical
 * stage list for a History entry, computing stage state from the fields
 * the explorer already returns:
 *
 *   - **Broadcast**  — txHash is present (mempool or confirmed)
 *   - **In mempool** — blockIndex === 0 (waiting for inclusion)
 *   - **Confirmed**  — blockIndex > 0; cell labels the block + timestamp
 *
 * Future work (cluster FOLLOWUP): a "Signed" stage when we start
 * tracking pendingTx records before broadcast, and an "Indexed" stage
 * once the indexer-sync watermark is exposed via messaging.
 *
 * @param {object} props
 * @param {{ blockIndex: number, timestamp: number, txHash: string, action: string }} props.entry
 */
export function TxStatusTimeline({ entry }) {
    const txHash = typeof entry?.txHash === 'string' ? entry.txHash : '';
    const blockIndex = Number(entry?.blockIndex ?? 0);
    const timestamp = Number(entry?.timestamp ?? 0);
    const inMempool = blockIndex === 0 && txHash.length > 0;
    const confirmed = blockIndex > 0;

    const stages = [
        {
            key: 'broadcast',
            label: 'Broadcast',
            done: txHash.length > 0,
            sub: txHash ? short(txHash) : 'No txid yet',
        },
        {
            key: 'mempool',
            label: inMempool ? 'In mempool' : (confirmed ? 'Mempool' : 'Pending broadcast'),
            done: inMempool || confirmed,
            sub: inMempool
                ? 'Waiting for a miner to include the tx'
                : confirmed
                    ? 'Cleared mempool when the block was mined'
                    : '—',
        },
        {
            key: 'confirmed',
            label: confirmed ? `Confirmed at block ${blockIndex.toLocaleString()}` : 'Confirmed',
            done: confirmed,
            sub: confirmed && timestamp > 0
                ? new Date(timestamp * 1000).toLocaleString()
                : '—',
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
