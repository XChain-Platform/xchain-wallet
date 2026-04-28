// DeveloperModeSection — §35.1 + §48 Developer Mode panel.
//
// Live:
//   - Developer Mode master toggle (`settings.developerMode`). Gates
//     regtest visibility in chain pickers (currently applied in
//     NetworkEndpointsSection; broader picker application lands in a
//     follow-up step).
//   - Learn Mode toggle (`settings.learnMode`). Drives explanatory
//     copy on confirmation screens; toggle ships now even though some
//     consumers haven't been wired yet.
//   - Auto-approve localhost dApps (`settings.autoApproveLocalhost`).
//     §48.6 / G151 — when both this and Developer Mode are on,
//     `bridge.connect` from localhost / 127.0.0.1 / [::1] origins
//     skips the approval prompt. Sign requests still prompt (the
//     password is required to sign and the wallet never caches it).
//
// Deferred (need new schema fields + flow wiring):
//   - Custom chain registry (§9.7 user-added chains via
//     `chainRegistry.addCustom`; UI to add a chain descriptor)
//   - Raw PSBT inspector reveal on sign screens (§48.4)
//   - Logs and diagnostics console (§48.5)

import { useSettings } from '../../hooks/useSettings.js';
import { STACK, Status, ToggleRow } from './_settingsPrimitives.jsx';

export function DeveloperModeSection() {
    const { settings, loading, error, update } = useSettings();
    if (loading) return <Status text="Loading…" />;
    if (error) return <Status text={`Settings unavailable: ${error.message}`} tone="error" />;
    if (!settings) return <Status text="Settings unavailable." tone="error" />;

    const onToggle = async (field, next) => {
        try {
            await update({ [field]: next });
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`${field} update failed:`, err);
        }
    };

    return (
        <div style={STACK}>
            <ToggleRow
                label="Developer Mode"
                hint="Reveals regtest networks in chain pickers, custom-endpoint editors, and the raw PSBT inspector."
                checked={Boolean(settings.developerMode)}
                onChange={(v) => onToggle('developerMode', v)}
            />
            <ToggleRow
                label="Learn Mode"
                hint="Adds explanatory copy on confirmation screens for users new to bitcoin / XChain mechanics."
                checked={Boolean(settings.learnMode)}
                onChange={(v) => onToggle('learnMode', v)}
            />
            <ToggleRow
                label="Custom chain registry"
                hint="Coming soon — add a chain descriptor at runtime (regtest endpoints, alt explorers)."
                checked={false}
                disabled
                onChange={() => {}}
            />
            <ToggleRow
                label="Raw PSBT inspector"
                hint="Coming soon — reveals the raw PSBT hex + parsed fields on sign screens. §48.4."
                checked={false}
                disabled
                onChange={() => {}}
            />
            <ToggleRow
                label="Auto-approve localhost dApps"
                hint="Skip the bridge.connect prompt for http://localhost / 127.0.0.1 / [::1] origins. Requires Developer Mode. Sign requests still prompt — the password is needed to sign and the wallet never caches it."
                checked={Boolean(settings.autoApproveLocalhost)}
                disabled={!settings.developerMode}
                onChange={(v) => onToggle('autoApproveLocalhost', v)}
            />
            <ToggleRow
                label="Logs and diagnostics console"
                hint="Coming soon — surface SDK requests, signing operations, storage I/O. §48.5."
                checked={false}
                disabled
                onChange={() => {}}
            />
        </div>
    );
}
