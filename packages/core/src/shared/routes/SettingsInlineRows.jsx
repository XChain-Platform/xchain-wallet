// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Settings group-page rows that change in place but hold state of their
// own (2026-11-13 redesign): Biometric unlock's switch (operator ruling
// 2026-11-14: turning it on opens the Enable Biometric Unlock page), and the
// contacts file import (a chevron row that opens the file picker). Each draws
// itself with the shared inline row frame or list row and runs the same flows
// as the page it replaced. Panic mode is a chevron row to its own page
// (SecurityPages.jsx).

import { useEffect, useRef, useState } from 'react';
import { ListRow } from '@xchain-wallet/core/ui';
import { InlineSwitchFrame } from '../components/settings/SettingsInlineRow.jsx';
import { clearBiometricEnrolNotice, peekBiometricEnrolNotice } from '../components/settings/SecurityPages.jsx';
import {
    CONTACT_IMPORT_ACCEPT,
    ContactsTransferMessages,
    useContactsTransfer,
} from '../components/settings/ContactsSection.jsx';
import { StatusMessage } from '@xchain-wallet/core/ui';
import { AssetMark } from '../../ui/AssetMark.jsx';
import groupListStyles from './CoSignerAccountList.module.css';
import { SettingsLoadError } from '../components/settings/SettingsInlineRow.jsx';
import { useSettings } from '../hooks/useSettings.js';
import {
    NOTIFICATION_FLAGS,
    initialNotificationPermission,
    useNotificationPermissionAccess,
} from '../components/settings/NotificationsSection.jsx';
import { ConfirmModal } from '../components/ConfirmModal.jsx';
import { useConfirmModal } from '../hooks/useConfirmModal.js';
import { useMessaging } from '../useMessaging.js';
import {
    activeNetworkOptions,
    activeNetworkSwitchCopy,
    normalizeActiveNetwork,
    persistActiveNetwork,
} from '../utils/activeNetworkSwitch.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import inlineStyles from '../components/settings/SettingsInlineRow.module.css';
import {
    clearBiometricCredential,
    describeBiometric,
    isBiometricRegistered,
} from '../../flows/biometricUnlock.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/settings.js';
import '../../i18n/locales/en/ui.js';

// A row's own entry (title, short line, help) comes from Settings.jsx; a
// row drawn without one, as the route render sweeps do, still renders.
const EMPTY_ROW = Object.freeze({ id: '', title: '', line: '' });

const readRegistered = () => { try { return isBiometricRegistered(); } catch { return false; } };

/**
 * Biometric unlock as a plain switch that never changes the page's look
 * (operator ruling 2026-11-14). Turning it on opens the Enable Biometric
 * Unlock page (`row.onEnrol`), which returns here with the switch on after a
 * successful enrolment and off after Back or a failure. Turning it off asks
 * for nothing: the stored credential is removed from the device, so turning
 * it on again asks for the password once more.
 */
