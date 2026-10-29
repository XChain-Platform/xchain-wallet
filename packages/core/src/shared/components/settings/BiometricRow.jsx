// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// BiometricRow (§35): Safety panel row that owns the §26 / G063 biometric
// unlock affordance. Three states:
//
//   not-supported    Nothing on this device can release the password.
//                    Renders the provider's own reason and disables
//                    interaction.
//   supported-off    No credential registered. Reveals an inline password
//                    field; on submit, runs `registerBiometricCredential`
//                    so the wallet password is wrapped by whatever the
//                    active provider wraps it with.
//   supported-on     Credential registered. Offers re-enrolment and a Disable
//                    button that discards the wrap. (The platform credential
//                    itself can only be cleared via OS settings, by design.)
//
// This component names NO vendor and NO browser API, and a smoke test
// enforces that. It used to hardcode two desktop-platform brand
// names and explain unavailability in terms of the browser credential API,
// which on a phone is wrong twice over: neither brand is what the device
// does, and the true reason there is usually "nothing is enrolled yet" - a
// reason the native provider already had and this row discarded. All such
// wording now comes from `describeBiometric()`, so adding a third shell means
// teaching its provider to speak, not editing shared UI.
//
// The component re-checks support + registration on mount and after any
// state change so toggling between OS settings + the wallet stays in
// sync without a refresh.

import { useEffect, useRef, useState } from 'react';
import { Button, FormPage, FormSection, Input, StatusMessage } from '@xchain-wallet/core/ui';
import { useMessaging } from '../../useMessaging.js';
import {
    describeBiometric,
    isBiometricRegistered,
    clearBiometricCredential,
    registerBiometricCredential,
} from '../../../flows/biometricUnlock.js';
import { ROW, ROW_HINT, SettingsInlineForm } from './_settingsPrimitives.jsx';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/send.js';
import '../../../i18n/locales/en/settings.js';

