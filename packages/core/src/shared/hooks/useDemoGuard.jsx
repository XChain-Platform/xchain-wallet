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
// that would compose or broadcast a transaction keeps its form usable and its
// submit enabled, then refuses the submit, so no encoder is ever contacted
// from a demo wallet. The user knows the wallet is a demo, so no page warns
// in advance: the refusal (with the "Create a real wallet" exit) shows only
// as the result of pressing the action.
//
// `useDemoGuard(walletId)` is the one primitive. A FormPage route passes the
// result as `<FormPage demoGuard={guard}>`, and FormPage swallows the submit
// and calls `guard.refuse()`. A route that lays itself out renders
// `guard.note` (null until refused) and `guard.dialog`, and its action
// handler calls `guard.refuse()` and returns when `guard.blocked` is true.

import { useCallback, useMemo, useState } from 'react';
import { StatusMessage } from '../../ui/StatusMessage.jsx';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/demo.js';
import '../../i18n/locales/en/send.js';
import { isDemoWallet } from '../../flows/demoMode.js';
import { demoMessaging } from '../../flows/demoFixtures.js';
import { exitDemoWallet } from '../utils/demoGraduation.js';
import { DemoExitConfirm } from '../components/DemoExitConfirm.jsx';
import { useMessaging } from '../useMessaging.js';

/**
 * Select the wallet's read source once so views never branch on wallet kind.
 * Live capabilities stay explicit because polling and proof traffic must not
 * run against sample data, while every ordinary read follows the same path.
 *
 * @param {string | null | undefined} walletId
 * @returns {{ messaging: Record<string, any>, live: boolean, canSpend: boolean, pricesTestCoins: boolean }}
 */
export function useWalletSource(walletId) {
    const { messaging } = useMessaging();
    const sampleMessaging = useMemo(() => demoMessaging(messaging), [messaging]);
    return useMemo(() => {
        if (walletId && isDemoWallet(walletId)) {
            return {
                messaging: sampleMessaging,
                live: false,
                canSpend: false,
                pricesTestCoins: true,
            };
        }
        return {
            messaging,
            live: true,
            canSpend: true,
            pricesTestCoins: false,
        };
    }, [messaging, sampleMessaging, walletId]);
}

/**
 * @param {string | null | undefined} walletId
 * @param {{ onBack?: () => void }} [opts]
 * @returns {{
 *   blocked: boolean,
 *   note: import('react').ReactNode,
 *   dialog: import('react').ReactNode,
 *   refuse: () => void,
 *   walletId: string | null,
 * }}
 */
export function useDemoGuard(walletId, { onBack } = {}) {
    const { messaging } = useMessaging();
    const blocked = !!walletId && isDemoWallet(walletId);
    // Set only by a refused action, so the note is a result, never a warning.
    const [refused, setRefused] = useState(false);
    const refuse = useCallback(() => { setRefused(true); }, []);
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

    // `walletId` rides along so the Form Standard frame, which receives this
    // guard, knows the wallet without each form passing it again.
    return useMemo(() => {
        if (!blocked) return { blocked: false, note: null, dialog: null, refuse, walletId: walletId || null };
        return {
            blocked: true,
            walletId,
            refuse,
            note: refused ? (
                <StatusMessage
                    variant="error"
                    testId="demo-guard-refusal"
                    recovery={{
                        label: t('send.demo.createRealWallet'),
                        onAction: () => { setError(null); setConfirmOpen(true); },
                    }}
                >
                    {t('demo.guard.blocked')}
                </StatusMessage>
            ) : null,
            dialog: confirmOpen ? (
                <DemoExitConfirm
                    busy={busy}
                    error={error}
                    onConfirm={handleExit}
                    onCancel={() => { setConfirmOpen(false); setError(null); }}
                />
            ) : null,
        };
    }, [blocked, refused, refuse, confirmOpen, busy, error, handleExit, walletId]);
}
