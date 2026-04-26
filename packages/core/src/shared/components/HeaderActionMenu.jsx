import { useEffect } from 'react';
import { Icon } from '@xchain-wallet/core/ui';
import { iconForLabel } from '@xchain-wallet/core/ui/icons/index.jsx';
import styles from './HeaderActionMenu.module.css';

/**
 * Full-overlay navigation drawer for the `small` (narrow-viewport)
 * variant. Triggered by the header pancake button on Home. Acts as
 * the SOLE navigation surface in small mode — no "More actions"
 * link that pushes to a list-in-main-view, because main view is
 * for doing work, not navigation.
 *
 * Two sections:
 *   1. Primary nav (Send, Receive, Markets, Messaging, …) —
 *      rendered from the explicit on*-prop handlers
 *   2. Actions (Issue token, Mint, Pay dividend, Airdrop, Swap, …) —
 *      rendered from the `extraActions` array passed in by the host
 *
 * Closes on:
 *   - Outside click
 *   - X button
 *   - Escape
 *   - Any row click (handler fires AND drawer closes)
 *
 * @param {object} props
 * @param {() => void} props.onClose
 * @param {() => void} [props.onAlerts]
 * @param {number} [props.alertCount]
 * @param {() => void} [props.onSend]
 * @param {() => void} [props.onReceive]
 * @param {() => void} [props.onCreateToken]
 * @param {() => void} [props.onMarkets]
 * @param {() => void} [props.onMessaging]
 * @param {() => void} [props.onHistory]
 * @param {() => void} [props.onAddresses]
 * @param {() => void} [props.onContracts]
 * @param {() => void} [props.onStaking]
 * @param {Array<{ id: string, label: string, onSelect?: () => void }>} [props.extraActions]
 * @param {() => void} [props.onLock]
 * @param {boolean} [props.locking]
 */
export function HeaderActionMenu({
    onClose,
    onAlerts,
    alertCount = 0,
    onSend,
    onReceive,
    onCreateToken,
    onMarkets,
    onMessaging,
    onHistory,
    onAddresses,
    onContracts,
    onStaking,
    extraActions = [],
    onLock,
    locking,
}) {
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const primary = [
        { id: 'send',      label: 'Send',         Icon: Icon.SendIcon,    handler: onSend },
        { id: 'receive',   label: 'Receive',      Icon: Icon.ReceiveIcon, handler: onReceive },
        { id: 'token',     label: 'Create token', Icon: Icon.TokenIcon,   handler: onCreateToken },
        { id: 'markets',   label: 'Markets',      Icon: Icon.MarketIcon,  handler: onMarkets },
        { id: 'messaging', label: 'Messaging',    Icon: Icon.MessageIcon, handler: onMessaging },
        { id: 'history',   label: 'History',      Icon: Icon.HistoryIcon, handler: onHistory },
        { id: 'addresses', label: 'Addresses',    Icon: Icon.AddressIcon, handler: onAddresses },
        { id: 'contracts', label: 'Contracts',    Icon: Icon.ContractIcon, handler: onContracts },
        { id: 'staking',   label: 'Staking',      Icon: Icon.StakeIcon,   handler: onStaking },
    ].filter((e) => typeof e.handler === 'function');

    const extras = (extraActions || []).filter((e) => typeof e.onSelect === 'function');

    return (
        <div
            className={styles.overlay}
            role="dialog"
            aria-modal="true"
            aria-label="Wallet menu"
            onClick={onClose}
        >
            <div
                className={styles.panel}
                onClick={(e) => e.stopPropagation()}
            >
                <header className={styles.header}>
                    <span className={styles.title}>Menu</span>
                    <button
                        type="button"
                        className={styles.close}
                        onClick={onClose}
                        aria-label="Close menu"
                    >
                        <Icon.XIcon />
                    </button>
                </header>
                <div className={styles.scroll}>
                    {typeof onAlerts === 'function' ? (
                        <ul className={styles.list} role="list">
                            <li className={styles.section}>Alerts</li>
                            <li>
                                <button
                                    type="button"
                                    className={styles.row}
                                    onClick={() => { onAlerts(); onClose(); }}
                                >
                                    <span className={styles.rowIcon} aria-hidden="true">
                                        <Icon.InfoIcon />
                                    </span>
                                    <span className={styles.rowLabel}>
                                        {alertCount > 0
                                            ? `View alerts`
                                            : 'No alerts'}
                                    </span>
                                    {alertCount > 0 ? (
                                        <span className={styles.rowBadge} aria-label={`${alertCount} alert${alertCount === 1 ? '' : 's'}`}>
                                            {alertCount}
                                        </span>
                                    ) : null}
                                    <span className={styles.rowChevron} aria-hidden="true">
                                        <Icon.ForwardIcon />
                                    </span>
                                </button>
                            </li>
                        </ul>
                    ) : null}
                    {primary.length > 0 ? (
                        <ul className={styles.list} role="list">
                            <li className={styles.section}>Wallet</li>
                            {primary.map(({ id, label, Icon: ItemIcon, handler }) => (
                                <li key={id}>
                                    <button
                                        type="button"
                                        className={styles.row}
                                        onClick={() => { handler(); onClose(); }}
                                    >
                                        <span className={styles.rowIcon} aria-hidden="true">
                                            <ItemIcon />
                                        </span>
                                        <span className={styles.rowLabel}>{label}</span>
                                        <span className={styles.rowChevron} aria-hidden="true">
                                            <Icon.ForwardIcon />
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ) : null}
                    {extras.length > 0 ? (
                        <ul className={styles.list} role="list">
                            <li className={styles.section}>Actions</li>
                            {extras.map(({ id, label, onSelect }) => {
                                const ResolvedIcon = iconForLabel(label) || Icon.MoreIcon;
                                return (
                                    <li key={id}>
                                        <button
                                            type="button"
                                            className={styles.row}
                                            onClick={() => { onSelect(); onClose(); }}
                                        >
                                            <span className={styles.rowIcon} aria-hidden="true">
                                                <ResolvedIcon />
                                            </span>
                                            <span className={styles.rowLabel}>{label}</span>
                                            <span className={styles.rowChevron} aria-hidden="true">
                                                <Icon.ForwardIcon />
                                            </span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    ) : null}
                </div>
                {typeof onLock === 'function' ? (
                    <div className={styles.lockBlock}>
                        <button
                            type="button"
                            className={styles.lockBtn}
                            onClick={() => { onLock(); onClose(); }}
                            disabled={locking}
                        >
                            <span className={styles.rowIcon} aria-hidden="true">
                                <Icon.LockIcon />
                            </span>
                            <span className={styles.rowLabel}>Lock wallet</span>
                        </button>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
