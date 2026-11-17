// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// SafetySection (§35.1 Safety panel).
//
// Live rows:
//   - Auto-lock timeout (minutes)
//   - New-recipient test-send threshold (display currency; 0 disables)
//   - Lookalike-address warnings switch (on unless turned off)
//   - Undo-send: opt-in hold so a signed send can be cancelled before broadcast
//   - Panic-mode activation and duress passphrase controls
//   - Automatic backup-reminder status
//
// The Security group page draws these as rows (Settings.jsx); this section
// renders one part on a page of its own (`only`), or every part.

import { useState } from 'react';
import { Icon, InfoTip, Input, Select } from '@xchain-wallet/core/ui';
import { useSettings } from '../../hooks/useSettings.js';
import { isNativeShell } from '../../nativeShell.js';
import { useMessaging } from '../../useMessaging.js';
import { isTestSendFiat, lookalikeWarningsEnabled } from '../../../schemas/settings.js';
import { normalizeTestSendAmount } from './SecurityPages.jsx';
import {
    ROW,
    ROW_HINT,
    ROW_TITLE,
    ROW_LABEL,
    STACK,
    SettingsLoadError,
    Status,
    ToggleRow,
} from './_settingsPrimitives.jsx';
import { BiometricRow } from './BiometricRow.jsx';
import { PanicModeRow } from './PanicModeRow.jsx';
import { PanicSaveNotice } from './PanicSaveNotice.jsx';
import { UndoSendRow } from './UndoSendRow.jsx';
import { DuressPassphraseRow } from './DuressPassphraseRow.jsx';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/settings.js';

export const AUTOLOCK_OPTIONS = /** @type {const} */ ([
    { value: 1, label: '1 minute' },
    { value: 5, label: '5 minutes' },
    { value: 15, label: '15 minutes' },
    { value: 30, label: '30 minutes' },
    { value: 60, label: '1 hour' },
    { value: 240, label: '4 hours' },
    { value: 0, label: 'Never' },
]);

export function autolockOptionLabel(option, shell) {
    return option.value === 0 && (shell === 'desktop' || isNativeShell())
        ? t('settings.safety.neverUntilAppCloses')
        : option.label;
}

