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
// (operator ruling a, 2026-08-11): the "Clipboard auto-clear
// (seconds)" input that used to sit at the bottom of this panel is gone.
// Its only consumer was ViewPrivateKey's post-copy wipe timer, and
// a later change made key material uncopyable on every shell, so the control
// wrote `settings.privacy.clipboardAutoClearSeconds` and nothing read it.
// A privacy control that governs nothing is worse than an absent one: it
// tells the user they hold a protection they do not hold. The schema
// field stays (see schemas/settings.js) because dropping it would be a
// stored-settings migration for no gain, and because a future copy path
// can claim it back.

import { useSettings } from '../../hooks/useSettings.js';
import { shellCapabilities } from '../../shellCapabilities.js';
import {
    FORM_DRAFT_TTL_OFF,
    FORM_DRAFT_TTL_1H,
    FORM_DRAFT_TTL_24H,
    FORM_DRAFT_TTL_7D,
    FORM_DRAFT_TTL_DEFAULT,
} from '../../../schemas/settings.js';
import { INPUT, ROW, ROW_HINT, ToggleRow, SettingsLoadError, Status, STACK } from './_settingsPrimitives.jsx';

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
            {/* The live toggle renders only where the host can
                actually route. A browser page cannot speak SOCKS at all,
                and an MV3 extension could only proxy the user's whole
                browser rather than the wallet, so an operable toggle
                there would promise something no code could keep. It was
                offered in all three shells and implemented in none. */}
            {shellCapabilities().socksProxy && (
                <ToggleRow
                    label="Tor routing"
                    hint="Routes wallet requests through Tor at 127.0.0.1:9050. Tor must already be running; requests fail if it cannot be reached."
                    checked={settings.privacy.torRouting}
                    onChange={(v) => onToggle('torRouting', v)}
                />
            )}
            {/* (operator ruling a): the shells that cannot route
                say so, rather than dropping the row. Silence reads as
                "this wallet has no Tor option"; the disabled row reads
                as "not here, and here is where". It is rendered
                unchecked and inert on purpose: a saved `torRouting: true`
                carried in from a desktop vault must never draw a switch
                in the on position on a shell where nothing is proxied,
                which is the exact misrepresentation this item exists to
                close. Same disclosure shape as "Labels survive restore"
                below. */}
            {!shellCapabilities().socksProxy && (
                <ToggleRow
                    label="Tor routing"
                    hint="Tor routing is available only in the desktop app. This platform cannot proxy only the wallet's requests."
                    checked={false}
                    disabled
                    onChange={() => {}}
                />
            )}
            <ToggleRow
                label="Change-address rotation"
                /* This drives flows/changeAddress.js. The second
                   sentence is not a caveat for its own sake - the wallet funds
                   one action from one address, so after a rotated send the
                   remaining balance sits on the new address and the address you
                   sent from reads zero. Users who are not told that report it
                   as lost funds. */
                hint="Uses a fresh address for change after each send, making transactions harder to link. Your remaining balance appears under a new Change address."
                checked={settings.privacy.changeAddressRotation}
                onChange={(v) => onToggle('changeAddressRotation', v)}
            />
            <ToggleRow
                label="Hide small balances"
                hint="Hides tiny balances from balance and portfolio views."
                checked={settings.privacy.hideSmallBalances}
                onChange={(v) => onToggle('hideSmallBalances', v)}
            />
            <ToggleRow
                label="Blur sensitive data on blur"
                hint="Blurs recovery phrases, QR codes, and balances while the wallet is not focused."
                checked={Boolean(settings.privacy.blurOnBlur)}
                onChange={(v) => onToggle('blurOnBlur', v)}
            />
            <ToggleRow
                label="Labels survive restore"
                /* Spec §19.5.2: the extension background host reads this flag to queue label batches; Backup publishes by hand in every shell. */
                hint="In the browser extension, queues label changes for encrypted backup and restore. You can also publish them manually from Backup."
                checked={Boolean(settings.privacy.labelsSurviveRestore)}
                onChange={(v) => onToggle('labelsSurviveRestore', v)}
            />
            <ToggleRow
                label="Haptic feedback"
                hint="Vibrates for success, errors, and taps on supported devices. Your reduced-motion setting also turns this off."
                checked={settings.privacy.hapticsEnabled !== false}
                onChange={(v) => onToggle('hapticsEnabled', v)}
            />
            <ToggleRow
                label="Native coin price data"
                hint="Allows CoinGecko lookups for fiat values, market data, charts, and price alerts. CoinGecko can learn that you use this wallet. Turn off to stop these requests."
                checked={settings.privacy.priceDataEnabled !== false}
                onChange={(v) => onToggle('priceDataEnabled', v)}
            />
            <ToggleRow
                label="Fetch token metadata"
                hint="Loads artwork, media, and links referenced by token descriptions. Their hosts can learn which token you view. Turn off to show only on-chain details."
                checked={settings.privacy.metadataFetchEnabled !== false}
                onChange={(v) => onToggle('metadataFetchEnabled', v)}
            />
            <ToggleRow
                label="Always require hardware cross-check confirm"
                hint="Requires you to confirm the path and address on every hardware-wallet signature. Risky signatures already require this check."
                checked={settings.privacy.alwaysRequireHwExplicitConfirm === true}
                onChange={(v) => onToggle('alwaysRequireHwExplicitConfirm', v)}
            />
            <FormDraftTtlRow settings={settings} update={update} />
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
