import { Screen, Icon } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './ActionsMenu.module.css';
import pickerStyles from './WalletPicker.module.css';

/**
 * Settings page — full-screen replacement for the gear popover.
 *
 *   ▸ Wallet     summary row showing the active wallet name; click
 *                navigates to WalletPicker
 *   ▸ Account    same shape — click navigates to AccountPicker
 *
 * Reached from the pancake menu's "Settings" entry. The Network
 * filter lives in the header as a separate filter-icon popover so
 * users can toggle networks without entering Settings.
 *
 * @param {object} props
 * @param {() => void} props.onBack
 * @param {{ id: string, name: string } | null} [props.activeWallet]
 * @param {{ id: string, name: string, index: number } | null} [props.activeAccount]
 * @param {() => void} [props.onOpenWalletPicker]
 * @param {() => void} [props.onOpenAccountPicker]
 */
export function Settings({
    onBack,
    activeWallet,
    activeAccount,
    onOpenWalletPicker,
    onOpenAccountPicker,
}) {
    const { shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const walletLabel = activeWallet?.name || 'No wallet';
    const accountLabel = activeAccount?.name
        || (Number.isInteger(activeAccount?.index) ? `Account ${activeAccount.index + 1}` : 'Account 1');

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
            <span className={pickerStyles.title}>Settings</span>
            <span />
        </div>
    );

    return (
        <Screen variant={variant} header={header}>
            <div className={styles.listPopup}>
                {onOpenWalletPicker ? (
                    <Section title="Wallet">
                        <button
                            type="button"
                            className={styles.entry}
                            style={{ width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                            onClick={onOpenWalletPicker}
                        >
                            <span className={styles.entryLabel}>{walletLabel}</span>
                            <span aria-hidden="true" style={{ color: 'var(--xc-text-muted)', display: 'inline-flex' }}><Icon.ForwardIcon /></span>
                        </button>
                    </Section>
                ) : null}

                {onOpenAccountPicker && activeWallet ? (
                    <Section title="Account">
                        <button
                            type="button"
                            className={styles.entry}
                            style={{ width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                            onClick={onOpenAccountPicker}
                        >
                            <span className={styles.entryLabel}>{accountLabel}</span>
                            <span aria-hidden="true" style={{ color: 'var(--xc-text-muted)', display: 'inline-flex' }}><Icon.ForwardIcon /></span>
                        </button>
                    </Section>
                ) : null}
            </div>
        </Screen>
    );
}

function Section({ title, children }) {
    return (
        <div style={{ marginBottom: 'var(--xc-space-3)' }}>
            <div style={{
                fontSize: 'var(--xc-text-xs)',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--xc-text-muted)',
                marginBottom: 'var(--xc-space-1)',
            }}>{title}</div>
            {children}
        </div>
    );
}
