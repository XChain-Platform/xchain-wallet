// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// useSettings — §35 read + patch hook for the Settings record. Loads
// once on mount via `messaging.getSettings()`, exposes `update(patch)`
// for deep-merge writes, and `refresh()` for an explicit re-read.
//
// Shells that don't expose `getSettings` / `updateSettings` (older
// builds, future shells under construction) report an error string in
// the returned state rather than throwing — keeps the consuming
// settings page renderable in a degraded mode.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMessaging } from '../useMessaging.js';

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
        return next;
    }, [messaging]);

    useEffect(() => {
        aliveRef.current = true;
        refresh();
        return () => { aliveRef.current = false; };
    }, [refresh]);

    return { settings, loading, error, refresh, update };
}