// `only` renders one part (autolock, testSend, lookalike, undoSend,
// biometric, panic, duress or reminders) on its own Settings page; null renders every part.
export function SafetySection({ only = null } = {}) {
    const show = (part) => !only || only === part;
    const { shell } = useMessaging();
    const { settings, loading, error, update } = useSettings();
    const [thresholdError, setThresholdError] = useState(/** @type {string | null} */ (null));

    if (loading) return <Status text={t('common.loading')} />;
    if (error) return <SettingsLoadError error={error} />;
    if (!settings) return <Status text={t('common.settingsUnavailable')} tone="error" />;

    const onAutolockChange = async (next) => {
        try { await update({ autolockMinutes: Number(next) }); } catch (err) {
            // eslint-disable-next-line no-console
            console.error('autolock.update failed:', err);
        }
    };

    const autolockValue = AUTOLOCK_OPTIONS.some((o) => o.value === settings.autolockMinutes)
        ? settings.autolockMinutes
        : settings.autolockMinutes;
    // The test-send threshold in the display currency ('0' is Off).
    const currency = settings.fiatCurrency || 'USD';
    const testSendFiat = isTestSendFiat(settings.grace?.testSendThresholdFiat) ? settings.grace.testSendThresholdFiat : '0';

    return (
        <div style={STACK}>
            {show('panic') ? <PanicSaveNotice /> : null}
            {show('autolock') ? (
            <div style={ROW}>
                <span style={ROW_TITLE}>
                    {t('settings.safety.autoLockTimeout')}{' '}
                    <InfoTip
                        aria={t('settings.help.safety.autoLockLabel')}
                        label={t('settings.help.safety.autoLock')}
                    />
                </span>
                <div data-settings-control="">
                    <Select
                        value={String(autolockValue)}
                        onChange={(e) => onAutolockChange(e.target.value)}
                        aria-label={t('settings.safety.autoLockTimeout')}
                    >
                        {AUTOLOCK_OPTIONS.map((o) => (
                            <Select.Option key={o.value} value={String(o.value)} icon={<Icon.LockIcon />}>{autolockOptionLabel(o, shell)}</Select.Option>
                        ))}
                        {!AUTOLOCK_OPTIONS.some((o) => o.value === settings.autolockMinutes) ? (
                            <Select.Option value={String(settings.autolockMinutes)} icon={<Icon.ClockIcon />}>
                                {t('settings.safety.minutesCustom', { autolockMinutes: settings.autolockMinutes })}
                            </Select.Option>
                        ) : null}
                    </Select>
                </div>
            </div>
            ) : null}
            {show('testSend') ? (
            <>
            <div style={ROW}>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <span style={ROW_TITLE}>
                        {t('settings.safety.newRecipientTestSendWarning')}{' '}
                        <InfoTip
                            aria={t('settings.help.safety.testSendLabel')}
                            label={t('settings.help.safety.testSend')}
                        />
                    </span>
                </div>
                <div data-settings-control="">
                    <Input
                        key={String(testSendFiat)}
                        type="text"
                        inputMode="decimal"
                        enterKeyHint="done"
                        autoComplete="off"
                        defaultValue={testSendFiat}
                        onBlur={(e) => {
                            const raw = e.target.value.trim();
                            // 0 turns the suggestion off; anything else is an amount.
                            const threshold = /^0*(\.0*)?$/.test(raw) && raw !== '' ? '0' : normalizeTestSendAmount(raw);
                            if (threshold === null) {
                                setThresholdError(t('settings.security.testSendCustomError'));
                                return;
                            }
                            setThresholdError(null);
                            update({ grace: { testSendThresholdFiat: threshold } }).catch((err) => {
                                setThresholdError(t('settings.security.testSendSaveFailed'));
                                // eslint-disable-next-line no-console
                                console.error('grace.testSendThresholdFiat update failed:', err);
                            });
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                        placeholder={t('settings.safety.0NoWarning')}
                        aria-label={t('settings.safety.testSendWarningThresholdSats', { currency })}
                        aria-invalid={thresholdError ? 'true' : undefined}
                        aria-describedby={thresholdError ? 'test-send-threshold-error' : undefined}
                        style={{ width: 140, textAlign: 'right' }}
                    />
                </div>
            </div>
            {thresholdError ? (
                <Status id="test-send-threshold-error" text={thresholdError} tone="error" />
            ) : null}
            </>
            ) : null}
            {show('lookalike') ? (
            <ToggleRow
                embedded
                label={t('settings.safety.lookalikeAddressWarnings')}
                hint={t('settings.security.lookalikeLine')}
                help={t('settings.security.lookalikeHelp')}
                checked={lookalikeWarningsEnabled(settings)}
                onChange={(next) => {
                    update({ grace: { lookalikeWarnings: next } }).catch((err) => {
                        // eslint-disable-next-line no-console
                        console.error('grace.lookalikeWarnings update failed:', err);
                    });
                }}
            />
            ) : null}
            {show('undoSend') ? <UndoSendRow /> : null}
            {/* On its own page (only set) a row lands straight on its form. */}
            {show('biometric') ? <BiometricRow direct={only === 'biometric'} /> : null}
            {show('panic') ? <PanicModeRow /> : null}
            {show('duress') ? <DuressPassphraseRow direct={only === 'duress'} /> : null}
            {show('reminders') ? (
            <div style={ROW}>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <span style={ROW_TITLE}>{t('settings.safety.backupReminders')}</span>
                    <span style={ROW_HINT}>
                        {t('settings.safety.shownAutomaticallyForWalletsWithout')}
                    </span>
                </div>
                <span style={ROW_LABEL}>{t('settings.safety.automatic')}</span>
            </div>
            ) : null}
        </div>
    );
}
