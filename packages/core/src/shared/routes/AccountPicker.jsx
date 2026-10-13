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
import { Button, EmptyState, Icon, ListPage, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { t } from '../../i18n/index.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import styles from './ActionsMenu.module.css';
import pickerStyles from './WalletPicker.module.css';

/**
 * AccountPicker: full-screen list of BIP44 accounts under the active
 * wallet, with thumb-reachable add and current-account management
 * actions. Reached from the gear popover's Account summary row. Picking
 * an account calls `onSwitch`
 * and returns to home.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string | null} props.activeAccountId
 * @param {(accountId: string) => void} props.onSwitch
 * @param {() => void} props.onAddAccount
 * @param {(account: any) => void} [props.onRenameAccount]
 * @param {() => void} props.onBack
 */
export function AccountPicker({ walletId, activeAccountId, onSwitch, onAddAccount, onRenameAccount, onBack }) {
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
            setError(t('accountPicker.error.unavailable'));
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

    const header = <PageHeader onBack={onBack} title={t('accountPicker.title')} />;
    const activeAccount = accounts?.find((account) => account.id === activeAccountId) || null;
    const footer = (
        <div className={pickerStyles.footerActions}>
            <Button variant="primary" onClick={onAddAccount} icon={<Icon.PlusIcon />}>
                {t('accountPicker.add')}
            </Button>
            {onRenameAccount && activeAccount ? (
                <Button
                    variant="ghost"
                    onClick={() => onRenameAccount(activeAccount)}
                    icon={<Icon.PencilIcon />}
                >
                    {t('accountPicker.manage')}
                </Button>
            ) : null}
        </div>
    );

    return (
        <Screen variant={variant} header={header} footer={footer}>
            <ListPage>
                {error ? (
                    <StatusMessage
                        variant="error"
                        className={styles.entryDescription}
                        recovery={{ label: t('common.tryAgain'), onAction: () => setReload((value) => value + 1) }}
                    >
                        {error}
                    </StatusMessage>
                ) : accounts === null ? (
                    <div
                        role="status"
                        aria-label={t('accountPicker.loadingLabel')}
                        aria-busy="true"
                        className={styles.entryDescription}
                    >
                        {t('accountPicker.loading')}
                    </div>
                ) : accounts.length === 0 ? (
                    <EmptyState
                        title={t('accountPicker.empty.title')}
                        body={t('accountPicker.empty.body')}
                        titleAs="p"
                    />
                ) : accounts.map((a) => {
                    const active = a.id === activeAccountId;
                    const defaultName = t('accountPicker.defaultName', { number: a.index + 1 });
                    const label = a.name || defaultName;
                    // Keep the numbered name visible under a custom one, so a renamed account stays findable.
                    const customName = typeof a.name === 'string' ? a.name.trim() : '';
                    const subtitle = customName && customName !== defaultName ? defaultName : null;
                    return (
                        <div key={a.id} className={pickerStyles.rowWrap}>
                            <button
                                type="button"
                                className={`${styles.entry} ${active ? pickerStyles.rowCurrent : ''}`}
                                style={{ width: '100%', paddingRight: '56px' }}
                                onClick={() => {
                                    if (!active) onSwitch(a.id);
                                    onBack();
                                }}
                                aria-current={active ? 'true' : undefined}
                            >
                                <span className={`${styles.entryText} ${pickerStyles.rowText}`}>
                                    <span className={`${styles.entryLabel} ${pickerStyles.rowLabel}`}>
                                        {active ? (
                                            <span className={pickerStyles.currentMark} aria-hidden="true">
                                                <Icon.CheckIcon />
                                            </span>
                                        ) : null}
                                        <span className={pickerStyles.rowName} title={label}>{label}</span>
                                    </span>
                                    {subtitle ? (
                                        <span className={styles.entryDescription}>{subtitle}</span>
                                    ) : null}
                                </span>
                            </button>
                            {onRenameAccount ? (
                                <button
                                    type="button"
                                    className={pickerStyles.rowMenuBtn}
                                    aria-label={t('accountPicker.renameLabel', { label })}
                                    title={t('accountPicker.renameTitle')}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onRenameAccount(a);
                                    }}
                                >
                                    <Icon.PencilIcon />
                                </button>
                            ) : null}
                        </div>
                    );
                })}
            </ListPage>
        </Screen>
    );
}
