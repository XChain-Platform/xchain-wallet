// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// NotificationsSection: §35.1 Notifications panel + §46 + §6 M4.2.
//
// Ten per-kind toggles backed by `settings.notifications.*`. Toggling these
// flags is the user *preference*; delivery is the §46 NotificationService
// (`packages/core/src/notifications/`), hosted per-shell (extension SW,
// web in-page host, Electron main) and gated by exactly these flags. Below
// the flag list sit a quiet-hours (do-not-disturb) row, the price-alert
// manager under the priceAlerts toggle, and the M4 sounds block.
//
// The permission row owns the one piece of delivery the user must grant:
// the browser/OS notification permission (web + desktop renderer). It reads
// `Notification.permission` live and is hidden where that API is absent
// (e.g. the extension popup, whose delivery uses `chrome.notifications`,
// granted via the manifest, no runtime prompt).
//
// The sounds block is a separate, top-level preference: `settings.sounds`
// (never nested under `notifications`, so a single family pick doesn't
// freeze the whole flag block under the sparse-merge rule). It has its own
// master switch, off by default, and while on, one sound picker per
// notification family plus a Preview button. Preview is gated on the web
// shell (`shell === 'web'`) because that is the only host with the
// delivery seam to actually play a sound (ruling I-34b); it dispatches
// SOUND_PREVIEW_EVENT for the shell's notify adapter to pick up.

import { useEffect, useState } from 'react';
import { Input } from '../../../ui/Input.jsx';
import { useSettings } from '../../hooks/useSettings.js';
import { usePriceAlerts } from '../../hooks/usePriceAlerts.js';
import { useMessaging } from '../../useMessaging.js';
import { PriceAlertForm, coinLabelForChain } from '../PriceAlertForm.jsx';
import { RelativeTime } from '../RelativeTime.jsx';
import { QUIET_HOURS_DEFAULT } from '../../../schemas/settings.js';
import {
    SOUND_FAMILIES,
    SOUND_NONE,
    SOUND_PALETTE,
    SOUND_PREVIEW_EVENT,
    pickedSoundForFamily,
} from '../../../notifications/notificationSounds.js';
import { ROW, ROW_HINT, SELECT, STACK, SettingsLoadError, Status, ToggleRow } from './_settingsPrimitives.jsx';

const PERMISSION_BUTTON = {
    background: 'var(--xc-accent, #3a7afe)',
    color: 'var(--xc-on-accent)',
    border: 'none',
    borderRadius: 'var(--xc-radius-sm)',
    padding: 'var(--xc-space-1) var(--xc-space-3)',
    fontSize: 'var(--xc-text-sm)',
    fontFamily: 'inherit',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
};

/**
 * Browser/OS notification-permission affordance. The extension requests and
 * removes its optional Chrome permission here, under a direct user gesture.
 */
