import { useEffect, useState } from 'react';
import { Screen, Icon } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './ActionsMenu.module.css';
import pickerStyles from './WalletPicker.module.css';

/**
 * AccountPicker — full-screen list of BIP44 accounts under the active
 * wallet, with an "Add Account" affordance. Reached from the gear
 * popover's Account summary row. Picking an account calls `onSwitch`
 * and returns to home.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string | null} props.activeAccountId
 * @param {(accountId: string) => void} props.onSwitch
 * @param {() => void} props.onAddAccount
 * @param {() => void} props.onBack
 */
export function AccountPicker({ walletId, activeAccountId, onSwitch, onAddAccount, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [accounts, setAccounts] = useState(/** @type {any[] | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        if (typeof messaging.listAccounts !== 'function') {
            setError('messaging.listAccounts is not available in this shell.');
            return undefined;
        }
        messaging.listAccounts(walletId)
            .then((list) => {
                if (cancelled) return;
                const sorted = Array.isArray(list)
                    ? [...list].sort((a, b) => a.index - b.index)
                    : [];
                setAccounts(sorted);
            })
            .catch((err) => { if (!cancelled) setError(err?.message || 'Failed to load accounts.'); });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    const header = (
        <div className={pickerStyles.header}>
            <button
                type="button"
                onClick={onBack}
                className={pickerStyles.iconBtn}
                aria-label="Back"
                title="Back"
            >
                <Icon.BackIcon />
            </button>
            <span className={pickerStyles.title}>Accounts</span>
            <button
                type="button"
                onClick={onAddAccount}
                className={pickerStyles.iconBtn}
                aria-label="Add Account"
                title="Add Account"
            >
                <Icon.PlusIcon />
            </button>
        </div>
    );

    return (
        <Screen variant={variant} header={header}>
            <div className={isFull ? styles.listFull : styles.listPopup}>
                {error ? (
                    <div className={styles.entryDescription} role="alert">{error}</div>
                ) : accounts === null ? (
                    <div className={styles.entryDescription}>Loading…</div>
                ) : accounts.length === 0 ? (
                    <div className={styles.entryDescription}>No accounts yet.</div>
                ) : accounts.map((a) => {
                    const active = a.id === activeAccountId;
                    const label = a.name || `Account ${a.index + 1}`;
                    return (
                        <button
                            key={a.id}
                            type="button"
                            className={styles.entry}
                            onClick={() => {
                                if (!active) onSwitch(a.id);
                                onBack();
                            }}
                        >
                            <span className={styles.entryLabel}>
                                {active ? '● ' : '○ '}{label}
                            </span>
                            <span className={styles.entryDescription}>
                                BIP44 account index {a.index}
                            </span>
                        </button>
                    );
                })}
            </div>
        </Screen>
    );
}
