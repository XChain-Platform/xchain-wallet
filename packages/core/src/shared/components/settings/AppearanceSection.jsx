// AppearanceSection — §35.1 Appearance panel.
//
// Live:
//   - Theme picker: system / light / dark.
//   - Reduced-motion override: auto (follow OS) / always / never.
//
// Deferred:
//   - Accent color (per spec §35.1 only "when brand is finalized").

import { useSettings } from '../../hooks/useSettings.js';
import { ROW, ROW_LABEL, SELECT, STACK, Status } from './_settingsPrimitives.jsx';

const THEME_OPTIONS = /** @type {const} */ ([
    { value: 'system', label: 'System default' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
]);

const REDUCED_MOTION_OPTIONS = /** @type {const} */ ([
    { value: 'auto', label: 'Follow system' },
    { value: 'always', label: 'Always reduce' },
    { value: 'never', label: 'Never reduce' },
]);

const HINT = {
    color: 'var(--xc-text-muted)',
    fontSize: 'var(--xc-text-xs)',
    fontStyle: 'italic',
};

export function AppearanceSection() {
    const { settings, loading, error, update } = useSettings();

    if (loading) return <Status text="Loading…" />;
    if (error) return <Status text={`Settings unavailable: ${error.message}`} tone="error" />;
    if (!settings) return <Status text="Settings unavailable." tone="error" />;

    const onThemeChange = async (next) => {
        try {
            await update({ theme: next });
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error('appearance.theme update failed:', err);
        }
    };
    const onReducedMotionChange = async (next) => {
        try {
            await update({ reducedMotion: next });
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error('appearance.reducedMotion update failed:', err);
        }
    };

    return (
        <div style={STACK}>
            <div style={ROW}>
                <span style={ROW_LABEL}>Theme</span>
                <select
                    value={settings.theme}
                    onChange={(e) => onThemeChange(e.target.value)}
                    aria-label="Theme"
                    style={SELECT}
                >
                    {THEME_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                </select>
            </div>
            <div style={ROW}>
                <span style={ROW_LABEL}>Reduced motion</span>
                <select
                    value={settings.reducedMotion ?? 'auto'}
                    onChange={(e) => onReducedMotionChange(e.target.value)}
                    aria-label="Reduced motion"
                    style={SELECT}
                >
                    {REDUCED_MOTION_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                </select>
            </div>
            <div style={ROW}>
                <span style={ROW_LABEL}>Accent color</span>
                <span style={HINT}>finalized at brand cut</span>
            </div>
        </div>
    );
}
