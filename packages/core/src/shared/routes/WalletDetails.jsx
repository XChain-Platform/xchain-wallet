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
import { Button, Icon, ListPage, ListRow, PageHeader, Screen, StatusMessage, Tabs } from '@xchain-wallet/core/ui';
// The standard list card and row icon.
import listStyles from './CoSignerAccountList.module.css';
import homeTabsStyles from '../components/HomeTabs.module.css';
import { IdentityAvatar } from '../components/WalletIdentity.jsx';
import { readWalletTile, tileRadius, walletTileText } from '../utils/walletTile.js';
import { isDemoWallet, getDemoWalletExpiry } from '@xchain-wallet/core/flows';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { exitDemoWallet } from '../utils/demoGraduation.js';
import { DemoExitConfirm } from '../components/DemoExitConfirm.jsx';
import { AddressDiscoveryNotice } from '../components/AddressDiscoveryNotice.jsx';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/accountPicker.js';
import '../../i18n/locales/en/addressDiscovery.js';
import '../../i18n/locales/en/history.js';
import '../../i18n/locales/en/renameWallet.js';
import '../../i18n/locales/en/routes.js';
import '../../i18n/locales/en/settings.js';
import '../../i18n/locales/en/walletDetails.js';
import '../../i18n/locales/en/walletPicker.js';
import { walletOriginLabel } from '../utils/walletOriginLabel.js';
import { walletModeLabel } from '../components/WalletModeField.jsx';
import styles from './ActionsMenu.module.css';
import pickerStyles from './WalletPicker.module.css';
import { pendingMigrationSweeps } from '../../flows/migrationSweeps.js';

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
 * @param {(wallet: any) => void} [props.onRename]   navigates to RenameWalletForm scoped to this wallet
 * @param {() => void} [props.onMigrateToBip39]      shown only when format === 'counterwallet-legacy'; navigates to the §40.13 migration wizard scoped to this wallet
 * @param {() => void} [props.onExited]              fires after a successful demo wipe so the host can refresh App state
 * @param {(wallet: any) => void} [props.onExportBackup]  opens the Export Backup page for this wallet
 * @param {(wallet: any) => void} [props.onRemoveWallet]  opens the Remove Wallet page for this wallet
 */