function PermissionRow() {
    const chromePermissions = globalThis.chrome?.permissions;
    const extensionSupported = typeof chromePermissions?.contains === 'function'
        && typeof chromePermissions?.request === 'function'
        && typeof chromePermissions?.remove === 'function';
    const webSupported = typeof Notification !== 'undefined';
    const [permission, setPermission] = useState(extensionSupported
        ? 'checking'
        : (webSupported ? Notification.permission : 'unsupported'));
    const [requestError, setRequestError] = useState(/** @type {string | null} */ (null));
    const [requesting, setRequesting] = useState(false);

    useEffect(() => {
        if (!extensionSupported) return undefined;
        let active = true;
        chromePermissions.contains({ permissions: ['notifications'] })
            .then((granted) => {
                if (active) setPermission(granted ? 'granted' : 'default');
            })
            .catch(() => {
                if (active) setRequestError('Could not check notification permission. Try again.');
            });
        return () => { active = false; };
    }, [chromePermissions, extensionSupported]);

    if (!extensionSupported && !webSupported) return null;

    const request = async () => {
        if (requesting) return;
        setRequesting(true);
        setRequestError(null);
        try {
            if (extensionSupported) {
                const granted = await chromePermissions.request({ permissions: ['notifications'] });
                setPermission(granted ? 'granted' : 'default');
            } else {
                const result = await Notification.requestPermission();
                setPermission(result);
            }
        } catch {
            setRequestError('Could not request notification permission. Check this app in your browser or system settings.');
        } finally {
            setRequesting(false);
        }
    };

    const revoke = async () => {
        if (requesting || !extensionSupported) return;
        setRequesting(true);
        setRequestError(null);
        try {
            const removed = await chromePermissions.remove({ permissions: ['notifications'] });
            if (removed) setPermission('default');
            else setRequestError('Could not revoke notification permission. Try again.');
        } catch {
            setRequestError('Could not revoke notification permission. Try again.');
        } finally {
            setRequesting(false);
        }
    };

    let hint = extensionSupported
        ? 'Optional. Allows XChain Wallet to show the transaction, payment, market, and governance alerts you select. You can revoke access here at any time.'
        : 'Not enabled';
    let action = null;
    if (permission === 'granted') {
        hint = extensionSupported
            ? 'Allowed. XChain Wallet can show the alert categories you select below.'
            : 'Allowed. Use the categories below to choose which notifications you receive.';
        if (extensionSupported) {
            action = (
                <button type="button" onClick={revoke} disabled={requesting} aria-busy={requesting} style={PERMISSION_BUTTON}>
                    {requesting ? 'Revoking…' : 'Revoke permission'}
                </button>
            );
        }
    } else if (permission === 'denied') {
        hint = 'Notifications are blocked. Open your browser or system settings, find XChain Wallet, and allow notifications.';
    } else if (permission !== 'checking') {
        action = (
            <button type="button" onClick={request} disabled={requesting} aria-busy={requesting} style={PERMISSION_BUTTON}>
                {requesting ? 'Requesting…' : (extensionSupported ? 'Allow notifications' : 'Request permission')}
            </button>
        );
    }

    return (
        <div style={ROW}>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                <span style={{ color: 'var(--xc-text)', fontWeight: 500 }}>Desktop notifications</span>
                <span style={ROW_HINT}>{requestError || hint}</span>
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
        key: 'incomingPending',
        label: 'Incoming pending payments',
        hint: 'Notify as soon as a payment to a watched address is seen by the network, before it confirms.',
        // Same v2-tolerant default as governancePolls: the watcher treats an
        // absent flag as ON, so a pre-flag settings record renders ON here too.
        defaultOn: true,
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
        key: 'deadlines',
        label: 'Deadlines',
        hint: 'Notify before one of your orders, swaps or dispensers expires, or a poll you created or voted in closes.',
        // Same v2-tolerant default as governancePolls: the watcher treats an
        // absent flag as ON, so a pre-flag settings record renders ON here too.
        defaultOn: true,
    },
    {
        key: 'dispenserEscrow',
        label: 'Dispenser running low',
        hint: 'Notify when a dispenser you run is nearly out of stock, so you can top it up before it turns buyers away.',
        // v2-tolerant default, like the sibling watcher flags.
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
        hint: 'Notify when a coin hits a price level you set.',
    },
]);

/**
 * @param {object} props
 * @param {string | null | undefined} [props.walletId]  active wallet; scopes the price-alert manager
 */
