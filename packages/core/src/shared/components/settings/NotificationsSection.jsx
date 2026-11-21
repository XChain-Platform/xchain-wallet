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
// the flag list sit a quiet-hours (do-not-disturb) row and the M4 sounds block.
//
// The permission row owns the one piece of delivery the user must grant:
// browser/OS notification permission on web and desktop, or the optional
// Chrome notification permission in the extension. It refreshes the live
// state without prompting; only its button requests access.
//
// The sounds block is a separate, top-level preference: `settings.sounds`
// (never nested under `notifications`, so a single family pick doesn't
// freeze the whole flag block under the sparse-merge rule). It has its own
// master switch, off by default, and one sound field per notification
// family, always visible in three groups. Each field is the standard picker
// field and opens the Choose Sound page (operator 2026-11-15); tapping a row
// there previews it when the platform exposes sound playback, then dispatches
// SOUND_PREVIEW_EVENT for that platform's notify adapter.

import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Button, FormPage, Icon, Input, StatusMessage, Switch, useFormErrors } from '@xchain-wallet/core/ui';
import { ListField } from '../ListField.jsx';
import { FileField } from '../FileField.jsx';
import { ChoiceList, RowIcon } from './AppearancePages.jsx';
import styles from './NotificationsSection.module.css';
import { useSettings } from '../../hooks/useSettings.js';
import { useMessaging } from '../../useMessaging.js';
import { getNativePlugin } from '../../nativeShell.js';
import { QUIET_HOURS_DEFAULT } from '../../../schemas/settings.js';
import {
    MINUTES_PER_DAY,
    STEP_MINUTES,
    formatClock,
    formatHourLabel,
    parseClock,
    quietSegments,
    snapMinutes,
    toClock,
    uses24HourClock,
} from '../../../notifications/quietHoursTime.js';
import {
    SOUND_FAMILIES,
    SOUND_NONE,
    SOUND_NONE_OPTION,
    SOUND_PALETTE,
    SOUND_PREVIEW_EVENT,
    pickedSoundForFamily,
} from '../../../notifications/notificationSounds.js';
import {
    CUSTOM_SOUND_ACCEPT,
    deleteCustomSound,
    isCustomSoundId,
    listCustomSounds,
    playCustomSound,
    saveCustomSound,
    validateCustomSoundFile,
} from '../../../notifications/customSounds.js';
import { ROW, ROW_HINT, STACK, SettingsLoadError, Status } from './_settingsPrimitives.jsx';
import { t } from '../../../i18n/index.js';
import { userFacingMessage } from '../../utils/userFacingMessage.js';
import '../../../i18n/locales/en/settings.js';
import '../../../i18n/locales/en/alerts.js';

const LazyCustomSoundIconField = lazy(() => import('./CustomSoundIconField.jsx').then((module) => ({
    default: module.CustomSoundIconField,
})));
const LazyCustomSoundIconPickerScreen = lazy(() => import('./CustomSoundIconField.jsx').then((module) => ({
    default: module.CustomSoundIconPickerScreen,
})));
const DEFAULT_CUSTOM_SOUND_ICON = 'lucide:alarm-clock';

/** The permission state before the first live read. */
export function initialNotificationPermission() {
    const nativeNotify = getNativePlugin('XChainNotify', { method: 'permissionState' });
    if (nativeNotify) return 'checking';
    const chromePermissions = globalThis.chrome?.permissions;
    const extensionSupported = typeof chromePermissions?.contains === 'function'
        && typeof chromePermissions?.request === 'function'
        && typeof chromePermissions?.remove === 'function';
    if (extensionSupported) return 'checking';
    return typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
}

export function nativeNotificationPermission(state) {
    if (state === 'granted' || state === 'denied') return state;
    if (state === 'default' || state === 'prompt' || state === 'prompt-with-rationale') return 'default';
    return 'unsupported';
}

/**
 * Browser/OS notification permission: refreshes the live state without
 * prompting (on mount, focus and visibility), and requests or, in the
 * extension, revokes it under a direct user gesture. Shared by this section
 * and the Notifications page's inline Desktop notifications row.
 *
 * @param {string} permission
 * @param {(next: string) => void} setPermission
 */
