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

import { useEffect, useRef, useState } from 'react';
import {
    Button,
    CopyButton,
    FormErrorSummary,
    FormPage,
    FormSection,
    Icon,
    Input,
    PageNotice as Status,
    StatusMessage,
    useFormErrors,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging } from '../../useMessaging.js';
import { KeyQR } from '../KeyQR.jsx';
import { WarningCard, WarningLine } from '../WarningCard.jsx';
import { useToast } from '../ToastHost.jsx';
import { addressTypeLabel } from '../../utils/addressTypeLabel.js';
import { clearLastView } from '../../utils/lastViewMemory.js';
import { sweepMsgMemoryForWallet } from '../../utils/msgReadMemory.js';
import { clearRemovedWalletStorage } from '../../utils/wipeWalletStorage.js';
import { userFacingMessage } from '../../utils/userFacingMessage.js';
import { retireBiometricAfterPasswordChange } from '../../../flows/biometricUnlock.js';
import { isHardwareWallet } from '../../../flows/hardwareWallet.js';
import { DURESS_PASSWORD_COLLISION_MESSAGE, walletPasswordCollidesWithDuress } from '../../../flows/duressPassphrase.js';
import { SettingsActionRow, SettingsInlineForm } from './_settingsPrimitives.jsx';
import cardStyles from '../../../ui/Card.module.css';
import styles from './ThisWalletSection.module.css';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/accountPicker.js';
import '../../../i18n/locales/en/history.js';
import '../../../i18n/locales/en/send.js';
import '../../../i18n/locales/en/settings.js';
import '../../../i18n/locales/en/walletDetails.js';

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
            chainId: typeof key.chainId === 'string' ? key.chainId : 'Unknown network',
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
 * @param {() => void} [props.onOpenAccountPicker]
 * @param {(walletId: string) => void | Promise<void>} [props.onWalletRemoved]
 * @param {(busy: boolean) => void} [props.onBusyChange]
 */
