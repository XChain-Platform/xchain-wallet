// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The lock screen's Forgot Password pages (operator ruling 2026-11-16).
//
// Forgot Password used to erase the whole vault on a typed WIPE and send the
// user to restore, so anyone at the lock screen could destroy a wallet,
// imported private keys included. It now lists the ways back in this order,
// each its own Form Standard page (errors at the top, G129; buttons always in
// full colour, G130):
//
//   1. Reset with Recovery Phrase   only when a phrase wrap exists. Nothing is
//                                   erased: the phrase opens the vault and the
//                                   new password re-seals it.
//   2. Restore from Backup File     the file is checked first (file password,
//                                   payload, the wallet's own seals); only then
//                                   is the device erased and the restore opened.
//   3. Erase Everything             schedules an erase 48 hours out. The lock
//                                   screen shows it, any unlock cancels it.
//
// Both erase paths first try the demo password once (eraseIfDemoVault): a
// demo vault whose marker was lost is erased at once instead of waiting.
//
// Rendered by Locked.jsx, which keeps the screen guard (useProtectedScreen)
// on for every page here; the phrase page also holds it itself.

import { useEffect, useId, useState } from 'react';
import { Button, FormPage, Icon, Input, ListRow, PageHeader, Screen, StatusMessage, Textarea, useFormErrors } from '@xchain-wallet/core/ui';
import { FileField } from '../components/FileField.jsx';
import { isExactTypedConfirmation } from '../../flows/typedConfirmation.js';
import { useProtectedScreen } from '../utils/screenGuard.js';
import { scheduleErase } from '../../flows/eraseSchedule.js';
import {
    isBiometricRegistered,
    isBiometricSupported,
    unlockWithBiometric,
} from '../../flows/biometricUnlock.js';
import { wipeWalletStorage } from '../utils/wipeWalletStorage.js';
import { setForgotPasswordRestoreIntent } from '../utils/forgotPasswordRecovery.js';
import { eraseIfDemoVault } from '../utils/demoGraduation.js';
import styles from './Locked.module.css';
import { t } from '../../i18n/index.js';

const MIN_NEW_PASSWORD_LENGTH = 8;

