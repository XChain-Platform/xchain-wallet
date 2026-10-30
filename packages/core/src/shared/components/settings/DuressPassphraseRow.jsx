// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// DuressPassphraseRow: §26.5 / G068 part 2 Safety panel row.
//
// Three states:
//
//   not configured   "Set duress passphrase" reveals an inline form.
//                    The user confirms the current wallet password and types
//                    a different candidate twice; on submit the passphrase is
//                    hashed with a fresh 16-byte salt and stored in
//                    localStorage. Plaintext is never persisted.
//
//   configured       "Configured. Disable". A single click wipes the
//                    stored hash. There is intentionally no "view"
//                    affordance; the passphrase cannot be recovered
//                    from storage.
//
//   error            an error message (role="alert") above the form card, via
//                    SettingsInlineForm, with a one-click "Try again" recovery on storage-write failure.
//
//   not saved        storage refused the record or its removal. The row says
//                    which, above the row, with a "Try again" that writes the
//                    held salt and hash (or the removal) again, so the screen
//                    never reads Configured for a passphrase a restart drops,
//                    or Not configured for one a restart brings back.
//
// Setup verifies the current wallet password so a duress passphrase cannot
// equal it. Disable remains available to the unlocked session.

import { useRef, useState } from 'react';
import { Button, FormPage, FormSection, Input } from '@xchain-wallet/core/ui';
import { useMessaging } from '../../useMessaging.js';
import {
    isDuressConfigured,
    setDuressPassphrase,
    clearDuressPassphrase,
    getDuressSaveStatus,
    retryDuressSave,
    DURESS_SAVE_UNSAVED,
    DURESS_SAVE_CLEAR_FAILED,
} from '../../../flows/duressPassphrase.js';
import { ROW, ROW_HINT, SettingsInlineForm, useFocusAfterSwap } from './_settingsPrimitives.jsx';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/history.js';
import '../../../i18n/locales/en/settings.js';
import '../../../i18n/locales/en/verifySignature.js';

