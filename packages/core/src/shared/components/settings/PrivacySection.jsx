// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PrivacySection (§35.1 Privacy panel).
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
//   - Clipboard auto-clear seconds: 0–600, 0 disables. Read by
//     ViewPrivateKey to time its post-copy clipboard wipe.

import { useSettings } from '../../hooks/useSettings.js';
import {
    CLIPBOARD_AUTO_CLEAR_DEFAULT,
    CLIPBOARD_AUTO_CLEAR_MAX,
    CLIPBOARD_AUTO_CLEAR_MIN,
    FORM_DRAFT_TTL_OFF,
    FORM_DRAFT_TTL_1H,
    FORM_DRAFT_TTL_24H,
    FORM_DRAFT_TTL_7D,
    FORM_DRAFT_TTL_DEFAULT,
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
                /* Spec §19.5.2: on-chain label sync via FILE-action transport; submit/fetch wiring lands separately. */
                hint="Sync your address labels on-chain so your other devices can restore them. This feature is not active yet; your choice is saved."
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
                label="Native coin price data"
                hint="Sends a request to api.coingecko.com to display USD price, market cap, 24-hour change, and a 7-day chart for Bitcoin, Litecoin, and Dogecoin on the coin detail page. Reveals to that third party that you're using this wallet. Disable to hide the stats strip and chart with zero network calls."
                checked={settings.privacy.priceDataEnabled !== false}
                onChange={(v) => onToggle('priceDataEnabled', v)}
            />
            <ToggleRow
                label="Fetch token metadata"
                hint="When a token's description points at a Token Information Standard (TIS) JSON document, the wallet downloads it and renders the embedded artwork, audio, video, website, and social links on the token detail page. Reveals to the host of that document (and any embedded media URLs, including IPFS gateways and third-party CDNs) that you're looking at this token. Disable to render only the on-chain fields with zero extra network calls."
                checked={settings.privacy.metadataFetchEnabled !== false}
                onChange={(v) => onToggle('metadataFetchEnabled', v)}
            />
            <ToggleRow
                label="Always require hardware cross-check confirm"
                hint={`Forces the explicit "I've verified path + address" checkbox on every hardware-wallet sign, regardless of amount or recipient. The wallet already requires it for risky signs (large amounts, first-time recipients, multisig). Turn this on to require it on every HW sign.`}
                checked={settings.privacy.alwaysRequireHwExplicitConfirm === true}
                onChange={(v) => onToggle('alwaysRequireHwExplicitConfirm', v)}
            />
            <FormDraftTtlRow settings={settings} update={update} />
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

// Cluster P FOLLOWUP 6: form-draft retention dropdown.
function FormDraftTtlRow({ settings, update }) {
    const current = Number.isFinite(settings?.privacy?.formDraftTtlMs)
        ? Number(settings.privacy.formDraftTtlMs)
        : FORM_DRAFT_TTL_DEFAULT;
    const onChange = async (e) => {
        const next = Number(e.target.value);
        try {
            await update({ privacy: { formDraftTtlMs: next } });
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error('privacy.formDraftTtlMs update failed:', err);
        }
    };
    return (
        <div style={ROW}>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                <span style={{ color: 'var(--xc-text)', fontWeight: 500 }}>
                    Form draft retention
                </span>
                <span style={ROW_HINT}>
                    Send / sign-message forms persist a draft of in-progress
                    fields so a tab close or wallet lock doesn't lose what
                    you typed. Drafts older than the retention window are
                    discarded automatically; "Off" disables persistence and
                    wipes any existing drafts on next form load.
                </span>
            </div>
            <select
                value={current}
                onChange={onChange}
                aria-label="Form draft retention"
                style={{
                    ...INPUT,
                    width: '7.5rem',
                }}
            >
                <option value={FORM_DRAFT_TTL_OFF}>Off</option>
                <option value={FORM_DRAFT_TTL_1H}>1 hour</option>
                <option value={FORM_DRAFT_TTL_24H}>24 hours</option>
                <option value={FORM_DRAFT_TTL_7D}>7 days</option>
            </select>
        </div>
    );
}
