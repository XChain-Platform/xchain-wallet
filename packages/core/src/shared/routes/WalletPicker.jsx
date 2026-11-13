// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useRef, useState } from 'react';
import { Button, EmptyState, Icon, ListPage, ListRow, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/walletPicker.js';
import '../../i18n/locales/en/settings.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import styles from './ActionsMenu.module.css';
import pickerStyles from './WalletPicker.module.css';
// The standard list card, shared with Agent accounts.
import listStyles from './CoSignerAccountList.module.css';
import { IdentityAvatar } from '../components/WalletIdentity.jsx';
import { readWalletTile, tileRadius, walletTileText } from '../utils/walletTile.js';

/**
 * WalletPicker: full-screen list of all wallets in the vault, with
 * thumb-reachable add and current-wallet management actions directly
 * under the list. Reached from the gear popover's Wallet summary row. Picking
 * a wallet calls `onSwitch`
 * and returns to the screen that opened the picker.
 *
 * Each row also carries an info (ⓘ) button on the right; clicking it
 * navigates to WalletDetails (where the Rename affordance also lives).
 *
 * @param {object} props
 * @param {string | null} props.activeWalletId
 * @param {(walletId: string) => void | Promise<void>} props.onSwitch
 * @param {() => void} props.onAddWallet
 * @param {(walletId: string) => void} [props.onShowDetails]
 * @param {() => void} props.onBack
 */
export function WalletPicker({
    activeWalletId,
    onSwitch,
    onAddWallet,
    onShowDetails,
    onBack,
}) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const [wallets, setWallets] = useState(/** @type {any[] | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [switchingWalletId, setSwitchingWalletId] = useState(/** @type {string | null} */ (null));
    const [switchError, setSwitchError] = useState(/** @type {string | null} */ (null));
    const switchingRef = useRef(false);

    useEffect(() => {
        let cancelled = false;
        if (typeof messaging.listWallets !== 'function') {
            setError('messaging.listWallets is not available in this shell.');
            return undefined;
        }
        Promise.resolve()
            .then(() => messaging.listWallets())
            .then((list) => { if (!cancelled) setWallets(Array.isArray(list) ? list : []); })
            .catch((err) => { if (!cancelled) setError(err?.message || 'Failed to load wallets.'); });
        return () => { cancelled = true; };
    }, [messaging]);

    async function handleSelect(walletId, active) {
        if (switchingRef.current) return;
        if (active) {
            onBack();
            return;
        }
        switchingRef.current = true;
        setSwitchingWalletId(walletId);
        setSwitchError(null);
        try {
            await onSwitch(walletId);
            onBack();
        } catch (err) {
            setSwitchError(userFacingMessage(err, 'Could not switch wallets. Try again.'));
        } finally {
            switchingRef.current = false;
            setSwitchingWalletId(null);
        }
    }

    const switching = switchingWalletId !== null;

    // A plus at the far right of the title line adds a wallet.
    const header = (
        <PageHeader
            onBack={onBack}
            backDisabled={switching}
            title={t('walletPicker.title')}
            trailing={(
                <Button variant="ghost" size="sm" icon={<Icon.PlusIcon />} onClick={onAddWallet} disabled={switching} aria-label={t('walletPicker.add')} title={t('walletPicker.add')} />
            )}
        />
    );
    const activeWallet = wallets?.find((wallet) => wallet.id === activeWalletId) || null;
    const actions = (
        <div className={pickerStyles.pickerActions}>
            <Button
                variant="success"
                onClick={onAddWallet}
                disabled={switching}
                icon={<Icon.PlusIcon />}
            >
                {t('walletPicker.add')}
            </Button>
            {onShowDetails && activeWallet ? (
                <Button
                    variant="ghost"
                    onClick={() => onShowDetails(activeWallet.id)}
                    disabled={switching}
                    icon={<Icon.InfoIcon />}
                >
                    {t('walletPicker.manage')}
                </Button>
            ) : null}
        </div>
    );

    return (
        <Screen variant={variant} header={header}>
            <ListPage>
                {switchError ? (
                    <StatusMessage variant="error" className={styles.entryDescription}>{switchError}</StatusMessage>
                ) : null}
                {error ? (
                    <StatusMessage variant="error" className={styles.entryDescription}>{error}</StatusMessage>
                ) : wallets === null ? (
                    <div className={styles.entryDescription}>{t('common.loading')}</div>
                ) : wallets.length === 0 ? (
                    <EmptyState title={t('walletPicker.emptyTitle')} body={t('walletPicker.emptyBody')} />
                ) : (
                    // One list card; a row opens that wallet's page.
                    /* Safari needs an explicit list role because this class removes list styling. */
                    <ul className={listStyles.list} role="list" aria-label={t('walletPicker.title')}>
                    {wallets.map((w, index) => {
                    const active = w.id === activeWalletId;
                    return (
                        <li key={`${w.id}:${index}`}>
                            <ListRow
                                type="button"
                                onClick={() => (onShowDetails ? onShowDetails(w.id) : handleSelect(w.id, active))}
                                disabled={switching}
                                aria-current={active ? 'true' : undefined}
                                leading={<span aria-hidden="true" style={{ '--xc-avatar-shape': tileRadius(readWalletTile(w.id).shape), display: 'inline-flex' }}><IdentityAvatar name={w.name || 'Wallet'} text={walletTileText(w.name)} seed={w.id} context="list" variant="asset" tone={readWalletTile(w.id).colour} src={readWalletTile(w.id).image || null} /></span>}
                                title={w.name || t('walletPicker.unnamed')}
                                // The full name stays readable when a long one is cut short.
                                tooltip={w.name || undefined}
                                chevron
                                // The wallet row's lines: name; type and accounts
                                // (and, for a legacy record still owed its one-time
                                // passphrase capture, where that happens); Active.
                                subtitle={(
                                    <span className={pickerStyles.rowMeta}>
                                        <span>
                                            {w.origin === 'demo' ? t('walletPicker.demoPrefix') : ''}
                                            {w.format === 'counterwallet-legacy' ? t('walletPicker.legacy') : w.format === 'wif-only' ? t('walletPicker.importedKey') : t('walletPicker.bip39')}
                                            {typeof w.accountCount === 'number' ? ` · ${t('walletPicker.accountCount', { count: w.accountCount })}` : ''}
                                            {/* A stored passphrase unlocks with the wallet password alone, so
                                                only a record not yet captured earns the badge. */}
                                            {w.passphraseEnabled && !w.passphraseStored ? t('walletPicker.passphraseNeeded') : ''}
                                        </span>
                                        {active ? <span className={pickerStyles.activeBadge}>{t('settings.developer.active')}</span> : null}
                                    </span>
                                )}
                            />
                        </li>
                    );
                })}
                    </ul>
                )}
            </ListPage>
        </Screen>
    );
}