export function BiometricInlineRow({ row = EMPTY_ROW, leading }) {
    const [description, setDescription] = useState(
        /** @type {null | Awaited<ReturnType<typeof describeBiometric>>} */ (null),
    );
    const [registered, setRegistered] = useState(readRegistered);
    const [busy, setBusy] = useState(false);
    // A failed enrolment on the Enable page comes back with its reason.
    const [error, setError] = useState(/** @type {string | null} */ (peekBiometricEnrolNotice));
    useEffect(() => { clearBiometricEnrolNotice(); }, []);

    // Probed on mount and whenever the app comes back into view, as the
    // Biometric unlock page did: device enrolment changes outside the wallet.
    useEffect(() => {
        let cancelled = false;
        let generation = 0;
        const probe = () => {
            const mine = ++generation;
            describeBiometric().then((described) => {
                if (cancelled || mine !== generation) return;
                setDescription(described);
                setRegistered(readRegistered());
            }).catch(() => {
                if (!cancelled && mine === generation) {
                    setDescription({ supported: false, reason: 'Could not check biometric unlock on this device.', mechanism: 'device unlock', wrapNote: '' });
                }
            });
        };
        const onVisible = () => { if (globalThis.document?.visibilityState !== 'hidden') probe(); };
        probe();
        globalThis.addEventListener?.('focus', probe);
        globalThis.document?.addEventListener?.('visibilitychange', onVisible);
        return () => {
            cancelled = true;
            globalThis.removeEventListener?.('focus', probe);
            globalThis.document?.removeEventListener?.('visibilitychange', onVisible);
        };
    }, []);

    const turnOff = async () => {
        setBusy(true);
        setError(null);
        try {
            await clearBiometricCredential();
            if (readRegistered()) throw new Error(t('settings.security.biometricTurnOffFailed'));
            setRegistered(false);
        } catch (err) {
            setError(userFacingMessage(err, t('settings.security.biometricTurnOffFailed')));
        } finally {
            setBusy(false);
        }
    };

    const supported = description?.supported === true;
    let line = row.line;
    let help = row.help;
    if (description === null) line = t('settings.biometric.checkingThisDevice');
    else if (!supported) {
        line = 'Not available on this device';
        help = `${row.help || ''} ${description.reason || ''}`.trim();
    }
    return (
        <>
            <InlineSwitchFrame
                leading={leading}
                title={row.title}
                help={help}
                line={line}
                checked={registered}
                disabled={!supported || busy}
                onChange={(next) => {
                    setError(null);
                    // The switch stays off until the Enable page succeeds.
                    if (next) row.onEnrol?.();
                    else turnOff();
                }}
                after={error ? <StatusMessage variant="error">{error}</StatusMessage> : null}
            />
        </>
    );
}

/**
 * Import contacts: the whole row is a tappable row with the right chevron
 * (2026-11-14, no button inside a row); a tap opens the file picker (JSON or
 * CSV) and the import runs here, behind the replace confirmation.
 */
export function ContactsImportInlineRow({ row = EMPTY_ROW, leading }) {
    const transfer = useContactsTransfer({ readCount: false });
    const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const hasMessage = Boolean(transfer.importResult || transfer.error || transfer.confirmDialog.request);
    return (
        <>
            <input
                ref={inputRef}
                type="file"
                accept={CONTACT_IMPORT_ACCEPT.join(',')}
                hidden
                aria-label={t('settings.inline.contactsFileToImport')}
                onChange={async (event) => {
                    const file = event.target.files?.[0];
                    // The same file can be picked again after a refused import.
                    event.target.value = '';
                    if (!file) return;
                    await transfer.onImportFile(file);
                }}
            />
            <ListRow
                type="button"
                leading={leading}
                title={row.title}
                subtitle={row.line}
                chevron
                onClick={() => inputRef.current?.click()}
            />
            {hasMessage ? (
                <div className={inlineStyles.error}>
                    <ContactsTransferMessages {...transfer} />
                </div>
            ) : null}
        </>
    );
}

// The notification permission, shared by the Desktop notifications row and
// the event switches below it, which stay greyed until it is allowed. The
// permission row owns the live reads; the store resets when it unmounts.
const permissionStore = { value: /** @type {string | null} */ (null), listeners: new Set() };

function publishPermission(next) {
    permissionStore.value = next;
    for (const listener of permissionStore.listeners) listener(next);
}

function useSharedPermission() {
    const [permission, setPermission] = useState(() => permissionStore.value ?? initialNotificationPermission());
    useEffect(() => {
        permissionStore.listeners.add(setPermission);
        if (permissionStore.value !== null) setPermission(permissionStore.value);
        return () => { permissionStore.listeners.delete(setPermission); };
    }, []);
    return permission;
}

/** Whether this shell can show notifications at all; the row is left out where it cannot. */
export function notificationPermissionAvailable() {
    return initialNotificationPermission() !== 'unsupported';
}

/**
 * Desktop notifications: one switch row, off by default. Turning it on asks
 * the browser or OS for permission when it is not already granted; granted
 * keeps it on, denied or dismissed flips it back off. Turning it off saves
 * `notifications.desktop = false` (and drops the optional permission in the
 * extension). The row reads on only while permission is granted and the
 * saved choice is not off.
 */
