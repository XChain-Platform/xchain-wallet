// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// CoSignerAccountDetail (§22, P4 passive co-signer, management UI).
//
// Shows one agent account: the aggregate address to fund, its policy, the
// current rolling-window usage, and an enable/disable toggle. Editing the
// policy reuses CoSignerPolicyEditor (the same authoring surface as the
// provision wizard), so there is one place that knows the policy shape.
//
// A disabled account is refused by the daemon and treated as unknown by the
// bridge resolver, so the toggle is the safe kill-switch.

import { useEffect, useMemo, useState } from 'react';
import {
    Screen,
    PageHeader,
    Button,
    Input,
    ChainBadge,
    AddressText,
    CopyButton,
    StatusMessage,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import {
    CoSignerPolicyEditor,
    draftFromAccount,
    buildPolicyDraft,
} from './CoSignerPolicyEditor.jsx';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * @param {object} props
 * @param {string} props.accountId
 * @param {() => void} props.onBack
 */
export function CoSignerAccountDetail({ accountId, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [account, setAccount] = useState(/** @type {any | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [busy, setBusy] = useState(false);

    const [editing, setEditing] = useState(false);
    const [name, setName] = useState('');
    const [policyDraft, setPolicyDraft] = useState(null);
    const [editError, setEditError] = useState(/** @type {string | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        messaging.getCoSignerAccount({ id: accountId })
            .then((a) => {
                if (cancelled) return;
                if (!a) { setError('Agent account not found.'); return; }
                setAccount(a);
            })
            .catch((err) => { if (!cancelled) setError(err?.message || 'Failed to load the agent account.'); });
        return () => { cancelled = true; };
    }, [accountId, messaging]);

    async function toggleEnabled() {
        if (!account) return;
        setBusy(true);
        setError(null);
        try {
            const updated = await messaging.updateCoSignerAccount({
                id: account.id,
                patch: { enabled: !account.enabled },
            });
            setAccount(updated);
        } catch (err) {
            setError(err?.message || 'Failed to update the agent account.');
        } finally {
            setBusy(false);
        }
    }

    function startEdit() {
        setName(account.name);
        setPolicyDraft(draftFromAccount(account));
        setEditError(null);
        setEditing(true);
    }

    async function saveEdit() {
        const built = buildPolicyDraft(policyDraft);
        if (built.error) { setEditError(built.error); return; }
        setBusy(true);
        setEditError(null);
        try {
            const updated = await messaging.updateCoSignerAccount({
                id: account.id,
                patch: {
                    name: name.trim() || account.name,
                    policy: built.policy,
                    allowedOutputs: built.allowedOutputs,
                },
            });
            setAccount(updated);
            setEditing(false);
        } catch (err) {
            setEditError(err?.message || 'Failed to save changes.');
        } finally {
            setBusy(false);
        }
    }

    const windowCount = useMemo(() => {
        const entries = account?.window?.entries;
        return Array.isArray(entries) ? entries.length : 0;
    }, [account]);

    const header = <PageHeader onBack={onBack} title="Agent account" />;
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (error && !account) return wrap(<StatusMessage variant="error">{error}</StatusMessage>);
    if (!account) return wrap(<p className={styles.hint}>Loading…</p>);

    if (editing) {
        return wrap(
            <>
                <p className={styles.hint} style={{ textAlign: 'left' }}>
                    Editing the policy changes only the rules; the account's address
                    and keys stay the same.
                </p>
                <Input label="Account name" value={name} onChange={(e) => setName(e.target.value)} />
                <CoSignerPolicyEditor value={policyDraft} onChange={setPolicyDraft} />
                {editError ? <StatusMessage variant="error">{editError}</StatusMessage> : null}
                <div className={styles.actions}>
                    <Button variant="primary" onClick={saveEdit} loading={busy} disabled={busy}>Save changes</Button>
                    <Button variant="secondary" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
                </div>
            </>,
        );
    }

    const descriptor = chainRegistry.get(account.chainId);
    const p = account.policy || {};

    return wrap(
        <>
            <p className={styles.successTitle}>{account.name}</p>
            <p className={styles.hint} style={{ textAlign: 'left' }}>
                {account.enabled
                    ? 'This account is active. Requests that fit the policy are signed after your approval.'
                    : 'This account is disabled. Every request is refused until you re-enable it.'}
            </p>

            <dl className={styles.detailsList}>
                <dt className={styles.detailsLabel}>Network</dt>
                <dd className={styles.detailsValue}>
                    {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : account.chainId}
                </dd>
                <dt className={styles.detailsLabel}>Fund this address</dt>
                <dd className={styles.detailsValue} style={{ display: 'flex', gap: 'var(--xc-space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                    <AddressText address={account.aggregateAddress} />
                    <CopyButton value={account.aggregateAddress || ''} label="Copy" />
                </dd>
                <dt className={styles.detailsLabel}>Allowed actions</dt>
                <dd className={styles.detailsValue}>{(p.allowedActions || []).join(', ') || 'none'}</dd>
                <dt className={styles.detailsLabel}>Allowed recipients</dt>
                <dd className={styles.detailsValue}>
                    {Array.isArray(p.allowedDestinations) && p.allowedDestinations.length > 0
                        ? `${p.allowedDestinations.length} address(es)`
                        : 'Any'}
                </dd>
                <dt className={styles.detailsLabel}>Rolling limit</dt>
                <dd className={styles.detailsValue}>
                    {p.maxPerWindow
                        ? `${p.maxPerWindow.maxActions ? `${p.maxPerWindow.maxActions} actions ` : ''}per ${p.maxPerWindow.hours}h`
                        : 'None'}
                </dd>
                <dt className={styles.detailsLabel}>Activity in current window</dt>
                <dd className={styles.detailsValue}>{windowCount} action(s)</dd>
            </dl>

            {error ? <StatusMessage variant="error">{error}</StatusMessage> : null}

            <div className={styles.actions}>
                <Button variant="secondary" onClick={startEdit} disabled={busy}>Edit policy</Button>
                <Button
                    variant={account.enabled ? 'ghost' : 'primary'}
                    onClick={toggleEnabled}
                    loading={busy}
                    disabled={busy}
                >
                    {account.enabled ? 'Disable' : 'Enable'}
                </Button>
            </div>
        </>,
    );
}