export function ThisWalletSection({
    activeWallet,
    activeAccount,
    onOpenWalletPicker,
    onOpenAccountPicker,
    onWalletRemoved,
    onBusyChange,
    // Render one part only (password, xpub or remove), for pages that host a single part.
    only = null,
    // With only="remove", land straight on the final confirm step; with
    // only="password", straight on the change-password form.
    direct = false,
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

    // Account Details' Extended public keys page shows the keys at once. The
    // key remounts it per account, so a switch never shows the last keys.
    if (only === 'xpub') {
        return <AccountPublicKeys key={`${activeWallet?.id || ''}:${activeAccount?.index ?? 0}`} activeWallet={activeWallet} activeAccount={activeAccount} />;
    }

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
            setRemoveError(userFacingMessage(err, 'Failed to remove wallet.'));
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
                : userFacingMessage(err, 'Could not export this wallet\'s extended public keys.'));
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

    // A hardware wallet has no seed to export keys from, so it shows no export row.
    const hardware = isHardwareWallet(activeWallet);
    const removePart = (direct && only === 'remove') ? (
        <RemoveConfirm direct walletName={activeWallet.name} busy={removing} error={removeError} onConfirm={onConfirmRemove} />
    ) : confirmingRemove ? (
        <RemoveConfirm walletName={activeWallet.name} busy={removing} error={removeError} onCancel={() => { setConfirmingRemove(false); setRemoveError(null); }} onConfirm={onConfirmRemove} />
    ) : (
        <SettingsActionRow label={t('settings.thisWallet.removeWallet')} hint={t('settings.thisWallet.deletesTheWalletAndAll')}>
            <Button variant="danger" size="sm" icon={<Icon.TrashIcon />} onClick={() => { setConfirmingRemove(true); setRemoveError(null); }}>
                {t('settings.thisWallet.remove')}
            </Button>
        </SettingsActionRow>
    );
    if (only === 'password') return <div className={styles.stack}><ChangePasswordRow walletId={activeWallet.id} disabled={removing} direct={direct} /></div>;
    if (only === 'remove') return <div className={styles.stack}>{removePart}</div>;

    return (
        <div className={styles.stack}>
            <Row
                label={t('settings.thisWallet.wallet')}
                hint={activeWallet.name}
                actionLabel={onOpenWalletPicker ? t('settings.thisWallet.switchRename') : null}
                actionIcon={<Icon.SwapIcon />}
                onClick={onOpenWalletPicker}
                disabled={removing}
            />
            <Row
                label={t('settings.thisWallet.account')}
                hint={activeAccount?.name || t('accountPicker.defaultName', {
                    number: Number.isInteger(activeAccount?.index) ? activeAccount.index + 1 : 1,
                })}
                actionLabel={onOpenAccountPicker ? t('settings.thisWallet.switchAccount') : null}
                actionIcon={<Icon.SwapIcon />}
                onClick={onOpenAccountPicker}
                disabled={removing}
            />
            {/* Offer the upgrade only to the older 12-word format; a standard wallet has nothing to upgrade. */}
            {activeWallet.format === 'counterwallet-legacy' ? (
                <Row
                    label={t('walletDetails.upgradeRecovery')}
                    hint={t('settings.thisWallet.thisWalletUsesAnOlder')}
                    actionLabel={onOpenWalletPicker ? t('settings.thisWallet.openWallets') : null}
                    actionIcon={<Icon.ForwardIcon />}
                    onClick={onOpenWalletPicker}
                    disabled={removing}
                />
            ) : null}
            {hardware ? null : activeWallet.format === 'wif-only' ? (
                <Row
                    label={t('settings.thisWallet.extendedPublicKeys')}
                    hint={t('settings.thisWallet.notAvailableForAPrivate')}
                />
            ) : exportStage === 'idle' ? (
                <Row
                    label={t('settings.thisWallet.extendedPublicKeys')}
                    hint={t('settings.thisWallet.exportAccountLevelPublicKeys')}
                    actionLabel={t('history.export.open')}
                    actionIcon={<Icon.DownloadIcon />}
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
                        icon={<Icon.TrashIcon />}
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
// The Remove wallet confirm field: its id keys its error entry (G130).
const REMOVE_CONFIRM_ID = 'remove-wallet-confirm-name';
const passwordMismatch = () => t('settings.thisWallet.passwordsDoNotMatch');

// `direct` is the Wallet password page of its own: it lands on the form, with
// no Change button first and no Cancel (Back leaves), and stays on it after a
// change.
function ChangePasswordRow({ walletId, disabled, direct = false }) {
    const { messaging } = useMessaging();
    const { showToast } = useToast();
    const [openState, setOpen] = useState(false);
    const open = openState || direct;
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [busy, setBusy] = useState(false);
    // Each message names the field it is about, so it renders under that
    // field; a failure that is about no one field stays in the form status.
    const [error, setErrorState] = useState(
        /** @type {{ field: 'current' | 'new' | 'confirm' | null, text: string } | null} */ (null),
    );
    const setError = (text, field = null) => {
        if (text) focusAfterErrorRef.current = field || 'current';
        setErrorState(text ? { field, text } : null);
    };
    // The fields are disabled while the change runs, which drops focus to the
    // page. After a refusal the cursor goes back to the field to fix, with its
    // text selected, the same way the Locked screen returns it.
    const currentRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const newRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const confirmRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const focusAfterErrorRef = useRef(/** @type {'current' | 'new' | 'confirm' | null} */ (null));
    useEffect(() => {
        if (busy || !error || !focusAfterErrorRef.current) return;
        const target = { current: currentRef, new: newRef, confirm: confirmRef }[focusAfterErrorRef.current];
        focusAfterErrorRef.current = null;
        target.current?.focus();
        target.current?.select();
    }, [busy, error]);

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
            setError('Enter your current wallet password.', 'current');
            return;
        }
        if (newPassword.length < MIN_WALLET_PASSWORD_LENGTH) {
            setError(`New password must be at least ${MIN_WALLET_PASSWORD_LENGTH} characters.`, 'new');
            return;
        }
        if (newPassword !== confirmation) {
            setError(passwordMismatch(), 'confirm');
            return;
        }
        if (newPassword === currentPassword) {
            setError('Choose a new password that differs from the current password.', 'new');
            return;
        }
        // The Locked screen tries the real unlock before the duress check, so
        // a wallet password equal to the duress passphrase opens the wallet
        // when it is typed under duress and arms nothing.
        if (walletPasswordCollidesWithDuress(newPassword)) {
            setError(DURESS_PASSWORD_COLLISION_MESSAGE, 'new');
            return;
        }
        if (typeof messaging?.changePassword !== 'function') {
            setError('Changing the password is not available in this version of the app.');
            return;
        }

        setBusy(true);
        setError(null);
        let result;
        try {
            result = await messaging.changePassword({ walletId, currentPassword, newPassword });
        } catch (err) {
            if (isWrongPasswordError(err)) setError('Current wallet password is incorrect.', 'current');
            else setError(userFacingMessage(err, 'Could not change the wallet password.'));
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
                actionIcon={<Icon.KeyIcon />}
                onClick={() => setOpen(true)}
                disabled={disabled}
            />
        );
    }

    const update = (setter) => (event) => {
        setter(event.target.value);
        if (error) setError(null);
    };
    const fieldError = (field) => (error?.field === field ? error.text : undefined);
    // The mismatch shows while the confirmation is typed, keyed to its value
    // so the field does not dismiss it as stale on the next keystroke.
    const confirmError = confirmation && confirmation !== newPassword
        ? passwordMismatch()
        : fieldError('confirm');

    return (
        <SettingsInlineForm onCancel={direct ? undefined : close} cancelDisabled={busy}>
            <Status text={error && error.field === null ? error.text : null} tone="error" />
            {/* The page names the action; its note sits in the notice card. */}
            {direct ? (
                <WarningCard>
                    <WarningLine>{t('settings.thisWallet.useAtLeastCharactersA', { MIN_WALLET_PASSWORD_LENGTH })}</WarningLine>
                </WarningCard>
            ) : null}
            <FormPage onSubmit={submit} sectioned={!direct} label={t('settings.thisWallet.changeWalletPassword')} aria-busy={busy}>
                <FormSection
                    title={direct ? undefined : t('settings.thisWallet.changeWalletPassword')}
                    description={direct ? undefined : t('settings.thisWallet.useAtLeastCharactersA', { MIN_WALLET_PASSWORD_LENGTH })}
                >
                    <Input
                        ref={currentRef}
                        type="password"
                        revealable
                        label={t('settings.thisWallet.currentWalletPassword')}
                        value={currentPassword}
                        onChange={update(setCurrentPassword)}
                        aria-label={t('settings.thisWallet.currentWalletPassword')}
                        help={t('settings.thisWallet.currentPasswordHelp')}
                        autoComplete="current-password"
                        autoFocus
                        disabled={busy}
                        error={fieldError('current')}
                    />
                    <Input
                        ref={newRef}
                        type="password"
                        revealable
                        label={t('settings.thisWallet.newWalletPassword')}
                        value={newPassword}
                        onChange={update(setNewPassword)}
                        aria-label={t('settings.thisWallet.newWalletPassword')}
                        help={t('settings.thisWallet.newPasswordHelp')}
                        autoComplete="new-password"
                        disabled={busy}
                        error={fieldError('new')}
                    />
                    <Input
                        ref={confirmRef}
                        type="password"
                        revealable
                        label={t('settings.thisWallet.confirmNewWalletPassword')}
                        value={confirmation}
                        onChange={update(setConfirmation)}
                        aria-label={t('settings.thisWallet.confirmNewWalletPassword')}
                        help={t('settings.thisWallet.confirmNewPasswordHelp')}
                        autoComplete="new-password"
                        disabled={busy}
                        error={confirmError}
                        errorKey={confirmation}
                    />
                    <div className={styles.actions}>
                        {direct ? null : (
                            <Button type="button" variant="secondary" size="sm" icon={<Icon.XIcon />} onClick={close} disabled={busy}>
                                {t('common.cancel')}
                            </Button>
                        )}
                        <Button type="submit" variant="success" size={direct ? 'md' : 'sm'} block={direct} icon={<Icon.KeyIcon />} disabled={busy}>
                            {busy ? t('settings.thisWallet.changingPassword') : t('settings.thisWallet.changePassword')}
                        </Button>
                    </div>
                </FormSection>
            </FormPage>
        </SettingsInlineForm>
    );
}

// The Extended public keys page opened from Account Details (operator ruling
// 2026-11-15): one page that shows the account's keys at once, with no intro
// step and no password. The host reads them from the unlocked session's
// signer and returns only xpub strings, which are filtered again here. A
// hardware wallet keeps its keys on the device and a private-key-only wallet
// has no HD keys, so each says so instead.
function AccountPublicKeys({ activeWallet, activeAccount }) {
    const { messaging } = useMessaging();
    const [state, setState] = useState(
        /** @type {{ status: 'loading' | 'shown' | 'error', entries: Array<any>, error: string | null }} */
        ({ status: 'loading', entries: [], error: null }),
    );
    const walletId = activeWallet?.id || '';
    const format = activeWallet?.format || '';
    const hardware = isHardwareWallet(activeWallet);
    const accountIndex = Number.isInteger(activeAccount?.index) ? activeAccount.index : 0;
    const readable = !!walletId && !hardware && format !== 'wif-only';

    useEffect(() => {
        if (!readable) return undefined;
        let cancelled = false;
        setState({ status: 'loading', entries: [], error: null });
        if (typeof messaging?.pairingPayloadRequest !== 'function') {
            setState({ status: 'error', entries: [], error: 'Extended public key export is not wired in this shell yet.' });
            return undefined;
        }
        Promise.resolve(messaging.pairingPayloadRequest({ walletId, accountIndex, publicExport: true }))
            .then((result) => {
                if (cancelled) return;
                const entries = publicKeyEntries(result);
                setState(entries.length > 0
                    ? { status: 'shown', entries, error: null }
                    : { status: 'error', entries: [], error: 'This wallet returned no valid extended public keys.' });
            })
            .catch((err) => {
                if (!cancelled) setState({ status: 'error', entries: [], error: userFacingMessage(err, 'Could not read the extended public keys.') });
            });
        return () => { cancelled = true; };
    }, [messaging, readable, walletId, accountIndex]);

    if (!activeWallet) return <Status text={t('settings.thisWallet.noActiveWallet')} />;
    if (hardware) return <Status text={t('settings.thisWallet.publicKeysOnDevice')} />;
    if (format === 'wif-only') return <Status text={t('settings.thisWallet.notAvailableForAPrivate')} />;
    if (state.status === 'error') return <Status text={state.error} tone="error" />;
    if (state.status === 'loading') return <div role="status" aria-busy="true">{t('settings.thisWallet.readingPublicKeys')}</div>;
    const accountName = activeAccount?.name;
    return (
        <div className={styles.stack}>
            <FormSection
                title={accountName ? t('settings.thisWallet.extendedPublicKeysFor', { name: accountName }) : t('settings.thisWallet.extendedPublicKeys')}
                description={t('settings.thisWallet.publicKeysNote')}
                className={cardStyles.card}
            >
                <PublicKeyEntries entries={state.entries} />
            </FormSection>
        </div>
    );
}

function PublicKeyEntries({ entries }) {
    return entries.map((entry) => (
        <FormSection
            key={`${entry.chainId}:${entry.path}`}
            title={publicKeyTitle(entry)}
            description={entry.path ? t('settings.thisWallet.accountPath', { path: entry.path }) : undefined}
            headingLevel="h3"
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
    ));
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
        <SettingsInlineForm onCancel={onClose} cancelDisabled={busy}>
            <Status text={stage === 'password' ? error : null} tone="error" />
            {stage === 'password' ? (
                <FormPage
                    onSubmit={onSubmit}
                    sectioned
                    submitFromAnyField
                    label={(accountName ? t('settings.thisWallet.extendedPublicKeysFor', { name: accountName }) : t('settings.thisWallet.extendedPublicKeys'))}
                >
                    <FormSection
                        title={(accountName ? t('settings.thisWallet.extendedPublicKeysFor', { name: accountName }) : t('settings.thisWallet.extendedPublicKeys'))}
                        description={t('settings.thisWallet.anExtendedPublicKeyDoes')}
                    >
                        <Input
                            type="password"
                            revealable
                            label={t('settings.thisWallet.confirmWalletPassword')}
                            value={password}
                            onChange={(event) => onPasswordChange(event.target.value)}
                            placeholder={t('send.gated.passwordLabel')}
                            help={t('settings.thisWallet.exportPasswordHelp')}
                            autoComplete="current-password"
                            autoFocus
                            disabled={busy}
                        />
                        <div className={styles.actions}>
                            <Button type="button" variant="secondary" size="sm" icon={<Icon.XIcon />} onClick={onClose} disabled={busy}>
                                {t('common.cancel')}
                            </Button>
                            <Button type="submit" variant="success" size="sm" icon={<Icon.DownloadIcon />} disabled={busy}>
                                {busy ? t('settings.backup.exporting') : t('settings.thisWallet.exportKeys')}
                            </Button>
                        </div>
                    </FormSection>
                </FormPage>
            ) : (
                <FormSection
                    title={(accountName ? t('settings.thisWallet.extendedPublicKeysFor', { name: accountName }) : t('settings.thisWallet.extendedPublicKeys'))}
                    description={t('settings.thisWallet.anExtendedPublicKeyDoes')}
                    className={cardStyles.card}
                >
                    <>
                        <PublicKeyEntries entries={entries} />
                        <div className={styles.actions}>
                            <Button type="button" variant="secondary" size="sm" icon={<Icon.CheckIcon />} onClick={onClose}>{t('common.done')}</Button>
                        </div>
                    </>
                </FormSection>
            )}
        </SettingsInlineForm>
    );
}

function Row({ label, hint, actionLabel, actionIcon, onClick, disabled = false }) {
    return (
        <SettingsActionRow label={label} hint={hint}>
            {actionLabel && onClick ? (
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    icon={actionIcon}
                    onClick={onClick}
                    disabled={disabled}
                >
                    {actionLabel}
                </Button>
            ) : null}
        </SettingsActionRow>
    );
}

function RemoveConfirm({ walletName, busy, error, onCancel, onConfirm, direct = false }) {
    const [typed, setTyped] = useState('');
    // Require the exact wallet name, so an accidental tap never removes the
    // wallet. The red button stays enabled (G130): a tap before the name
    // matches marks the field and leads the form with the error summary.
    const matches = typed === walletName;
    const formErrors = useFormErrors();
    const confirmIfTyped = () => {
        if (busy) return;
        if (!formErrors.validate({
            [REMOVE_CONFIRM_ID]: matches ? null : t('settings.thisWallet.typeTheWalletName', { walletName }),
        })) return;
        onConfirm();
    };
    if (direct) {
        const submit = (event) => {
            event.preventDefault();
            confirmIfTyped();
        };
        return (
            <>
                <Status text={error} tone="error" />
                {/* One danger notice first, then the confirm field and the red
                    main action. Bare on a phone; on wide screens FormPage draws
                    its own centred card at the shared form width. */}
                <FormPage className={styles.removeDirect} onSubmit={submit} label={t('walletDetails.remove.title')} errors={formErrors}>
                    <StatusMessage variant="error" title={t('settings.thisWallet.removeDirectTitle')} testId="remove-wallet-danger-notice">
                        <p className={styles.confirmName}>{walletName}</p>
                        {/* One flowing paragraph: the two sentences never sit on their own lines. */}
                        <p data-testid="remove-wallet-danger-body">
                            {t('settings.thisWallet.removeDirectDeleted')} {t('settings.thisWallet.removeDirectLost')}
                        </p>
                    </StatusMessage>
                    <Input
                        id={REMOVE_CONFIRM_ID}
                        type="text"
                        enterKeyHint="done"
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        value={typed}
                        onChange={(e) => setTyped(e.target.value)}
                        placeholder={walletName}
                        label={t('settings.thisWallet.confirmWalletName')}
                        help={t('settings.thisWallet.removeNameHelp')}
                        aria-label={t('settings.thisWallet.confirmWalletName')}
                        autoFocus
                        disabled={busy}
                    />
                    <Button type="submit" variant="danger" block icon={<Icon.TrashIcon />} disabled={busy}>
                        {busy ? t('settings.thisWallet.removing') : t('settings.thisWallet.removeWalletAction')}
                    </Button>
                </FormPage>
            </>
        );
    }
    return (
        <SettingsInlineForm onCancel={onCancel} cancelDisabled={busy}>
            <Status text={error} tone="error" />
            <FormErrorSummary form={formErrors} />
            <FormSection
                title={t('settings.thisWallet.remove2', { walletName })}
                description={(
                    <>
                        {t('settings.thisWallet.itsAccountsAddressesSignersAnd')}{' '}
                        <strong className={styles.confirmName}>{walletName}</strong> {t('settings.thisWallet.toConfirm')}
                    </>
                )}
                className={cardStyles.card}
            >
                <Input
                    type="text"
                    enterKeyHint="done"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    value={typed}
                    onChange={(e) => { setTyped(e.target.value); formErrors.clear(REMOVE_CONFIRM_ID); }}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' && matches && !busy) onConfirm();
                    }}
                    placeholder={walletName}
                    label={t('settings.thisWallet.confirmWalletName')}
                    help={t('settings.thisWallet.removeNameHelp')}
                    aria-label={t('settings.thisWallet.confirmWalletName')}
                    autoFocus
                    disabled={busy}
                    error={formErrors.errorFor(REMOVE_CONFIRM_ID)}
                    errorKey={formErrors.attempt}
                />
                <div className={styles.actions}>
                    <Button type="button" variant="secondary" size="sm" icon={<Icon.XIcon />} onClick={onCancel} disabled={busy}>
                        {t('common.cancel')}
                    </Button>
                    <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        icon={<Icon.TrashIcon />}
                        onClick={confirmIfTyped}
                        disabled={busy}
                    >
                        {busy ? t('settings.thisWallet.removing') : t('settings.thisWallet.removeWalletAction')}
                    </Button>
                </div>
            </FormSection>
        </SettingsInlineForm>
    );
}