export function NotificationsPermissionInlineRow({ row = EMPTY_ROW, leading, settings, update = async () => {} }) {
    const permission = useSharedPermission();
    const access = useNotificationPermissionAccess(permission, publishPermission);
    const [saveError, setSaveError] = useState(/** @type {string | null} */ (null));
    useEffect(() => () => { permissionStore.value = null; }, []);

    const saved = settings?.notifications?.desktop;
    const on = permission === 'granted' && saved !== false;
    const save = async (next) => {
        try {
            await update({ notifications: { desktop: next } });
        } catch (err) {
            setSaveError('Could not save this setting. Try again.');
            // eslint-disable-next-line no-console
            console.error('notifications.desktop update failed:', err);
        }
    };
    const onChange = async (next) => {
        setSaveError(null);
        if (!next) {
            if (access.extensionSupported) await access.revoke();
            await save(false);
            return;
        }
        if (permission !== 'granted') {
            const result = await access.request();
            if (result !== 'granted') return;
        }
        await save(true);
    };

    const line = permission === 'denied'
        ? t('settings.notifications.blockedHint')
        : t('settings.notifications.desktopLine');
    const error = access.requestError || saveError;
    return (
        <InlineSwitchFrame
            leading={leading}
            title={row.title}
            help={row.help}
            line={line}
            checked={on}
            disabled={!settings || permission === 'checking' || access.requesting}
            onChange={onChange}
            after={error ? <StatusMessage variant="error">{error}</StatusMessage> : null}
        />
    );
}

/** One wallet event's notification switch, greyed until notifications are allowed. */
export function NotificationEventInlineRow({ row = EMPTY_ROW, leading, settings, update = async () => {} }) {
    const permission = useSharedPermission();
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const flag = NOTIFICATION_FLAGS.find((f) => f.key === row.flagKey);
    const blocked = permission !== 'unsupported' && permission !== 'granted';
    const stored = settings?.notifications?.[row.flagKey];
    const on = flag?.defaultOn ? stored !== false : Boolean(stored);
    return (
        <InlineSwitchFrame
            leading={leading}
            title={row.title}
            help={row.help || flag?.hint}
            line={row.line}
            checked={Boolean(settings) && !blocked && on}
            disabled={!settings || blocked}
            onChange={async (next) => {
                setError(null);
                try {
                    await update({ notifications: { [row.flagKey]: next } });
                } catch (err) {
                    setError(`Could not update ${row.title.toLowerCase()}. Try again.`);
                    // eslint-disable-next-line no-console
                    console.error(`notifications.${row.flagKey} update failed:`, err);
                }
            }}
            after={error ? <StatusMessage variant="error">{error}</StatusMessage> : null}
        />
    );
}

// The line under each environment's name on the Network page.
const networkEnvironmentLine = (network) => ({
    mainnet: t('settings.network.environment.mainnet'),
    testnet: t('settings.network.environment.testnet'),
    regtest: t('settings.network.environment.regtest'),
})[network] || '';

// The Settings landing's list card: rows reach the card edges, dividers run
// edge to edge and the chevron sits at the landing's inset (operator walk
// 2026-11-15). Set inline because the Settings surface is a card and the
// shared nested-card rule would strip a class border.
const LIST_SURFACE = { border: '1px solid var(--xc-border)', borderRadius: 'var(--xc-radius-md)', background: 'var(--xc-surface)', overflow: 'hidden' };

/**
 * Mainnet, Testnet and Regtest as standard Settings list rows: the network
 * mark, the name, its line and the chevron, the current one marked. The
 * arrows, Home and End move between rows as on the network picker.
 */
