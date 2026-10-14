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
import { submitOnlyFromLastField } from '../../../ui/formEnter.js';
import {
    Button,
    CopyButton,
    FormSection,
    Input,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging } from '../../useMessaging.js';
import { KeyQR } from '../KeyQR.jsx';
import { useToast } from '../ToastHost.jsx';
import { addressTypeLabel } from '../../utils/addressTypeLabel.js';
import { clearLastView } from '../../utils/lastViewMemory.js';
import { sweepMsgMemoryForWallet } from '../../utils/msgReadMemory.js';
import { clearRemovedWalletStorage } from '../../utils/wipeWalletStorage.js';
import { retireBiometricAfterPasswordChange } from '../../../flows/biometricUnlock.js';
import { SettingsActionRow, Status } from './_settingsPrimitives.jsx';
import styles from './ThisWalletSection.module.css';

const PUBLIC_EXTENDED_KEY_RE = /^(?:xpub|tpub)[1-9A-HJ-NP-Za-km-z]+$/;

const chainRegistry = registryLib.defaultRegistry();

// Name a chain as the network pickers do: display name, plus the network kind off mainnet.
function chainDisplayName(chainId) {
    const descriptor = chainRegistry.get(chainId);
    if (!descriptor?.displayName) return chainId;
    return descriptor.networkKind && descriptor.networkKind !== 'mainnet'
        ? `${descriptor.displayName} ${descriptor.networkKind}`
        : descriptor.displayName;
}

// Head an exported key with plain names; the account path line keeps the technical detail.
function publicKeyTitle(entry) {
    const chain = chainDisplayName(entry.chainId);
    return entry.addressType ? `${chain} (${addressTypeLabel(entry.addressType)})` : chain;
}

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
            clearLastView(activeWallet.id);
            sweepMsgMemoryForWallet(activeWallet.id);
            clearRemovedWalletStorage(activeWallet.id);
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
        <div className={styles.stack}>
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
                <SettingsActionRow
                    label="Remove wallet"
                    hint="Deletes the wallet and all linked records (accounts, addresses, signers, pending txs). The encrypted seed is destroyed; back up first if you need recovery."
                >
                    <Button
                        variant="danger"
                        size="sm"
                        icon={null}
                        onClick={() => { setConfirmingRemove(true); setRemoveError(null); }}
                    >
                        Remove…
                    </Button>
                </SettingsActionRow>
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
        let result;
        try {
            result = await messaging.changePassword({ walletId, currentPassword, newPassword });
        } catch (err) {
            setError(isWrongPasswordError(err)
                ? 'Current wallet password is incorrect.'
                : (err?.message || 'Could not change the wallet password.'));
            setBusy(false);
            return;
        }

        // The change is committed. A biometric enrolment wraps the unlock
        // password as it was, so it would now release a password the wallet
        // no longer opens with; retire it here, in the context that holds it.
        // A failure is said on screen, never swallowed: the old password is
        // still wrapped on this device until the enrolment goes.
        let biometricCleared = false;
        let biometricError = false;
        try {
            biometricCleared = await retireBiometricAfterPasswordChange(result);
        } catch {
            biometricError = true;
        }
        reset();
        setOpen(false);
        setBusy(false);
        if (biometricError) {
            showToast({
                message: 'Wallet password changed, but biometric unlock could not be turned off. '
                    + 'Turn it off in Settings, then turn it on again with the new password.',
                variant: 'error',
            });
        } else if (biometricCleared) {
            showToast({
                message: 'Wallet password changed. Biometric unlock was turned off; '
                    + 'turn it on again in Settings to use it with the new password.',
                variant: 'success',
            });
        } else {
            showToast({ message: 'Wallet password changed.', variant: 'success' });
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
        <form onSubmit={submit} onKeyDown={submitOnlyFromLastField} aria-busy={busy}>
            <FormSection
                title="Change wallet password"
                description={`Use at least ${MIN_WALLET_PASSWORD_LENGTH} characters. A unique, longer password is stronger. Keep it safe because it cannot be recovered.`}
                className={styles.panel}
            >
                <Input
                    type="password"
                    label="Current wallet password"
                    value={currentPassword}
                    onChange={update(setCurrentPassword)}
                    aria-label="Current wallet password"
                    autoComplete="current-password"
                    autoFocus
                    disabled={busy}
                />
                <Input
                    type="password"
                    label="New wallet password"
                    value={newPassword}
                    onChange={update(setNewPassword)}
                    aria-label="New wallet password"
                    autoComplete="new-password"
                    disabled={busy}
                />
                <Input
                    type="password"
                    label="Confirm new wallet password"
                    value={confirmation}
                    onChange={update(setConfirmation)}
                    aria-label="Confirm new wallet password"
                    autoComplete="new-password"
                    disabled={busy}
                />
                {(confirmation && confirmation !== newPassword)
                    || error === 'Passwords do not match.' ? (
                    <Status text="Passwords do not match." tone="error" />
                ) : null}
                {error && error !== 'Passwords do not match.' ? <Status text={error} tone="error" /> : null}
                <div className={styles.actions}>
                    <Button type="button" variant="ghost" size="sm" icon={null} onClick={close} disabled={busy}>
                        Cancel
                    </Button>
                    <Button type="submit" size="sm" icon={null} disabled={busy}>
                        {busy ? 'Changing password…' : 'Change password'}
                    </Button>
                </div>
            </FormSection>
        </form>
    );
}

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
        <FormSection
            title={`Extended public keys${accountName ? ` for ${accountName}` : ''}`}
            description="An extended public key does not contain private keys and cannot spend funds. Anyone with it can derive and monitor every address below that account path, including future addresses. Share it only with a watch-only wallet you trust."
            className={styles.panel}
        >
            {stage === 'password' ? (
                <form onSubmit={onSubmit} className={styles.form}>
                    <Input
                        type="password"
                        label="Confirm wallet password"
                        value={password}
                        onChange={(event) => onPasswordChange(event.target.value)}
                        placeholder="Wallet password"
                        autoComplete="current-password"
                        autoFocus
                        disabled={busy}
                    />
                    {error ? <Status text={error} tone="error" /> : null}
                    <div className={styles.actions}>
                        <Button type="button" variant="ghost" size="sm" icon={null} onClick={onClose} disabled={busy}>
                            Cancel
                        </Button>
                        <Button type="submit" size="sm" icon={null} disabled={busy}>
                            {busy ? 'Exporting…' : 'Show public keys'}
                        </Button>
                    </div>
                </form>
            ) : (
                <>
                    {entries.map((entry) => (
                        <FormSection
                            key={`${entry.chainId}:${entry.path}`}
                            title={publicKeyTitle(entry)}
                            description={entry.path ? `Account path: ${entry.path}` : undefined}
                            headingLevel="h3"
                            className={styles.keyPanel}
                        >
                            <div className={styles.xpub}>{entry.xpub}</div>
                            <div className={styles.qr}>
                                <KeyQR
                                    value={entry.xpub}
                                    size={180}
                                    alt={`QR code for ${chainDisplayName(entry.chainId)} extended public key`}
                                />
                                <CopyButton
                                    value={entry.xpub}
                                    label="Copy extended public key"
                                    sensitive
                                />
                            </div>
                        </FormSection>
                    ))}
                    <div className={styles.actions}>
                        <Button type="button" variant="ghost" size="sm" icon={null} onClick={onClose}>Done</Button>
                    </div>
                </>
            )}
        </FormSection>
    );
}

