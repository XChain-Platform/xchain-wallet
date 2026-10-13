// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ThisWalletSection (§35.1 This Wallet panel) owns wallet-level identity,
// watch-only export, recovery-format upgrade and removal controls.

import { useEffect, useState } from 'react';
import { CopyButton } from '@xchain-wallet/core/ui';
import { useMessaging } from '../../useMessaging.js';
import { KeyQR } from '../KeyQR.jsx';
import { useToast } from '../ToastHost.jsx';
import { clearLastView } from '../../utils/lastViewMemory.js';
import { sweepMsgMemoryForWallet } from '../../utils/msgReadMemory.js';
import { clearBalanceCache } from '../../utils/balanceCache.js';
import { ROW, ROW_HINT, STACK, Status } from './_settingsPrimitives.jsx';

const ACTION_BTN = {
    background: 'transparent',
    border: '1px solid var(--xc-border)',
    color: 'var(--xc-text)',
    borderRadius: 'var(--xc-radius-sm)',
    padding: 'var(--xc-space-1) var(--xc-space-3)',
    fontSize: 'var(--xc-text-sm)',
    cursor: 'pointer',
};
const DESTRUCTIVE_BTN = {
    ...ACTION_BTN,
    color: 'var(--xc-danger-fg)',
    borderColor: 'var(--xc-danger-fg)',
};
const EXPORT_PANEL = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--xc-space-2)',
    padding: 'var(--xc-space-3)',
    background: 'var(--xc-surface-raised)',
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-md)',
};
const XPUB_TEXT = {
    fontFamily: 'var(--xc-font-mono, monospace)',
    fontSize: 'var(--xc-text-xs)',
    color: 'var(--xc-text)',
    overflowWrap: 'anywhere',
};

const PUBLIC_EXTENDED_KEY_RE = /^(?:xpub|tpub)[1-9A-HJ-NP-Za-km-z]+$/;

function isWrongPasswordError(err) {
    return err?.name === 'AeadAuthError' || err?.name === 'InvalidPasswordError';
}

function publicKeyEntries(result) {
    const keys = result?.payload?.keys;
    if (!Array.isArray(keys)) return [];
    return keys
        .filter((key) => PUBLIC_EXTENDED_KEY_RE.test(key?.xpub || ''))
        .map((key) => ({
            chainId: typeof key.chainId === 'string' ? key.chainId : 'Unknown chain',
            addressType: typeof key.addressType === 'string' ? key.addressType : '',
            path: typeof key.path === 'string' ? key.path : '',
            xpub: key.xpub,
        }));
}

/**
 * @param {object} props
 * @param {{ id: string, name: string, format?: string } | null} [props.activeWallet]
 * @param {{ id: string, name: string, index: number } | null} [props.activeAccount]
 * @param {() => void} [props.onOpenWalletPicker]
 * @param {(walletId: string) => void | Promise<void>} [props.onWalletRemoved]
 * @param {(busy: boolean) => void} [props.onBusyChange]
 */