function NetworkEnvironmentList({ value, options, onSelect }) {
    const onKeyDown = (event) => {
        const rows = Array.from(event.currentTarget.querySelectorAll('button[data-network-option]'));
        const index = rows.indexOf(document.activeElement);
        let next = null;
        if (event.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % rows.length;
        if (event.key === 'ArrowUp') next = index < 0 ? rows.length - 1 : (index - 1 + rows.length) % rows.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = rows.length - 1;
        if (next === null || rows.length === 0) return;
        event.preventDefault();
        rows[next]?.focus();
    };
    return (
        /* Safari needs an explicit list role because this class removes list styling. */
        <ul
            className={groupListStyles.list}
            role="list"
            aria-label={t('settings.network.label')}
            data-network-environment-list=""
            style={LIST_SURFACE}
            onKeyDown={onKeyDown}
        >
            {options.map((o) => (
                <li key={o.value}>
                    <ListRow
                        type="button"
                        onClick={() => onSelect(o.value)}
                        aria-current={o.value === value ? 'true' : undefined}
                        aria-label={t('ui.networkPicker.selectNetwork', { network: o.actionName })}
                        data-network-option=""
                        leading={<AssetMark chainId={o.value} tick={o.title} isNative />}
                        title={o.title}
                        subtitle={o.description ? <span data-network-description="">{o.description}</span> : null}
                        chevron
                    />
                </li>
            ))}
        </ul>
    );
}

/**
 * The Network page (operator ruling 2026-11-14): the wallet-wide environment
 * (Mainnet, Testnet, Regtest) as the shared network rows, the current one
 * marked. A pick still asks to confirm the switch, then switches as the
 * dropdown did and returns to Network and Fees (`onDone`).
 *
 * @param {object} props
 * @param {{ id?: string } | null} [props.activeWallet]
 * @param {(network: string) => Promise<unknown> | unknown} [props.onActiveNetworkChange]
 * @param {() => void} [props.reload]
 * @param {() => void} [props.onDone]  closes this page once a switch has run
 */
export function NetworkEnvironmentPage({ activeWallet, onActiveNetworkChange, reload, onDone }) {
    const { messaging } = useMessaging();
    const { settings, error, update } = useSettings({ reportsOwnError: true });
    const confirmDialog = useConfirmModal();
    const [switching, setSwitching] = useState(false);
    const [switchError, setSwitchError] = useState(/** @type {string | null} */ (null));
    const current = normalizeActiveNetwork(settings?.activeNetwork);
    const options = settings
        ? activeNetworkOptions({ developerMode: Boolean(settings.developerMode), current }).map((o) => ({
            value: o.value,
            title: o.label,
            ticker: o.label,
            actionName: o.label,
            description: networkEnvironmentLine(o.value),
        }))
        : [];

    const onChange = async (next) => {
        if (switching || confirmDialog.request) return;
        if (next === current) {
            onDone?.();
            return;
        }
        const copy = activeNetworkSwitchCopy(current, next);
        const confirmed = await confirmDialog.confirm({
            title: copy.title,
            message: copy.message,
            confirmLabel: t('settings.network.switchConfirm'),
        });
        if (!confirmed) return;
        setSwitchError(null);
        setSwitching(true);
        try {
            if (typeof onActiveNetworkChange === 'function') {
                await onActiveNetworkChange(next);
            } else {
                await persistActiveNetwork({ messaging, update, walletId: activeWallet?.id, network: next });
                reload?.();
            }
            onDone?.();
        } catch (err) {
            setSwitchError(userFacingMessage(err, t('settings.network.switchError')));
        } finally {
            setSwitching(false);
        }
    };

    if (error) return <SettingsLoadError error={error} />;
    if (!settings) return <StatusMessage variant="info">{t('common.loading')}</StatusMessage>;

    return (
        <>
            <NetworkEnvironmentList value={current} options={options} onSelect={onChange} />
            {switching ? <StatusMessage variant="info">{t('settings.network.switching')}</StatusMessage> : null}
            {switchError ? <StatusMessage variant="error">{switchError}</StatusMessage> : null}
            {confirmDialog.request ? (
                <ConfirmModal
                    {...confirmDialog.request}
                    onConfirm={confirmDialog.onConfirm}
                    onCancel={confirmDialog.onCancel}
                />
            ) : null}
        </>
    );
}
