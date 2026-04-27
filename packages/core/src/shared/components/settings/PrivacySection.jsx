// PrivacySection — §35.1 Privacy panel.
//
// All five §35.1 toggles backed by `settings.privacy.*` (schema v2):
//   - Tor routing
//   - Change-address rotation
//   - Hide small balances
//   - Blur sensitive data on blur (window-unfocus blur of mnemonic /
//     QR / balance values; toggle ships now, the actual blur-on-blur
//     wiring lives in shell-level event handlers added later)
//   - Labels-survive-restore (§19.5.2 on-chain label sync opt-in;
//     toggle persists the preference, the FILE-action submit/fetch
//     wiring is shell-level work pending separately)

import { useSettings } from '../../hooks/useSettings.js';
import { ToggleRow, Status, STACK } from './_settingsPrimitives.jsx';

export function PrivacySection() {
    const { settings, loading, error, update } = useSettings();

    if (loading) return <Status text="Loading…" />;
    if (error) return <Status text={`Settings unavailable: ${error.message}`} tone="error" />;
    if (!settings) return <Status text="Settings unavailable." tone="error" />;

    const onToggle = async (field, next) => {
        try {
            await update({ privacy: { [field]: next } });
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`privacy.${field} update failed:`, err);
        }
    };

    return (
        <div style={STACK}>
            <ToggleRow
                label="Tor routing"
                hint="Route SDK requests through a local Tor SOCKS5 proxy when available."
                checked={settings.privacy.torRouting}
                onChange={(v) => onToggle('torRouting', v)}
            />
            <ToggleRow
                label="Change-address rotation"
                hint="Use a fresh change address for every send. Improves chain-analysis resistance."
                checked={settings.privacy.changeAddressRotation}
                onChange={(v) => onToggle('changeAddressRotation', v)}
            />
            <ToggleRow
                label="Hide small balances"
                hint="Collapse balances under the dust threshold from balance / portfolio views."
                checked={settings.privacy.hideSmallBalances}
                onChange={(v) => onToggle('hideSmallBalances', v)}
            />
            <ToggleRow
                label="Blur sensitive data on blur"
                hint="When enabled, mnemonic / QR / balance surfaces blur out while the wallet window is unfocused."
                checked={Boolean(settings.privacy.blurOnBlur)}
                onChange={(v) => onToggle('blurOnBlur', v)}
            />
            <ToggleRow
                label="Labels survive restore"
                hint="Opts into §19.5.2 on-chain label sync (FILE-action transport). Submit/fetch wiring lands separately; the toggle persists the preference today."
                checked={Boolean(settings.privacy.labelsSurviveRestore)}
                onChange={(v) => onToggle('labelsSurviveRestore', v)}
            />
        </div>
    );
}