export function useNotificationPermissionAccess(permission, setPermission) {
    const nativeNotify = getNativePlugin('XChainNotify', { method: 'permissionState' });
    const nativeSupported = Boolean(nativeNotify);
    const chromePermissions = globalThis.chrome?.permissions;
    const extensionSupported = typeof chromePermissions?.contains === 'function'
        && typeof chromePermissions?.request === 'function'
        && typeof chromePermissions?.remove === 'function';
    const webSupported = typeof Notification !== 'undefined';
    const [requestError, setRequestError] = useState(/** @type {string | null} */ (null));
    const [requesting, setRequesting] = useState(false);
    const requestInFlight = useRef(false);

    useEffect(() => {
        let active = true;
        const refresh = () => {
            if (nativeSupported) {
                nativeNotify.permissionState()
                    .then(({ state } = {}) => {
                        if (active) {
                            setPermission(nativeNotificationPermission(state));
                            setRequestError(null);
                        }
                    })
                    .catch(() => {
                        if (active) setRequestError('Could not check notification permission. Try again.');
                    });
            } else if (extensionSupported) {
                chromePermissions.contains({ permissions: ['notifications'] })
                    .then((granted) => {
                        if (active) {
                            setPermission(granted ? 'granted' : 'default');
                            setRequestError(null);
                        }
                    })
                    .catch(() => {
                        if (active) setRequestError('Could not check notification permission. Try again.');
                    });
            } else if (webSupported) {
                setPermission(Notification.permission);
                setRequestError(null);
            }
        };

        refresh();
        globalThis.addEventListener?.('focus', refresh);
        globalThis.document?.addEventListener?.('visibilitychange', refresh);
        chromePermissions?.onAdded?.addListener?.(refresh);
        chromePermissions?.onRemoved?.addListener?.(refresh);
        return () => {
            active = false;
            globalThis.removeEventListener?.('focus', refresh);
            globalThis.document?.removeEventListener?.('visibilitychange', refresh);
            chromePermissions?.onAdded?.removeListener?.(refresh);
            chromePermissions?.onRemoved?.removeListener?.(refresh);
        };
    }, [chromePermissions, extensionSupported, nativeNotify, nativeSupported, setPermission, webSupported]);

    const request = async () => {
        if (requestInFlight.current) return null;
        requestInFlight.current = true;
        setRequesting(true);
        setRequestError(null);
        try {
            if (nativeSupported && typeof nativeNotify.requestPermission === 'function') {
                const result = await nativeNotify.requestPermission();
                const next = nativeNotificationPermission(result?.state);
                setPermission(next);
                return next;
            }
            if (extensionSupported) {
                const granted = await chromePermissions.request({ permissions: ['notifications'] });
                const next = granted ? 'granted' : 'default';
                setPermission(next);
                return next;
            }
            const result = await Notification.requestPermission();
            setPermission(result);
            return result;
        } catch {
            setRequestError('Could not request notification permission. Check this app in your browser or system settings.');
            return null;
        } finally {
            requestInFlight.current = false;
            setRequesting(false);
        }
    };

    const revoke = async () => {
        if (requestInFlight.current || !extensionSupported) return false;
        requestInFlight.current = true;
        setRequesting(true);
        setRequestError(null);
        try {
            const removed = await chromePermissions.remove({ permissions: ['notifications'] });
            if (removed) setPermission('default');
            else setRequestError('Could not revoke notification permission. Try again.');
            return Boolean(removed);
        } catch {
            setRequestError('Could not revoke notification permission. Try again.');
            return false;
        } finally {
            requestInFlight.current = false;
            setRequesting(false);
        }
    };

    return {
        supported: nativeSupported || extensionSupported || webSupported,
        extensionSupported,
        permission,
        requestError,
        requesting,
        request,
        revoke,
    };
}

/**
 * Browser/OS notification-permission affordance. The extension requests and
 * removes its optional Chrome permission here, under a direct user gesture.
 */
function PermissionRow({ access }) {
    const { supported, extensionSupported, permission, requestError, requesting, request, revoke } = access;
    if (!supported) return null;

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
                <Button type="button" size="sm" icon={<Icon.LockIcon />} onClick={revoke} disabled={requesting} aria-busy={requesting}>
                    {requesting ? t('settings.notifications.revoking') : t('settings.notifications.revokePermission')}
                </Button>
            );
        }
    } else if (permission === 'denied') {
        hint = t('settings.notifications.blockedHint');
    } else if (permission !== 'checking') {
        action = (
            <Button type="button" size="sm" variant="success" icon={<Icon.BellIcon />} onClick={request} disabled={requesting} aria-busy={requesting}>
                {requesting ? t('settings.notifications.requesting') : (extensionSupported ? t('settings.notifications.allowNotifications') : t('settings.notifications.requestPermission'))}
            </Button>
        );
    }

    return (
        <div style={ROW}>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                <span style={{ color: 'var(--xc-text)', fontWeight: 500 }}>{t('settings.notifications.desktopNotifications')}</span>
                <span style={ROW_HINT}>{requestError || hint}</span>
            </div>
            {action}
        </div>
    );
}