export function NotificationsSection({ walletId } = {}) {
    const { settings, loading, error, update } = useSettings();
    const [pendingKey, setPendingKey] = useState(/** @type {string | null} */ (null));
    const [toggleError, setToggleError] = useState(/** @type {{ key: string, message: string } | null} */ (null));

    if (loading) return <Status text="Loading…" />;
    if (error) return <SettingsLoadError error={error} />;
    if (!settings) return <Status text="Settings unavailable." tone="error" />;

    const onToggle = async (key, label, next) => {
        setPendingKey(key);
        setToggleError(null);
        try {
            await update({ notifications: { [key]: next } });
        } catch (err) {
            setToggleError({ key, message: `Could not update ${label.toLowerCase()}. Try again.` });
            // eslint-disable-next-line no-console
            console.error(`notifications.${key} update failed:`, err);
        } finally {
            setPendingKey(null);
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
                        disabled={pendingKey !== null}
                        onChange={(v) => onToggle(f.key, f.label, v)}
                    />
                    <NotificationSaveError message={toggleError?.key === f.key ? toggleError.message : null} />
                    {f.key === 'priceAlerts' ? (
                        <PriceAlertsManager
                            walletId={walletId}
                            settings={settings}
                            enabled={Boolean(settings.notifications.priceAlerts)}
                        />
                    ) : null}
                </div>
            ))}
            <QuietHoursRow settings={settings} update={update} />
            <SoundsBlock settings={settings} update={update} />
        </div>
    );
}

function NotificationSaveError({ message }) {
    return message ? (
        <span role="alert" style={{ ...ROW_HINT, color: 'var(--xc-danger-fg)' }}>{message}</span>
    ) : null;
}

/**
 * Event sounds (§6 M4.2). A master toggle, off by default, and while it is
 * on one picker per notification family plus a Preview button.
 *
 * The pickers stay collapsed behind the master the way quiet hours and the
 * price-alert manager collapse behind theirs: ten always-visible selects
 * would double the panel's height for a feature that ships off.
 *
 * Preview is rendered only where the shell can actually make a noise: the
 * web shell (which the mobile wrapper shares), whose host listens for
 * SOUND_PREVIEW_EVENT and plays through its notify adapter. Desktop and the
 * extension lack the delivery seam (ruling I-34b), and a button that does
 * nothing is worse than no button, so it is gated on the shell rather than
 * routed through a messaging helper the parity gate would demand of all three.
 *
 * @param {object} props
 * @param {import('../../../schemas/settings.js').Settings} props.settings
 * @param {(patch: Record<string, unknown>) => Promise<unknown>} props.update
 */
function SoundsBlock({ settings, update }) {
    const { shell } = useMessaging();
    const canPreview = shell === 'web';
    const enabled = settings.sounds?.enabled === true;
    const [saveError, setSaveError] = useState(/** @type {string | null} */ (null));

    const onToggle = async (next) => {
        setSaveError(null);
        try {
            await update({ sounds: { enabled: next } });
        } catch (err) {
            setSaveError('enabled');
            // eslint-disable-next-line no-console
            console.error('notifications.sounds update failed:', err);
        }
    };
    // One family's patch, not the whole map: the settings merge recurses,
    // so writing a single key leaves every sibling family untouched.
    const onPick = async (familyKey, soundId) => {
        setSaveError(null);
        try {
            await update({ sounds: { perKind: { [familyKey]: soundId } } });
        } catch (err) {
            setSaveError(familyKey);
            // eslint-disable-next-line no-console
            console.error(`notifications.sounds.${familyKey} update failed:`, err);
        }
    };
    const onPreview = (soundId) => {
        try {
            window.dispatchEvent(new CustomEvent(SOUND_PREVIEW_EVENT, { detail: { soundId } }));
        } catch {
            // No window (a non-DOM render): the user just hears nothing, which
            // is not worth an error surface.
        }
    };

    return (
        <div style={STACK}>
            <ToggleRow
                label="Notification sounds"
                hint="Play a sound with each in-app notification while the wallet is open. Off by default; quiet hours and the toggles above still apply."
                checked={enabled}
                onChange={onToggle}
            />
            <NotificationSaveError
                message={saveError === 'enabled' ? 'Could not save the notification sound setting. Try again.' : null}
            />
            {enabled ? (
                <div style={MANAGER}>
                    {SOUND_FAMILIES.map((family) => {
                        const picked = pickedSoundForFamily(settings, family.key);
                        return (
                            <div key={family.key} style={STACK}>
                                <div style={ALERT_ROW}>
                                    <span>{family.label}</span>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--xc-space-2)' }}>
                                        <select
                                            style={SELECT}
                                            aria-label={`${family.label} sound`}
                                            value={picked}
                                            onChange={(e) => onPick(family.key, e.target.value)}
                                        >
                                            {SOUND_PALETTE.map((s) => (
                                                <option key={s.id} value={s.id}>{s.label}</option>
                                            ))}
                                            <option value={SOUND_NONE}>No sound</option>
                                        </select>
                                        {canPreview ? (
                                            <button
                                                type="button"
                                                style={LINK_BTN}
                                                aria-label={`Preview ${family.label} sound`}
                                                disabled={picked === SOUND_NONE}
                                                onClick={() => onPreview(picked)}
                                            >
                                                Preview
                                            </button>
                                        ) : null}
                                    </span>
                                </div>
                                <NotificationSaveError
                                    message={saveError === family.key ? 'Could not save this notification sound. Try again.' : null}
                                />
                            </div>
                        );
                    })}
                    <span style={ROW_HINT}>
                        Sounds never arrive on their own: each one rides the notification it belongs to.
                    </span>
                </div>
            ) : null}
        </div>
    );
}

