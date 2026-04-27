// AppearanceSection — §35.1 Appearance panel.
//
// In scope this step:
//   - Theme picker: system / light / dark. Persisted to
//     `settings.theme` via the Settings flow.
//
// Deferred to later steps:
//   - Reduced motion override (needs a `reducedMotion` field on the
//     Settings schema; not yet in the v1 record). The shipped
//     wallet currently respects `prefers-reduced-motion` from the
//     OS for AnimatedQrFrames and a few other surfaces; the
//     in-wallet override row appears here once the schema migration
//     lands.
//   - Accent color (per spec §35.1 only "when brand is finalized").

import { useSettings } from '../../hooks/useSettings.js';

const THEME_OPTIONS = /** @type {const} */ ([
    { value: 'system', label: 'System default' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
]);

const ROW = {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 'var(--xc-space-2) var(--xc-space-3)',
    background: 'var(--xc-surface-raised)',
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-md)',
    fontSize: 'var(--xc-text-sm)',
    gap: 'var(--xc-space-3)',
};
const STACK = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--xc-space-1)',
};
const SELECT = {
    background: 'var(--xc-bg)',
    color: 'var(--xc-text)',
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-sm)',
    padding: 'var(--xc-space-1) var(--xc-space-2)',
    fontSize: 'var(--xc-text-sm)',
    fontFamily: 'inherit',
};
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
            // The hook surfaces `error` for read failures; for write
            // failures we keep the previous value visible and don't
            // throw past the section. A future toast pass surfaces
            // failures inline (§37.2).
            // eslint-disable-next-line no-console
            console.error('appearance.theme update failed:', err);
        }
    };

    return (
        <div style={STACK}>
            <div style={ROW}>
                <span style={{ color: 'var(--xc-text-muted)' }}>Theme</span>
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
                <span style={{ color: 'var(--xc-text-muted)' }}>Reduced motion</span>
                <span style={HINT}>follows OS — override coming soon</span>
            </div>
            <div style={ROW}>
                <span style={{ color: 'var(--xc-text-muted)' }}>Accent color</span>
                <span style={HINT}>finalized at brand cut</span>
            </div>
        </div>
    );
}

function Status({ text, tone }) {
    return (
        <div style={{
            padding: 'var(--xc-space-3) var(--xc-space-4)',
            background: 'var(--xc-surface-raised)',
            border: tone === 'error'
                ? '1px solid var(--xc-error, #c33)'
                : '1px dashed var(--xc-border)',
            borderRadius: 'var(--xc-radius-md)',
            color: tone === 'error' ? 'var(--xc-error, #c33)' : 'var(--xc-text-muted)',
            fontSize: 'var(--xc-text-sm)',
        }}>
            {text}
        </div>
    );
}
