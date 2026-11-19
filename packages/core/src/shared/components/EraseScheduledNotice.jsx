// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Forgot Password's 48-hour erase seen from an UNLOCKED session (security
// review 2026-11-16). On web a second tab sits on the lock screen while the
// owner is unlocked in another, and its Forgot Password can schedule the
// erase; the lock screen was the only place that showed or cancelled one. This
// G120 danger notice sits at the top of the unlocked app in every shell, with
// one action, Cancel Erase. The session is already unlocked, so the cancel
// needs no password. It reads the schedule on mount, on a storage event from
// another tab, and every 30 seconds (a native shell's slot fires no event).

import { useCallback, useEffect, useState } from 'react';
import { StatusMessage } from '@xchain-wallet/core/ui';
import {
    ERASE_SCHEDULE_STORAGE_KEY,
    cancelEraseSchedule,
    eraseRemainingMs,
    getEraseSchedule,
} from '../../flows/eraseSchedule.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/locked.js';

const REFRESH_MS = 30_000;

/** Coarse time left for a notice that waits hours: whole hours, then minutes. @param {number} ms */
function timeLeft(ms) {
    const mins = Math.max(1, Math.ceil(ms / 60_000));
    if (mins < 60) return t('locked.countdown.minutes', { count: mins });
    return t('locked.countdown.hours', { count: Math.ceil(mins / 60) });
}

export function EraseScheduledNotice() {
    const [schedule, setSchedule] = useState(getEraseSchedule);
    const [now, setNow] = useState(() => Date.now());
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));

    const refresh = useCallback(() => {
        setSchedule(getEraseSchedule());
        setNow(Date.now());
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const onStorage = (event) => {
            if (event?.key === null || event?.key === ERASE_SCHEDULE_STORAGE_KEY) refresh();
        };
        window.addEventListener('storage', onStorage);
        const handle = window.setInterval(refresh, REFRESH_MS);
        return () => {
            window.removeEventListener('storage', onStorage);
            window.clearInterval(handle);
        };
    }, [refresh]);

    async function handleCancel() {
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
            await cancelEraseSchedule();
            refresh();
        } catch {
            setError(t('locked.erase.cancelFailed'));
            refresh();
        } finally {
            setBusy(false);
        }
    }

    if (!schedule) return null;
    const left = eraseRemainingMs(schedule, now);
    return (
        <StatusMessage
            tone="danger"
            title={t('locked.erase.unlockedTitle')}
            action={{ label: t('locked.erase.cancel'), onAction: handleCancel, disabled: busy }}
        >
            {left > 0
                ? t('locked.erase.unlockedBody', { time: timeLeft(left) })
                : t('locked.erase.unlockedDueBody')}
            {error ? <span role="alert">{' '}{error}</span> : null}
        </StatusMessage>
    );
}
