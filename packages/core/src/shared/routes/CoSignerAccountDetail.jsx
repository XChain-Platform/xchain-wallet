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

import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Screen,
    PageHeader,
    Button,
    Input,
    ChainBadge,
    AddressText,
    CopyButton,
    FormPage,
    StatusMessage,
    ListPage,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import {
    CoSignerPolicyEditor,
    draftFromAccount,
    buildPolicyDraft,
} from './CoSignerPolicyEditor.jsx';
import { actionDisplayLabel } from '../utils/actionDisplayLabel.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { ConfirmModal } from '../components/ConfirmModal.jsx';
import { useConfirmModal } from '../hooks/useConfirmModal.js';
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
    const confirmDialog = useConfirmModal();

    const [account, setAccount] = useState(/** @type {any | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [busy, setBusy] = useState(false);

    const [editing, setEditing] = useState(false);
    const [name, setName] = useState('');
    const [policyDraft, setPolicyDraft] = useState(null);
    const [editError, setEditError] = useState(/** @type {string | null} */ (null));
    const editBaselineRef = useRef('');
    const viewRef = useRef(0);
    const operationRef = useRef(0);
    const busyRef = useRef(false);

    function editableSnapshot(value) {
        return JSON.stringify(editableFields(value));
    }

    function editableFields(value) {
        return {
            name: value?.name,
            policy: value?.policy,
            allowedOutputs: value?.allowedOutputs,
        };
    }

    useEffect(() => {
        const view = viewRef.current + 1;
        viewRef.current = view;
        operationRef.current += 1;
        busyRef.current = false;
        let cancelled = false;
        setAccount(null);
        setError(null);
        setBusy(false);
        setEditing(false);
        setName('');
        setPolicyDraft(null);
        setEditError(null);
        editBaselineRef.current = '';
        confirmDialog.onCancel();
        Promise.resolve()
            .then(() => messaging.getCoSignerAccount({ id: accountId }))
            .then((a) => {
                if (cancelled || viewRef.current !== view) return;
                if (!a) { setError('Agent account not found.'); return; }
                setAccount(a);
            })
            .catch((err) => {
                if (!cancelled && viewRef.current === view) {
                    setError(userFacingMessage(err, 'Failed to load the agent account.'));
                }
            });
        return () => {
            cancelled = true;
            if (viewRef.current === view) {
                viewRef.current += 1;
                operationRef.current += 1;
                busyRef.current = false;
            }
        };
    }, [accountId, messaging, confirmDialog.onCancel]);

    async function toggleEnabled() {
        if (!account || busyRef.current) return;
        const target = account;
        const view = viewRef.current;
        if (target.enabled && !(await confirmDialog.confirm({
            title: 'Disable this agent account?',
            message: 'This revokes the agent\'s signing access until you enable the account again. Funds already sent to the shared address are not moved.',
            confirmLabel: 'Disable',
            danger: true,
        }))) return;
        if (viewRef.current !== view || busyRef.current) return;
        const operation = operationRef.current + 1;
        operationRef.current = operation;
        busyRef.current = true;
        setBusy(true);
        setError(null);
        try {
            const updated = await messaging.updateCoSignerAccount({
                id: target.id,
                patch: { enabled: !target.enabled },
            });
            if (viewRef.current === view && operationRef.current === operation) setAccount(updated);
        } catch (err) {
            if (viewRef.current === view && operationRef.current === operation) {
                setError(userFacingMessage(err, 'Failed to update the agent account.'));
            }
        } finally {
            if (viewRef.current === view && operationRef.current === operation) {
                busyRef.current = false;
                setBusy(false);
            }
        }
    }

    function startEdit() {
        setName(account.name);
        setPolicyDraft(draftFromAccount(account));
        editBaselineRef.current = editableSnapshot(account);
        setEditError(null);
        setEditing(true);
    }

    async function saveEdit(event) {
        event?.preventDefault();
        if (!account || busyRef.current) return;
        const built = buildPolicyDraft(policyDraft);
        if (built.error) { setEditError(built.error); return; }
        const target = account;
        const view = viewRef.current;
        const operation = operationRef.current + 1;
        operationRef.current = operation;
        busyRef.current = true;
        setBusy(true);
        setEditError(null);
        try {
            const fresh = await messaging.getCoSignerAccount({ id: target.id });
            if (viewRef.current !== view || operationRef.current !== operation) return;
            if (!fresh) throw new Error('This agent account no longer exists.');
            if (editableSnapshot(fresh) !== editBaselineRef.current) {
                setAccount(fresh);
                setName(fresh.name);
                setPolicyDraft(draftFromAccount(fresh));
                editBaselineRef.current = editableSnapshot(fresh);
                setEditError('This agent account changed after you opened the editor. Review the latest policy, then save again.');
                return;
            }
            const updated = await messaging.updateCoSignerAccount({
                id: target.id,
                patch: {
                    expectedEditable: editableFields(fresh),
                    name: name.trim() || target.name,
                    policy: built.policy,
                    allowedOutputs: built.allowedOutputs,
                },
            });
            if (viewRef.current === view && operationRef.current === operation) {
                setAccount(updated);
                setEditing(false);
            }
        } catch (err) {
            if (viewRef.current === view && operationRef.current === operation) {
                setEditError(userFacingMessage(err, 'Failed to save changes.'));
            }
        } finally {
            if (viewRef.current === view && operationRef.current === operation) {
                busyRef.current = false;
                setBusy(false);
            }
        }
    }

    const windowCount = useMemo(() => {
        const entries = account?.window?.entries;
        return Array.isArray(entries) ? entries.length : 0;
    }, [account]);

    const header = <PageHeader onBack={onBack} title="Agent account" />;
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {children}
            {confirmDialog.request ? (
                <ConfirmModal
                    {...confirmDialog.request}
                    onConfirm={confirmDialog.onConfirm}
                    onCancel={confirmDialog.onCancel}
                />
            ) : null}
        </Screen>
    );

    if (error && !account) return wrap(<ListPage><StatusMessage variant="error">{error}</StatusMessage></ListPage>);
    if (!account) return wrap(<ListPage><p className={styles.hint}>Loading…</p></ListPage>);

    if (editing) {
        return wrap(
            <FormPage
                label="Edit agent account"
                onSubmit={saveEdit}
                intro="Editing the policy changes only the rules; the account's address and keys stay the same."
                status={editError ? <StatusMessage variant="error">{editError}</StatusMessage> : null}
                actions={(
                    <>
                        <Button type="button" variant="secondary" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
                        <Button type="submit" variant="primary" loading={busy} disabled={busy}>Save changes</Button>
                    </>
                )}
            >
                <Input label="Account name" value={name} onChange={(e) => setName(e.target.value)} />
                <CoSignerPolicyEditor value={policyDraft} onChange={setPolicyDraft} />
            </FormPage>,
        );
    }

    const descriptor = chainRegistry.get(account.chainId);
    const p = account.policy || {};

    return wrap(
        <ListPage>
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
                    <CopyButton value={account.aggregateAddress || ''} label="Copy funding address" />
                </dd>
                <dt className={styles.detailsLabel}>Allowed actions</dt>
                <dd className={styles.detailsValue}>{(p.allowedActions || []).map(actionDisplayLabel).join(', ') || 'none'}</dd>
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
        </ListPage>,
    );
}