function Row({ label, hint, actionLabel, onClick, disabled = false }) {
    return (
        <SettingsActionRow label={label} hint={hint}>
            {actionLabel && onClick ? (
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    icon={null}
                    onClick={onClick}
                    disabled={disabled}
                >
                    {actionLabel}
                </Button>
            ) : null}
        </SettingsActionRow>
    );
}

function RemoveConfirm({ walletName, busy, error, onCancel, onConfirm }) {
    const [typed, setTyped] = useState('');
    // Require the exact wallet name so accidental destructive clicks stay disabled.
    const matches = typed === walletName;
    return (
        <FormSection
            title={`Remove ${walletName}?`}
            description={(
                <>
                    Its accounts, addresses, signers, and pending transactions will be deleted.
                    Make sure you have a backup before continuing. The encrypted seed is destroyed and
                    cannot be recovered. This cannot be undone. Type the wallet name{' '}
                    <strong className={styles.confirmName}>{walletName}</strong> to confirm.
                </>
            )}
            className={`${styles.panel} ${styles.dangerPanel}`}
        >
            <Input
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
            />
            {error ? <Status text={error} tone="error" /> : null}
            <div className={styles.actions}>
                <Button type="button" variant="ghost" size="sm" icon={null} onClick={onCancel} disabled={busy}>
                    Cancel
                </Button>
                <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    icon={null}
                    onClick={onConfirm}
                    disabled={!matches || busy}
                >
                    {busy ? 'Removing…' : 'Remove wallet'}
                </Button>
            </div>
        </FormSection>
    );
}
