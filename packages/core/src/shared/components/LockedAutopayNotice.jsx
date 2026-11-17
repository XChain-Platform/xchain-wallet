// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Locked screen's auto pay line (PC-16 Phase B). While locked auto pay
// runs, the screen says how many armed orders it covers and up to how much,
// with a Stop that needs no password. It reads plain status from the shell
// (messaging.lockedAutopayStatus) and renders nothing when the shell has no
// such call or nothing is running. No time left is shown: locked auto pay has
// no time limit (operator ruling 2026-11-13).

import { useCallback, useEffect, useRef, useState } from 'react';
import { StatusMessage } from '@xchain-wallet/core/ui';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/locked.js';

const REFRESH_MS = 15_000;

/**
 * @param {{ active?: boolean, orders?: number, caps?: Array<{ amount: string, ticker: string }> } | null} status
 * @returns {string | null}
 */
export function lockedAutopayText(status) {
    if (!status || status.active !== true) return null;
    const orders = Number.isInteger(status.orders) ? status.orders : 0;
    const caps = Array.isArray(status.caps) ? status.caps : [];
    if (orders === 0 || caps.length === 0) return t('locked.autopay.onNoOrders');
    const cap = caps.map((c) => `${c.amount} ${c.ticker}`).join(', ');
    return t('locked.autopay.on', { count: orders, cap });
}

/**
 * The notice as a StatusMessage element, or null while nothing runs. A hook
 * rather than a component so the form's status slot merges it into its one
 * notice box and draws no empty box when there is nothing to say.
 *
 * @param {{ lockedAutopayStatus?: () => Promise<any>, stopLockedAutopay?: () => Promise<any> } | null | undefined} messaging
 * @returns {import('react').ReactElement | null}
 */
export function useLockedAutopayNotice(messaging) {
    const [status, setStatus] = useState(null);
    const [stopError, setStopError] = useState(false);
    const [stopping, setStopping] = useState(false);
    const mounted = useRef(true);
    const read = typeof messaging?.lockedAutopayStatus === 'function' ? messaging.lockedAutopayStatus : null;

    const refresh = useCallback(async () => {
        if (!read) return;
        try {
            const next = await read();
            if (mounted.current) setStatus(next && typeof next === 'object' ? next : null);
        } catch {
            if (mounted.current) setStatus(null);
        }
    }, [read]);

    useEffect(() => {
        mounted.current = true;
        if (!read) return undefined;
        void refresh();
        const handle = setInterval(() => { void refresh(); }, REFRESH_MS);
        return () => {
            mounted.current = false;
            clearInterval(handle);
        };
    }, [read, refresh]);

    const onStop = useCallback(async () => {
        if (typeof messaging?.stopLockedAutopay !== 'function') return;
        setStopping(true);
        setStopError(false);
        try {
            const next = await messaging.stopLockedAutopay();
            if (mounted.current) setStatus(next && typeof next === 'object' ? next : { active: false });
        } catch {
            if (mounted.current) setStopError(true);
        } finally {
            if (mounted.current) setStopping(false);
        }
    }, [messaging]);

    const text = lockedAutopayText(status);
    if (!text) return null;
    return (
        <StatusMessage
            key="locked-autopay"
            variant="info"
            testId="locked-autopay"
            recovery={{
                label: t('locked.autopay.stop'),
                ariaLabel: t('locked.autopay.stopAria'),
                onAction: onStop,
                disabled: stopping,
            }}
        >
            {stopError ? `${text} ${t('locked.autopay.stopFailed')}` : text}
        </StatusMessage>
    );
}
