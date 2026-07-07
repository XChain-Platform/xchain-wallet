// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// NotificationsSection: §35.1 Notifications panel + §46.
//
// Five toggles backed by `settings.notifications.*`. Toggling these flags
// is the user *preference*; delivery is the §46 NotificationService
// (`packages/core/src/notifications/`), hosted per-shell (extension SW,
// web in-page host, Electron main) and gated by exactly these flags.
//
// The permission row owns the one piece of delivery the user must grant:
// the browser/OS notification permission (web + desktop renderer). It reads
// `Notification.permission` live and is hidden where that API is absent
// (e.g. the extension popup, whose delivery uses `chrome.notifications`,
// granted via the manifest, no runtime prompt).

import { useState } from 'react';
import { useSettings } from '../../hooks/useSettings.js';
import { usePriceAlerts } from '../../hooks/usePriceAlerts.js';
import { PriceAlertForm, coinLabelForChain } from '../PriceAlertForm.jsx';
import { ROW, ROW_HINT, STACK, Status, ToggleRow } from './_settingsPrimitives.jsx';

const PERMISSION_BUTTON = {
    background: 'var(--xc-accent, #3a7afe)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--xc-radius-sm)',
    padding: 'var(--xc-space-1) var(--xc-space-3)',
    fontSize: 'var(--xc-text-sm)',
    fontFamily: 'inherit',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
};

/**
 * Browser/OS notification-permission affordance. Renders nothing when the
 * Notification API is unavailable (extension popup) so the toggles still show.
 */
function PermissionRow() {
    const supported = typeof Notification !== 'undefined';
    const [permission, setPermission] = useState(supported ? Notification.permission : 'unsupported');

    if (!supported) return null;

    const request = async () => {
        try {
            const result = await Notification.requestPermission();
            setPermission(result);
        } catch {
            // Some browsers throw if requestPermission() is called outside a
            // user gesture; the click handler is a gesture, but stay defensive.
        }
    };

    let hint = 'Not enabled';
    let action = null;
    if (permission === 'granted') {
        hint = 'Enabled';
    } else if (permission === 'denied') {
        hint = 'Blocked. Turn notifications back on for this app in your browser or system settings.';
    } else {
        action = (
            <button type="button" onClick={request} style={PERMISSION_BUTTON}>
                Request permission
            </button>
        );
    }

    return (
        <div style={ROW}>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                <span style={{ color: 'var(--xc-text)', fontWeight: 500 }}>Desktop notifications</span>
                <span style={ROW_HINT}>{hint}</span>
            </div>
            {action}
        </div>
    );
}

const NOTIFICATION_FLAGS = /** @type {const} */ ([
    {
        key: 'txConfirmations',
        label: 'Transaction confirmations',
        hint: 'Notify on the first confirmation of a sent transaction.',
    },
    {
        key: 'incomingReceipts',
        label: 'Incoming receipts',
        hint: 'Notify when a watched address receives a transaction.',
    },
    {
        key: 'messages',
        label: 'Incoming messages',
        hint: 'Notify when a watched address receives a message.',
    },
    {
        key: 'governancePolls',
        label: 'Governance polls',
        hint: 'Notify when a new poll opens for a token you hold. Binding polls (their result triggers a contract) are flagged.',
        // The watcher treats an absent flag as ON (v2-tolerant default), so a
        // pre-flag settings record must render the toggle as ON too.
        defaultOn: true,
    },
    {
        key: 'dispenserFills',
        label: 'Dispenser fills',
        hint: 'Notify when a dispenser you authored is hit.',
    },
    {
        key: 'orderFills',
        label: 'Order fills',
        hint: 'Notify when a DEX order you placed is matched.',
    },
    {
        key: 'priceAlerts',
        label: 'Price alerts',
        hint: 'Notify on PRICE-oracle alert levels you subscribed to.',
    },
]);

/**
 * @param {object} props
 * @param {string | null | undefined} [props.walletId]  active wallet; scopes the price-alert manager
 */
