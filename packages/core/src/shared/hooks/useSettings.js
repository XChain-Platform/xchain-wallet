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
import { defaultRegistry, hydrateCustomChainsFromSettings } from '../../registry/index.js';

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

/**
 * @returns {{
 *   settings: import('../../schemas/settings.js').Settings | null,
 *   loading: boolean,
 *   error: Error | null,
 *   refresh: () => Promise<void>,
 *   update: (patch: Record<string, unknown>) => Promise<import('../../schemas/settings.js').Settings>,
 * }}
 */
export function useSettings() {
    const { messaging } = useMessaging();
    const [settings, setSettings] = useState(/** @type {any} */ (null));
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(/** @type {Error | null} */ (null));
    const aliveRef = useRef(true);

    const refresh = useCallback(async () => {
        if (typeof messaging?.getSettings !== 'function') {
            if (!aliveRef.current) return;
            setError(new Error('messaging.getSettings is not available in this shell'));
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const next = await messaging.getSettings();
            // The record carries the user-added chains, and this realm's
            // registry may not know them yet: the host seeds only the
            // instance it holds, and the popup, approval and desktop
            // renderer realms each own a separate defaultRegistry(). A
            // successful read is also the first moment the encrypted record
            // is readable after unlock, so hydrating here reaches every shell
            // without a per-entry boot hook (§9.7 Developer Mode).
            try { hydrateCustomChainsFromSettings(defaultRegistry(), next); } catch { /* never fail a read */ }
            if (!aliveRef.current) return;
            setSettings(next);
            setError(null);
        } catch (err) {
            if (!aliveRef.current) return;
            setError(err instanceof Error ? err : new Error(String(err)));
        } finally {
            if (aliveRef.current) setLoading(false);
        }
    }, [messaging]);

    const update = useCallback(async (patch) => {
        if (typeof messaging?.updateSettings !== 'function') {
            throw new Error('messaging.updateSettings is not available in this shell');
        }
        const next = await messaging.updateSettings(patch);
        if (aliveRef.current) setSettings(next);
        if (typeof window !== 'undefined') {
            try {
                window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT, { detail: next }));
            } catch { /* CustomEvent unsupported: non-fatal */ }
        }
        return next;
    }, [messaging]);

    useEffect(() => {
        aliveRef.current = true;
        refresh();
        let onChanged;
        let onSession;
        if (typeof window !== 'undefined') {
            onChanged = (e) => {
                const next = e?.detail;
                if (next && aliveRef.current) setSettings(next);
            };
            window.addEventListener(SETTINGS_CHANGED_EVENT, onChanged);
            // Re-read on unlock: the locked-state read failed, so pull the
            // now-decryptable record without waiting for a settings write.
            onSession = () => { if (aliveRef.current) refresh(); };
            window.addEventListener(SESSION_CHANGED_EVENT, onSession);
        }
        return () => {
            aliveRef.current = false;
            if (onChanged) window.removeEventListener(SETTINGS_CHANGED_EVENT, onChanged);
            if (onSession) window.removeEventListener(SESSION_CHANGED_EVENT, onSession);
        };
    }, [refresh]);

    return { settings, loading, error, refresh, update };
}
