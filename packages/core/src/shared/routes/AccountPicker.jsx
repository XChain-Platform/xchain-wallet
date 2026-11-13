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
import { Button, EmptyState, Icon, ListPage, ListRow, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
// The My Wallets list card and wallet-style tiles.
import listStyles from './CoSignerAccountList.module.css';
import { IdentityAvatar } from '../components/WalletIdentity.jsx';
import { readWalletTile, tileRadius, walletTileText } from '../utils/walletTile.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/accountPicker.js';
import '../../i18n/locales/en/settings.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import styles from './ActionsMenu.module.css';
import pickerStyles from './WalletPicker.module.css';

function runRouteAction(action, ...args) {
    const result = action?.(...args);
    if (result && typeof result.catch === 'function') result.catch(() => {});
}

/**
 * AccountPicker: full-screen list of BIP44 accounts under the active
 * wallet, with thumb-reachable add and current-account management
 * actions directly under the list, as on the Wallets screen. Reached from
 * the gear popover's Account summary row. Picking an account calls
 * `onSwitch` and returns to home.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string | null} props.activeAccountId
 * @param {(accountId: string) => void} props.onSwitch
 * @param {() => void} props.onAddAccount
 * @param {(account: any) => void} [props.onRenameAccount]
 * @param {() => void} props.onBack
 * @param {string} [props.backLabel]
 */
export function AccountPicker({ walletId, activeAccountId, onSwitch, onAddAccount, onRenameAccount, onBack, backLabel, onShowDetails }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const [accounts, setAccounts] = useState(/** @type {any[] | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [reload, setReload] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setAccounts(null);
        setError(null);
        if (typeof messaging.listAccounts !== 'function') {
            setError(t('accountPicker.error.load'));
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
            .catch((err) => {
                if (!cancelled) setError(userFacingMessage(err, t('accountPicker.error.load')));
            });
        return () => { cancelled = true; };
    }, [walletId, messaging, reload]);

    // My Accounts, laid out like My Wallets.
    const header = (
        <PageHeader
            onBack={onBack}
            backLabel={backLabel}
            title={t('accountPicker.pageTitle')}
            trailing={(
                <Button variant="ghost" size="sm" icon={<Icon.PlusIcon />} onClick={() => onAddAccount?.()} aria-label={t('accountPicker.add')} title={t('accountPicker.add')} />
            )}
        />
    );
    return (
        <Screen variant={variant} header={header}>
            <ListPage>
                {error ? (
                    <StatusMessage
                        variant="error"
                        className={styles.entryDescription}
                        recovery={{ label: t('common.tryAgain'), onAction: () => setReload((value) => value + 1) }}
                    >
                        {error}
                    </StatusMessage>
                ) : null}
                {accounts === null && !error ? (
                    <div
                        role="status"
                        aria-label={t('accountPicker.loadingLabel')}
                        aria-busy="true"
                        className={styles.entryDescription}
                    >
                        {t('accountPicker.loading')}
                    </div>
                ) : null}
                {accounts && accounts.length === 0 ? <EmptyState title={t('accountPicker.empty.title')} body={t('accountPicker.empty.addBody')} /> : null}
                {accounts && accounts.length ? (
                    /* Safari needs an explicit list role because this class removes list styling. */
                    <ul className={listStyles.list} role="list" aria-label={t('accountPicker.pageTitle')}>
                        {accounts.map((a) => {
                            const active = a.id === activeAccountId;
                            const numbered = t('accountPicker.defaultName', { number: (a.index ?? 0) + 1 });
                            const customName = typeof a.name === 'string' ? a.name.trim() : '';
                            const name = customName || numbered;
                            const tile = readWalletTile(a.id);
                            // The numbered name stays under a custom one so a renamed
                            // account is still findable; it is not repeated under itself.
                            const showNumbered = name !== numbered;
                            return (
                                <li key={a.id}>
                                    <ListRow
                                        type="button"
                                        onClick={() => {
                                            if (onShowDetails) {
                                                onShowDetails(a);
                                                return;
                                            }
                                            // Picking another account switches to it and
                                            // returns; the current account's row does nothing.
                                            if (active) return;
                                            runRouteAction(onSwitch, a.id);
                                            runRouteAction(onBack);
                                        }}
                                        aria-current={active ? 'true' : undefined}
                                        leading={<span aria-hidden="true" style={{ '--xc-avatar-shape': tileRadius(tile.shape), display: 'inline-flex' }}><IdentityAvatar name={name} text={walletTileText(name)} seed={a.id} context="list" variant="asset" tone={tile.colour} src={tile.image || null} /></span>}
                                        title={name}
                                        tooltip={name}
                                        chevron
                                        subtitle={showNumbered || active ? (
                                            <span className={pickerStyles.rowMeta}>
                                                {showNumbered ? <span>{numbered}</span> : null}
                                                {active ? <span className={pickerStyles.activeBadge}>{t('settings.developer.active')}</span> : null}
                                            </span>
                                        ) : null}
                                    />
                                </li>
                            );
                        })}
                    </ul>
                ) : null}
            </ListPage>
        </Screen>
    );
}