export function NotificationsSection({ walletId } = {}) {
    const { settings, loading, error, update } = useSettings();

    if (loading) return <Status text="Loading…" />;
    if (error) return <Status text={`Settings unavailable: ${error.message}`} tone="error" />;
    if (!settings) return <Status text="Settings unavailable." tone="error" />;

    const onToggle = async (key, next) => {
        try {
            await update({ notifications: { [key]: next } });
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`notifications.${key} update failed:`, err);
        }
    };

    return (
        <div style={STACK}>
            <PermissionRow />
            {NOTIFICATION_FLAGS.map((f) => (
                <div key={f.key} style={STACK}>
                    <ToggleRow
                        label={f.label}
                        hint={f.hint}
                        checked={f.defaultOn ? settings.notifications[f.key] !== false : Boolean(settings.notifications[f.key])}
                        onChange={(v) => onToggle(f.key, v)}
                    />
                    {f.key === 'priceAlerts' ? (
                        <PriceAlertsManager
                            walletId={walletId}
                            settings={settings}
                            enabled={Boolean(settings.notifications.priceAlerts)}
                        />
                    ) : null}
                </div>
            ))}
        </div>
    );
}

const MANAGER = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--xc-space-2)',
    padding: 'var(--xc-space-2) var(--xc-space-3)',
    marginLeft: 'var(--xc-space-3)',
    borderLeft: '2px solid var(--xc-border)',
};
const ALERT_ROW = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--xc-space-2)',
    fontSize: 'var(--xc-text-sm)',
};
const LINK_BTN = {
    background: 'transparent',
    border: 'none',
    color: 'var(--xc-accent, #3a7afe)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 'var(--xc-text-xs)',
    padding: 0,
};

/**
 * Price-alert manager rendered under the priceAlerts toggle: the saved
 * alerts + an inline add form. Surfaces the two dependencies that keep an
 * alert from firing: the toggle being off, and (the key one) the privacy
 * opt-out for native-coin price data, which the watcher hard-gates on.
 *
 * @param {object} props
 * @param {string | null | undefined} props.walletId
 * @param {import('../../../schemas/settings.js').Settings} props.settings
 * @param {boolean} props.enabled
 */
function PriceAlertsManager({ walletId, settings, enabled }) {
    const { alerts, supported, addAlert, removeAlert, rearm } = usePriceAlerts(walletId);
    const priceDataOff = settings?.privacy?.priceDataEnabled === false;
    const fiatCurrency = (typeof settings?.fiatCurrency === 'string' && settings.fiatCurrency) || 'usd';

    if (!walletId || !supported) {
        return (
            <div style={MANAGER}>
                <span style={ROW_HINT}>Price alerts aren’t available in this view.</span>
            </div>
        );
    }

    return (
        <div style={MANAGER}>
            {priceDataOff ? (
                <span style={ROW_HINT}>
                    Price alerts need <strong>Native coin price data</strong>, which is off. Turn it on in
                    Settings → Privacy. Until then, alerts won’t fire.
                </span>
            ) : !enabled ? (
                <span style={ROW_HINT}>Turn on Price alerts above to start receiving these.</span>
            ) : null}

            {alerts.length === 0 ? (
                <span style={ROW_HINT}>No price alerts yet. Add one below.</span>
            ) : (
                alerts.map((a) => (
                    <div key={a.id} style={ALERT_ROW}>
                        <span>
                            {coinLabelForChain(a.chainId)}{' '}
                            {a.direction === 'above' ? 'rises above' : 'falls below'}{' '}
                            {formatThreshold(a.targetFiat, a.fiatCurrency)}
                            {a.status === 'triggered' ? <span style={ROW_HINT}> · triggered</span> : null}
                        </span>
                        <span style={{ display: 'flex', gap: 'var(--xc-space-2)' }}>
                            {a.status === 'triggered' ? (
                                <button type="button" style={LINK_BTN} onClick={() => rearm(a.id)}>Re-arm</button>
                            ) : null}
                            <button type="button" style={LINK_BTN} onClick={() => removeAlert(a.id)}>Delete</button>
                        </span>
                    </div>
                ))
            )}

            <PriceAlertForm onCreate={addAlert} fiatCurrency={fiatCurrency} />
        </div>
    );
}

/** Compact, locale-free threshold label, e.g. 70000/usd → "$70,000". */
function formatThreshold(value, fiatCurrency) {
    const cur = String(fiatCurrency || 'usd').toLowerCase();
    const n = Number(value);
    const grouped = Number.isFinite(n)
        ? String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
        : String(value);
    const body = (n < 0 ? '-' : '') + grouped;
    return cur === 'usd' ? `$${body}` : `${body} ${cur.toUpperCase()}`;
}
