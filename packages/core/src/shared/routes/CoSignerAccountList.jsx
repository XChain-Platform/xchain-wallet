// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// CoSignerAccountList (§22, P4 passive co-signer, management UI).
//
// Lists the agent accounts this wallet co-signs for, newest first. Entry
// point to create a new account (the provision wizard) or open one for
// detail / policy edit / enable-disable.

import { useEffect, useState } from 'react';
import {
    Screen,
    PageHeader,
    Button,
    ChainBadge,
    AddressText,
    EmptyState,
    Icon,
    ListPage,
    ListRow,
    StatusMessage,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './IssueTokenForm.module.css';
import listStyles from './CoSignerAccountList.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 * @param {() => void} props.onProvision              open the new-account wizard
 * @param {(accountId: string) => void} props.onOpen  open an account's detail
 */
export function CoSignerAccountList({ walletId, onBack, onProvision, onOpen }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const [accounts, setAccounts] = useState(/** @type {any[] | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        setAccounts(null);
        setError(null);
        Promise.resolve()
            .then(() => messaging.listCoSignerAccounts({ walletId }))
            .then((list) => { if (!cancelled) setAccounts(Array.isArray(list) ? list : []); })
            .catch((err) => { if (!cancelled) setError(err?.message || 'Failed to load agent accounts.'); });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    const header = <PageHeader onBack={onBack} title="Agent accounts" />;
    const wrap = (children) => (
        <Screen variant={variant} header={header}>{children}</Screen>
    );

    if (error) return wrap(<ListPage><StatusMessage variant="error">{error}</StatusMessage></ListPage>);
    if (!accounts) return wrap(<ListPage><p className={styles.hint}>Loading…</p></ListPage>);

    return wrap(
        <ListPage
            // The screen's one green main action, in the empty and the filled
            // state alike (U63); the shared EmptyState would draw a blue one.
            toolbar={<Button variant="success" icon={<Icon.PlusIcon />} onClick={onProvision}>New agent account</Button>}
        >
            {accounts.length === 0 ? (
                <EmptyState
                    title="No agent accounts yet"
                    body="Create one to let an agent share a 2-of-2 address with this wallet."
                />
            ) : (
                // One flush list card with divider lines, rows never boxed apart (U41, U58).
                /* Safari needs an explicit list role because this class removes list styling. */
                <ul aria-label="Agent accounts" className={listStyles.list} role="list">
                    {accounts.map((a) => {
                        const descriptor = chainRegistry.get(a.chainId);
                        return (
                            <li key={a.id}>
                                <ListRow
                                    type="button"
                                    onClick={() => onOpen(a.id)}
                                    leading={<span className={listStyles.rowIcon} aria-hidden="true"><Icon.UsersIcon /></span>}
                                    title={a.name}
                                    subtitle={<AddressText address={a.aggregateAddress} truncate />}
                                    trailing={(
                                        <span style={{ display: 'flex', gap: 'var(--xc-space-2)', alignItems: 'center', flexShrink: 0 }}>
                                            {descriptor ? <ChainBadge descriptor={descriptor} size="sm" showName={false} /> : null}
                                            <span style={{
                                                fontSize: '0.8em',
                                                color: a.enabled ? 'var(--xc-success, green)' : 'var(--xc-text-muted)',
                                            }}>
                                                {a.enabled ? 'Active' : 'Disabled'}
                                            </span>
                                        </span>
                                    )}
                                />
                            </li>
                        );
                    })}
                </ul>
            )}
        </ListPage>,
    );
}