export function DuressPassphraseRow() {
    const { messaging } = useMessaging();
    const [configured, setConfigured] = useState(isDuressConfigured());
    const [saveStatus, setSaveStatus] = useState(getDuressSaveStatus);
    const [showForm, setShowForm] = useState(false);
    const [currentPassword, setCurrentPassword] = useState('');
    const [pass, setPass] = useState('');
    const [confirm, setConfirm] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));
    // Operational failures are retryable with the same inputs. Validation and
    // an incorrect current password require an edit, so those leave retryRef
    // null and the alert renders without a misleading "Try again" button.
    const retryRef = useRef(/** @type {null | (() => void)} */ (null));
    const swap = useFocusAfterSwap(configured);

    async function attemptSet() {
        if (busy) return;
        setError(null);
        retryRef.current = null;
        if (currentPassword.length === 0) {
            setError('Enter your current wallet password.');
            return;
        }
        if (pass.length === 0) {
            setError('Pick a passphrase.');
            return;
        }
        if (pass !== confirm) {
            setError('Passphrases do not match.');
            return;
        }
        if (pass === currentPassword) {
            setError('Duress passphrase must differ from your wallet password.');
            return;
        }
        setBusy(true);
        try {
            await messaging.unlockWallet(currentPassword);
            setDuressPassphrase(pass);
            setSaveStatus(getDuressSaveStatus());
            swap.request();
            setConfigured(true);
            setShowForm(false);
            setCurrentPassword('');
            setPass('');
            setConfirm('');
        } catch (err) {
            if (err?.name === 'InvalidPasswordError') {
                setError('Current wallet password is incorrect.');
            } else {
                retryRef.current = attemptSet;
                setError(err?.message || 'Could not save the duress passphrase.');
            }
        } finally {
            setBusy(false);
        }
    }

    function handleSet(event) {
        event.preventDefault();
        attemptSet();
    }

    function handleClear() {
        clearDuressPassphrase();
        setSaveStatus(getDuressSaveStatus());
        const stillConfigured = isDuressConfigured();
        if (!stillConfigured) swap.request();
        setConfigured(stillConfigured);
    }

    function retrySave() {
        const status = retryDuressSave();
        setSaveStatus(status);
        const stillConfigured = isDuressConfigured();
        if (stillConfigured !== configured) swap.request();
        setConfigured(stillConfigured);
    }

    function cancelForm() {
        setShowForm(false);
        setCurrentPassword('');
        setPass('');
        setConfirm('');
        setError(null);
    }

    const labelStyle = { color: 'var(--xc-text)', fontWeight: 500 };
    if (configured) {
        const saveNotice = saveStatus === DURESS_SAVE_UNSAVED
            ? t('settings.duress.notSaved')
            : saveStatus === DURESS_SAVE_CLEAR_FAILED
                ? t('settings.duress.couldNotRemove')
                : null;
        return (
            <SettingsInlineForm
                error={saveNotice}
                recovery={saveNotice ? { label: t('common.tryAgain'), onAction: retrySave } : undefined}
            >
                <div style={ROW}>
                    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                        <span style={labelStyle}>{t('settings.duress.duressPassphrase')}</span>
                        <span style={ROW_HINT}>
                            {t('settings.duress.configuredEnteringThisPassphraseOn')}
                        </span>
                    </div>
                    <Button ref={swap.target} type="button" size="sm" variant="ghost" icon={null} onClick={handleClear}>
                        {t('settings.biometric.disable')}
                    </Button>
                </div>
            </SettingsInlineForm>
        );
    }

    if (showForm) {
        return (
            <SettingsInlineForm
                error={error}
                recovery={retryRef.current ? { label: t('common.tryAgain'), onAction: retryRef.current } : undefined}
                onCancel={cancelForm}
                cancelDisabled={busy}
            >
                <FormPage
                    onSubmit={handleSet}
                    sectioned
                    submitFromAnyField
                    label={t('settings.duress.setDuressPassphrase')}
                >
                    <FormSection
                        title={t('settings.duress.setDuressPassphrase')}
                        description={t('settings.duress.pickAPassphraseThatIs')}
                        headingLevel="h3"
                    >
                    <Input
                        type="password"
                        revealable
                        enterKeyHint="next"
                        value={currentPassword}
                        onChange={(e) => { setCurrentPassword(e.target.value); if (error) setError(null); }}
                        placeholder={t('settings.thisWallet.currentWalletPassword')}
                        autoComplete="current-password"
                        aria-label={t('settings.thisWallet.currentWalletPassword')}
                    />
                    <Input
                        type="password"
                        revealable
                        enterKeyHint="next"
                        value={pass}
                        onChange={(e) => { setPass(e.target.value); if (error) setError(null); }}
                        placeholder={t('settings.duress.duressPassphrase')}
                        autoComplete="new-password"
                        aria-label={t('settings.duress.duressPassphrase')}
                    />
                    <Input
                        type="password"
                        revealable
                        enterKeyHint="done"
                        value={confirm}
                        onChange={(e) => { setConfirm(e.target.value); if (error) setError(null); }}
                        placeholder={t('settings.duress.confirmPassphrase')}
                        autoComplete="new-password"
                        aria-label={t('settings.duress.confirmDuressPassphrase')}
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--xc-space-2)' }}>
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            icon={null}
                            onClick={cancelForm}
                            disabled={busy}
                        >
                            {t('common.cancel')}
                        </Button>
                        <Button
                            type="submit"
                            size="sm"
                            icon={null}
                            disabled={busy || currentPassword.length === 0 || pass.length === 0 || confirm.length === 0}
                        >
                            {busy ? t('verifySignature.verifying') : t('history.contact.save')}
                        </Button>
                    </div>
                    </FormSection>
                </FormPage>
            </SettingsInlineForm>
        );
    }

    return (
        <div style={ROW}>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                <span style={labelStyle}>{t('settings.duress.duressPassphrase')}</span>
                <span style={ROW_HINT}>
                    {t('settings.duress.aSecondPasswordThatIf')}
                </span>
            </div>
            <Button ref={swap.target} type="button" size="sm" variant="ghost" icon={null} onClick={() => setShowForm(true)}>
                {t('settings.duress.set')}
            </Button>
        </div>
    );
}
