// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// NotificationsSection — §35.1 Notifications panel + §46.
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
        hint = 'Blocked — turn notifications back on for this app in your browser or system settings.';
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

export function NotificationsSection() {
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
                <ToggleRow
                    key={f.key}
                    label={f.label}
                    hint={f.hint}
                    checked={Boolean(settings.notifications[f.key])}
                    onChange={(v) => onToggle(f.key, v)}
                />
            ))}
        </div>
    );
}
