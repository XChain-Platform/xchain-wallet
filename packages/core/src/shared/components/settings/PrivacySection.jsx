// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PrivacySection (§35.1 Privacy panel). Every switch describes its live
// consumer, including shell limits and the behavior of default-on fields.
// Form-draft retention is a select because it has more than two states.
//
// Clipboard auto-clear (seconds) is a live control again: it writes
// `settings.privacy.clipboardAutoClearSeconds`, which shared/clipboard.js
// reads on every shell, so a privacy control here always governs something.

import { useSettings } from '../../hooks/useSettings.js';
import { shellCapabilities } from '../../shellCapabilities.js';
import {
    FORM_DRAFT_TTL_OFF,
    FORM_DRAFT_TTL_1H,
    FORM_DRAFT_TTL_24H,
    FORM_DRAFT_TTL_7D,
    FORM_DRAFT_TTL_DEFAULT,
    CLIPBOARD_AUTO_CLEAR_DEFAULT,
    CLIPBOARD_AUTO_CLEAR_MAX,
    CLIPBOARD_AUTO_CLEAR_MIN,
} from '../../../schemas/settings.js';
import {
    INPUT,
    ROW,
    ROW_HINT,
    ROW_VALUE,
    SELECT,
    ToggleRow,
    SettingsLoadError,
    Status,
    STACK,
} from './_settingsPrimitives.jsx';

export function PrivacySection() {
    const { settings, loading, error, update } = useSettings();

    if (loading) return <Status text="Loading…" />;
    if (error) return <SettingsLoadError error={error} />;
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
            {/* Only a host that can proxy wallet-owned traffic exposes the
                live setting. Browser-based shells show the disabled row. */}
            {shellCapabilities().socksProxy && (
                <ToggleRow
                    label="Tor routing"
                    hint="Desktop only: send wallet traffic through a local Tor SOCKS5 proxy at 127.0.0.1:9050; Tor must already be running because unreachable requests fail rather than quietly going direct."
                    checked={settings.privacy.torRouting}
                    onChange={(v) => onToggle('torRouting', v)}
                />
            )}
            {/* An unavailable shell always renders this switch off because
                its stored desktop preference cannot affect local traffic. */}
            {!shellCapabilities().socksProxy && (
                <ToggleRow
                    label="Tor routing"
                    hint="Not available on this platform or shell because browser wallets cannot open a wallet-only SOCKS connection and extension proxies affect the entire browser; the desktop app can route only wallet traffic through Tor."
                    checked={false}
                    disabled
                    onChange={() => {}}
                />
            )}
            <ToggleRow
                label="Change-address rotation"
                hint="Imported-key and watch-only sends keep the spending address, while HD wallets use the next internal change address when available and list rotated leftovers as “Change #N”."
                checked={settings.privacy.changeAddressRotation}
                onChange={(v) => onToggle('changeAddressRotation', v)}
            />
            <ToggleRow
                label="Blur sensitive data on blur"
                hint="Blur the entire wallet display while its window or tab is unfocused or hidden, then reveal it again when focus returns."
                checked={Boolean(settings.privacy.blurOnBlur)}
                onChange={(v) => onToggle('blurOnBlur', v)}
            />
            <ToggleRow
                label="Labels survive restore"
                hint="In the browser extension, batch label and contact edits into one on-chain publish prompt per unlock window while keeping manual publishing and restoration available in Backup."
                checked={Boolean(settings.privacy.labelsSurviveRestore)}
                onChange={(v) => onToggle('labelsSurviveRestore', v)}
            />
            <ToggleRow
                label="Haptic feedback"
                hint="Allow vibration for tap, success, warning, and error events when supported; OS or in-app reduced-motion settings suppress haptics."
                checked={settings.privacy.hapticsEnabled !== false}
                onChange={(v) => onToggle('hapticsEnabled', v)}
            />
            <ToggleRow
                label="Native coin price data"
                hint="Allow CoinGecko requests for native-coin details, fallback fiat rates, and enabled price alerts; turning this off blocks those requests and hides the details and chart, while explorer-backed on-chain oracle rates can still appear."
                checked={settings.privacy.priceDataEnabled !== false}
                onChange={(v) => onToggle('priceDataEnabled', v)}
            />
            <ToggleRow
                label="Fetch token metadata"
                hint="Fetch Token Information Standard (TIS) JSON and referenced media from issuer-selected hosts when linked by a token description; turning this off shows only on-chain fields without TIS or remote-media requests."
                checked={settings.privacy.metadataFetchEnabled !== false}
                onChange={(v) => onToggle('metadataFetchEnabled', v)}
            />
            <ToggleRow
                label="Always require hardware cross-check confirm"
                hint={`Require the "I've verified path + address" checkbox for every hardware-wallet sign instead of only for large amounts, first-time recipients, and multisig signs.`}
                checked={settings.privacy.alwaysRequireHwExplicitConfirm === true}
                onChange={(v) => onToggle('alwaysRequireHwExplicitConfirm', v)}
            />
            <ClipboardAutoClearRow settings={settings} update={update} />
            <FormDraftTtlRow settings={settings} update={update} />
        </div>
    );
}

function ClipboardAutoClearRow({ settings, update }) {
    const stored = settings?.privacy?.clipboardAutoClearSeconds;
    const current = Number.isInteger(stored) ? stored : CLIPBOARD_AUTO_CLEAR_DEFAULT;
    const onChange = async (event) => {
        const next = Number(event.target.value);
        if (!Number.isInteger(next)
            || next < CLIPBOARD_AUTO_CLEAR_MIN
            || next > CLIPBOARD_AUTO_CLEAR_MAX) return;
        try {
            await update({ privacy: { clipboardAutoClearSeconds: next } });
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error('privacy.clipboardAutoClearSeconds update failed:', err);
        }
    };
    return (
        <div style={ROW}>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                <span style={ROW_VALUE}>
                    Clipboard auto-clear
                </span>
                <span style={ROW_HINT}>
                    Set to 0 to keep them until they are replaced; otherwise, clear sensitive clipboard copies after this many seconds.
                </span>
            </div>
            <input
                type="number"
                min={CLIPBOARD_AUTO_CLEAR_MIN}
                max={CLIPBOARD_AUTO_CLEAR_MAX}
                step="1"
                value={current}
                onChange={onChange}
                aria-label="Clipboard auto-clear seconds"
                style={{ ...INPUT, width: '6rem' }}
            />
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
                <span style={ROW_VALUE}>
                    Form draft retention
                </span>
                <span style={ROW_HINT}>
                    Keep in-progress send and sign-message fields through a tab close or wallet lock until the retention window expires, or disable persistence and clear saved drafts on the next form load by selecting "Off."
                </span>
            </div>
            <select
                value={current}
                onChange={onChange}
                aria-label="Form draft retention"
                style={{
                    ...SELECT,
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
