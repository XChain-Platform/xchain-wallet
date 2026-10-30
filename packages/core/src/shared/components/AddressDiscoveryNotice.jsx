// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Progress and result of the used-address check that runs in the background
// after a restore or from Wallet details. One message per state: checking,
// the count found, or the networks that could not be checked with Try again.

import { useEffect, useRef, useState } from 'react';
import { StatusMessage } from '@xchain-wallet/core/ui';
import { useMessaging } from '../useMessaging.js';
import { formatAndList, t } from '../../i18n/index.js';
import '../../i18n/locales/en/addressDiscovery.js';

export const ADDRESS_DISCOVERY_POLL_MS = 1000;

// A shell without the check, or a stand-in messaging layer, answers with
// something other than a scan snapshot; that reads as no scan at all.
function asSnapshot(value) {
    if (!value || typeof value !== 'object') return null;
    if (!Number.isInteger(value.id)) return null;
    if (value.status !== 'running' && value.status !== 'done') return null;
    if (!Array.isArray(value.failedChains) || !Array.isArray(value.walletIds)) return null;
    return value;
}

/**
 * The line a discovery snapshot reads as, or null when there is none to show.
 *
 * @param {{ status: string, chainsDone: number, chainsTotal: number, found: number, failedChains: string[] } | null} job
 * @returns {{ variant: 'status' | 'success' | 'warning', text: string, failed: boolean } | null}
 */
export function addressDiscoveryLine(value) {
    const job = asSnapshot(value);
    if (!job) return null;
    if (job.status === 'running') {
        return {
            variant: 'status',
            text: t('addressDiscovery.checking', {
                done: Math.min(job.chainsDone, job.chainsTotal),
                total: job.chainsTotal,
            }),
            failed: false,
        };
    }
    if (job.failedChains.length > 0) {
        return {
            variant: 'warning',
            text: t('addressDiscovery.failed', { chains: formatAndList(job.failedChains) }),
            failed: true,
        };
    }
    return { variant: 'success', text: t('addressDiscovery.found', { count: job.found }), failed: false };
}

/**
 * @param {object} props
 * @param {(job: any) => void} [props.onFinished]  fires once when a scan this notice watched finishes
 * @param {boolean} [props.dismissOnLeave]          mark a finished scan as read when this notice unmounts
 */
export function AddressDiscoveryNotice({ onFinished, dismissOnLeave = false }) {
    const { messaging } = useMessaging();
    const [job, setJob] = useState(/** @type {any} */ (null));
    const [retryError, setRetryError] = useState(/** @type {string | null} */ (null));
    // Bumped by Try again so the poll restarts on the scan it started.
    const [generation, setGeneration] = useState(0);
    const watchedRunningRef = useRef(/** @type {number | null} */ (null));
    const shownDoneRef = useRef(/** @type {number | null} */ (null));
    const onFinishedRef = useRef(onFinished);
    onFinishedRef.current = onFinished;

    useEffect(() => {
        if (typeof messaging?.addressDiscoveryStatus !== 'function') return undefined;
        let cancelled = false;
        let timer = null;
        const poll = async () => {
            let next = null;
            try {
                next = await messaging.addressDiscoveryStatus();
            } catch {
                next = null;
            }
            if (cancelled) return;
            // The latest scan, until a screen that showed its result marks it read.
            const snapshot = asSnapshot(next);
            const relevant = snapshot && !snapshot.dismissed ? snapshot : null;
            setJob(relevant);
            if (relevant?.status === 'running') {
                watchedRunningRef.current = relevant.id;
                timer = setTimeout(poll, ADDRESS_DISCOVERY_POLL_MS);
            } else if (relevant?.status === 'done' && watchedRunningRef.current === relevant.id) {
                watchedRunningRef.current = null;
                if (typeof onFinishedRef.current === 'function') onFinishedRef.current(relevant);
            }
        };
        void poll();
        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, [messaging, generation]);

    useEffect(() => {
        if (job?.status === 'done') shownDoneRef.current = job.id;
    }, [job]);

    useEffect(() => () => {
        if (!dismissOnLeave || shownDoneRef.current === null) return;
        if (typeof messaging?.addressDiscoveryDismiss !== 'function') return;
        void Promise.resolve(messaging.addressDiscoveryDismiss({ id: shownDoneRef.current })).catch(() => {});
    }, [dismissOnLeave, messaging]);

    async function retry() {
        setRetryError(null);
        const walletIds = job?.walletIds ?? [];
        try {
            await messaging.discoverAddresses(walletIds.length === 1 ? { walletId: walletIds[0] } : {});
            setGeneration((g) => g + 1);
        } catch (err) {
            setRetryError(err?.message || String(err));
        }
    }

    if (retryError) return <StatusMessage variant="error">{retryError}</StatusMessage>;
    const line = addressDiscoveryLine(job);
    if (!line) return null;
    return (
        <StatusMessage
            variant={line.variant}
            testId="address-discovery-status"
            recovery={line.failed && typeof messaging?.discoverAddresses === 'function'
                ? { label: t('common.tryAgain'), onAction: retry }
                : undefined}
        >
            {line.text}
        </StatusMessage>
    );
}
