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
//   - Test-send warning threshold (sats; 0 disables)
//   - Undo-send: opt-in hold so a signed send can be cancelled before broadcast
//   - Panic-mode activation and duress passphrase controls
//   - Backup reminders cadence (off / monthly / quarterly)
//

import { useState } from 'react';
import { useSettings } from '../../hooks/useSettings.js';
import { INPUT, ROW, ROW_LABEL, SELECT, STACK, SettingsLoadError, Status, ToggleRow } from './_settingsPrimitives.jsx';
import { BiometricRow } from './BiometricRow.jsx';
import { PanicModeRow } from './PanicModeRow.jsx';
import { UndoSendRow } from './UndoSendRow.jsx';
import { DuressPassphraseRow } from './DuressPassphraseRow.jsx';

const AUTOLOCK_OPTIONS = /** @type {const} */ ([
    { value: 1, label: '1 minute' },
    { value: 5, label: '5 minutes' },
    { value: 15, label: '15 minutes' },
    { value: 30, label: '30 minutes' },
    { value: 60, label: '1 hour' },
    { value: 240, label: '4 hours' },
    { value: 0, label: 'Never (until tab close)' },
]);

const BACKUP_REMINDER_OPTIONS = /** @type {const} */ ([
    { value: 'off', label: 'Off' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'quarterly', label: 'Quarterly' },
]);

export function SafetySection() {
    const { settings, loading, error, update } = useSettings();
    const [thresholdError, setThresholdError] = useState(/** @type {string | null} */ (null));

    if (loading) return <Status text="Loading…" />;
    if (error) return <SettingsLoadError error={error} />;
    if (!settings) return <Status text="Settings unavailable." tone="error" />;

    const onAutolockChange = async (next) => {
        try { await update({ autolockMinutes: Number(next) }); } catch (err) {
            // eslint-disable-next-line no-console
            console.error('autolock.update failed:', err);
        }
    };

    const autolockValue = AUTOLOCK_OPTIONS.some((o) => o.value === settings.autolockMinutes)
        ? settings.autolockMinutes
        : settings.autolockMinutes;

    return (
        <div style={STACK}>
            <div style={ROW}>
                <span style={ROW_LABEL}>Auto-lock timeout</span>
                <select
                    value={String(autolockValue)}
                    onChange={(e) => onAutolockChange(e.target.value)}
                    aria-label="Auto-lock timeout"
                    style={SELECT}
                >
                    {AUTOLOCK_OPTIONS.map((o) => (
                        <option key={o.value} value={String(o.value)}>{o.label}</option>
                    ))}
                    {!AUTOLOCK_OPTIONS.some((o) => o.value === settings.autolockMinutes) ? (
                        <option value={String(settings.autolockMinutes)}>
                            {`${settings.autolockMinutes} minutes (custom)`}
                        </option>
                    ) : null}
                </select>
            </div>
            <div style={ROW}>
                <span style={ROW_LABEL}>Test-send warning (sats)</span>
                <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    defaultValue={settings.grace.testSendThresholdSats}
                    onBlur={(e) => {
                        const raw = e.target.value.trim();
                        if (!/^\d+$/.test(raw)) {
                            setThresholdError('Enter a whole number of sats. Use 0 to turn the warning off.');
                            return;
                        }
                        setThresholdError(null);
                        const threshold = raw.replace(/^0+(?=\d)/, '');
                        update({ grace: { testSendThresholdSats: threshold } }).catch((err) => {
                            // eslint-disable-next-line no-console
                            console.error('grace.testSendThresholdSats update failed:', err);
                        });
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    placeholder="0 = no warning"
                    aria-label="Test-send warning threshold (sats)"
                    style={{ ...INPUT, width: 140, textAlign: 'right' }}
                />
            </div>
            {thresholdError ? <Status text={thresholdError} tone="error" /> : null}
            <UndoSendRow />
            <BiometricRow />
            <PanicModeRow />
            <DuressPassphraseRow />
            <div style={ROW}>
                <span style={ROW_LABEL}>Backup reminders</span>
                <select
                    value={settings.backupReminders ?? 'off'}
                    onChange={(e) => {
                        update({ backupReminders: e.target.value }).catch((err) => {
                            // eslint-disable-next-line no-console
                            console.error('backupReminders update failed:', err);
                        });
                    }}
                    aria-label="Backup reminders"
                    style={SELECT}
                >
                    {BACKUP_REMINDER_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                </select>
            </div>
        </div>
    );
}