export function ThisWalletSection({
    activeWallet,
    activeAccount,
    onOpenWalletPicker,
    onWalletRemoved,
    onBusyChange,
}) {
    const { messaging } = useMessaging();
    const [exportStage, setExportStage] = useState(
        /** @type {'idle' | 'password' | 'shown'} */ ('idle'),
    );
    const [exportPassword, setExportPassword] = useState('');
    const [exporting, setExporting] = useState(false);
    const [exportError, setExportError] = useState(/** @type {string | null} */ (null));
    const [exportedKeys, setExportedKeys] = useState(/** @type {Array<any>} */ ([]));
    const [confirmingRemove, setConfirmingRemove] = useState(false);
    const [removeError, setRemoveError] = useState(/** @type {string | null} */ (null));
    const [removing, setRemoving] = useState(false);
    const [removed, setRemoved] = useState(false);

    useEffect(() => {
        setExportStage('idle');
        setExportPassword('');
        setExportError(null);
        setExportedKeys([]);
    }, [activeWallet?.id, activeAccount?.id]);

    if (removed) {
        return (
            <Status
                text={removeError
                    ? `Wallet removed, but the app could not finish switching wallets: ${removeError}`
                    : 'Wallet removed.'}
                tone={removeError ? 'error' : undefined}
            />
        );
    }

    if (!activeWallet) {
        return <Status text="No active wallet." />;
    }

    const onConfirmRemove = async () => {
        // Refuse removal when this shell cannot delete the wallet record.
        if (typeof messaging?.removeWallet !== 'function') {
            setRemoveError('Wallet removal is not wired in this shell yet.');
            return;
        }
        setRemoving(true);
        onBusyChange?.(true);
        setRemoveError(null);
        let removalSucceeded = false;
        try {
            await messaging.removeWallet({ walletId: activeWallet.id });
            removalSucceeded = true;
            // Cluster U FOLLOWUP 5: drop the resume-last-view memory
            // for this wallet so a future wallet that happens to reuse
            // the same id (vanishingly unlikely with cuids, but the
            // hygiene cost is zero) doesn't inherit a stale route.
            clearLastView(activeWallet.id);
            clearBalanceCache(activeWallet.id);
            // sweep this wallet's messaging read marks/unread
            // counts too, or they orphan in localStorage forever.
            sweepMsgMemoryForWallet(activeWallet.id);
            setConfirmingRemove(false);
            setRemoved(true);
            if (typeof onWalletRemoved === 'function') {
                await onWalletRemoved(activeWallet.id);
            }
        } catch (err) {
            setRemoveError(err instanceof Error ? err.message : String(err));
            if (removalSucceeded) setRemoved(true);
        } finally {
            setRemoving(false);
            onBusyChange?.(false);
        }
    };

    const onExportPublicKeys = async (event) => {
        event.preventDefault();
        if (!exportPassword) {
            setExportError('Enter your wallet password.');
            return;
        }
        if (typeof messaging?.pairingPayloadRequest !== 'function') {
            setExportError('Extended public key export is not wired in this shell yet.');
            return;
        }
        setExporting(true);
        setExportError(null);
        try {
            const result = await messaging.pairingPayloadRequest({
                walletId: activeWallet.id,
                password: exportPassword,
                accountIndex: Number.isInteger(activeAccount?.index) ? activeAccount.index : 0,
                publicExport: true,
            });
            const entries = publicKeyEntries(result);
            if (entries.length === 0) {
                throw new Error('This wallet returned no valid extended public keys.');
            }
            setExportedKeys(entries);
            setExportPassword('');
            setExportStage('shown');
        } catch (err) {
            setExportPassword('');
            setExportError(isWrongPasswordError(err)
                ? 'Incorrect password.'
                : (err?.message || String(err)));
        } finally {
            setExporting(false);
        }
    };

    const closePublicKeyExport = () => {
        setExportStage('idle');
        setExportPassword('');
        setExportError(null);
        setExportedKeys([]);
    };

    return (
        <div style={STACK}>
            <Row
                label="Wallet"
                hint={activeWallet.name}
                actionLabel={onOpenWalletPicker ? 'Switch / rename…' : null}
                onClick={onOpenWalletPicker}
                disabled={removing}
            />
            {/* Offer the upgrade only to the older 12-word format; a standard wallet has nothing to upgrade. */}
            {activeWallet.format === 'counterwallet-legacy' ? (
                <Row
                    label="Upgrade recovery phrase"
                    hint="This wallet uses an older 12-word recovery phrase format. Open your wallets, choose this wallet's details, and pick Upgrade recovery phrase."
                    actionLabel={onOpenWalletPicker ? 'Open wallets…' : null}
                    onClick={onOpenWalletPicker}
                    disabled={removing}
                />
            ) : null}
            {activeWallet.format === 'wif-only' ? (
                <Row
                    label="Extended public keys"
                    hint="Not available for a private-key-only wallet."
                />
            ) : exportStage === 'idle' ? (
                <Row
                    label="Extended public keys"
                    hint="Export account-level public keys for a watch-only wallet."
                    actionLabel="Export…"
                    onClick={() => { setExportStage('password'); setExportError(null); }}
                />
            ) : (
                <PublicKeyExport
                    stage={exportStage}
                    accountName={activeAccount?.name}
                    password={exportPassword}
                    busy={exporting}
                    error={exportError}
                    entries={exportedKeys}
                    onPasswordChange={setExportPassword}
                    onSubmit={onExportPublicKeys}
                    onClose={closePublicKeyExport}
                />
            )}
            <ChangePasswordRow walletId={activeWallet.id} disabled={removing} />
            {confirmingRemove ? (
                <RemoveConfirm
                    walletName={activeWallet.name}
                    busy={removing}
                    error={removeError}
                    onCancel={() => { setConfirmingRemove(false); setRemoveError(null); }}
                    onConfirm={onConfirmRemove}
                />
            ) : (
                <div style={ROW}>
                    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                        <span style={{ color: 'var(--xc-text)', fontWeight: 500 }}>Remove wallet</span>
                        <span style={ROW_HINT}>
                            Deletes the wallet and all linked records (accounts, addresses, signers,
                            pending txs). The encrypted seed is destroyed; back up first if you need
                            recovery.
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={() => { setConfirmingRemove(true); setRemoveError(null); }}
                        style={DESTRUCTIVE_BTN}
                    >
                        Remove…
                    </button>
                </div>
            )}
        </div>
    );
}

