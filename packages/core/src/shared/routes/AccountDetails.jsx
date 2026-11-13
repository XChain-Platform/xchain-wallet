// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Account Details, opened from a My Accounts row and laid out like Wallet Details:
// the account card (tile, name, "Account N", Active bubble) and Actions | Details tabs.
// Set as active account comes first (absent when active), then Edit account.

import { useEffect, useState } from 'react';
import { Icon, ListPage, ListRow, PageHeader, Screen, StatusMessage, Tabs } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { IdentityAvatar } from '../components/WalletIdentity.jsx';
import { readWalletTile, tileRadius, walletTileText } from '../utils/walletTile.js';
import listStyles from './CoSignerAccountList.module.css';
import homeTabsStyles from '../components/HomeTabs.module.css';

export function AccountDetails({ walletId, accountId, activeAccountId, onBack, onMakeActive, onRename, onExtendedKeys }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const [account, setAccount] = useState(/** @type {any} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [tab, setTab] = useState('actions');
    const [madeActive, setMadeActive] = useState(false);
    useEffect(() => {
        let cancelled = false;
        Promise.resolve(messaging.listAccounts(walletId))
            .then((list) => { if (!cancelled) setAccount((Array.isArray(list) ? list : []).find((a) => a.id === accountId) || null); })
            .catch((err) => { if (!cancelled) setError(err?.message || 'Could not load the account.'); });
        return () => { cancelled = true; };
    }, [messaging, walletId, accountId]);
    const header = <PageHeader onBack={onBack} title="Account Details" />;
    if (error) return <Screen variant={variant} header={header}><ListPage><StatusMessage variant="error">{error}</StatusMessage></ListPage></Screen>;
    if (!account) return <Screen variant={variant} header={header}><ListPage><div>Loading…</div></ListPage></Screen>;
    const name = account.name || `Account ${(account.index ?? 0) + 1}`;
    const isActive = madeActive || account.id === activeAccountId;
    const tile = readWalletTile(account.id);
    const row = (key, label, IconC, onClick) => (
        <li key={key}>
            <ListRow type="button" onClick={onClick} leading={<span className={listStyles.rowIcon} aria-hidden="true"><IconC /></span>} title={label} chevron />
        </li>
    );
    return (
        <Screen variant={variant} header={header}>
            <ListPage style={{ '--xc-section-gap': 'var(--xc-space-2)', gap: 'var(--xc-space-2)' }}>
                <div className={listStyles.list} style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-start', textAlign: 'start', gap: 'var(--xc-space-3)', alignItems: 'center', padding: 'var(--xc-space-3)' }}>
                    <span aria-hidden="true" style={{ '--xc-avatar-shape': tileRadius(tile.shape), display: 'inline-flex' }}><IdentityAvatar name={name} text={walletTileText(name)} seed={account.id} context="list" variant="asset" tone={tile.colour} src={tile.image || null} /></span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                        <strong style={{ overflowWrap: 'anywhere' }}>{name}</strong>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--xc-space-2)', flexWrap: 'wrap', color: 'var(--xc-text-muted)', fontSize: 'var(--xc-text-sm)' }}>
                            <span>Account {(account.index ?? 0) + 1}</span>
                            {isActive ? <span style={{ fontSize: 'var(--xc-text-xs)', fontWeight: 700, padding: '1px 8px', borderRadius: '999px', background: 'var(--xc-success-bg, #e3f6ea)', color: 'var(--xc-success, green)' }}>Active</span> : null}
                        </span>
                    </div>
                </div>
                <Tabs
                    items={[
                        { id: 'actions', label: (<span className={homeTabsStyles.tabWithIcon}><span className={homeTabsStyles.tabIcon} aria-hidden="true"><Icon.ZapIcon /></span>Actions</span>) },
                        { id: 'details', label: (<span className={homeTabsStyles.tabWithIcon}><span className={homeTabsStyles.tabIcon} aria-hidden="true"><Icon.InfoIcon /></span>Details</span>) },
                    ]}
                    value={tab}
                    onChange={setTab}
                />
                {tab === 'actions' ? (
                    /* Safari needs an explicit list role because this class removes list styling. */
                    <ul className={listStyles.list} role="list" aria-label="Account actions">
                        {!isActive && typeof onMakeActive === 'function'
                            ? row('active', 'Set as active account', Icon.CheckIcon, () => { onMakeActive(account); setMadeActive(true); })
                            : null}
                        {typeof onRename === 'function' ? row('edit', 'Edit account', Icon.PencilIcon, () => onRename(account)) : null}
                        {isActive && typeof onExtendedKeys === 'function' ? row('xpub', 'Extended public keys', Icon.KeyIcon, () => onExtendedKeys(account)) : null}
                    </ul>
                ) : (
                    /* Safari needs an explicit list role because this class removes list styling. */
                    <ul className={listStyles.list} role="list" aria-label="Account details">
                        {[['Name', name], ['Account number', String((account.index ?? 0) + 1)], ['Status', isActive ? 'Active' : 'Not active']].map(([k, v]) => (
                            <li key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: 'var(--xc-space-2) var(--xc-space-3)' }}>
                                <span style={{ color: 'var(--xc-text-muted)' }}>{k}</span><span>{v}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </ListPage>
        </Screen>
    );
}