export const NOTIFICATION_FLAGS = /** @type {const} */ ([
    {
        key: 'txConfirmations',
        get label() { return t('settings.notifications.transactionConfirmations'); },
        get hint() { return t('settings.notifications.notifyOnTheFirstConfirmation'); },
    },
    {
        key: 'incomingReceipts',
        get label() { return t('settings.notifications.incomingReceipts'); },
        get hint() { return t('settings.notifications.notifyWhenAWatchedAddress'); },
    },
    {
        key: 'incomingPending',
        get label() { return t('settings.notifications.incomingPendingPayments'); },
        get hint() { return t('settings.notifications.notifyAsSoonAsA'); },
        // Same v2-tolerant default as governancePolls: the watcher treats an
        // absent flag as ON, so a pre-flag settings record renders ON here too.
        defaultOn: true,
    },
    {
        key: 'messages',
        get label() { return t('settings.notifications.incomingMessages'); },
    },
    {
        key: 'governancePolls',
        get label() { return t('settings.notifications.governancePolls'); },
        get hint() { return t('settings.notifications.notifyWhenANewPoll'); },
        // The watcher treats an absent flag as ON (v2-tolerant default), so a
        // pre-flag settings record must render the toggle as ON too.
        defaultOn: true,
    },
    {
        key: 'deadlines',
        get label() { return t('settings.notifications.deadlines'); },
        get hint() { return t('settings.notifications.notifyBeforeOneOfYour'); },
        // Same v2-tolerant default as governancePolls: the watcher treats an
        // absent flag as ON, so a pre-flag settings record renders ON here too.
        defaultOn: true,
    },
    {
        key: 'dispenserEscrow',
        get label() { return t('settings.notifications.dispenserRunningLow'); },
        // v2-tolerant default, like the sibling watcher flags.
        defaultOn: true,
    },
    {
        key: 'dispenserFills',
        get label() { return t('settings.notifications.dispenserFills'); },
    },
    {
        key: 'orderFills',
        get label() { return t('settings.notifications.orderFills'); },
    },
    {
        key: 'priceAlerts',
        get label() { return t('settings.notifications.priceAlerts'); },
    },
]);

/**
 * @param {object} props
 * @param {'quiet' | 'sounds' | 'priceAlerts' | null} [props.only]
 */
// `only` renders one part on its own page (2026-11-13): 'quiet' (Quiet
// hours), 'sounds' (Notification sounds) or 'priceAlerts' (its switch only;
// the alert list is PriceAlertsSection); with no `only` the whole panel renders.
// The shell passes walletId and a picker callback it no longer needs here.
// `onOpenPage` opens a Settings page (a sound field's Choose Sound page).
export function NotificationsSection({ only = null, onOpenPage = null } = {}) {
    const { settings, loading, error, update } = useSettings({ reportsOwnError: true });
    const [permission, setPermission] = useState(initialNotificationPermission);
    const access = useNotificationPermissionAccess(permission, setPermission);
    const [pendingKey, setPendingKey] = useState(/** @type {string | null} */ (null));
    const [toggleError, setToggleError] = useState(/** @type {{ key: string, message: string } | null} */ (null));

    if (loading) return <Status text={t('common.loading')} />;
    if (error) return <SettingsLoadError error={error} />;
    if (!settings) return <Status text={t('common.settingsUnavailable')} tone="error" />;

    const permissionBlocksDelivery = permission !== 'unsupported' && permission !== 'granted';
    const notificationFlags = settings.notifications || {};

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

    const renderFlag = (f) => (
        <div key={f.key} style={STACK}>
            <div style={ROW}>
                <Switch
                    label={f.label}
                    help={f.hint}
                    checked={!permissionBlocksDelivery
                        && (f.defaultOn ? notificationFlags[f.key] !== false : Boolean(notificationFlags[f.key]))}
                    disabled={permissionBlocksDelivery || pendingKey !== null}
                    onChange={(event) => onToggle(f.key, f.label, event.target.checked)}
                />
            </div>
            <NotificationSaveError message={toggleError?.key === f.key ? toggleError.message : null} />
        </div>
    );

    if (only === 'quiet') return <QuietHoursRow settings={settings} update={update} />;
    if (only === 'sounds') return <SoundsBlock settings={settings} update={update} onOpenPage={onOpenPage} />;
    if (only === 'priceAlerts') {
        return <div style={STACK}>{NOTIFICATION_FLAGS.filter((f) => f.key === 'priceAlerts').map(renderFlag)}</div>;
    }

    // The Price alerts switch stays last; the alert list is its own page
    // (PriceAlertsSection), opened from the Notifications group page.
    return (
        <div style={STACK}>
            <PermissionRow access={access} />
            {NOTIFICATION_FLAGS.filter((f) => f.key !== 'priceAlerts').map(renderFlag)}
            <QuietHoursRow settings={settings} update={update} />
            <SoundsBlock settings={settings} update={update} onOpenPage={onOpenPage} />
            {NOTIFICATION_FLAGS.filter((f) => f.key === 'priceAlerts').map(renderFlag)}
        </div>
    );
}

function NotificationSaveError({ message }) {
    return message ? (
        <Status text={message} tone="error" />
    ) : null;
}

/** The Choose Sound page for one family: `notifications-sound:<family key>`. */
export const SOUND_PICKER_PAGE_PREFIX = 'notifications-sound:';
export const ADD_SOUND_PAGE_PREFIX = 'notifications-add-sound:';

/**
 * The Settings page a sound field opens, or null when `pageId` is not one.
 * Settings resolves ids it does not list itself here, like a coin's fee page.
 *
 * @param {string | null} pageId
 */
