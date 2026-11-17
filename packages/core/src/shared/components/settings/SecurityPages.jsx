// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Settings > Security pages and rows (operator rulings 2026-11-14):
//   - Enable Biometric Unlock: the page the Biometric unlock switch opens
//     when it is turned on. One password field and a green Enable button;
//     success returns to Security with the switch on, Back or a failed
//     enrolment returns with it off.
//   - Panic Mode: the page the Panic mode chevron row opens. Inactive, it
//     shows a freeze notice and one red Confirm (Back leaves); active, it
//     shows the time left and Deactivate.
//   - New-recipient test send: the threshold in the display currency on its
//     row, as the themed dropdown (Off, four amounts, Custom); Custom opens an
//     amount field in place under the row.

import { useEffect, useId, useRef, useState } from 'react';
import { Button, FormPage, FormSection, Icon, Input, Select, StatusMessage } from '@xchain-wallet/core/ui';
import { useMessaging } from '../../useMessaging.js';
import {
    describeBiometric,
    isBiometricRegistered,
    registerBiometricCredential,
} from '../../../flows/biometricUnlock.js';
import {
    activatePanicMode,
    deactivatePanicMode,
    getPanicModeState,
    getPanicRemainingMs,
    subscribePanicModeSaveStatus,
} from '../../../flows/panicMode.js';
import {
    TEST_SEND_FIAT_MAX,
    TEST_SEND_FIAT_OFF,
    TEST_SEND_FIAT_PRESETS,
    isTestSendFiat,
} from '../../../schemas/settings.js';
import { formatFiatAmount } from '../../utils/fiatAmountFormat.js';
import {
    dropFieldGrouping,
    formatWithThousands,
    normalizeLocalizedDecimal,
} from '../../utils/amountFormat.js';
import { formatPanicCountdown } from './PanicModeRow.jsx';
import { PanicSaveNotice } from './PanicSaveNotice.jsx';
import { InlineRowFrame } from './SettingsInlineRow.jsx';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/send.js';
import '../../../i18n/locales/en/settings.js';
import '../../../i18n/locales/en/ui.js';
import styles from './SecurityPages.module.css';

/** The Settings page id of Enable Biometric Unlock (opened by the switch, not listed as a row). */
export const BIOMETRIC_ENABLE_PAGE_ID = 'security-biometric-enable';

// A failed enrolment returns to Security with the switch off; the reason
// waits here for the Biometric unlock row to show once under it.
let pendingBiometricNotice = /** @type {string | null} */ (null);

/** The failed-enrolment reason left for the Biometric unlock row, if any. */
export function peekBiometricEnrolNotice() {
    return pendingBiometricNotice;
}

/** Drops the reason once the row has shown it. */
export function clearBiometricEnrolNotice() {
    pendingBiometricNotice = null;
}

/**
 * Enable Biometric Unlock. `onDone` returns to Security: after a successful
 * enrolment (the switch then reads on) or a failed one (it reads off, with
 * the reason under it). A wrong password stays here to be typed again, and a
 * closed device prompt leaves the form as it was.
 *
 * @param {object} props
 * @param {() => void} [props.onDone]
 */
