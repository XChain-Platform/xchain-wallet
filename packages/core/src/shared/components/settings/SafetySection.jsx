// SafetySection — §35.1 Safety panel.
//
// Live rows:
//   - Auto-lock timeout (minutes)
//   - Test-send warning threshold (sats; 0 disables)
//   - Panic mode toggle — schema slot ships v2; full §26.5 duress-PIN
//     wiring lands later, the toggle gates that behavior when present.
//   - Backup reminders cadence (off / monthly / quarterly)
//
// The undo-send grace row was removed v0.132.0 — the feature was
// scrapped (a cancellable countdown delays every broadcast and rewards
// rage-clicking with a no-op). The `settings.grace.undoSendSeconds`
// schema field stays around as a dead slot until a future v3 migration
// sweeps it; see settings close-report FOLLOWUP 12.

import { useSettings } from '../../hooks/useSettings.js';
import { INPUT, ROW, ROW_LABEL, SELECT, STACK, Status, ToggleRow } from './_settingsPrimitives.jsx';
import { BiometricRow } from './BiometricRow.jsx';
import { PanicModeRow } from './PanicModeRow.jsx';
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

    if (loading) return <Status text="Loading…" />;
    if (error) return <Status text={`Settings unavailable: ${error.message}`} tone="error" />;
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
                        const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
                        update({ grace: { testSendThresholdSats: n } }).catch((err) => {
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
            <BiometricRow />
            <PanicModeRow />
            <DuressPassphraseRow />
            <ToggleRow
                label="Auto-arm panic mode"
                hint="Reserved — duress-passphrase / shortcut auto-arming lands in a follow-up step. The persisted preference is honoured when that wiring ships; the Activate button above always works regardless."
                checked={Boolean(settings.panicMode?.enabled)}
                onChange={(v) => {
                    update({ panicMode: { enabled: v } }).catch((err) => {
                        // eslint-disable-next-line no-console
                        console.error('panicMode.enabled update failed:', err);
                    });
                }}
            />
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
