// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// useSettings. §35 read + patch hook for the Settings record. Loads
// once on mount via `messaging.getSettings()`, exposes `update(patch)`
// for deep-merge writes, and `refresh()` for an explicit re-read.
//
// Shells that don't expose `getSettings` / `updateSettings` (older
// builds, future shells under construction) report an error string in
// the returned state rather than throwing; this keeps the consuming
// settings page renderable in a degraded mode.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMessaging } from '../useMessaging.js';
import { useToast } from '../components/ToastHost.jsx';
import { isVaultConflictError, userFacingMessage } from '../utils/userFacingMessage.js';
import { t } from '../../i18n/index.js';
import { defaultRegistry, hydrateCustomChainsFromSettings } from '../../registry/index.js';
import { normalizeDisplayCurrency } from '../utils/displayCurrency.js';

// Each useSettings() instance loads its own snapshot, so a write made by
// one component (e.g. the Settings panel) would leave another component's
// snapshot (e.g. a header badge gated on that flag) stale until it
// remounts. update() broadcasts the new record on this window event and
// every instance listens, so the whole UI reflects a settings change
// immediately, no reload needed.
const SETTINGS_CHANGED_EVENT = 'xc:settings-changed';

// Settings live in the encrypted vault, so they are unreadable while
// the wallet is locked: the first read on a fresh page load (locked)
// fails and leaves `settings` null. Instances mounted above the unlock
// boundary (e.g. the web dev-variant badge gated on `showVariantBadge`)
// never remount on unlock, so they would stay stale for the whole
// session. The shell dispatches this event when the session unlocks;
// every instance listens and re-reads so gated UI reappears post-unlock.
const SESSION_CHANGED_EVENT = 'xc:session-changed';

// The host applies writes in the order they are issued but can answer them
// out of order (the desktop host answers a privacy write only after its
// routing hook runs). Each answer carries the whole record as of that
// write, so a late answer to an earlier write would roll back a newer one
// in every instance through the broadcast. The ticket is shared across
// instances because the newer write can come from a different section.
let latestWriteTicket = 0;

/**
 * @returns {{
 *   settings: import('../../schemas/settings.js').Settings | null,
 *   loading: boolean,
 *   error: Error | null,
 *   unsupportedFiatCurrency: string | null,
 *   refresh: () => Promise<void>,
 *   update: (patch: Record<string, unknown>) => Promise<import('../../schemas/settings.js').Settings>,
 * }}
 */
export function useSettings({ reportsOwnError = false } = {}) {
    const { messaging } = useMessaging();
    const { showToast } = useToast();
    const [settings, setSettings] = useState(/** @type {any} */ (null));
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(/** @type {Error | null} */ (null));
    const [unsupportedFiatCurrency, setUnsupportedFiatCurrency] = useState(/** @type {string | null} */ (null));
    const aliveRef = useRef(true);
    const requestRef = useRef(0);

    const refresh = useCallback(async () => {
        if (!aliveRef.current) return;
        const request = requestRef.current + 1;
        requestRef.current = request;
        const isCurrent = () => aliveRef.current && requestRef.current === request;
        if (typeof messaging?.getSettings !== 'function') {
            setError(new Error('useSettings: messaging.getSettings is not available in this shell'));
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const next = await messaging.getSettings();
            if (!isCurrent()) return;
            // The record carries the user-added chains, and this realm's
            // registry may not know them yet: the host seeds only the
            // instance it holds, and the popup, approval and desktop
            // renderer realms each own a separate defaultRegistry(). A
            // successful read is also the first moment the encrypted record
            // is readable after unlock, so hydrating here reaches every shell
            // without a per-entry boot hook (§9.7 Developer Mode).
            try { hydrateCustomChainsFromSettings(defaultRegistry(), next); } catch { /* never fail a read */ }
            const effective = normalizeDisplayCurrency(next);
            setSettings(effective.settings);
            setUnsupportedFiatCurrency(effective.unsupportedFiatCurrency);
            setError(null);
        } catch (err) {
            if (!isCurrent()) return;
            setError(err instanceof Error ? err : new Error(String(err)));
        } finally {
            if (isCurrent()) setLoading(false);
        }
    }, [messaging]);

    // A refused write (a full disk, a storage backend that went away) would
    // otherwise leave the control snapping back with no word. A section that
    // shows its own message mounts the hook with `reportsOwnError`, so the user
    // sees one.
    const update = useCallback(async (patch) => {
        if (typeof messaging?.updateSettings !== 'function') {
            throw new Error('messaging.updateSettings is not available in this shell');
        }
        latestWriteTicket += 1;
        const ticket = latestWriteTicket;
        let next;
        try {
            next = await messaging.updateSettings(patch);
        } catch (err) {
            const message = userFacingMessage(err, t('settings.saveFailed'));
            const conflict = isVaultConflictError(err);
            if (!reportsOwnError || conflict) {
                showToast({
                    id: 'settings-save-failed',
                    variant: 'error',
                    message,
                });
            }
            if (conflict) {
                throw Object.assign(new Error(message), err, { name: 'VaultConflictError' });
            }
            throw err;
        }
        const effective = normalizeDisplayCurrency(next);
        // A newer write is in flight or answered: its record supersedes this
        // one, so only the caller hears this answer.
        if (ticket !== latestWriteTicket) return effective.settings;
        if (aliveRef.current) {
            requestRef.current += 1;
            setSettings(effective.settings);
            setUnsupportedFiatCurrency(effective.unsupportedFiatCurrency);
            setError(null);
            setLoading(false);
        }
        if (typeof window !== 'undefined') {
            try {
                window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT, { detail: next }));
            } catch { /* CustomEvent unsupported: non-fatal */ }
        }
        return effective.settings;
    }, [messaging, showToast, reportsOwnError]);

    useEffect(() => {
        aliveRef.current = true;
        refresh();
        let onChanged;
        let onSession;
        if (typeof window !== 'undefined') {
            onChanged = (e) => {
                const next = e?.detail;
                if (next && aliveRef.current) {
                    const effective = normalizeDisplayCurrency(next);
                    requestRef.current += 1;
                    setSettings(effective.settings);
                    setUnsupportedFiatCurrency(effective.unsupportedFiatCurrency);
                    setError(null);
                    setLoading(false);
                }
            };
            window.addEventListener(SETTINGS_CHANGED_EVENT, onChanged);
            // Re-read on unlock: the locked-state read failed, so pull the
            // now-decryptable record without waiting for a settings write.
            onSession = () => { if (aliveRef.current) refresh(); };
            window.addEventListener(SESSION_CHANGED_EVENT, onSession);
        }
        return () => {
            aliveRef.current = false;
            requestRef.current += 1;
            if (onChanged) window.removeEventListener(SETTINGS_CHANGED_EVENT, onChanged);
            if (onSession) window.removeEventListener(SESSION_CHANGED_EVENT, onSession);
        };
    }, [refresh]);

    return { settings, loading, error, unsupportedFiatCurrency, refresh, update };
}