export function BiometricRow() {
    const { messaging } = useMessaging();
    // null while the probe is in flight; afterwards the provider's full
    // self-description, which is where every user-facing noun below comes from.
    const [description, setDescription] = useState(
        /** @type {null | Awaited<ReturnType<typeof describeBiometric>>} */ (null),
    );
    const [registered, setRegistered] = useState(isBiometricRegistered());
    const [enrolAction, setEnrolAction] = useState(/** @type {null | 'enable' | 'reenrol'} */ (null));
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));
    // Re-run the pairing attempt on the recorded action. Biometric
    // registration failures (prompt timeout, user-cancelled the OS dialog,
    // transient provider error) are always retryable with the same password
    // still in the field, so the error surface offers a one-click "Try again".
    const retryRef = useRef(/** @type {null | (() => void)} */ (null));

    // Probed on mount and again whenever the app comes back into view: the
    // person removes or adds a face or finger in the device settings, which
    // leaves this screen mounted, and a row still reading "Enabled" after
    // biometrics are gone offers an unlock that cannot work.
    useEffect(() => {
        let cancelled = false;
        let probeGeneration = 0;
        const probe = () => {
            const generation = ++probeGeneration;
            describeBiometric().then((described) => {
                // A resumed app can finish its fresh device check before a
                // throttled hidden-tab check. Only the latest request owns the
                // row so an older answer cannot restore stale availability.
                if (cancelled || generation !== probeGeneration) return;
                setDescription(described);
                setRegistered(isBiometricRegistered());
            }).catch(() => {
                if (!cancelled && generation === probeGeneration) {
                    setDescription({
                        supported: false,
                        reason: 'Could not check biometric unlock on this device.',
                        mechanism: 'device unlock',
                        wrapNote: '',
                    });
                }
            });
        };
        const onVisible = () => {
            if (globalThis.document?.visibilityState !== 'hidden') probe();
        };
        probe();
        globalThis.addEventListener?.('focus', probe);
        globalThis.document?.addEventListener?.('visibilitychange', onVisible);
        return () => {
            cancelled = true;
            globalThis.removeEventListener?.('focus', probe);
            globalThis.document?.removeEventListener?.('visibilitychange', onVisible);
        };
    }, []);

    const refreshRegistered = () => setRegistered(isBiometricRegistered());

    async function doEnable() {
        if (busy || password.length === 0) return;
        setBusy(true);
        setError(null);
        retryRef.current = null;
        try {
            await messaging.unlockWallet(password);
            await registerBiometricCredential({ password });
            setPassword('');
            setEnrolAction(null);
            refreshRegistered();
        } catch (err) {
            // Closing the prompt is a choice, not a failure: leave the form
            // as it was, with no error.
            if (err?.name === 'BiometricCancelledError') return;
            if (err?.name === 'InvalidPasswordError') {
                setError('Incorrect wallet password.');
            } else {
                retryRef.current = doEnable;
                setError(err?.message || 'Biometric enrolment failed.');
            }
        } finally {
            setBusy(false);
        }
    }

    function handleEnable(event) {
        event.preventDefault();
        doEnable();
    }

    function cancelEnrol() {
        setEnrolAction(null);
        setPassword('');
        setError(null);
    }

    async function handleDisable() {
        if (busy) return;
        setBusy(true);
        setError(null);
        retryRef.current = null;
        try {
            await clearBiometricCredential();
            if (isBiometricRegistered()) {
                throw new Error('Biometric unlock could not be disabled.');
            }
            refreshRegistered();
        } catch (err) {
            retryRef.current = handleDisable;
            setError(err?.message || 'Biometric unlock could not be disabled.');
        } finally {
            setBusy(false);
        }
    }

    const labelStyle = { color: 'var(--xc-text)', fontWeight: 500 };
    if (description === null) {
        return (
            <div style={ROW}>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <span style={labelStyle}>{t('settings.biometric.biometricUnlock')}</span>
                    <span style={ROW_HINT}>{t('settings.biometric.checkingThisDevice')}</span>
                </div>
            </div>
        );
    }

    if (!description.supported) {
        return (
            <div style={ROW}>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <span style={labelStyle}>{t('settings.biometric.biometricUnlock')}</span>
                    <span style={ROW_HINT}>{t('settings.biometric.notAvailable')} {description.reason}</span>
                </div>
            </div>
        );
    }

    if (registered && enrolAction === null) {
        return (
            <div style={{ ...ROW, alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, gap: 'var(--xc-space-2)' }}>
                    <div>
                        <span style={labelStyle}>{t('settings.biometric.biometricUnlock')}</span>
                        <span style={{ ...ROW_HINT, display: 'block' }}>
                            {t('settings.biometric.enabledUse')} {description.mechanism} {t('settings.biometric.onTheUnlockScreenRe')}
                        </span>
                    </div>
                    {error ? (
                        <StatusMessage
                            variant="error"
                            recovery={retryRef.current ? { label: t('common.tryAgain'), onAction: retryRef.current } : undefined}
                        >
                            {error}
                        </StatusMessage>
                    ) : null}
                </div>
                <div style={{ display: 'flex', gap: 'var(--xc-space-2)' }}>
                    <Button type="button" size="sm" variant="ghost" icon={null} onClick={() => { setEnrolAction('reenrol'); setError(null); }}>
                        {t('settings.biometric.reEnrol')}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" icon={null} onClick={handleDisable} disabled={busy}>
                        {busy ? t('settings.biometric.disabling') : t('settings.biometric.disable')}
                    </Button>
                </div>
            </div>
        );
    }

    if (enrolAction !== null) {
        const isReenrol = enrolAction === 'reenrol';
        return (
            <SettingsInlineForm
                error={error}
                recovery={retryRef.current ? { label: t('common.tryAgain'), onAction: retryRef.current } : undefined}
                onCancel={cancelEnrol}
                cancelDisabled={busy}
            >
                <FormPage
                    onSubmit={handleEnable}
                    sectioned
                    submitFromAnyField
                    label={`${isReenrol ? t('settings.biometric.reEnrol') : t('settings.biometric.enable')} ${t('settings.biometric.biometricUnlock2')}`}
                >
                    <FormSection
                        title={`${isReenrol ? t('settings.biometric.reEnrol') : t('settings.biometric.enable')} ${t('settings.biometric.biometricUnlock2')}`}
                        headingLevel="h3"
                        description={(
                            <>
                            {t('settings.biometric.confirmYourCurrentWalletPassword')} {description.wrapNote}
                            </>
                        )}
                    >
                    <Input
                        type="password"
                        revealable
                        enterKeyHint="go"
                        value={password}
                        onChange={(e) => { setPassword(e.target.value); if (error) setError(null); }}
                        placeholder={t('send.gated.passwordLabel')}
                        autoComplete="current-password"
                        aria-label={t('send.gated.passwordLabel')}
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--xc-space-2)' }}>
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            icon={null}
                            onClick={cancelEnrol}
                            disabled={busy}
                        >
                            {t('common.cancel')}
                        </Button>
                        <Button
                            type="submit"
                            size="sm"
                            icon={null}
                            disabled={busy || password.length === 0}
                        >
                            {busy ? t('settings.biometric.pairing') : (isReenrol ? t('settings.biometric.reEnrol') : t('settings.biometric.enable'))}
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
                <span style={labelStyle}>{t('settings.biometric.biometricUnlock')}</span>
                <span style={ROW_HINT}>
                    {t('settings.biometric.use')} {description.mechanism} {t('settings.biometric.toUnlockWithoutTypingYour')}
                </span>
            </div>
            <Button
                type="button"
                size="sm"
                variant="ghost"
                icon={null}
                onClick={() => setEnrolAction('enable')}
            >
                {t('settings.biometric.enable')}
            </Button>
        </div>
    );
}