export function soundPickerSectionFor(pageId, navigation = {}) {
    if (typeof pageId !== 'string') return null;
    const picker = pageId.startsWith(SOUND_PICKER_PAGE_PREFIX);
    const add = pageId.startsWith(ADD_SOUND_PAGE_PREFIX);
    if (!picker && !add) return null;
    const familyKey = pageId.slice((picker ? SOUND_PICKER_PAGE_PREFIX : ADD_SOUND_PAGE_PREFIX).length);
    if (!SOUND_FAMILIES.some((f) => f.key === familyKey)) return null;
    if (add) {
        return {
            id: pageId,
            kind: 'internal-drill',
            title: 'Add Sound',
            flat: true,
            Component: AddSoundPage,
            props: {
                familyKey,
                variant: navigation.variant,
                onPickerScreenChange: navigation.onPickerScreenChange,
                ...(navigation.onReturnTo ? {
                    onAdded: () => navigation.onReturnTo(`${SOUND_PICKER_PAGE_PREFIX}${familyKey}`),
                } : {}),
            },
        };
    }
    return {
        id: pageId,
        kind: 'internal-drill',
        title: t('settings.notifications.chooseSound'),
        // One list card of sounds; the list draws its own card (G07).
        flat: true,
        Component: SoundPickerPage,
        props: { familyKey },
        trailing: navigation.onOpen ? (
            <Button
                variant="secondary"
                size="sm"
                icon={<Icon.PlusIcon />}
                aria-label={t('settings.notifications.addSound')}
                title={t('settings.notifications.addSound')}
                onClick={() => navigation.onOpen(`${ADD_SOUND_PAGE_PREFIX}${familyKey}`)}
            />
        ) : null,
    };
}

/** The sound rows the Choose Sound page lists: the palette, then No sound. */
export function soundChoices(customSounds = [], onDelete = null) {
    return [
        ...SOUND_PALETTE.map((sound) => {
            const SoundIcon = soundIconFor(sound);
            return {
                value: sound.id,
                title: sound.label,
                glyph: SoundIcon,
                leading: <RowIcon icon={SoundIcon} />,
            };
        }),
        ...customSounds.map((sound) => {
            const SoundIcon = soundIconFor(sound);
            return {
                value: sound.id,
                title: sound.name,
                glyph: SoundIcon,
                leading: <RowIcon icon={SoundIcon || Icon.MusicIcon} />,
                ...(onDelete ? {
                    onDelete: () => onDelete(sound),
                    deleteLabel: `Delete ${sound.name}`,
                } : {}),
            };
        }),
        {
            value: SOUND_NONE,
            title: t('settings.notifications.noSound'),
            glyph: soundIconFor(SOUND_NONE_OPTION),
            leading: <RowIcon icon={soundIconFor(SOUND_NONE_OPTION)} />,
        },
    ];
}

function soundIconFor(option) {
    const SoundIcon = option ? Icon[option.icon] : null;
    return typeof SoundIcon === 'function' ? SoundIcon : null;
}

function soundOptionForId(soundId, customSounds = []) {
    return soundId === SOUND_NONE
        ? SOUND_NONE_OPTION
        : SOUND_PALETTE.find((sound) => sound.id === soundId)
            || customSounds.find((sound) => sound.id === soundId)
            || null;
}

