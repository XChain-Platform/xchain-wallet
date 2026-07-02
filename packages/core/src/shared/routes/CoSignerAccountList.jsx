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
    StatusMessage,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './IssueTokenForm.module.css';

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
    const isFull = variant === 'full';

    const [accounts, setAccounts] = useState(/** @type {any[] | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        messaging.listCoSignerAccounts({ walletId })
            .then((list) => { if (!cancelled) setAccounts(Array.isArray(list) ? list : []); })
            .catch((err) => { if (!cancelled) setError(err?.message || 'Failed to load agent accounts.'); });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    const header = <PageHeader onBack={onBack} title="Agent accounts" />;
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (error) return wrap(<StatusMessage variant="error">{error}</StatusMessage>);
    if (!accounts) return wrap(<p className={styles.hint}>Loading…</p>);

    return wrap(
        <>
            <p className={styles.hint} style={{ textAlign: 'left' }}>
                Agent accounts let an automated agent share a 2-of-2 address with
                this wallet. This wallet signs each request automatically when it
                fits the policy you set, and asks you to approve it. Bitcoin-only
                at launch.
            </p>

            <div className={styles.actions} style={{ marginBottom: 'var(--xc-space-3)' }}>
                <Button variant="primary" onClick={onProvision}>New agent account</Button>
            </div>

            {accounts.length === 0 ? (
                <p className={styles.hint}>No agent accounts yet.</p>
            ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {accounts.map((a) => {
                        const descriptor = chainRegistry.get(a.chainId);
                        return (
                            <li key={a.id} style={{ marginBottom: 'var(--xc-space-2)' }}>
                                <button
                                    type="button"
                                    onClick={() => onOpen(a.id)}
                                    style={{
                                        display: 'flex',
                                        width: '100%',
                                        gap: 'var(--xc-space-2)',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        padding: 'var(--xc-space-3)',
                                        border: '1px solid var(--xc-border)',
                                        borderRadius: 'var(--xc-radius-md)',
                                        background: 'var(--xc-surface-raised)',
                                        cursor: 'pointer',
                                        textAlign: 'left',
                                    }}
                                >
                                    <span style={{ minWidth: 0 }}>
                                        <strong style={{ display: 'block' }}>{a.name}</strong>
                                        <AddressText address={a.aggregateAddress} truncate />
                                    </span>
                                    <span style={{ display: 'flex', gap: 'var(--xc-space-2)', alignItems: 'center', flexShrink: 0 }}>
                                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : null}
                                        <span style={{
                                            fontSize: '0.8em',
                                            color: a.enabled ? 'var(--xc-success, green)' : 'var(--xc-text-muted)',
                                        }}>
                                            {a.enabled ? 'Active' : 'Disabled'}
                                        </span>
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </>,
    );
}
