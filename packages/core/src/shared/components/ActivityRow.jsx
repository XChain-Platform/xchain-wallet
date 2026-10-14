// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { AssetMark } from '../../ui/AssetMark.jsx';
import { RelativeTime } from './RelativeTime.jsx';
import styles from './ActivityRow.module.css';

const STATUS_LABELS = {
    confirmed: 'Confirmed',
    failed: 'Failed',
    pending: 'Pending',
};

/** A compact transaction row shared by Home activity and full History. */
export function ActivityRow({
    chainId,
    tick,
    imageUrl = null,
    isNative = false,
    label,
    context = null,
    amount,
    status,
    statusLabels = STATUS_LABELS,
    timestamp,
    selected = false,
    onClick,
    decoration = null,
    trailing = null,
    className = '',
    ...rest
}) {
    const statusLabel = statusLabels[status] || '';
    return (
        <button
            type="button"
            onClick={onClick}
            className={`${styles.row} ${selected ? styles.selected : ''} ${className}`.trim()}
            {...rest}
        >
            {decoration}
            <AssetMark
                chainId={chainId}
                tick={tick}
                imageUrl={imageUrl}
                isNative={isNative}
            />
            <span className={styles.labelCell}>
                <span className={styles.label}>{label}</span>
                {context ? <span className={styles.context}>{context}</span> : null}
            </span>
            <span className={styles.primary}>{amount}</span>
            {statusLabel ? (
                <span className={`${styles.status} ${styles[status]}`} title={statusLabel}>
                    {statusLabel}
                </span>
            ) : <span />}
            {timestamp ? <RelativeTime className={styles.time} timestamp={timestamp} /> : <span />}
            {trailing ? <span className={styles.trailing} aria-hidden="true">{trailing}</span> : <span />}
        </button>
    );
}
