import { useEffect, useState } from 'react';
import { Screen, Button, Icon } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './ActionsMenu.module.css';
import pickerStyles from './WalletPicker.module.css';

/**
 * WalletDetails — read-only display of a Wallet record's metadata.
 * Reached from the 3-dot menu on a row in WalletPicker.
 *
 * Surfaces: name, format (BIP39 / Counterwallet-legacy), origin
 * (created / imported / freewallet-migrated), 25th-word-passphrase
 * status, created-at, account count, and address count. No secrets
 * — the encryptedSeed and kdfParams are projected out by `wallet.list`.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 * @param {() => void} [props.onRename]              navigates to RenameWalletForm scoped to this wallet
 * @param {() => void} [props.onMigrateToBip39]      shown only when format === 'counterwallet-legacy'; navigates to the §40.13 migration wizard scoped to this wallet
 */
export function WalletDetails({ walletId, onBack, onRename, onMigrateToBip39 }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const [wallet, setWallet] = useState(/** @type {any | null} */ (null));
    const [accountCount, setAccountCount] = useState(/** @type {number | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        if (typeof messaging.listWallets !== 'function') {
            setError('messaging.listWallets is not available in this shell.');
            return undefined;
        }
        messaging.listWallets()
            .then((list) => {
                if (cancelled) return;
                const found = Array.isArray(list) ? list.find((w) => w.id === walletId) : null;
                if (!found) setError('Wallet not found.');
                else setWallet(found);
            })
            .catch((err) => { if (!cancelled) setError(err?.message || 'Failed to load wallet.'); });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    useEffect(() => {
        let cancelled = false;
        if (typeof messaging.listAccounts !== 'function') return undefined;
        messaging.listAccounts(walletId)
            .then((list) => {
                if (cancelled) return;
                setAccountCount(Array.isArray(list) ? list.length : 0);
            })
            .catch(() => { if (!cancelled) setAccountCount(0); });
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
            <span className={pickerStyles.title}>Wallet details</span>
            <span />
        </div>
    );

    if (error) {
        return (
            <Screen variant={variant} header={header}>
                <div className={styles.entryDescription} role="alert">{error}</div>
            </Screen>
        );
    }
    if (!wallet) {
        return (
            <Screen variant={variant} header={header}>
                <div className={styles.entryDescription}>Loading…</div>
            </Screen>
        );
    }

    const formatLabel = wallet.format === 'counterwallet-legacy' ? 'FreeWallet (Counterwallet legacy)' : 'BIP39';
    const originLabel = ({
        'created':                'Generated in this wallet',
        'imported-mnemonic':      'Imported from a recovery phrase',
        'imported-freewallet':    'Imported from FreeWallet',
        'imported-xchain-backup': 'Restored from backup file',
        'imported-wif':           'Imported single private key',
    })[wallet.origin] || wallet.origin || '—';
    const created = wallet.createdAt ? new Date(wallet.createdAt) : null;
    const createdLabel = created && !Number.isNaN(created.getTime())
        ? created.toLocaleString()
        : '—';

    return (
        <Screen variant={variant} header={header}>
            <dl className={pickerStyles.detailList}>
                <Row label="Name" value={wallet.name || 'Unnamed wallet'} />
                <Row label="Type" value={formatLabel} />
                <Row label="Origin" value={originLabel} />
                <Row
                    label="25th-word passphrase"
                    value={wallet.passphraseEnabled ? 'Enabled' : 'Disabled'}
                />
                <Row label="Accounts" value={accountCount === null ? '…' : String(accountCount)} />
                <Row label="Created" value={createdLabel} />
                <Row label="ID" value={<code className={pickerStyles.code}>{wallet.id}</code>} />
            </dl>
            {wallet.format === 'counterwallet-legacy' && onMigrateToBip39 ? (
                <div style={{ marginTop: 'var(--xc-space-3)' }}>
                    <Button
                        type="button"
                        variant="primary"
                        block
                        onClick={onMigrateToBip39}
                        icon={<Icon.MigrateIcon />}
                    >
                        Migrate to BIP39
                    </Button>
                </div>
            ) : null}
            {onRename ? (
                <div style={{ marginTop: 'var(--xc-space-2)' }}>
                    <Button
                        type="button"
                        variant="primary"
                        block
                        onClick={onRename}
                        icon={<Icon.PencilIcon />}
                    >
                        Rename wallet
                    </Button>
                </div>
            ) : null}
        </Screen>
    );
}

function Row({ label, value }) {
    return (
        <div className={pickerStyles.detailRow}>
            <dt className={pickerStyles.detailLabel}>{label}</dt>
            <dd className={pickerStyles.detailValue}>{value}</dd>
        </div>
    );
}
