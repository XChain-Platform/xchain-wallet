// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// useSignerStatus (§18.4 / §17.3): sign-screen helper. Polls a signer's
// `getStatus()` at a cadence matching the HW UX: fast at mount (user
// just plugged the device in or opened the screen), slow after it
// reports 'available' (steady state), fast again after 'wrong-app' /
// 'disconnected' (user is acting on the device).
//
// Shapes itself as a React hook so per-form wiring is one line; the
// underlying polling is plain setInterval so any signer with a
// working `getStatus` method. RemoteSigner, TrezorSigner, and
// LedgerSigner all plug in without change.

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * @typedef {'idle'|'available'|'locked'|'disconnected'|'wrong-app'|'error'} SignerStatus
 */

const FAST_INTERVAL_MS = 2000;
const STEADY_INTERVAL_MS = 10000;

/**
 * Poll a signer's status. Returns the latest status, a `detail`
 * string when present, and a `refresh` function for explicit manual
 * polls (e.g. after the user says "I opened the Bitcoin app").
 *
 * Pass `getStatus={null}` or omit the signer to disable polling
 * (useful when the active wallet hasn't selected a HW source).
 *
 * @param {{ getStatus: ((opts?: object) => Promise<any>) | null, chainId?: string }} opts
 * @returns {{ status: SignerStatus, detail: string | null, refresh: () => void }}
 */
export function useSignerStatus({ getStatus, chainId }) {
    const [status, setStatus] = useState(/** @type {SignerStatus} */ ('idle'));
    const [detail, setDetail] = useState(/** @type {string | null} */ (null));
    const aliveRef = useRef(true);
    const timerRef = useRef(/** @type {any} */ (null));
    // Mirror the latest status into a ref so the long-lived polling
    // loop below reads the *current* value when picking its cadence.
    // The loop's effect intentionally does not re-run on status changes
    // (doing so would tear down and immediately re-fire the poll), so a
    // plain closure over `status` would go stale at the mount value.
    const statusRef = useRef(status);
    statusRef.current = status;

    const doPoll = useCallback(async () => {
        if (!getStatus || !aliveRef.current) return;
        try {
            const res = await getStatus({ chainId });
            if (!aliveRef.current) return;
            const s = typeof res === 'string' ? res : (res && res.status) || 'error';
            const d = res && typeof res === 'object' && typeof res.detail === 'string'
                ? res.detail
                : null;
            setStatus(s);
            setDetail(d);
        } catch (err) {
            if (!aliveRef.current) return;
            setStatus('disconnected');
            setDetail(err && err.message ? String(err.message) : null);
        }
    }, [getStatus, chainId]);

    const refresh = useCallback(() => { doPoll(); }, [doPoll]);

    useEffect(() => {
        aliveRef.current = true;
        if (!getStatus) {
            setStatus('idle');
            setDetail(null);
            return () => { aliveRef.current = false; };
        }
        // Fire once immediately so the caller doesn't flash through
        // 'idle' before the first poll resolves.
        doPoll();
        const scheduleNext = () => {
            if (!aliveRef.current) return;
            const interval = statusRef.current === 'available'
                ? STEADY_INTERVAL_MS
                : FAST_INTERVAL_MS;
            timerRef.current = setTimeout(async () => {
                if (!aliveRef.current) return;
                await doPoll();
                scheduleNext();
            }, interval);
        };
        scheduleNext();
        return () => {
            aliveRef.current = false;
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [doPoll, getStatus]);

    return { status, detail, refresh };
}
