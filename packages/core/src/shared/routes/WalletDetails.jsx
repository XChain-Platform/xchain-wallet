// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useState } from 'react';
import { Button, Icon, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { isDemoWallet, getDemoWalletExpiry } from '@xchain-wallet/core/flows';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { exitDemoWallet } from '../utils/demoGraduation.js';
import styles from './ActionsMenu.module.css';
import pickerStyles from './WalletPicker.module.css';

// Re-exported for the callers and tests that reached for it here before
// the demo-exit primitives were pulled into one module.
export { isVaultEmpty } from '../utils/demoGraduation.js';

/**
 * WalletDetails: read-only display of a Wallet record's metadata.
 * Reached from the 3-dot menu on a row in WalletPicker.
 *
 * Surfaces: name, format (BIP39 / Counterwallet-legacy), origin
 * (created / imported / freewallet-migrated), 25th-word-passphrase
 * status, created-at, account count, and address count. No secrets
 * The encryptedSeed and kdfParams are projected out by `wallet.list`.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 * @param {() => void} [props.onRename]              navigates to RenameWalletForm scoped to this wallet
 * @param {() => void} [props.onMigrateToBip39]      shown only when format === 'counterwallet-legacy'; navigates to the §40.13 migration wizard scoped to this wallet
 * @param {() => void} [props.onExited]              fires after a successful demo wipe so the host can refresh App state
 */
export function WalletDetails({ walletId, onBack, onRename, onMigrateToBip39, onExited }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const [wallet, setWallet] = useState(/** @type {any | null} */ (null));
    const [accountCount, setAccountCount] = useState(/** @type {number | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [exitBusy, setExitBusy] = useState(false);
    const [exitError, setExitError] = useState(/** @type {string | null} */ (null));

    const isDemo = isDemoWallet(walletId);
    const demoExpiry = isDemo ? getDemoWalletExpiry() : null;

    async function handleExitDemo() {
        if (exitBusy) return;
        setExitBusy(true);
        setExitError(null);
        try {
            // Removing the record does not remove the vault, and the
            // vault meta is what the shell reads to decide a wallet
            // exists. If the demo was the only wallet, leaving the meta
            // behind boots the user into an unlock screen for an empty
            // vault, holding a throwaway password we just deleted - and
            // the Locked screen's demo escape is gated on that same
            // deleted id, so their only way out is the "Forgot password"
            // wipe, under copy about permanently losing funds.
            // `exitDemoWallet` clears the store so they land back on
            // Welcome instead, and only when nothing else is left.
            const { reloaded } = await exitDemoWallet({ messaging, walletId });
            if (reloaded) return;
            if (typeof onExited === 'function') onExited();
        } catch (err) {
            setExitError(err?.message || 'Could not exit demo mode.');
        } finally {
            setExitBusy(false);
        }
    }

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
        <PageHeader onBack={onBack} title="Wallet details" />
    );

    if (error) {
        return (
            <Screen variant={variant} header={header}>
                <StatusMessage variant="error" className={styles.entryDescription}>{error}</StatusMessage>
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
    })[wallet.origin] || wallet.origin || 'N/A';
    const created = wallet.createdAt ? new Date(wallet.createdAt) : null;
    const createdLabel = created && !Number.isNaN(created.getTime())
        ? created.toLocaleString()
        : 'N/A';

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
                {isDemo ? (
                    <Row
                        label="Status"
                        value={
                            <span>
                                Demo wallet (throwaway)
                                {formatDemoExpiry(demoExpiry) ? ` · ${formatDemoExpiry(demoExpiry)}` : ''}
                            </span>
                        }
                    />
                ) : null}
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
            {isDemo ? (
                <div style={{ marginTop: 'var(--xc-space-3)' }}>
                    <Button
                        type="button"
                        variant="danger"
                        block
                        onClick={handleExitDemo}
                        loading={exitBusy}
                        disabled={exitBusy}
                    >
                        Exit demo &amp; wipe
                    </Button>
                    {exitError ? (
                        <p
                            role="alert"
                            style={{
                                marginTop: 'var(--xc-space-2)',
                                fontSize: 'var(--xc-text-xs)',
                                color: 'var(--xc-danger)',
                            }}
                        >
                            {exitError}
                        </p>
                    ) : null}
                </div>
            ) : null}
        </Screen>
    );
}

function formatDemoExpiry(expiry) {
    if (!expiry || typeof expiry.expiresAt !== 'number') return null;
    const remaining = expiry.expiresAt - Date.now();
    if (remaining <= 0) return 'auto-wipe imminent';
    const minutes = Math.floor(remaining / 60_000);
    const hours = Math.floor(minutes / 60);
    if (hours >= 1) {
        const remMin = minutes % 60;
        return remMin > 0
            ? `auto-wipes in ${hours}h ${remMin}m`
            : `auto-wipes in ${hours}h`;
    }
    if (minutes >= 1) return `auto-wipes in ${minutes}m`;
    return 'auto-wipes in under a minute';
}

function Row({ label, value }) {
    return (
        <div className={pickerStyles.detailRow}>
            <dt className={pickerStyles.detailLabel}>{label}</dt>
            <dd className={pickerStyles.detailValue}>{value}</dd>
        </div>
    );
}
