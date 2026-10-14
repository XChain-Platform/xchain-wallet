// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A demo wallet holds fixture balances and cannot move funds. Every route
// that would compose or broadcast a transaction shows the same inline note
// (with the "Create a real wallet" exit), keeps its form browsable, and
// disables its submit, so no encoder is ever contacted from a demo wallet.
//
// `useDemoGuard(walletId)` is the one primitive. A FormPage route passes the
// result as `<FormPage demoGuard={guard}>`; a route that lays itself out
// renders `guard.note` and `guard.dialog` and reads `guard.blocked` to
// disable its own action buttons.

import { useCallback, useMemo, useState } from 'react';
import { StatusMessage } from '../../ui/StatusMessage.jsx';
import { t } from '../../i18n/index.js';
import { isDemoWallet } from '../../flows/demoMode.js';
import { exitDemoWallet } from '../utils/demoGraduation.js';
import { DemoExitConfirm } from '../components/DemoExitConfirm.jsx';
import { useMessaging } from '../useMessaging.js';

/**
 * @param {string | null | undefined} walletId
 * @param {{ onBack?: () => void }} [opts]
 * @returns {{
 *   blocked: boolean,
 *   note: import('react').ReactNode,
 *   dialog: import('react').ReactNode,
 * }}
 */
export function useDemoGuard(walletId, { onBack } = {}) {
    const { messaging } = useMessaging();
    const blocked = !!walletId && isDemoWallet(walletId);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));

    const handleExit = useCallback(async () => {
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
            const { reloaded } = await exitDemoWallet({ messaging, walletId });
            if (reloaded) return;
            setConfirmOpen(false);
            onBack?.();
        } catch {
            setError('Could not exit demo mode. Please try again.');
        } finally {
            setBusy(false);
        }
    }, [busy, messaging, walletId, onBack]);

    return useMemo(() => {
        if (!blocked) return { blocked: false, note: null, dialog: null };
        return {
            blocked: true,
            note: (
                <StatusMessage
                    variant="info"
                    recovery={{
                        label: t('send.demo.createRealWallet'),
                        onAction: () => { setError(null); setConfirmOpen(true); },
                    }}
                >
                    {t('demo.guard.blocked')}
                </StatusMessage>
            ),
            dialog: confirmOpen ? (
                <DemoExitConfirm
                    busy={busy}
                    error={error}
                    onConfirm={handleExit}
                    onCancel={() => { setConfirmOpen(false); setError(null); }}
                />
            ) : null,
        };
    }, [blocked, confirmOpen, busy, error, handleExit]);
}