function useCustomSounds() {
    const [customSounds, setCustomSounds] = useState([]);
    const [customSoundsError, setCustomSoundsError] = useState(null);
    const refresh = async () => {
        try {
            setCustomSounds(await listCustomSounds());
            setCustomSoundsError(null);
        } catch (error) {
            setCustomSounds([]);
            setCustomSoundsError(userFacingMessage(error, 'Could not load custom sounds.'));
        }
    };
    useEffect(() => { void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return { customSounds, customSoundsError, refresh };
}

/**
 * Play a palette sound once as a preview when the active platform has the
 * same playback capability used by delivered notifications. The web host
 * listens for SOUND_PREVIEW_EVENT and plays through its notify adapter's
 * playSound, which swallows a refused autoplay or a missing file. No sound
 * plays nothing.
 *
 * @param {boolean} canPreview
 * @param {string} soundId
 */
function previewSound(canPreview, soundId) {
    if (soundId === SOUND_NONE) return;
    if (isCustomSoundId(soundId)) {
        void playCustomSound(soundId);
        return;
    }
    if (!canPreview) return;
    try {
        window.dispatchEvent(new CustomEvent(SOUND_PREVIEW_EVENT, { detail: { soundId } }));
    } catch {
        // No window (a non-DOM render): the user just hears nothing, which
        // is not worth an error surface.
    }
}

/**
 * Settings > Notifications > Notification Sounds > Choose Sound: one list
 * card of every sound plus No sound, the family's current sound ticked.
 * Tapping a row plays it once (the master switch does not gate a preview the
 * user asked for) and saves it as that family's sound at once; Back returns
 * to Notification Sounds, whose field then shows the pick.
 *
 * @param {object} props
 * @param {string} props.familyKey  a SOUND_FAMILIES key
 */
export function SoundPickerPage({ familyKey }) {
    const { settings, error, update } = useSettings({ reportsOwnError: true });
    const { messaging } = useMessaging();
    const { supportsNotificationSoundPlayback = false } = messaging || {};
    const canPreview = supportsNotificationSoundPlayback === true;
    // The tapped row is ticked at once; the saved settings take over after.
    const [chosen, setChosen] = useState(/** @type {string | null} */ (null));
    const [saveError, setSaveError] = useState(false);
    const { customSounds, customSoundsError, refresh } = useCustomSounds();
    if (error) return <SettingsLoadError error={error} />;
    if (!settings) return <Status text={t('common.loading')} />;
    const family = SOUND_FAMILIES.find((f) => f.key === familyKey);
    const current = chosen ?? pickedSoundForFamily(settings, familyKey);

    const onSelect = async (soundId) => {
        setSaveError(false);
        previewSound(canPreview, soundId);
        if (soundId === current) return;
        const before = chosen;
        setChosen(soundId);
        try {
            // One family's patch, never the whole map (the merge recurses).
            await update({ sounds: { perKind: { [familyKey]: soundId } } });
        } catch (err) {
            setChosen(before);
            setSaveError(true);
            // eslint-disable-next-line no-console
            console.error(`notifications.sounds.${familyKey} update failed:`, err);
        }
    };

    const onDelete = async (sound) => {
        setSaveError(false);
        try {
            await deleteCustomSound(sound.id);
            if (current === sound.id) {
                const fallback = family?.defaultSound || SOUND_NONE;
                setChosen(fallback);
                await update({ sounds: { perKind: { [familyKey]: fallback } } });
            }
            await refresh();
        } catch (err) {
            setSaveError(true);
            console.error(`notifications.sounds.${familyKey} delete failed:`, err); // eslint-disable-line no-console
        }
    };

    return (
        <div style={STACK} data-sound-picker={familyKey}>
            {saveError ? <Status text={t('settings.notifications.couldNotSaveThisNotification')} tone="error" /> : null}
            {customSoundsError ? <Status text={customSoundsError} tone="error" /> : null}
            <ChoiceList
                label={family ? t('settings.notifications.sound', { label: family.label }) : t('settings.notifications.chooseSound')}
                choices={soundChoices(customSounds, onDelete)}
                value={current}
                onSelect={onSelect}
            />
        </div>
    );
}

const CUSTOM_SOUND_FILE_HELP = 'Choose a WAV, MP3, OGG, M4A or AAC audio file, up to 30 seconds.';

export function AddSoundPage({
    onAdded = null,
    currentIcon = null,
    onPickerScreenChange = null,
    variant = 'full',
}) {
    const errors = useFormErrors();
    const [name, setName] = useState('');
    const [icon, setIcon] = useState(currentIcon || DEFAULT_CUSTOM_SOUND_ICON);
    const [fileName, setFileName] = useState('');
    const [audio, setAudio] = useState(null);
    const [fileError, setFileError] = useState(null);
    const [checking, setChecking] = useState(false);
    const [saving, setSaving] = useState(false);
    const [knownSounds, setKnownSounds] = useState([]);
    const [iconPickerOpen, setIconPickerOpen] = useState(false);

    useEffect(() => {
        listCustomSounds()
            .then(setKnownSounds)
            .catch(() => setKnownSounds([]));
    }, []);

    const pickFile = async (file) => {
        setFileName(file?.name || '');
        setAudio(null);
        setFileError(null);
        setChecking(true);
        try {
            setAudio(await validateCustomSoundFile(file));
        } catch (error) {
            setFileError(userFacingMessage(error, 'Could not read this audio file.'));
        } finally {
            setChecking(false);
        }
    };

    const clearFile = () => {
        setFileName('');
        setAudio(null);
        setFileError(null);
    };

    const onPreview = async () => {
        if (!audio) {
            setFileError((current) => current || 'Choose a valid sound file before previewing.');
            return;
        }
        const url = globalThis.URL?.createObjectURL?.(new Blob([audio.bytes], { type: audio.mimeType }));
        if (!url || typeof globalThis.Audio !== 'function') return;
        try {
            const player = new Audio(url);
            player.addEventListener?.('ended', () => URL.revokeObjectURL(url), { once: true });
            const playing = player.play();
            playing?.catch?.(() => URL.revokeObjectURL(url));
        } catch {
            URL.revokeObjectURL(url);
        }
    };

    const submit = async (event) => {
        event.preventDefault();
        const cleanName = name.trim();
        const duplicate = knownSounds.some((sound) => sound.name.toLowerCase() === cleanName.toLowerCase());
        const otherFieldsValid = errors.validate({
            soundName: !cleanName ? 'Enter a name.'
                : cleanName.length > 32 ? 'Name must be 32 characters or fewer.'
                    : duplicate ? 'A sound with this name already exists.' : null,
            soundIcon: icon ? null : 'Choose an icon.',
        });
        if (!audio) setFileError((current) => current || 'Choose a valid sound file.');
        if (!audio || !otherFieldsValid) return;
        setSaving(true);
        try {
            const saved = await saveCustomSound({ name: cleanName, icon, ...audio });
            onAdded?.(saved);
        } catch (error) {
            errors.fail(error?.code === 'duplicate-name'
                ? 'A sound with this name already exists.'
                : (error?.message || 'Could not save this sound.'), error?.code === 'duplicate-name' ? 'soundName' : 'form');
        } finally {
            setSaving(false);
        }
    };

    const closeIconPicker = () => {
        setIconPickerOpen(false);
        onPickerScreenChange?.(null);
    };
    const chooseIcon = (nextIcon) => {
        setIcon(nextIcon);
        closeIconPicker();
    };
    const usedIcons = [
        ...SOUND_PALETTE.map((sound) => sound.icon),
        ...knownSounds.map((sound) => sound.icon),
    ];
    const iconPickerScreen = (
        <Suspense fallback={<div role="status" aria-label={t('settings.notifications.loadingIcons')} />}>
            <LazyCustomSoundIconPickerScreen
                value={icon}
                usedIcons={usedIcons}
                currentIcon={currentIcon}
                onSelect={chooseIcon}
                onBack={closeIconPicker}
                variant={variant}
            />
        </Suspense>
    );

    useEffect(() => {
        if (iconPickerOpen && onPickerScreenChange) onPickerScreenChange(iconPickerScreen);
        // Refresh an externally hosted picker if the device's used-icon list
        // arrives after the field was tapped.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentIcon, icon, iconPickerOpen, knownSounds, onPickerScreenChange, variant]);

    // Settings hosts picker screens above the still-mounted form so an audio
    // file and name survive the trip. A standalone render returns the same
    // full-page picker directly.
    if (iconPickerOpen && !onPickerScreenChange) return iconPickerScreen;

    return (
        <FormPage
            label={t('settings.notifications.addSound')}
            onSubmit={submit}
            errors={errors}
            status={(
                <StatusMessage variant="info" title={t('settings.notifications.customSound')}>
                    {t('settings.notifications.customSoundDescription')}
                </StatusMessage>
            )}
            actions={(
                <>
                    <Button type="button" variant="secondary" icon={<Icon.PlayIcon />} onClick={onPreview} disabled={checking || saving}>{t('settings.notifications.playPreview')}</Button>
                    <Button type="submit" variant="success" icon={<Icon.SaveIcon />} loading={saving}>{t('settings.notifications.saveSound')}</Button>
                </>
            )}
        >
            <FileField
                id="soundFile"
                label={t('settings.notifications.soundFile')}
                help={t('settings.notifications.soundFileHelp')}
                hint={CUSTOM_SOUND_FILE_HELP}
                fileName={fileName}
                placeholder={t('settings.notifications.chooseAudioFile')}
                accept={CUSTOM_SOUND_ACCEPT}
                onFile={pickFile}
                onClear={clearFile}
                disabled={checking || saving}
                error={fileError}
            />
            <Input id="soundName" label={t('settings.notifications.soundName')} help={t('settings.notifications.soundNameHelp')} value={name} maxLength={32} onChange={(event) => setName(event.target.value)} disabled={saving} />
            <Suspense fallback={<div role="status" aria-label={t('settings.notifications.loadingIcons')} />}>
                <LazyCustomSoundIconField
                    value={icon}
                    onChange={setIcon}
                    usedIcons={usedIcons}
                    currentIcon={currentIcon}
                    disabled={saving}
                    onOpenPicker={() => {
                        setIconPickerOpen(true);
                        onPickerScreenChange?.(iconPickerScreen);
                    }}
                />
            </Suspense>
        </FormPage>
    );
}

/**
 * Event sounds (§6 M4.2). A master toggle, off by default, and one sound
 * field per notification family in three titled groups.
 *
 * Every field remains visible when the master is off, so changing the switch
 * never changes the page structure. A field is the standard picker field
 * (ListField) showing the family's sound; it opens that family's Choose Sound
 * page, where a tap previews and saves (SoundPickerPage).
 *
 * @param {object} props
 * @param {import('../../../schemas/settings.js').Settings} props.settings
 * @param {(patch: Record<string, unknown>) => Promise<unknown>} props.update
 * @param {((pageId: string) => void) | null} [props.onOpenPage]
 */
function SoundsBlock({ settings, update, onOpenPage = null }) {
    const enabled = settings.sounds?.enabled === true;
    const [saveError, setSaveError] = useState(/** @type {string | null} */ (null));
    const { customSounds } = useCustomSounds();

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
    const soundLabel = (soundId) => (soundId === SOUND_NONE
        ? t('settings.notifications.noSound')
        : SOUND_PALETTE.find((s) => s.id === soundId)?.label
            ?? customSounds.find((s) => s.id === soundId)?.name
            ?? (isCustomSoundId(soundId) ? 'Custom sound' : soundId));

    // The notice, the master switch, then the titled groups of sound fields,
    // with no divider lines (operator 2026-11-15).
    return (
        <div className={styles.form} data-sounds-form="">
            <StatusMessage variant="info">
                {t('settings.notifications.soundsNotice')}
            </StatusMessage>
            <div className={styles.field} data-sounds-field="master">
                <Switch
                    label={t('settings.notifications.playNotificationSounds')}
                    help={t('settings.notifications.playASoundWithEach')}
                    checked={enabled}
                    onChange={(event) => onToggle(event.target.checked)}
                />
            </div>
            <NotificationSaveError
                message={saveError === 'enabled' ? t('settings.notifications.couldNotSaveTheNotification') : null}
            />
            {/* The master switch changes state only: every group and event row
                is always on the page, never hidden or dimmed. */}
            <div className={styles.soundGroups} data-options-active={enabled ? 'true' : 'false'}>
                {SOUND_GROUPS.map((group) => (
                    <div key={group.id} className={styles.soundGroup} role="group" aria-labelledby={`sound-group-${group.id}`}>
                        <span id={`sound-group-${group.id}`} className={styles.groupLabel}>{t(group.labelKey)}</span>
                        {group.families.map((familyKey) => {
                            const family = SOUND_FAMILIES.find((f) => f.key === familyKey);
                            if (!family) return null;
                            const picked = pickedSoundForFamily(settings, family.key);
                            const SoundIcon = soundIconFor(soundOptionForId(picked, customSounds));
                            return (
                                <div key={family.key} data-sound-row={family.key}>
                                    <ListField
                                        id={`notification-sound-${family.key}`}
                                        label={t('settings.notifications.sound', { label: family.label })}
                                        help={t('settings.help.notifications.soundHelp', { label: family.label })}
                                        valueText={soundLabel(picked)}
                                        icon={SoundIcon ? <SoundIcon /> : null}
                                        placeholder={t('settings.notifications.noSound')}
                                        disabled={typeof onOpenPage !== 'function'}
                                        onOpenPicker={() => onOpenPage?.(`${SOUND_PICKER_PAGE_PREFIX}${family.key}`)}
                                    />
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>
        </div>
    );
}

// Layout 1's grouping on layout 2's master-switch page.
const SOUND_GROUPS = Object.freeze([
    { id: 'payments', labelKey: 'alerts.type.payments', families: ['txConfirmations', 'incomingReceipts', 'incomingPending'] },
    { id: 'messages', labelKey: 'settings.notifications.soundGroupMessages', families: ['messages', 'governancePolls', 'deadlines'] },
    { id: 'trading', labelKey: 'settings.notifications.soundGroupTrading', families: ['dispenserEscrow', 'dispenserFills', 'orderFills', 'priceAlerts'] },
]);

/**
 * Do-not-disturb window. When on, every notification kind
 * (including price alerts) is suppressed while the local clock is inside
 * [start, end); an end before start wraps past midnight (e.g. 22:00-08:00).
 * Delivery is dropped, not queued: nothing catches up once the window ends.
 */
function QuietHoursRow({ settings, update }) {
    const qh = settings.quietHours || QUIET_HOURS_DEFAULT;
    const [saveError, setSaveError] = useState(/** @type {string | null} */ (null));
    const [drag, setDrag] = useState(/** @type {{ field: string, minutes: number } | null} */ (null));
    const dragRef = useRef(/** @type {{ field: string, minutes: number } | null} */ (null));
    const trackRef = useRef(/** @type {HTMLDivElement | null} */ (null));

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

    const enabled = qh.enabled === true;
    const use24 = uses24HourClock(settings);
    const storedStart = parseClock(qh.start) ?? parseClock(QUIET_HOURS_DEFAULT.start);
    const storedEnd = parseClock(qh.end) ?? parseClock(QUIET_HOURS_DEFAULT.end);
    // While a handle is dragged the bar and the rows show the live value; the
    // change is saved once, when the handle is let go.
    const startMin = drag?.field === 'start' ? drag.minutes : storedStart;
    const endMin = drag?.field === 'end' ? drag.minutes : storedEnd;
    const startLabel = formatClock(startMin, use24);
    const endLabel = formatClock(endMin, use24);

    const minutesFromPointer = (clientX) => {
        const rect = trackRef.current?.getBoundingClientRect?.();
        if (!rect || !(rect.width > 0) || !Number.isFinite(clientX)) return null;
        const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
        return snapMinutes(ratio * MINUTES_PER_DAY);
    };
    const beginDrag = (field) => (event) => {
        try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* capture is a nicety */ }
        const minutes = field === 'start' ? storedStart : storedEnd;
        dragRef.current = { field, minutes };
        setDrag({ field, minutes });
    };
    const moveDrag = (event) => {
        const current = dragRef.current;
        if (!current) return;
        const minutes = minutesFromPointer(event.clientX);
        if (minutes === null || minutes === current.minutes) return;
        dragRef.current = { field: current.field, minutes };
        setDrag(dragRef.current);
    };
    const endDrag = (event) => {
        const current = dragRef.current;
        dragRef.current = null;
        setDrag(null);
        if (!current || event.type === 'pointercancel') return;
        const stored = current.field === 'start' ? storedStart : storedEnd;
        if (current.minutes !== stored) onTimeChange(current.field, toClock(current.minutes));
    };
    const onHandleKeyDown = (field) => (event) => {
        const stored = field === 'start' ? storedStart : storedEnd;
        let delta = 0;
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') delta = STEP_MINUTES;
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') delta = -STEP_MINUTES;
        else if (event.key === 'PageUp') delta = 60;
        else if (event.key === 'PageDown') delta = -60;
        else return;
        event.preventDefault();
        onTimeChange(field, toClock(snapMinutes(stored + delta)));
    };

    const segments = quietSegments(startMin, endMin);
    const fillClass = `${styles.fill} ${enabled ? styles.fillOn : styles.fillOff}`;
    const axis = [0, 6, 12, 18, 24];
    // A thumb is the Network fee slider's dot inside a tap-size hit box.
    const handle = (field, minutes, label) => (
        <div
            role="slider"
            tabIndex={0}
            aria-label={label}
            aria-orientation="horizontal"
            aria-valuemin={0}
            aria-valuemax={MINUTES_PER_DAY - STEP_MINUTES}
            aria-valuenow={minutes}
            aria-valuetext={formatClock(minutes, use24)}
            data-handle={field}
            className={styles.handle}
            style={{ left: `${(minutes / MINUTES_PER_DAY) * 100}%` }}
            onKeyDown={onHandleKeyDown(field)}
            onPointerDown={beginDrag(field)}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
        >
            <span className={styles.dot} data-quiet-dot="" aria-hidden="true" />
        </div>
    );

    // The notice, then the fields at the form gap: no divider lines between
    // Pause notifications, the slider, Starts and Ends (operator 2026-11-15).
    return (
        <div className={styles.form} data-options-active={enabled ? 'true' : 'false'}>
            <StatusMessage variant="info">
                {t('settings.notifications.quietNotice')}
            </StatusMessage>
            <div className={styles.field} data-quiet-row="switch">
                <Switch
                    label={t('settings.notifications.pauseNotifications')}
                    help={t('settings.notifications.pauseAllNotificationsIncludingPrice')}
                    checked={enabled}
                    onChange={(event) => onToggle(event.target.checked)}
                />
                <span style={ROW_HINT} role="status" data-quiet-status>
                    {enabled
                        ? t('settings.notifications.quietStatusOn', { start: startLabel, end: endLabel })
                        : t('settings.notifications.quietStatusOff')}
                </span>
            </div>
            <NotificationSaveError
                message={saveError === 'enabled' ? t('settings.notifications.couldNotSaveQuietHours') : null}
            />
            <>
                <div className={styles.field} data-quiet-row="bar">
                    <div
                        className={styles.track}
                        ref={trackRef}
                        role="group"
                        aria-label={t('settings.notifications.quietBarLabel')}
                        data-quiet-bar={enabled ? 'on' : 'off'}
                    >
                        <div className={styles.line} data-quiet-line="">
                            {segments.map((s) => (
                                <div
                                    key={`${s.from}-${s.to}`}
                                    data-quiet-segment={enabled ? 'on' : 'off'}
                                    className={fillClass}
                                    style={{
                                        left: `${(s.from / MINUTES_PER_DAY) * 100}%`,
                                        width: `${((s.to - s.from) / MINUTES_PER_DAY) * 100}%`,
                                    }}
                                />
                            ))}
                        </div>
                        {handle('start', startMin, t('settings.notifications.quietStartHandle'))}
                        {handle('end', endMin, t('settings.notifications.quietEndHandle'))}
                    </div>
                    <div className={styles.axis} aria-hidden="true">
                        {axis.map((hour, i) => (
                            <span key={`${hour}-${i}`}>{formatHourLabel(hour, use24)}</span>
                        ))}
                    </div>
                </div>
                <div className={styles.field} data-quiet-row="start">
                    <Input
                        id="quiet-hours-start"
                        label={t('settings.notifications.quietStarts')}
                        type="time"
                        step={STEP_MINUTES * 60}
                        help={t('settings.help.notifications.quietStart')}
                        value={toClock(startMin)}
                        onChange={(e) => onTimeChange('start', e.target.value)}
                    />
                </div>
                <div className={styles.field} data-quiet-row="end">
                    <Input
                        id="quiet-hours-end"
                        label={t('settings.notifications.quietEnds')}
                        type="time"
                        step={STEP_MINUTES * 60}
                        help={t('settings.help.notifications.quietEnd')}
                        value={toClock(endMin)}
                        onChange={(e) => onTimeChange('end', e.target.value)}
                    />
                </div>
            </>
            <NotificationSaveError
                message={saveError === 'start' || saveError === 'end' ? t('settings.notifications.couldNotSaveQuietHours') : null}
            />
        </div>
    );
}

// The price-alert list, the Price Alert page and the Add and Edit pages live in
// PriceAlertsSection.jsx (2026-11-14); this panel keeps only the master switch.
