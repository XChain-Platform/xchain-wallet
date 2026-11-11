// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { AssetMark } from '../../ui/AssetMark.jsx';
import { Icon } from '../../ui/index.js';
import { RelativeTime } from './RelativeTime.jsx';
// The Button sheet loads first so the row rules below win the cascade.
import buttonStyles from '../../ui/Button.module.css';
import styles from './ActivityRow.module.css';

const STATUS_LABELS = {
    confirmed: 'Confirmed',
    failed: 'Failed',
    pending: 'Pending',
};

/** The action icon shared by activity rows and History's action filter. */
export function actionIconForAction(action) {
    const id = String(action || '').trim().toLowerCase().replaceAll('_', '-');
    switch (id) {
        case 'send':             return <Icon.SendIcon />;
        case 'receive':          return <Icon.ReceiveIcon />;
        case 'issue':
        case 'issuance':         return <Icon.PlusIcon />;
        case 'mint':             return <Icon.TokenIcon />;
        case 'destroy':
        case 'burn':             return <Icon.TrashIcon />;
        case 'sweep':            return <Icon.DownloadIcon />;
        case 'dispenser':        return <Icon.MarketIcon />;
        case 'dispense':         return <Icon.DownloadIcon />;
        case 'order-match':
        case 'orderfill':
        case 'order-fill':       return <Icon.SwapIcon />;
        case 'order':
        case 'order-cancel':
        case 'order-edit':
        case 'order-expire':     return <Icon.MarketIcon />;
        case 'swap':
        case 'swap-match':
        case 'swap-cancel':
        case 'swap-edit':
        case 'swap-expire':      return <Icon.SwapIcon />;
        case 'dividend':         return <Icon.DollarIcon />;
        case 'broadcast':        return <Icon.BroadcastIcon />;
        case 'message':          return <Icon.MessageIcon />;
        case 'link':
        case 'crosschain':       return <Icon.LinkIcon />;
        case 'deploy':
        case 'execute':
        case 'deposit':
        case 'withdraw':         return <Icon.ContractIcon />;
        case 'stake':
        case 'unstake':
        case 'delegate':
        case 'slash':            return <Icon.StakeIcon />;
        default:                 return <Icon.MoreIcon />;
    }
}

/** A compact transaction row shared by Home activity and full History. */
export function ActivityRow({
    chainId,
    tick,
    imageUrl = null,
    isNative = false,
    label,
    actionIcon = null,
    context = null,
    amount,
    status,
    statusLabels = STATUS_LABELS,
    timestamp,
    block = null,
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
            className={`${buttonStyles.btn} ${buttonStyles.ghost} ${buttonStyles.lg} ${styles.row} ${selected ? styles.selected : ''} ${className}`.trim()}
            {...rest}
        >
            {decoration}
            <AssetMark
                chainId={chainId}
                tick={tick}
                imageUrl={imageUrl}
                isNative={isNative}
                className={styles.mark}
            />
            <span className={styles.labelCell}>
                <span className={styles.labelLine}>
                    {actionIcon ? (
                        <span className={styles.actionIcon} aria-hidden="true">{actionIcon}</span>
                    ) : null}
                    <span className={styles.label}>{label}</span>
                </span>
                {context ? <span className={styles.context}>{context}</span> : null}
            </span>
            <span className={styles.primary}>{amount}</span>
            {statusLabel ? (
                <span className={`${styles.status} ${styles[status]}`} title={statusLabel}>
                    {statusLabel}
                </span>
            ) : <span className={styles.status} />}
            {block ? <span className={styles.block}>{block}</span> : null}
            {timestamp ? <RelativeTime className={styles.time} timestamp={timestamp} /> : <span className={styles.time} />}
            {trailing ? <span className={styles.trailing} aria-hidden="true">{trailing}</span> : <span className={styles.trailing} />}
        </button>
    );
}
