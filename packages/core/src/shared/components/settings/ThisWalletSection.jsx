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
import { t } from '../../../i18n/index.js';

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
                    ? t('settings.thisWallet.walletRemovedButTheApp', { removeError })
                    : t('settings.thisWallet.walletRemoved')}
                tone={removeError ? 'error' : undefined}
            />
        );
    }

    if (!activeWallet) {
        return <Status text={t('settings.thisWallet.noActiveWallet')} />;
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
                label={t('settings.thisWallet.wallet')}
                hint={activeWallet.name}
                actionLabel={onOpenWalletPicker ? t('settings.thisWallet.switchRename') : null}
                onClick={onOpenWalletPicker}
                disabled={removing}
            />
            {/* Offer the upgrade only to the older 12-word format; a standard wallet has nothing to upgrade. */}
            {activeWallet.format === 'counterwallet-legacy' ? (
                <Row
                    label={t('walletDetails.upgradeRecovery')}
                    hint={t('settings.thisWallet.thisWalletUsesAnOlder')}
                    actionLabel={onOpenWalletPicker ? t('settings.thisWallet.openWallets') : null}
                    onClick={onOpenWalletPicker}
                    disabled={removing}
                />
            ) : null}
            {activeWallet.format === 'wif-only' ? (
                <Row
                    label={t('settings.thisWallet.extendedPublicKeys')}
                    hint={t('settings.thisWallet.notAvailableForAPrivate')}
                />
            ) : exportStage === 'idle' ? (
                <Row
                    label={t('settings.thisWallet.extendedPublicKeys')}
                    hint={t('settings.thisWallet.exportAccountLevelPublicKeys')}
                    actionLabel={t('history.export.open')}
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
                    label={t('settings.thisWallet.removeWallet')}
                    hint={t('settings.thisWallet.deletesTheWalletAndAll')}
                >
                    <Button
                        variant="danger"
                        size="sm"
                        icon={null}
                        onClick={() => { setConfirmingRemove(true); setRemoveError(null); }}
                    >
                        {t('settings.thisWallet.remove')}
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
                label={t('send.gated.passwordLabel')}
                hint={t('settings.thisWallet.changeThePasswordThatProtects')}
                actionLabel={t('settings.thisWallet.change')}
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
                title={t('settings.thisWallet.changeWalletPassword')}
                description={t('settings.thisWallet.useAtLeastCharactersA', { MIN_WALLET_PASSWORD_LENGTH })}
                className={styles.panel}
            >
                <Input
                    type="password"
                    label={t('settings.thisWallet.currentWalletPassword')}
                    value={currentPassword}
                    onChange={update(setCurrentPassword)}
                    aria-label={t('settings.thisWallet.currentWalletPassword')}
                    autoComplete="current-password"
                    autoFocus
                    disabled={busy}
                />
                <Input
                    type="password"
                    label={t('settings.thisWallet.newWalletPassword')}
                    value={newPassword}
                    onChange={update(setNewPassword)}
                    aria-label={t('settings.thisWallet.newWalletPassword')}
                    autoComplete="new-password"
                    disabled={busy}
                />
                <Input
                    type="password"
                    label={t('settings.thisWallet.confirmNewWalletPassword')}
                    value={confirmation}
                    onChange={update(setConfirmation)}
                    aria-label={t('settings.thisWallet.confirmNewWalletPassword')}
                    autoComplete="new-password"
                    disabled={busy}
                />
                {(confirmation && confirmation !== newPassword)
                    || error === 'Passwords do not match.' ? (
                    <Status text={t('settings.thisWallet.passwordsDoNotMatch')} tone="error" />
                ) : null}
                {error && error !== 'Passwords do not match.' ? <Status text={error} tone="error" /> : null}
                <div className={styles.actions}>
                    <Button type="button" variant="ghost" size="sm" icon={null} onClick={close} disabled={busy}>
                        {t('common.cancel')}
                    </Button>
                    <Button type="submit" size="sm" icon={null} disabled={busy}>
                        {busy ? t('settings.thisWallet.changingPassword') : t('settings.thisWallet.changePassword')}
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
            title={(accountName ? t('settings.thisWallet.extendedPublicKeysFor', { name: accountName }) : t('settings.thisWallet.extendedPublicKeys'))}
            description={t('settings.thisWallet.anExtendedPublicKeyDoes')}
            className={styles.panel}
        >
            {stage === 'password' ? (
                <form onSubmit={onSubmit} className={styles.form}>
                    <Input
                        type="password"
                        label={t('settings.thisWallet.confirmWalletPassword')}
                        value={password}
                        onChange={(event) => onPasswordChange(event.target.value)}
                        placeholder={t('send.gated.passwordLabel')}
                        autoComplete="current-password"
                        autoFocus
                        disabled={busy}
                    />
                    {error ? <Status text={error} tone="error" /> : null}
                    <div className={styles.actions}>
                        <Button type="button" variant="ghost" size="sm" icon={null} onClick={onClose} disabled={busy}>
                            {t('common.cancel')}
                        </Button>
                        <Button type="submit" size="sm" icon={null} disabled={busy}>
                            {busy ? t('settings.backup.exporting') : t('settings.thisWallet.showPublicKeys')}
                        </Button>
                    </div>
                </form>
            ) : (
                <>
                    {entries.map((entry) => (
                        <FormSection
                            key={`${entry.chainId}:${entry.path}`}
                            title={publicKeyTitle(entry)}
                            description={entry.path ? t('settings.thisWallet.accountPath', { path: entry.path }) : undefined}
                            headingLevel="h3"
                            className={styles.keyPanel}
                        >
                            <div className={styles.xpub}>{entry.xpub}</div>
                            <div className={styles.qr}>
                                <KeyQR
                                    value={entry.xpub}
                                    size={180}
                                    alt={t('settings.thisWallet.qrCodeForExtendedPublic', { chainId: chainDisplayName(entry.chainId) })}
                                />
                                <CopyButton
                                    value={entry.xpub}
                                    label={t('settings.thisWallet.copyExtendedPublicKey')}
                                    sensitive
                                />
                            </div>
                        </FormSection>
                    ))}
                    <div className={styles.actions}>
                        <Button type="button" variant="ghost" size="sm" icon={null} onClick={onClose}>{t('common.done')}</Button>
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
            title={t('settings.thisWallet.remove2', { walletName })}
            description={(
                <>
                    {t('settings.thisWallet.itsAccountsAddressesSignersAnd')}{' '}
                    <strong className={styles.confirmName}>{walletName}</strong> {t('settings.thisWallet.toConfirm')}
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
                aria-label={t('settings.thisWallet.confirmWalletName')}
                autoFocus
                disabled={busy}
            />
            {error ? <Status text={error} tone="error" /> : null}
            <div className={styles.actions}>
                <Button type="button" variant="ghost" size="sm" icon={null} onClick={onCancel} disabled={busy}>
                    {t('common.cancel')}
                </Button>
                <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    icon={null}
                    onClick={onConfirm}
                    disabled={!matches || busy}
                >
                    {busy ? t('settings.thisWallet.removing') : t('settings.thisWallet.removeWallet')}
                </Button>
            </div>
        </FormSection>
    );
}
