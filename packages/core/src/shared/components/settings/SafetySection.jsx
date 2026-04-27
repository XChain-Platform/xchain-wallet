// SafetySection — §35.1 Safety panel.
//
// Live: auto-lock timeout (minutes), undo-send grace (seconds).
// Both fields exist on the v1 Settings schema.
//
// Deferred to later steps (need schema migrations + flow wiring):
//   - Test-send warning threshold (large-amount confirmation gate)
//   - Panic mode duration (§26.5 — fully unbuilt per gap audit)
//   - Backup reminders cadence (§19.1)

import { useSettings } from '../../hooks/useSettings.js';
import { ROW, ROW_LABEL, SELECT, STACK, Status, ToggleRow } from './_settingsPrimitives.jsx';

const AUTOLOCK_OPTIONS = /** @type {const} */ ([
    { value: 1, label: '1 minute' },
    { value: 5, label: '5 minutes' },
    { value: 15, label: '15 minutes' },
    { value: 30, label: '30 minutes' },
    { value: 60, label: '1 hour' },
    { value: 240, label: '4 hours' },
    { value: 0, label: 'Never (until tab close)' },
]);

const UNDO_SEND_OPTIONS = /** @type {const} */ ([
    { value: 0, label: 'Off (send immediately)' },
    { value: 3, label: '3 seconds' },
    { value: 5, label: '5 seconds' },
    { value: 10, label: '10 seconds' },
    { value: 15, label: '15 seconds' },
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
    const onUndoSendChange = async (next) => {
        try { await update({ grace: { undoSendSeconds: Number(next) } }); } catch (err) {
            // eslint-disable-next-line no-console
            console.error('grace.undoSendSeconds.update failed:', err);
        }
    };

    const autolockValue = AUTOLOCK_OPTIONS.some((o) => o.value === settings.autolockMinutes)
        ? settings.autolockMinutes
        : settings.autolockMinutes;
    const undoSendValue = UNDO_SEND_OPTIONS.some((o) => o.value === settings.grace.undoSendSeconds)
        ? settings.grace.undoSendSeconds
        : settings.grace.undoSendSeconds;

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
                <span style={ROW_LABEL}>Undo-send grace</span>
                <select
                    value={String(undoSendValue)}
                    onChange={(e) => onUndoSendChange(e.target.value)}
                    aria-label="Undo-send grace"
                    style={SELECT}
                >
                    {UNDO_SEND_OPTIONS.map((o) => (
                        <option key={o.value} value={String(o.value)}>{o.label}</option>
                    ))}
                    {!UNDO_SEND_OPTIONS.some((o) => o.value === settings.grace.undoSendSeconds) ? (
                        <option value={String(settings.grace.undoSendSeconds)}>
                            {`${settings.grace.undoSendSeconds} seconds (custom)`}
                        </option>
                    ) : null}
                </select>
            </div>
            <ToggleRow
                label="Test-send warning"
                hint="Coming soon — confirmation gate for large amounts. Needs schema migration."
                checked={false}
                disabled
                onChange={() => {}}
            />
            <ToggleRow
                label="Panic mode"
                hint="Coming soon — duress PIN that opens a decoy wallet. §26.5 + schema migration."
                checked={false}
                disabled
                onChange={() => {}}
            />
            <ToggleRow
                label="Backup reminders"
                hint="Coming soon — periodic prompt to verify the seed phrase is still readable. §19.1 + schema migration."
                checked={false}
                disabled
                onChange={() => {}}
            />
        </div>
    );
}
