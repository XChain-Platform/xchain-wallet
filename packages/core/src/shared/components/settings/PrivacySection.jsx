// PrivacySection — §35.1 Privacy panel.
//
// Three toggles backed by `settings.privacy.*` (already in v1 of the
// Settings schema):
//   - Tor routing
//   - Change-address rotation
//   - Hide small balances
//
// Two additional rows from spec §35.1 ship as deferred:
//   - Blur sensitive data on blur (window-unfocus blur of mnemonic /
//     QR / balance values; needs new schema field)
//   - Labels-survive-restore (§19.5.2 on-chain FILE-action sync;
//     needs new schema field + flow wiring; flow primitives already
//     exist per CHANGELOG v0.22.0)
//
// Both deferral rows render an opt-in toggle in disabled state so the
// shape of the future UI is visible.

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
                hint="Coming soon — needs schema migration for blurOnBlur flag."
                checked={false}
                disabled
                onChange={() => {}}
            />
            <ToggleRow
                label="Labels survive restore"
                hint="Coming soon — opts into §19.5.2 on-chain label sync (FILE-action transport)."
                checked={false}
                disabled
                onChange={() => {}}
            />
        </div>
    );
}