export function BiometricEnablePage({ onDone }) {
    const { messaging } = useMessaging();
    const [description, setDescription] = useState(
        /** @type {null | Awaited<ReturnType<typeof describeBiometric>>} */ (null),
    );
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const formRef = useRef(/** @type {HTMLFormElement | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        describeBiometric().then((described) => {
            if (!cancelled) setDescription(described);
        }).catch(() => {
            if (!cancelled) setDescription({ supported: false, reason: '', mechanism: '', wrapNote: '' });
        });
        return () => { cancelled = true; };
    }, []);

    // The cursor lands in the password field, not on its help tip.
    useEffect(() => {
        if (description?.supported) formRef.current?.querySelector('input')?.focus();
    }, [description]);

    const enable = async (event) => {
        event?.preventDefault?.();
        if (busy || password.length === 0) return;
        setBusy(true);
        setError(null);
        try {
            await messaging.unlockWallet(password);
        } catch (err) {
            setBusy(false);
            setError(err?.name === 'InvalidPasswordError'
                ? t('settings.security.biometricWrongPassword')
                : (err?.message || t('settings.security.biometricWrongPassword')));
            return;
        }
        try {
            await registerBiometricCredential({ password });
            setPassword('');
            setBusy(false);
            onDone?.();
        } catch (err) {
            setBusy(false);
            // Closing the device prompt is a choice, not a failure.
            if (err?.name === 'BiometricCancelledError') return;
            setPassword('');
            pendingBiometricNotice = t('settings.security.biometricEnrolFailed', { reason: err?.message || '' }).trim();
            onDone?.();
        }
    };

    if (description === null) return <StatusMessage variant="info">{t('settings.biometric.checkingThisDevice')}</StatusMessage>;
    if (!description.supported || isBiometricRegistered()) {
        return (
            <StatusMessage variant={description.supported ? 'success' : 'info'}>
                {description.supported
                    ? `${t('settings.biometric.enabledUse')} ${description.mechanism} ${t('settings.biometric.onTheUnlockScreenRe')}`
                    : `${t('settings.biometric.notAvailable')} ${description.reason || ''}`.trim()}
            </StatusMessage>
        );
    }
    return (
        <FormPage
            ref={formRef}
            onSubmit={enable}
            sectioned
            submitFromAnyField
            label={t('settings.safety.enableBiometric')}
        >
            <FormSection>
                <p className={styles.intro}>{t('settings.security.biometricEnableIntro', { mechanism: description.mechanism })}</p>
                <Input
                    type="password"
                    revealable
                    enterKeyHint="go"
                    label={t('send.gated.passwordLabel')}
                    help={`${t('settings.biometric.confirmYourCurrentWalletPassword')} ${description.wrapNote || ''}`.trim()}
                    value={password}
                    error={error || undefined}
                    onChange={(e) => { setPassword(e.target.value); if (error) setError(null); }}
                    placeholder={t('send.gated.passwordLabel')}
                    autoComplete="current-password"
                    aria-label={t('send.gated.passwordLabel')}
                />
                <Button
                    type="submit"
                    variant="success"
                    block
                    icon={<Icon.UnlockIcon />}
                    disabled={busy || password.length === 0}
                >
                    {busy ? t('settings.security.biometricEnabling') : t('settings.safety.enableBiometric')}
                </Button>
            </FormSection>
        </FormPage>
    );
}

/** The Panic mode row's line: what it does, or how long the freeze has left. */
export function panicRowSummary() {
    let remaining = 0;
    try { remaining = getPanicRemainingMs(getPanicModeState()); } catch { remaining = 0; }
    return remaining > 0
        ? t('settings.security.panicActiveLine', { remaining: formatPanicCountdown(remaining) })
        : t('settings.security.panicLine');
}

/**
 * Panic Mode. Inactive: a notice that everything freezes for 24 hours and one
 * red Confirm button (Back is the way out); confirming starts the freeze and returns to Security. Active: the
 * time left and Deactivate, which ends it and returns.
 *
 * @param {object} props
 * @param {() => void} [props.onDone]
 */
export function PanicModePage({ onDone }) {
    const [remainingMs, setRemainingMs] = useState(() => getPanicRemainingMs(getPanicModeState()));
    const [busy, setBusy] = useState(false);

    // A refused save changes what this context enforces, so the page re-reads.
    useEffect(() => subscribePanicModeSaveStatus(() => {
        setRemainingMs(getPanicRemainingMs(getPanicModeState()));
    }), []);
    useEffect(() => {
        if (remainingMs <= 0) return undefined;
        const handle = window.setInterval(() => setRemainingMs(getPanicRemainingMs(getPanicModeState())), 60_000);
        return () => window.clearInterval(handle);
    }, [remainingMs]);

    const confirm = () => {
        activatePanicMode();
        onDone?.();
    };
    const deactivate = async () => {
        setBusy(true);
        try {
            await deactivatePanicMode();
        } finally {
            setBusy(false);
        }
        const left = getPanicRemainingMs(getPanicModeState());
        setRemainingMs(left);
        // A clear that did not save keeps the freeze; PanicSaveNotice says so here.
        if (left <= 0) onDone?.();
    };

    if (remainingMs > 0) {
        return (
            <div className={styles.panicForm} data-panic-form="active">
                <PanicSaveNotice />
                <div className={styles.panel}>
                    <h2 className={styles.heading}>{t('settings.panic.panicModeIsActive')}</h2>
                    <p className={styles.body}>
                        {t('settings.security.panicActiveBody', { remaining: formatPanicCountdown(remainingMs) })}
                    </p>
                </div>
                <div className={styles.actions}>
                    <Button type="button" variant="secondary" block icon={<Icon.UnlockIcon />} disabled={busy} onClick={deactivate}>
                        {busy ? t('settings.security.panicDeactivating') : t('settings.panic.deactivate')}
                    </Button>
                </div>
            </div>
        );
    }
    // A form page in the shared Settings form frame (G126): below 600px only
    // the notice and the full-width button; from 600px one centred card at
    // the standard form column width (Settings FORM_FRAME_PAGES).
    return (
        <div className={styles.panicForm} data-panic-form="confirm">
            <PanicSaveNotice />
            <StatusMessage variant="error" title={t('settings.security.panicFreezeTitle')} testId="panic-freeze-notice">
                {t('settings.security.panicFreezeBody')}
            </StatusMessage>
            <div className={styles.actions}>
                <Button type="button" variant="danger" block icon={<Icon.LockIcon />} onClick={confirm}>
                    {t('settings.panic.confirm24HourFreeze')}
                </Button>
            </div>
        </div>
    );
}

const CUSTOM = 'custom';

// A preset as the dropdown lists it: a whole amount in the display currency
// with no cents ("$1,000").
function wholeAmountLabel(value, currency) {
    try {
        return new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency,
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(Number(value));
    } catch {
        return formatFiatAmount(value, currency);
    }
}

/** The typed amount in its stored form ("1,000" -> "1000", "05.50" -> "5.5"), or null. */
export function normalizeTestSendAmount(raw) {
    const text = normalizeLocalizedDecimal(raw);
    if (text === null) return null;
    const match = /^(\d*)(?:\.(\d*))?$/.exec(text);
    if (!match || (match[1] === '' && !match[2])) return null;
    const whole = (match[1] || '0').replace(/^0+(?=\d)/, '');
    const frac = (match[2] || '').replace(/0+$/, '');
    const value = frac ? `${whole}.${frac}` : whole;
    if (!isTestSendFiat(value) || Number(value) <= 0 || Number(value) > Number(TEST_SEND_FIAT_MAX)) return null;
    return value;
}

/** The stored threshold, '0' (Off) when it is absent or not a valid amount. */
function storedTestSendFiat(settings) {
    const v = settings?.grace?.testSendThresholdFiat;
    return isTestSendFiat(v) ? v : TEST_SEND_FIAT_OFF;
}

/**
 * New-recipient test send: Off, $100, $1,000, $10,000, $100,000 or Custom on
 * the row, in the display currency; Custom opens an amount field in place.
 */
export function TestSendThresholdInlineRow({ row, leading, settings, update }) {
    const currency = settings?.fiatCurrency || 'USD';
    const stored = storedTestSendFiat(settings);
    const storedIsPreset = stored === TEST_SEND_FIAT_OFF || TEST_SEND_FIAT_PRESETS.includes(stored);
    const [customOpen, setCustomOpen] = useState(!storedIsPreset);
    const [draft, setDraft] = useState(storedIsPreset ? '' : stored);
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const fieldId = useId();
    const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const draftDisplay = formatWithThousands(draft);
    useEffect(() => {
        // A value saved elsewhere (another window) opens and refills the field.
        if (!storedIsPreset) {
            setCustomOpen(true);
            setDraft(stored);
        }
    }, [stored, storedIsPreset]);

    const save = async (value) => {
        setError(null);
        try {
            await update({ grace: { testSendThresholdFiat: value } });
        } catch (err) {
            setError(t('settings.security.testSendSaveFailed'));
            // eslint-disable-next-line no-console
            console.error('settings grace.testSendThresholdFiat update failed:', err);
        }
    };
    const commitDraft = async () => {
        const value = normalizeTestSendAmount(draft);
        if (value === null) {
            setError(t('settings.security.testSendCustomError'));
            return;
        }
        if (value === stored) { setError(null); return; }
        await save(value);
    };
    const changeDraft = (event) => {
        const shown = String(event.target.value);
        const cursor = event.target.selectionStart;
        const typed = /^(insertText|deleteContent)/.test(event.nativeEvent?.inputType || '');
        const raw = typed ? dropFieldGrouping(shown, draftDisplay) : shown;
        const normalized = normalizeLocalizedDecimal(raw);
        if (normalized === null) return;

        const groupMarks = new Set(
            Array.from(formatWithThousands('1000')).filter((character) => !/\p{Number}/u.test(character)),
        );
        const before = typeof cursor === 'number'
            ? Array.from(shown.slice(0, cursor)).filter((character) => !groupMarks.has(character)).length
            : null;
        setDraft(normalized);
        if (error) setError(null);

        if (before !== null && inputRef.current) {
            const formatted = formatWithThousands(normalized);
            let seen = 0;
            let nextCursor = before === 0 ? 0 : formatted.length;
            if (before > 0) {
                for (let index = 0; index < formatted.length; index += 1) {
                    if (!groupMarks.has(formatted[index])) seen += 1;
                    if (seen === before) {
                        nextCursor = index + 1;
                        break;
                    }
                }
            }
            const input = inputRef.current;
            requestAnimationFrame(() => {
                if (document.activeElement === input) input.setSelectionRange(nextCursor, nextCursor);
            });
        }
    };

    const options = [
        { value: TEST_SEND_FIAT_OFF, label: t('settings.privacy.off'), icon: <Icon.BanIcon /> },
        ...TEST_SEND_FIAT_PRESETS.map((value) => ({ value, label: wholeAmountLabel(value, currency), icon: <Icon.CoinsIcon /> })),
        { value: CUSTOM, label: t('ui.feeSelector.custom'), icon: <Icon.PencilIcon /> },
    ];
    const ready = Boolean(settings);
    return (
        <InlineRowFrame
            leading={leading}
            title={row.title}
            help={row.help}
            line={row.line}
            kind="select"
            after={customOpen || error ? (
                <div className={styles.custom}>
                    {customOpen ? (
                        <Input
                            ref={inputRef}
                            id={fieldId}
                            label={t('settings.ads.customAmount', { currency })}
                            help={row.help}
                            type="text"
                            inputMode="decimal"
                            enterKeyHint="done"
                            autoComplete="off"
                            value={draftDisplay}
                            error={error || undefined}
                            onChange={changeDraft}
                            onBlur={commitDraft}
                            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                            data-testid="test-send-custom-amount"
                        />
                    ) : null}
                    {!customOpen && error ? <StatusMessage variant="error">{error}</StatusMessage> : null}
                </div>
            ) : null}
        >
            <div className={styles.select}>
                <Select
                    value={ready ? (customOpen ? CUSTOM : stored) : undefined}
                    options={ready ? options : []}
                    disabled={!ready}
                    aria-label={row.title}
                    data-testid="test-send-threshold"
                    onChange={(event) => {
                        const next = event.target.value;
                        if (next === CUSTOM) {
                            setCustomOpen(true);
                            setDraft(storedIsPreset && stored !== TEST_SEND_FIAT_OFF ? stored : '');
                            return;
                        }
                        setCustomOpen(false);
                        setDraft('');
                        save(next);
                    }}
                />
            </div>
        </InlineRowFrame>
    );
}