const MIN_WALLET_PASSWORD_LENGTH = 8;

function ChangePasswordRow({ walletId, disabled }) {
    const { messaging } = useMessaging();
    const { showToast } = useToast();
    const [open, setOpen] = useState(false);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));

    const reset = () => {
        setCurrentPassword('');
        setNewPassword('');
        setConfirmation('');
        setError(null);
    };

    const close = () => {
        if (busy) return;
        reset();
        setOpen(false);
    };

    const submit = async (event) => {
        event.preventDefault();
        if (!currentPassword) {
            setError('Enter your current wallet password.');
            return;
        }
        if (newPassword.length < MIN_WALLET_PASSWORD_LENGTH) {
            setError(`New password must be at least ${MIN_WALLET_PASSWORD_LENGTH} characters.`);
            return;
        }
        if (newPassword !== confirmation) {
            setError('Passwords do not match.');
            return;
        }
        if (newPassword === currentPassword) {
            setError('Choose a new password that differs from the current password.');
            return;
        }
        if (typeof messaging?.changePassword !== 'function') {
            setError('Password changes are not wired in this shell yet.');
            return;
        }

        setBusy(true);
        setError(null);
        try {
            await messaging.changePassword({ walletId, currentPassword, newPassword });
            reset();
            setOpen(false);
            showToast({ message: 'Wallet password changed.', variant: 'success' });
        } catch (err) {
            setError(isWrongPasswordError(err)
                ? 'Current wallet password is incorrect.'
                : (err?.message || 'Could not change the wallet password.'));
        } finally {
            setBusy(false);
        }
    };

    if (!open) {
        return (
            <Row
                label="Wallet password"
                hint="Change the password that protects this wallet's private keys."
                actionLabel="Change…"
                onClick={() => setOpen(true)}
                disabled={disabled}
            />
        );
    }

    const update = (setter) => (event) => {
        setter(event.target.value);
        if (error) setError(null);
    };

    return (
        <form onSubmit={submit} style={EXPORT_PANEL} aria-busy={busy}>
            <div style={{ color: 'var(--xc-text)', fontWeight: 600 }}>Change wallet password</div>
            <div style={ROW_HINT}>
                Use at least {MIN_WALLET_PASSWORD_LENGTH} characters. A unique, longer password is stronger.
                Keep it safe because it cannot be recovered.
            </div>
            <label style={{ color: 'var(--xc-text)', fontSize: 'var(--xc-text-sm)' }}>
                Current wallet password
                <input
                    type="password"
                    value={currentPassword}
                    onChange={update(setCurrentPassword)}
                    aria-label="Current wallet password"
                    autoComplete="current-password"
                    autoFocus
                    disabled={busy}
                    style={PASSWORD_INPUT}
                />
            </label>
            <label style={{ color: 'var(--xc-text)', fontSize: 'var(--xc-text-sm)' }}>
                New wallet password
                <input
                    type="password"
                    value={newPassword}
                    onChange={update(setNewPassword)}
                    aria-label="New wallet password"
                    autoComplete="new-password"
                    disabled={busy}
                    style={PASSWORD_INPUT}
                />
            </label>
            <label style={{ color: 'var(--xc-text)', fontSize: 'var(--xc-text-sm)' }}>
                Confirm new wallet password
                <input
                    type="password"
                    value={confirmation}
                    onChange={update(setConfirmation)}
                    aria-label="Confirm new wallet password"
                    autoComplete="new-password"
                    disabled={busy}
                    style={PASSWORD_INPUT}
                />
            </label>
            {(confirmation && confirmation !== newPassword)
                || error === 'Passwords do not match.' ? (
                <Status text="Passwords do not match." tone="error" />
            ) : null}
            {error && error !== 'Passwords do not match.' ? <Status text={error} tone="error" /> : null}
            <div style={{ display: 'flex', gap: 'var(--xc-space-2)', justifyContent: 'flex-end' }}>
                <button type="button" onClick={close} disabled={busy} style={ACTION_BTN}>Cancel</button>
                <button type="submit" disabled={busy} style={ACTION_BTN}>
                    {busy ? 'Changing password…' : 'Change password'}
                </button>
            </div>
        </form>
    );
}

