// useSignerStatus — §18.4 / §17.3 sign-screen helper. Polls a signer's
// `getStatus()` at a cadence matching the HW UX: fast at mount (user
// just plugged the device in or opened the screen), slow after it
// reports 'available' (steady state), fast again after 'wrong-app' /
// 'disconnected' (user is acting on the device).
//
// Shapes itself as a React hook so per-form wiring is one line; the
// underlying polling is plain setInterval so any signer with a
// working `getStatus` method — RemoteSigner, TrezorSigner,
// LedgerSigner — plugs in without change.

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
            const interval = status === 'available'
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [doPoll, getStatus]);

    return { status, detail, refresh };
}
