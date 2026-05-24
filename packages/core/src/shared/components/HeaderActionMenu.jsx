import { useEffect } from 'react';
import { Icon } from '@xchain-wallet/core/ui';
import { LayoutModeToggle } from './LayoutModeToggle.jsx';
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
 * @param {() => void} [props.onMarkets]
 * @param {() => void} [props.onTokens]         opens ActionsMenu (token issue/mint/destroy/dispenser/dividend/airdrop/broadcast/advanced)
 * @param {() => void} [props.onMessaging]
 * @param {() => void} [props.onCrossChain]     opens CrossChainTemplates (link/parallel/cross-chain swap)
 * @param {() => void} [props.onContacts]
 * @param {() => void} [props.onAddresses]
 * @param {() => void} [props.onContracts]      BTC-only — host gates the prop based on hasBtcAddress
 * @param {() => void} [props.onStaking]        BTC-only
 * @param {() => void} [props.onMultisig]       opens the multisig create/sign route
 * @param {() => void} [props.onLock]
 * @param {boolean} [props.locking]
 * @param {() => void} [props.onSettings]
 */
export function HeaderActionMenu({
    onClose,
    onAlerts,
    alertCount = 0,
    onMarkets,
    onTokens,
    onMessaging,
    onCrossChain,
    onContacts,
    onAddresses,
    onContracts,
    onStaking,
    onMultisig,
    onLock,
    locking,
    onSettings,
}) {
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const primary = [
        { id: 'markets',     label: 'Decentralized Exchange', Icon: Icon.MarketIcon,   handler: onMarkets },
        { id: 'tokens',      label: 'Tokens',      Icon: Icon.TokenIcon,    handler: onTokens },
        { id: 'messaging',   label: 'Messaging',   Icon: Icon.MessageIcon,  handler: onMessaging },
        { id: 'cross-chain', label: 'Cross-chain', Icon: Icon.LinkIcon,     handler: onCrossChain },
        { id: 'contacts',    label: 'Contacts',    Icon: Icon.UsersIcon,    handler: onContacts },
        { id: 'addresses',   label: 'Addresses',   Icon: Icon.AddressIcon,  handler: onAddresses },
        { id: 'contracts',   label: 'Contracts',   Icon: Icon.ContractIcon, handler: onContracts },
        { id: 'staking',     label: 'Staking',     Icon: Icon.StakeIcon,    handler: onStaking },
        { id: 'multisig',    label: 'Multisig',    Icon: Icon.MultisigIcon, handler: onMultisig },
    ].filter((e) => typeof e.handler === 'function');

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
                            {typeof onSettings === 'function' ? (
                                <li>
                                    <button
                                        type="button"
                                        className={styles.row}
                                        onClick={() => { onSettings(); onClose(); }}
                                    >
                                        <span className={styles.rowIcon} aria-hidden="true">
                                            <Icon.GearIcon />
                                        </span>
                                        <span className={styles.rowLabel}>Settings</span>
                                        <span className={styles.rowChevron} aria-hidden="true">
                                            <Icon.ForwardIcon />
                                        </span>
                                    </button>
                                </li>
                            ) : null}
                        </ul>
                    ) : null}
                </div>
                <LayoutModeToggle />
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
