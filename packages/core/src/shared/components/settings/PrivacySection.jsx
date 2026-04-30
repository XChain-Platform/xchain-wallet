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
//
// Plus one numeric input (§17.7.1 / G028):
//   - Clipboard auto-clear seconds — 0–600, 0 disables. Read by
//     ViewPrivateKey to time its post-copy clipboard wipe.

import { useSettings } from '../../hooks/useSettings.js';
import {
    CLIPBOARD_AUTO_CLEAR_DEFAULT,
    CLIPBOARD_AUTO_CLEAR_MAX,
    CLIPBOARD_AUTO_CLEAR_MIN,
} from '../../../schemas/settings.js';
import { INPUT, ROW, ROW_HINT, ToggleRow, Status, STACK } from './_settingsPrimitives.jsx';

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

    const clipboardSeconds = (() => {
        const raw = settings?.privacy?.clipboardAutoClearSeconds;
        if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) return raw;
        return CLIPBOARD_AUTO_CLEAR_DEFAULT;
    })();
    const onClipboardSecondsChange = async (next) => {
        const clamped = Math.max(
            CLIPBOARD_AUTO_CLEAR_MIN,
            Math.min(CLIPBOARD_AUTO_CLEAR_MAX, Math.floor(Number(next) || 0)),
        );
        try {
            await update({ privacy: { clipboardAutoClearSeconds: clamped } });
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error('privacy.clipboardAutoClearSeconds update failed:', err);
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
            <ToggleRow
                label="Haptic feedback"
                hint="Vibration pulses on success / error / tap events when the device supports the Vibration API. Reduced-motion (OS-level) also suppresses haptics."
                checked={settings.privacy.hapticsEnabled !== false}
                onChange={(v) => onToggle('hapticsEnabled', v)}
            />
            <ToggleRow
                label="Always require hardware cross-check confirm"
                hint="Forces the explicit “I’ve verified path + address” checkbox on every hardware-wallet sign, regardless of amount or recipient. The wallet already requires it for risky signs (large amounts, first-time recipients, multisig). Turn this on to require it on every HW sign."
                checked={settings.privacy.alwaysRequireHwExplicitConfirm === true}
                onChange={(v) => onToggle('alwaysRequireHwExplicitConfirm', v)}
            />
            <div style={ROW}>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <span style={{ color: 'var(--xc-text)', fontWeight: 500 }}>
                        Clipboard auto-clear (seconds)
                    </span>
                    <span style={ROW_HINT}>
                        After copying a private key or mnemonic, wipe the clipboard
                        after this many seconds. Range {CLIPBOARD_AUTO_CLEAR_MIN}–{CLIPBOARD_AUTO_CLEAR_MAX};
                        0 disables auto-clear.
                    </span>
                </div>
                <input
                    type="number"
                    min={CLIPBOARD_AUTO_CLEAR_MIN}
                    max={CLIPBOARD_AUTO_CLEAR_MAX}
                    step={5}
                    value={clipboardSeconds}
                    onChange={(e) => onClipboardSecondsChange(e.target.value)}
                    aria-label="Clipboard auto-clear seconds"
                    style={{ ...INPUT, width: 96 }}
                />
            </div>
        </div>
    );
}
