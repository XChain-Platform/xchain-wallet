// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, EmptyState, Icon, ListPage, ListRow, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { ListFilterMenu } from '../components/ListFilterMenu.jsx';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/walletPicker.js';
import '../../i18n/locales/en/settings.js';
import '../../i18n/locales/en/walletDetails.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import styles from './ActionsMenu.module.css';
import pickerStyles from './WalletPicker.module.css';
// The standard list card, shared with Agent accounts.
import listStyles from './CoSignerAccountList.module.css';
import { IdentityAvatar } from '../components/WalletIdentity.jsx';
import { readWalletTile, tileRadius, walletTileText } from '../utils/walletTile.js';

/**
 * The wallet's kind on its My Wallets row: Hardware wallet, Legacy, Imported
 * key or BIP39. A hardware wallet has no phrase, so it never reads as BIP39;
 * its word is the one Wallet Details uses for a connected hardware wallet.
 * @param {{ format?: string } | null | undefined} wallet
 * @returns {string}
 */
export function walletKindLabel(wallet) {
    if (wallet?.format === 'hardware') return t('walletDetails.originLabel.connectedHardware');
    if (wallet?.format === 'counterwallet-legacy') return t('walletPicker.legacy');
    if (wallet?.format === 'wif-only') return t('walletPicker.importedKey');
    return t('walletPicker.bip39');
}

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

    const [query, setQuery] = useState('');
    const needle = query.trim().toLowerCase();
    // The wallet records carry no addresses, so addresses are read only once a
    // search is first typed: one host read answers for every wallet, kept for
    // the rest of the visit, never per keystroke and never per wallet.
    const [addressesByWallet, setAddressesByWallet] = useState(/** @type {Map<string, string>} */ (new Map()));
    const addressReadStarted = useRef(false);
    useEffect(() => {
        if (needle === '' || !wallets || addressReadStarted.current) return undefined;
        if (typeof messaging.getAddressesByWallet !== 'function') return undefined;
        addressReadStarted.current = true;
        Promise.resolve()
            .then(() => messaging.getAddressesByWallet())
            .then((byWallet) => {
                const pairs = Object.entries(byWallet && typeof byWallet === 'object' ? byWallet : {})
                    .map(([walletId, list]) => [
                        walletId,
                        (Array.isArray(list) ? list : []).map((address) => String(address || '').toLowerCase()).filter(Boolean).join('\n'),
                    ]);
                setAddressesByWallet(new Map(pairs));
            })
            .catch(() => {});
        return undefined;
    }, [needle, wallets, messaging]);

    const visibleWallets = useMemo(() => {
        if (!wallets || needle === '') return wallets;
        return wallets.filter((w) => {
            const hay = `${w.name || ''}\n${walletKindLabel(w)}\n${addressesByWallet.get(w.id) || ''}`.toLowerCase();
            return hay.includes(needle);
        });
    }, [wallets, needle, addressesByWallet]);

    // The filter and a plus sit at the far right of the title line; the plus adds a wallet.
    const header = (
        <PageHeader
            onBack={onBack}
            backDisabled={switching}
            title={t('walletPicker.title')}
            trailing={(
                <>
                    <ListFilterMenu
                        query={query}
                        onQueryChange={setQuery}
                        searchPlaceholder={t('routes.addressList.search')}
                        searchLabel={t('walletPicker.searchLabel')}
                        label={t('walletPicker.filter')}
                    />
                    <Button variant="ghost" size="sm" icon={<Icon.PlusIcon />} onClick={onAddWallet} disabled={switching} aria-label={t('walletPicker.add')} title={t('walletPicker.add')} />
                </>
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
                ) : visibleWallets.length === 0 ? (
                    <EmptyState title={t('walletPicker.noMatchTitle')} body={t('walletPicker.noMatchBody')} />
                ) : (
                    // One list card; a row opens that wallet's page.
                    /* Safari needs an explicit list role because this class removes list styling. */
                    <ul className={listStyles.list} role="list" aria-label={t('walletPicker.title')}>
                    {visibleWallets.map((w, index) => {
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
                                            {walletKindLabel(w)}
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