export function WalletDetails({ walletId, onBack, onRename, onMigrateToBip39, onExited, activeWalletId, onMakeActive, onOpenSettings, onShowRecoveryPhrase, onExportBackup, onRemoveWallet }) {
    // The page opens on its Actions tab.
    const [tab, setTab] = useState('actions');
    const [madeActive, setMadeActive] = useState(false);
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const [walletLoad, setWalletLoad] = useState(
        /** @type {{ walletId: string | null, wallet: any | null, error: string | null }} */ (
            { walletId: null, wallet: null, error: null }
        ),
    );
    const [accountLoad, setAccountLoad] = useState(
        /** @type {{ walletId: string | null, count: number | null }} */ (
            { walletId: null, count: null }
        ),
    );
    const [exitBusy, setExitBusy] = useState(false);
    const [exitError, setExitError] = useState(/** @type {string | null} */ (null));
    const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
    // Remounts the status line on each check started here.
    const [discoveryRun, setDiscoveryRun] = useState(0);
    const [discoveryError, setDiscoveryError] = useState(/** @type {string | null} */ (null));
    const [discoveryStarting, setDiscoveryStarting] = useState(false);

    const isDemo = isDemoWallet(walletId);

    async function handleCheckAddresses() {
        if (discoveryStarting) return;
        setDiscoveryStarting(true);
        setDiscoveryError(null);
        try {
            await messaging.discoverAddresses({ walletId });
            setDiscoveryRun((n) => n + 1);
        } catch (err) {
            setDiscoveryError(err?.message || String(err));
        } finally {
            setDiscoveryStarting(false);
        }
    }
    const demoExpiry = isDemo ? getDemoWalletExpiry() : null;
    const currentWalletLoad = walletLoad.walletId === walletId ? walletLoad : null;
    const wallet = currentWalletLoad?.wallet || null;
    const error = currentWalletLoad?.error || null;
    const accountCount = accountLoad.walletId === walletId ? accountLoad.count : null;

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
            setExitConfirmOpen(false);
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
            setWalletLoad({
                walletId,
                wallet: null,
                error: 'messaging.listWallets is not available in this shell.',
            });
            return undefined;
        }
        Promise.resolve()
            .then(() => messaging.listWallets())
            .then((list) => {
                if (cancelled) return;
                const found = Array.isArray(list) ? list.find((w) => w.id === walletId) : null;
                setWalletLoad({
                    walletId,
                    wallet: found || null,
                    error: found ? null : 'Wallet not found.',
                });
            })
            .catch((err) => {
                if (!cancelled) {
                    setWalletLoad({
                        walletId,
                        wallet: null,
                        error: err?.message || 'Failed to load wallet.',
                    });
                }
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    useEffect(() => {
        let cancelled = false;
        if (typeof messaging.listAccounts !== 'function') return undefined;
        Promise.resolve()
            .then(() => messaging.listAccounts(walletId))
            .then((list) => {
                if (cancelled) return;
                setAccountLoad({ walletId, count: Array.isArray(list) ? list.length : 0 });
            })
            .catch(() => { if (!cancelled) setAccountLoad({ walletId, count: 0 }); });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    const header = (
        <PageHeader onBack={onBack} backDisabled={exitBusy} title={t('walletDetails.title')} />
    );

    if (error) {
        return (
            <Screen variant={variant} header={header}>
                <ListPage>
                    <StatusMessage variant="error" className={styles.entryDescription}>{error}</StatusMessage>
                </ListPage>
            </Screen>
        );
    }
    if (!wallet) {
        return (
            <Screen variant={variant} header={header}>
                <ListPage>
                    <div className={styles.entryDescription}>{t('common.loading')}</div>
                </ListPage>
            </Screen>
        );
    }

    const formatLabel = wallet.format === 'counterwallet-legacy' ? 'FreeWallet (Counterwallet legacy)' : 'BIP39';
    const originLabel = walletOriginLabel(wallet.origin);
    const created = wallet.createdAt ? new Date(wallet.createdAt) : null;
    const createdLabel = created && !Number.isNaN(created.getTime())
        ? created.toLocaleString()
        : 'N/A';

    const canCheckAddresses = !isDemo
        && wallet.origin !== 'demo'
        && wallet.format !== 'wif-only'
        && typeof messaging.discoverAddresses === 'function';

    const isActive = madeActive || wallet.id === activeWalletId;
    const walletModeText = walletModeLabel(wallet.walletMode);
    const typeShort = wallet.format === 'counterwallet-legacy' ? 'Legacy' : wallet.format === 'wif-only' ? 'Imported key' : 'BIP39';
    const accountsText = accountCount === null ? '…' : `${accountCount} ${accountCount === 1 ? 'account' : 'accounts'}`;
    const actionRow = (key, label, IconC, onClick, extra = {}) => (
        <li key={key}>
            <ListRow
                type="button"
                onClick={onClick}
                disabled={exitBusy || extra.disabled}
                leading={<span className={listStyles.rowIcon} aria-hidden="true" style={extra.danger ? { color: 'var(--xc-danger)' } : undefined}><IconC /></span>}
                title={extra.danger ? <span style={{ color: 'var(--xc-danger)' }}>{label}</span> : label}
                chevron
            />
        </li>
    );
    const toSettings = () => (typeof onOpenSettings === 'function' ? onOpenSettings() : undefined);

    return (
        <Screen variant={variant} header={header}>
            {/* 8px between every block on this page. */}
            <ListPage style={{ '--xc-section-gap': 'var(--xc-space-2)', gap: 'var(--xc-space-2)' }}>
                {discoveryError ? <StatusMessage variant="error">{discoveryError}</StatusMessage> : null}
                {discoveryRun > 0 ? <AddressDiscoveryNotice key={discoveryRun} /> : null}
                {/* The identity card is three lines: name; type and
                    accounts; Active or Not active. */}
                <div className={listStyles.list} style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-start', textAlign: 'start', gap: 'var(--xc-space-3)', alignItems: 'center', padding: 'var(--xc-space-3)' }}>
                    <span aria-hidden="true" style={{ '--xc-avatar-shape': tileRadius(readWalletTile(wallet.id).shape), display: 'inline-flex' }}><IdentityAvatar name={wallet.name || 'Wallet'} text={walletTileText(wallet.name)} seed={wallet.id} context="list" variant="asset" tone={readWalletTile(wallet.id).colour} src={readWalletTile(wallet.id).image || null} /></span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                        <strong style={{ fontSize: 'var(--xc-text-md, 1rem)', overflowWrap: 'anywhere' }}>{wallet.name || t('walletPicker.unnamed')}</strong>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--xc-space-2)', flexWrap: 'wrap', color: 'var(--xc-text-muted)', fontSize: 'var(--xc-text-sm)' }}>
                            <span>{typeShort} · {accountsText}</span>
                            {isActive ? (
                                <span style={{
                                    fontSize: 'var(--xc-text-xs)',
                                    fontWeight: 700,
                                    padding: '1px 8px',
                                    borderRadius: '999px',
                                    background: 'var(--xc-success-bg, #e3f6ea)',
                                    color: 'var(--xc-success, green)',
                                }}>
                                    {t('settings.developer.active')}
                                </span>
                            ) : null}
                        </span>
                    </div>
                </div>
                <Tabs
                    items={[
                        { id: 'actions', label: (<span className={homeTabsStyles.tabWithIcon}><span className={homeTabsStyles.tabIcon} aria-hidden="true"><Icon.ZapIcon /></span>{t('routes.manageToken.actions')}</span>) },
                        { id: 'details', label: (<span className={homeTabsStyles.tabWithIcon}><span className={homeTabsStyles.tabIcon} aria-hidden="true"><Icon.InfoIcon /></span>{t('components.reachabilityLine.details')}</span>) },
                    ]}
                    value={tab}
                    onChange={setTab}
                />
                {tab === 'actions' ? (
                    <>
                        {/* Safari needs an explicit list role because this class removes list styling. */}
                        <ul className={listStyles.list} role="list" aria-label={t('walletDetails.actionsList')}>
                            {!isActive && typeof onMakeActive === 'function'
                                ? actionRow('active', 'Set as active wallet', Icon.CheckIcon, () => { onMakeActive(wallet); setMadeActive(true); })
                                : null}
                            {onRename ? actionRow('rename', t('renameWallet.title'), Icon.PencilIcon, () => onRename(wallet)) : null}
                            {wallet.format !== 'wif-only' ? actionRow('phrase', 'Show recovery phrase', Icon.KeyIcon, () => (typeof onShowRecoveryPhrase === 'function' ? onShowRecoveryPhrase(wallet) : toSettings())) : null}
                            {actionRow('backup', t('walletDetails.exportBackupAction'), Icon.DownloadIcon || Icon.CopyIcon, () => (typeof onExportBackup === 'function' ? onExportBackup(wallet) : toSettings()))}
                            {canCheckAddresses ? actionRow('discover', t('addressDiscovery.action'), Icon.SearchIcon, handleCheckAddresses, { disabled: discoveryStarting }) : null}
                            {wallet.format === 'counterwallet-legacy' && onMigrateToBip39
                                ? actionRow('migrate', pendingMigrationSweeps(wallet.id) ? t('walletDetails.continueMigration') : t('walletDetails.upgradeRecovery'), Icon.MigrateIcon, onMigrateToBip39)
                                : null}
                        </ul>
                        {/* Safari needs an explicit list role because this class removes list styling. */}
                        <ul className={listStyles.list} role="list" aria-label={t('send.recipient.remove')}>
                            {isDemo
                                ? actionRow('exit-demo', t('walletDetails.exitDemo'), Icon.TrashIcon, () => { setExitError(null); setExitConfirmOpen(true); }, { danger: true })
                                : actionRow('remove', 'Remove wallet', Icon.TrashIcon, () => (typeof onRemoveWallet === 'function' ? onRemoveWallet(wallet) : toSettings()), { danger: true })}
                        </ul>
                        {exitError && !exitConfirmOpen ? <StatusMessage variant="error">{exitError}</StatusMessage> : null}
                        {exitConfirmOpen ? (
                            <DemoExitConfirm
                                busy={exitBusy}
                                error={exitError}
                                onConfirm={handleExitDemo}
                                onCancel={() => { setExitConfirmOpen(false); setExitError(null); }}
                            />
                        ) : null}
                    </>
                ) : (
                    <dl className={pickerStyles.detailList}>
                        <Row label={t('walletDetails.name')} value={wallet.name || t('walletPicker.unnamed')} />
                        <Row label={t('walletDetails.type')} value={formatLabel} />
                        {/* The wallet's own mode (§20), read-only; chosen at create, import or pair. */}
                        <Row label={t('walletDetails.walletMode')} value={walletModeText} />
                        <Row label={t('walletDetails.origin')} value={originLabel} />
                        <Row
                            label={t('walletDetails.passphrase')}
                            value={!wallet.passphraseEnabled
                                ? 'Disabled'
                                : wallet.passphraseStored
                                    ? 'Stored'
                                    : 'Needs its passphrase once. Lock the wallet; the unlock screen will ask for it.'}
                        />
                        <Row label={t('accountPicker.title')} value={accountCount === null ? '…' : String(accountCount)} />
                        <Row label={t('walletDetails.created')} value={createdLabel} />
                        {isDemo ? (
                            <Row
                                label={t('history.filters.statusHeader')}
                                value={<span>{t('walletDetails.demoWallet')}{formatDemoExpiry(demoExpiry) ? ` · ${formatDemoExpiry(demoExpiry)}` : ''}</span>}
                            />
                        ) : null}
                        <Row label={t('walletDetails.id')} value={<code className={pickerStyles.code}>{wallet.id}</code>} />
                    </dl>
                )}
            </ListPage>
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

// The wallet tile's name, spelled so the tile always shows two
// initials (a one-word name gives its first two letters).
function tileName(name) {
    const clean = String(name || 'Wallet').trim() || 'Wallet';
    const words = clean.split(/\s+/);
    return words.length > 1 ? clean : `${clean[0]} ${clean[1] || ''}`.trim();
}