/**
 * Do-not-disturb window. When on, every notification kind above
 * (including price alerts) is suppressed while the local clock is inside
 * [start, end); an end before start wraps past midnight (e.g. 22:00-08:00).
 * Delivery is dropped, not queued: nothing catches up once the window ends.
 */
function QuietHoursRow({ settings, update }) {
    const qh = settings.quietHours || QUIET_HOURS_DEFAULT;
    const [saveError, setSaveError] = useState(/** @type {string | null} */ (null));

    const onToggle = async (enabled) => {
        setSaveError(null);
        try {
            await update({ quietHours: { ...qh, enabled } });
        } catch (err) {
            setSaveError('enabled');
            // eslint-disable-next-line no-console
            console.error('notifications.quietHours update failed:', err);
        }
    };
    const onTimeChange = async (field, value) => {
        if (!value) return;
        setSaveError(null);
        try {
            await update({ quietHours: { ...qh, [field]: value } });
        } catch (err) {
            setSaveError(field);
            // eslint-disable-next-line no-console
            console.error('notifications.quietHours update failed:', err);
        }
    };

    return (
        <div style={STACK}>
            <ToggleRow
                label="Quiet hours"
                hint="Pause all notifications, including price alerts, during a daily time window."
                checked={qh.enabled === true}
                onChange={onToggle}
            />
            <NotificationSaveError
                message={saveError === 'enabled' ? 'Could not save quiet hours. Try again.' : null}
            />
            {qh.enabled ? (
                <div style={MANAGER}>
                    <div style={ALERT_ROW}>
                        <Input
                            id="quiet-hours-start"
                            label="From"
                            type="time"
                            value={qh.start}
                            onChange={(e) => onTimeChange('start', e.target.value)}
                        />
                        <Input
                            id="quiet-hours-end"
                            label="To"
                            type="time"
                            value={qh.end}
                            onChange={(e) => onTimeChange('end', e.target.value)}
                        />
                    </div>
                    <span style={ROW_HINT}>
                        {qh.start} to {qh.end} your device's local time, every day.
                    </span>
                    <NotificationSaveError
                        message={saveError === 'start' || saveError === 'end' ? 'Could not save quiet hours. Try again.' : null}
                    />
                </div>
            ) : null}
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
    flexWrap: 'wrap',
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
    const {
        alerts,
        loading,
        supported,
        error,
        addAlert,
        updateAlert,
        removeAlert,
        rearm,
        reload,
    } = usePriceAlerts(walletId);
    const [editingId, setEditingId] = useState(/** @type {string | null} */ (null));
    const [actionError, setActionError] = useState(/** @type {string | null} */ (null));
    const [busyId, setBusyId] = useState(/** @type {string | null} */ (null));
    const priceDataOff = settings?.privacy?.priceDataEnabled === false;
    const fiatCurrency = (typeof settings?.fiatCurrency === 'string' && settings.fiatCurrency) || 'usd';
    const editingAlert = alerts.find((alert) => alert.id === editingId) || null;

    if (!walletId || !supported) {
        return (
            <div style={MANAGER}>
                <span style={ROW_HINT}>
                    {!walletId ? 'Choose a wallet to manage price alerts.' : 'Price alerts are not supported in this app.'}
                </span>
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

            {loading ? (
                <span role="status" style={ROW_HINT}>Loading price alerts…</span>
            ) : error ? (
                <span role="alert" style={{ ...ROW_HINT, color: 'var(--xc-danger)' }}>
                    Could not load price alerts.{' '}
                    <button type="button" style={LINK_BTN} onClick={reload}>Try again</button>
                </span>
            ) : alerts.length === 0 ? (
                <span role="status" style={ROW_HINT}>No price alerts yet. Add one below.</span>
            ) : (
                alerts.map((a) => (
                    <div key={a.id} style={ALERT_ROW}>
                        <span>
                            {coinLabelForChain(a.chainId)}{' '}
                            {a.direction === 'above' ? 'rises above' : 'falls below'}{' '}
                            {formatThreshold(a.targetFiat, a.fiatCurrency)}
                            {a.status === 'triggered' ? (
                                <span style={ROW_HINT}>
                                    {' · triggered'}
                                    {a.triggeredAt ? (
                                        <RelativeTime timestamp={a.triggeredAt}>
                                            {(when) => ` ${when}`}
                                        </RelativeTime>
                                    ) : null}
                                </span>
                            ) : null}
                        </span>
                        <span style={{ display: 'flex', gap: 'var(--xc-space-2)' }}>
                            {a.status === 'triggered' ? (
                                <button
                                    type="button"
                                    style={LINK_BTN}
                                    disabled={busyId !== null}
                                    onClick={() => runAlertAction(a.id, () => rearm(a.id), setBusyId, setActionError)}
                                >
                                    Re-arm
                                </button>
                            ) : null}
                            <button
                                type="button"
                                style={LINK_BTN}
                                disabled={busyId !== null}
                                aria-label={`Edit ${coinLabelForChain(a.chainId)} price alert`}
                                onClick={() => { setEditingId(a.id); setActionError(null); }}
                            >
                                Edit
                            </button>
                            <button
                                type="button"
                                style={LINK_BTN}
                                disabled={busyId !== null}
                                aria-label={`Delete ${coinLabelForChain(a.chainId)} price alert`}
                                onClick={() => runAlertAction(a.id, async () => {
                                    await removeAlert(a.id);
                                    if (editingId === a.id) setEditingId(null);
                                }, setBusyId, setActionError)}
                            >
                                Delete
                            </button>
                        </span>
                    </div>
                ))
            )}

            {actionError ? <span role="alert" style={{ ...ROW_HINT, color: 'var(--xc-danger)' }}>{actionError}</span> : null}
            {!loading && !error ? (
                <PriceAlertForm
                    key={editingAlert?.id || 'new'}
                    onCreate={editingAlert ? async (input) => {
                        await updateAlert(editingAlert.id, input);
                        setEditingId(null);
                    } : addAlert}
                    fiatCurrency={editingAlert?.fiatCurrency || fiatCurrency}
                    initialAlert={editingAlert || undefined}
                    onCancel={editingAlert ? () => setEditingId(null) : undefined}
                />
            ) : null}
        </div>
    );
}

async function runAlertAction(id, action, setBusyId, setActionError) {
    setBusyId(id);
    setActionError(null);
    try {
        await action();
    } catch {
        setActionError('Could not update the price alert. Try again.');
    } finally {
        setBusyId(null);
    }
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
