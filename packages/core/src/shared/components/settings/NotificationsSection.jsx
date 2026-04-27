// NotificationsSection — §35.1 Notifications panel + §46.
//
// Five toggles backed by `settings.notifications.*` (all on the v1
// schema). Toggling these flags is independent of how notifications
// are *delivered* — the delivery layer (browser Notification API,
// extension service-worker, OS toast on desktop) lives in §46 and is
// wired separately. Here we own only the user preference.

import { useSettings } from '../../hooks/useSettings.js';
import { STACK, Status, ToggleRow } from './_settingsPrimitives.jsx';

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