/** @param {string} prefix */
function useFieldId(prefix) {
    return `${prefix}-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

/**
 * @param {object} props
 * @param {'popup' | 'page'} props.variant
 * @param {any} props.messaging
 * @param {() => void} props.onClose                                   back to the lock screen
 * @param {(reply: any, newPassword: string, result: { skippedWalletIds?: string[] }) => void} props.onPasswordReset
 * @param {(schedule: import('../../flows/eraseSchedule.js').EraseSchedule) => void} props.onEraseScheduled
 */
export function ForgotPassword({ variant, messaging, onClose, onPasswordReset, onEraseScheduled }) {
    const [page, setPage] = useState(/** @type {'choose' | 'phrase' | 'backup' | 'erase'} */ ('choose'));
    const [phraseReset, setPhraseReset] = useState(/** @type {boolean | null} */ (null));
    const [busy, setBusy] = useState(false);

    // Which ways back exist is the host's answer: only it can read the meta
    // slot. A shell without the lane, or a failed read, offers 2 and 3.
    useEffect(() => {
        let cancelled = false;
        if (typeof messaging?.recoveryStatus !== 'function') {
            setPhraseReset(false);
            return undefined;
        }
        Promise.resolve()
            .then(() => messaging.recoveryStatus())
            .then((status) => { if (!cancelled) setPhraseReset(status?.phraseReset === true); })
            .catch(() => { if (!cancelled) setPhraseReset(false); });
        return () => { cancelled = true; };
    }, [messaging]);

    function handleBack() {
        if (busy) return;
        if (page !== 'choose') {
            setPage('choose');
            return;
        }
        onClose();
    }

    return (
        <Screen
            variant={variant}
            header={(
                <PageHeader
                    nested
                    onBack={handleBack}
                    backDisabled={busy}
                    title={page === 'phrase'
                        ? t('locked.forgot.phrase.pageTitle')
                        : page === 'backup'
                            ? t('locked.forgot.backup.pageTitle')
                            : page === 'erase'
                                ? t('locked.forgot.erase.title')
                                : t('locked.forgotPassword')}
                />
            )}
        >
            {page === 'choose' ? (
                <FormPage label={t('locked.forgotPassword')}>
                    <StatusMessage variant="info" role={null} className={styles.restoreNotice}
                        title={t('locked.forgot.introTitle')}>
                        {t('locked.forgot.intro')}
                    </StatusMessage>
                    {phraseReset === null ? (
                        <p className={styles.unlockingNote} aria-live="polite">{t('locked.forgot.checking')}</p>
                    ) : (
                        /* Safari needs an explicit list role because this class removes list styling. */
                        <ul className={styles.restoreCard} role="list" aria-label={t('locked.restoreWalletAccess')}>
                            {phraseReset ? (
                                <li>
                                    <ListRow
                                        type="button"
                                        leading={<Icon.KeyIcon />}
                                        title={t('locked.forgot.phrase.title')}
                                        subtitle={t('locked.forgot.phrase.rowDescription')}
                                        chevron
                                        onClick={() => setPage('phrase')}
                                    />
                                </li>
                            ) : null}
                            <li>
                                <ListRow
                                    type="button"
                                    leading={<Icon.UploadIcon />}
                                    title={t('locked.forgot.backup.title')}
                                    subtitle={t('locked.forgot.backup.rowDescription')}
                                    chevron
                                    onClick={() => setPage('backup')}
                                />
                            </li>
                            <li>
                                <ListRow
                                    type="button"
                                    leading={<Icon.TrashIcon />}
                                    title={t('locked.forgot.erase.title')}
                                    subtitle={t('locked.forgot.erase.rowDescription')}
                                    chevron
                                    onClick={() => setPage('erase')}
                                />
                            </li>
                        </ul>
                    )}
                </FormPage>
            ) : null}
            {page === 'phrase' ? (
                <PhraseResetPage messaging={messaging} onBusy={setBusy} onPasswordReset={onPasswordReset} />
            ) : null}
            {page === 'backup' ? (
                <BackupRestorePage messaging={messaging} onBusy={setBusy} onEraseScheduled={onEraseScheduled} />
            ) : null}
            {page === 'erase' ? (
                <EraseSchedulePage messaging={messaging} onBusy={setBusy} onEraseScheduled={onEraseScheduled} />
            ) : null}
        </Screen>
    );
}

/**
 * 1. Reset with Recovery Phrase. A wrong phrase changes nothing and is said on
 * the phrase field, with the G129 summary at the top.
 */
function PhraseResetPage({ messaging, onBusy, onPasswordReset }) {
    // S4: a recording of this page is a recording of the recovery phrase.
    useProtectedScreen();
    const PHRASE_ID = useFieldId('forgot-phrase');
    const NEW_ID = useFieldId('forgot-new-password');
    const CONFIRM_ID = useFieldId('forgot-confirm-password');
    const errors = useFormErrors();
    const [phrase, setPhrase] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [busy, setBusy] = useState(false);

    // A native shell going to the background drops the typed words, as the
    // unlock field drops the password.
    useEffect(() => {
        if (typeof document === 'undefined') return undefined;
        const onPause = () => {
            setPhrase('');
            setNewPassword('');
            setConfirmPassword('');
        };
        document.addEventListener('pause', onPause);
        return () => document.removeEventListener('pause', onPause);
    }, []);

    async function handleSubmit(event) {
        event.preventDefault();
        if (busy) return;
        if (!errors.validate({
            [PHRASE_ID]: phrase.trim().length === 0 ? t('locked.forgot.phrase.required') : null,
            [NEW_ID]: newPassword.length < MIN_NEW_PASSWORD_LENGTH ? t('locked.forgot.phrase.passwordTooShort') : null,
            [CONFIRM_ID]: confirmPassword !== newPassword ? t('locked.forgot.phrase.passwordMismatch') : null,
        })) return;
        if (typeof messaging?.resetPasswordWithPhrase !== 'function') {
            errors.fail(t('locked.forgot.phrase.unavailable'));
            return;
        }
        setBusy(true);
        onBusy(true);
        try {
            const reply = await messaging.resetPasswordWithPhrase({ phrase, newPassword });
            setPhrase('');
            setConfirmPassword('');
            onBusy(false);
            onPasswordReset(reply, newPassword, { skippedWalletIds: reply?.skippedWalletIds });
            return;
        } catch (err) {
            const name = err?.name;
            if (name === 'RecoveryPhraseMismatchError') {
                errors.validate({ [PHRASE_ID]: t('locked.forgot.phrase.mismatch') });
            } else if (name === 'PhraseResetStaleError') {
                errors.fail(t('locked.forgot.phrase.stale'));
            } else if (name === 'PhraseResetUnavailableError') {
                errors.fail(t('locked.forgot.phrase.unavailable'));
            } else if (name === 'VaultInUseError' || name === 'VaultCoordinationUnavailableError') {
                errors.fail(err.message);
            } else {
                errors.fail(t('locked.forgot.phrase.failed'));
            }
        }
        setBusy(false);
        onBusy(false);
    }

    return (
        <FormPage label={t('locked.forgot.phrase.pageTitle')} onSubmit={handleSubmit} errors={errors}
            actions={(
                <Button type="submit" variant="success" block icon={<Icon.KeyIcon />} loading={busy}>
                    {t('locked.forgot.phrase.submit')}
                </Button>
            )}
        >
            <StatusMessage variant="info" role={null} className={styles.restoreNotice}
                title={t('locked.forgot.phrase.introTitle')}>
                {t('locked.forgot.phrase.intro')}
            </StatusMessage>
            <Textarea
                id={PHRASE_ID}
                label={t('locked.forgot.phrase.label')}
                help={t('locked.forgot.phrase.help')}
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                rows={3}
                disabled={busy}
            />
            <Input
                id={NEW_ID}
                type="password"
                revealable
                label={t('locked.forgot.phrase.newPassword')}
                help={t('locked.forgot.phrase.newPasswordHelp')}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                disabled={busy}
            />
            <Input
                id={CONFIRM_ID}
                type="password"
                revealable
                label={t('locked.forgot.phrase.confirmPassword')}
                help={t('locked.forgot.phrase.confirmPasswordHelp')}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                disabled={busy}
            />
        </FormPage>
    );
}

/**
 * 2. Restore from Backup File. Check first; the erase happens only on the
 * confirmation step, after the file opened, and a wrong file or password
 * erases nothing.
 *
 * The file and its passwords are never stored across the reload the erase
 * needs, so the restore form asks for the file again.
 */
function BackupRestorePage({ messaging, onBusy, onEraseScheduled }) {
    const FILE_ID = useFieldId('forgot-backup-file');
    const PASSWORD_ID = useFieldId('forgot-backup-password');
    const WALLET_PASSWORD_ID = useFieldId('forgot-backup-wallet-password');
    const WIPE_ID = useFieldId('forgot-backup-wipe');
    const errors = useFormErrors();
    const [fileName, setFileName] = useState('');
    const [fileContent, setFileContent] = useState('');
    const [password, setPassword] = useState('');
    const [walletPassword, setWalletPassword] = useState('');
    const [needsWalletPassword, setNeedsWalletPassword] = useState(false);
    const [verified, setVerified] = useState(/** @type {{ walletName: string, belongsToVault: boolean } | null} */ (null));
    const [wipeText, setWipeText] = useState('');
    const [busy, setBusy] = useState(false);

    function begin() { setBusy(true); onBusy(true); }
    function end() { setBusy(false); onBusy(false); }

    function handleFileChosen(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            setFileContent(typeof reader.result === 'string' ? reader.result : '');
            setFileName(file.name);
            setNeedsWalletPassword(false);
            setWalletPassword('');
            errors.clear?.(FILE_ID);
        };
        reader.onerror = () => errors.validate({ [FILE_ID]: t('locked.forgot.backup.unreadable') });
        reader.readAsText(file);
    }

    function clearFile() {
        setFileName('');
        setFileContent('');
        setNeedsWalletPassword(false);
        setWalletPassword('');
    }

    async function handleVerify(event) {
        event.preventDefault();
        if (busy) return;
        if (!errors.validate({
            [FILE_ID]: fileContent.trim().length === 0 ? t('locked.forgot.backup.noFile') : null,
            [PASSWORD_ID]: password.length === 0 ? t('locked.forgot.backup.passwordRequired') : null,
            [WALLET_PASSWORD_ID]: needsWalletPassword && walletPassword.length === 0
                ? t('locked.forgot.backup.walletPasswordRequired')
                : null,
        })) return;
        if (typeof messaging?.verifyBackupForRestore !== 'function') {
            errors.fail(t('locked.forgot.backup.unavailable'));
            return;
        }
        begin();
        try {
            const result = await messaging.verifyBackupForRestore({
                fileContent,
                password,
                ...(needsWalletPassword ? { walletPassword } : {}),
            });
            setVerified({
                walletName: typeof result?.walletName === 'string' ? result.walletName : '',
                belongsToVault: result?.belongsToVault === true,
            });
        } catch (err) {
            const name = err?.name;
            if (name === 'BackupPasswordError') {
                errors.validate({ [PASSWORD_ID]: t('locked.forgot.backup.wrongPassword') });
            } else if (name === 'BackupSeedPasswordError') {
                setNeedsWalletPassword(true);
                errors.validate({ [WALLET_PASSWORD_ID]: needsWalletPassword
                    ? t('locked.forgot.backup.wrongWalletPassword')
                    : t('locked.forgot.backup.walletPasswordNeeded') });
            } else if (name === 'BackupFormatError') {
                errors.validate({ [FILE_ID]: t('locked.forgot.backup.notBackup') });
            } else if (name === 'BackupSealDamagedError') {
                errors.validate({ [FILE_ID]: t('locked.forgot.backup.damaged') });
            } else {
                errors.fail(t('locked.forgot.backup.failed'));
            }
        }
        end();
    }

    async function handleErase(event) {
        event.preventDefault();
        if (busy) return;
        if (!errors.validate({
            [WIPE_ID]: isExactTypedConfirmation(wipeText, 'WIPE') ? null : t('locked.forgot.typeWipe'),
        })) return;
        begin();
        try {
            if (!verified?.belongsToVault) {
                let demoErased = false;
                try {
                    demoErased = await eraseIfDemoVault({
                        messaging,
                        beforeReload: () => setForgotPasswordRestoreIntent('backup'),
                    });
                } catch {
                    errors.fail(t('locked.forgot.eraseFailed'));
                    end();
                    return;
                }
                if (demoErased) return;
                const schedule = await scheduleErase();
                onBusy(false);
                onEraseScheduled(schedule);
                return;
            }
            await wipeWalletStorage();
            setForgotPasswordRestoreIntent('backup');
            if (typeof window !== 'undefined') window.location.reload();
        } catch {
            errors.fail(verified?.belongsToVault
                ? t('locked.forgot.eraseFailed')
                : t('locked.forgot.erase.scheduleFailed'));
            end();
        }
    }

    if (verified) {
        return (
            <FormPage label={t('locked.forgot.backup.pageTitle')} onSubmit={handleErase} errors={errors}
                actions={(
                    <Button type="submit" variant="danger" block icon={<Icon.TrashIcon />} loading={busy}>
                        {verified.belongsToVault
                            ? t('locked.forgot.backup.eraseAndRestore')
                            : t('locked.forgot.erase.submit')}
                    </Button>
                )}
            >
                <StatusMessage variant="danger" role={null} title={t('locked.forgot.backup.verifiedTitle')}>
                    <span>{verified.walletName
                        ? t('locked.forgot.backup.verifiedNamed', { name: verified.walletName })
                        : t('locked.forgot.backup.verified')}</span>
                    {' '}
                    <span>{verified.belongsToVault
                        ? t('locked.forgot.backup.eraseBody')
                        : t('locked.forgot.backup.foreignBody')}</span>
                </StatusMessage>
                <Input
                    id={WIPE_ID}
                    type="text"
                    label={t('vaultUnavailable.wipeConfirm')}
                    help={t('common.typedConfirmationHint', { word: 'WIPE' })}
                    value={wipeText}
                    onChange={(e) => setWipeText(e.target.value)}
                    autoComplete="off"
                    autoCapitalize="characters"
                    disabled={busy}
                />
            </FormPage>
        );
    }

    return (
        <FormPage label={t('locked.forgot.backup.pageTitle')} onSubmit={handleVerify} errors={errors}
            actions={(
                <Button type="submit" variant="success" block icon={<Icon.VerifyIcon />} loading={busy}>
                    {t('locked.forgot.backup.check')}
                </Button>
            )}
        >
            <StatusMessage variant="info" role={null} className={styles.restoreNotice}
                title={t('locked.forgot.backup.introTitle')}>
                {t('locked.forgot.backup.intro')}
            </StatusMessage>
            <FileField
                id={FILE_ID}
                label={t('locked.forgot.backup.fileLabel')}
                help={t('locked.forgot.backup.fileHelp')}
                fileName={fileName}
                inputLabel={t('locked.forgot.backup.choose')}
                accept=".xchain-wallet,.json,.txt,application/json,text/plain"
                onFile={handleFileChosen}
                onClear={clearFile}
                disabled={busy}
            />
            <Input
                id={PASSWORD_ID}
                type="password"
                revealable
                label={t('locked.forgot.backup.password')}
                help={t('locked.forgot.backup.passwordHelp')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
                disabled={busy}
            />
            {needsWalletPassword ? (
                <Input
                    id={WALLET_PASSWORD_ID}
                    type="password"
                    revealable
                    label={t('locked.forgot.backup.walletPassword')}
                    help={t('locked.forgot.backup.walletPasswordHelp')}
                    value={walletPassword}
                    onChange={(e) => setWalletPassword(e.target.value)}
                    autoComplete="off"
                    disabled={busy}
                />
            ) : null}
        </FormPage>
    );
}

/**
 * 3. Erase Everything, after a 48-hour hold. Where the device can prove its
 * owner (a registered biometric), it must before the erase is scheduled.
 */
function EraseSchedulePage({ messaging, onBusy, onEraseScheduled }) {
    const WIPE_ID = useFieldId('forgot-erase-wipe');
    const errors = useFormErrors();
    const [wipeText, setWipeText] = useState('');
    const [busy, setBusy] = useState(false);

    async function handleSubmit(event) {
        event.preventDefault();
        if (busy) return;
        if (!errors.validate({
            [WIPE_ID]: isExactTypedConfirmation(wipeText, 'WIPE') ? null : t('locked.forgot.typeWipe'),
        })) return;
        setBusy(true);
        onBusy(true);
        // A demo vault is erased at once and the reload lands on Welcome.
        try {
            if (await eraseIfDemoVault({ messaging })) return;
        } catch {
            errors.fail(t('locked.forgot.eraseFailed'));
            setBusy(false);
            onBusy(false);
            return;
        }
        try {
            // Device authentication where the shell has it. The unwrapped
            // value is not used: only that the device owner answered.
            if (isBiometricRegistered() && await isBiometricSupported()) {
                try {
                    await unlockWithBiometric();
                } catch {
                    errors.fail(t('locked.forgot.erase.deviceAuthFailed'));
                    setBusy(false);
                    onBusy(false);
                    return;
                }
            }
            const schedule = await scheduleErase();
            onBusy(false);
            onEraseScheduled(schedule);
        } catch {
            errors.fail(t('locked.forgot.erase.scheduleFailed'));
            setBusy(false);
            onBusy(false);
        }
    }

    return (
        <FormPage label={t('locked.forgot.erase.title')} onSubmit={handleSubmit} errors={errors}
            actions={(
                <Button type="submit" variant="danger" block icon={<Icon.TrashIcon />} loading={busy}>
                    {t('locked.forgot.erase.submit')}
                </Button>
            )}
        >
            <StatusMessage variant="danger" role={null} title={t('locked.forgot.erase.warningTitle')}>
                {t('locked.forgot.erase.warningBody')}
            </StatusMessage>
            <Input
                id={WIPE_ID}
                type="text"
                label={t('vaultUnavailable.wipeConfirm')}
                help={t('common.typedConfirmationHint', { word: 'WIPE' })}
                value={wipeText}
                onChange={(e) => setWipeText(e.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
                disabled={busy}
            />
        </FormPage>
    );
}