const PASSWORD_INPUT = {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box',
    marginBlockStart: 'var(--xc-space-1)',
    background: 'var(--xc-bg)',
    color: 'var(--xc-text)',
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-sm)',
    padding: 'var(--xc-space-2) var(--xc-space-3)',
    fontSize: 'var(--xc-text-sm)',
    fontFamily: 'inherit',
};

function PublicKeyExport({
    stage,
    accountName,
    password,
    busy,
    error,
    entries,
    onPasswordChange,
    onSubmit,
    onClose,
}) {
    return (
        <div style={EXPORT_PANEL}>
            <div style={{ color: 'var(--xc-text)', fontWeight: 600 }}>
                Extended public keys{accountName ? ` for ${accountName}` : ''}
            </div>
            <div style={ROW_HINT}>
                An extended public key does not contain private keys and cannot spend funds.
                Anyone with it can derive and monitor every address below that account path,
                including future addresses. Share it only with a watch-only wallet you trust.
            </div>
            {stage === 'password' ? (
                <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--xc-space-2)' }}>
                    <label style={{ color: 'var(--xc-text)', fontSize: 'var(--xc-text-sm)' }}>
                        Confirm wallet password
                        <input
                            type="password"
                            value={password}
                            onChange={(event) => onPasswordChange(event.target.value)}
                            placeholder="Wallet password"
                            autoComplete="current-password"
                            autoFocus
                            disabled={busy}
                            style={{
                                display: 'block',
                                width: '100%',
                                boxSizing: 'border-box',
                                marginBlockStart: 'var(--xc-space-1)',
                                background: 'var(--xc-bg)',
                                color: 'var(--xc-text)',
                                border: '1px solid var(--xc-border)',
                                borderRadius: 'var(--xc-radius-sm)',
                                padding: 'var(--xc-space-2) var(--xc-space-3)',
                                fontSize: 'var(--xc-text-sm)',
                                fontFamily: 'inherit',
                            }}
                        />
                    </label>
                    {error ? <Status text={error} tone="error" /> : null}
                    <div style={{ display: 'flex', gap: 'var(--xc-space-2)', justifyContent: 'flex-end' }}>
                        <button type="button" onClick={onClose} style={ACTION_BTN} disabled={busy}>
                            Cancel
                        </button>
                        <button type="submit" style={ACTION_BTN} disabled={busy}>
                            {busy ? 'Exporting…' : 'Show public keys'}
                        </button>
                    </div>
                </form>
            ) : (
                <>
                    {entries.map((entry) => (
                        <div key={`${entry.chainId}:${entry.path}`} style={EXPORT_PANEL}>
                            <div style={{ color: 'var(--xc-text)', fontWeight: 500 }}>
                                {entry.chainId}
                                {entry.addressType ? ` (${entry.addressType})` : ''}
                            </div>
                            {entry.path ? <div style={ROW_HINT}>Account path: {entry.path}</div> : null}
                            <div style={XPUB_TEXT}>{entry.xpub}</div>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--xc-space-2)' }}>
                                <KeyQR
                                    value={entry.xpub}
                                    size={180}
                                    alt={`QR code for ${entry.chainId} extended public key`}
                                />
                                <CopyButton
                                    value={entry.xpub}
                                    label="Copy extended public key"
                                    sensitive
                                />
                            </div>
                        </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button type="button" onClick={onClose} style={ACTION_BTN}>Done</button>
                    </div>
                </>
            )}
        </div>
    );
}

function Row({ label, hint, actionLabel, onClick, disabled = false }) {
    return (
        <div style={ROW}>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                <span style={{ color: 'var(--xc-text)', fontWeight: 500 }}>{label}</span>
                <span style={ROW_HINT}>{hint}</span>
            </div>
            {actionLabel && onClick ? (
                <button type="button" onClick={onClick} style={ACTION_BTN} disabled={disabled}>{actionLabel}</button>
            ) : null}
        </div>
    );
}

function RemoveConfirm({ walletName, busy, error, onCancel, onConfirm }) {
    const [typed, setTyped] = useState('');
    // Require the exact wallet name so accidental destructive clicks stay disabled.
    const matches = typed === walletName;
    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--xc-space-2)',
            padding: 'var(--xc-space-3)',
            background: 'var(--xc-surface-raised)',
            border: '1px solid var(--xc-danger-fg)',
            borderRadius: 'var(--xc-radius-md)',
        }}>
            <div style={{ color: 'var(--xc-danger-fg)', fontWeight: 600 }}>
                Remove {walletName}?
            </div>
            <div style={ROW_HINT}>
                Removing this wallet deletes its accounts, addresses, signers, and pending transactions.
                Make sure you have a backup before continuing. The encrypted seed is destroyed and
                cannot be recovered. This cannot be undone. Type the wallet name{' '}
                <strong style={{ color: 'var(--xc-text)' }}>{walletName}</strong> to confirm.
            </div>
            <input
                type="text"
                enterKeyHint="done"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' && matches && !busy) onConfirm();
                }}
                placeholder={walletName}
                aria-label="Confirm wallet name"
                autoFocus
                disabled={busy}
                style={{
                    background: 'var(--xc-bg)',
                    color: 'var(--xc-text)',
                    border: '1px solid var(--xc-border)',
                    borderRadius: 'var(--xc-radius-sm)',
                    padding: 'var(--xc-space-2) var(--xc-space-3)',
                    fontSize: 'var(--xc-text-sm)',
                    fontFamily: 'inherit',
                }}
            />
            {error ? <Status text={error} tone="error" /> : null}
            <div style={{ display: 'flex', gap: 'var(--xc-space-2)', justifyContent: 'flex-end' }}>
                <button type="button" onClick={onCancel} style={ACTION_BTN} disabled={busy}>
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={onConfirm}
                    disabled={!matches || busy}
                    style={{
                        ...DESTRUCTIVE_BTN,
                        background: matches && !busy ? 'var(--xc-danger-fg)' : 'transparent',
                        color: matches && !busy ? 'var(--xc-on-accent)' : 'var(--xc-danger-fg)',
                        opacity: matches && !busy ? 1 : 0.6,
                        cursor: matches && !busy ? 'pointer' : 'not-allowed',
                    }}
                >
                    {busy ? 'Removing…' : 'Remove wallet'}
                </button>
            </div>
        </div>
    );
}
