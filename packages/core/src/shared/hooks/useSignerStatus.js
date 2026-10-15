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
 * @typedef {'idle'|'available'|'locked'|'disconnected'|'wrong-app'|'unsupported-network'|'cancelled'|'error'} SignerStatus
 */

const FAST_INTERVAL_MS = 2000;
const STEADY_INTERVAL_MS = 10000;

function isDocumentHidden() {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

function isDeviceCancellation(error) {
    return error?.name === 'UserRejectedError'
        || error?.reason === 'user-rejected'
        || error?.code === 'Failure_ActionCancelled'
        || error?.statusCode === 0x6985;
}

// Sign controls for the same signer join one status read. A later mount also
// reuses the completed answer until the cadence for that status expires.
const readsByGetStatus = new WeakMap();

function sharedStatusRead(getStatus, chainId, intervalMs, force = false) {
    let reads = readsByGetStatus.get(getStatus);
    if (!reads) {
        reads = new Map();
        readsByGetStatus.set(getStatus, reads);
    }
    const key = chainId || '';
    let read = reads.get(key);
    if (!read) {
        read = {
            lastStartedAt: null, inFlight: null, result: null, refreshMs: null,
        };
        reads.set(key, read);
    }
    if (read.inFlight) return read.inFlight;
    const now = Date.now();
    const age = read.lastStartedAt === null ? Infinity : now - read.lastStartedAt;
    const refreshMs = read.refreshMs ?? intervalMs;
    if (!force && age >= 0 && age < refreshMs) return Promise.resolve(read.result);

    read.lastStartedAt = now;
    const inFlight = Promise.resolve()
        .then(() => getStatus({ chainId }))
        .then((result) => {
            read.result = result;
            const status = typeof result === 'string' ? result : result?.status;
            read.refreshMs = status === 'available' ? STEADY_INTERVAL_MS : FAST_INTERVAL_MS;
            return result;
        })
        .catch((error) => {
            read.lastStartedAt = null;
            throw error;
        })
        .finally(() => {
            if (read.inFlight === inFlight) read.inFlight = null;
        });
    read.inFlight = inFlight;
    return inFlight;
}

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
    const [snapshot, setSnapshot] = useState(() => ({
        status: /** @type {SignerStatus} */ ('idle'),
        detail: /** @type {string | null} */ (null),
        getStatus,
        chainId,
    }));
    const requestRef = useRef(0);
    const timerRef = useRef(/** @type {any} */ (null));
    const generationRef = useRef(0);
    // Mirror the latest status into a ref so the long-lived polling
    // loop below reads the *current* value when picking its cadence.
    // The loop's effect intentionally does not re-run on status changes
    // (doing so would tear down and immediately re-fire the poll), so a
    // plain closure over `status` would go stale at the mount value.
    const statusRef = useRef(snapshot.status);
    const statusMatchesInput = snapshot.getStatus === getStatus
        && snapshot.chainId === chainId;
    statusRef.current = statusMatchesInput ? snapshot.status : 'idle';

    const doPoll = useCallback(async (force = false, generation = generationRef.current) => {
        if (!getStatus || generation !== generationRef.current) return;
        // The newest read in this generation wins, so a refresh that lands
        // before an older poll is not overwritten by it.
        const request = requestRef.current + 1;
        requestRef.current = request;
        const isCurrent = () => generation === generationRef.current && requestRef.current === request;
        try {
            const interval = statusRef.current === 'available'
                ? STEADY_INTERVAL_MS
                : FAST_INTERVAL_MS;
            const res = await sharedStatusRead(getStatus, chainId, interval, force);
            if (!isCurrent()) return;
            const s = typeof res === 'string' ? res : (res && res.status) || 'error';
            const d = res && typeof res === 'object' && typeof res.detail === 'string'
                ? res.detail
                : null;
            statusRef.current = s;
            setSnapshot((previous) => (
                previous.status === s
                && previous.detail === d
                && previous.getStatus === getStatus
                && previous.chainId === chainId
                    ? previous
                    : { status: s, detail: d, getStatus, chainId }
            ));
        } catch (err) {
            if (!isCurrent()) return;
            const cancelled = isDeviceCancellation(err);
            const nextStatus = cancelled ? 'cancelled' : 'disconnected';
            const nextDetail = cancelled
                ? null
                : (err && err.message ? String(err.message) : null);
            statusRef.current = nextStatus;
            setSnapshot((previous) => (
                previous.status === nextStatus
                && previous.detail === nextDetail
                && previous.getStatus === getStatus
                && previous.chainId === chainId
                    ? previous
                    : {
                        status: nextStatus,
                        detail: nextDetail,
                        getStatus,
                        chainId,
                    }
            ));
        }
    }, [getStatus, chainId]);

    const refresh = useCallback(() => { void doPoll(true); }, [doPoll]);

    useEffect(() => {
        const generation = generationRef.current + 1;
        generationRef.current = generation;
        if (!getStatus) {
            statusRef.current = 'idle';
            setSnapshot((previous) => (
                previous.status === 'idle'
                && previous.detail === null
                && previous.getStatus === getStatus
                && previous.chainId === chainId
                    ? previous
                    : { status: 'idle', detail: null, getStatus, chainId }
            ));
            return () => {
                if (generationRef.current === generation) generationRef.current += 1;
            };
        }
        const scheduleNext = () => {
            if (generation !== generationRef.current) return;
            const interval = statusRef.current === 'available'
                ? STEADY_INTERVAL_MS
                : FAST_INTERVAL_MS;
            timerRef.current = setTimeout(async () => {
                if (generation !== generationRef.current) return;
                if (!isDocumentHidden()) await doPoll(false, generation);
                scheduleNext();
            }, interval);
        };
        // The next cadence starts when the immediate answer lands, so an
        // available signer waits the full steady interval before rereading.
        const start = async () => {
            if (!isDocumentHidden()) await doPoll(false, generation);
            scheduleNext();
        };
        void start();
        const onVisible = () => {
            if (!isDocumentHidden()) void doPoll(false, generation);
        };
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', onVisible);
        }
        return () => {
            if (generationRef.current === generation) generationRef.current += 1;
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', onVisible);
            }
        };
    }, [doPoll, getStatus]);

    return {
        status: statusMatchesInput ? snapshot.status : 'idle',
        detail: statusMatchesInput ? snapshot.detail : null,
        refresh,
    };
}
