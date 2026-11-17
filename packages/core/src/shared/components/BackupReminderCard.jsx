// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useState } from 'react';
import { flows as flowsLib } from '@xchain-wallet/core';
import { Icon, Notice } from '@xchain-wallet/core/ui';
import styles from './BackupReminderCard.module.css';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/backupReminder.js';

/**
 * §19.7 / G034 + G062: progressive backup reminder card on Home.
 *
 * Evaluates `flowsLib.computeBackupReminderState({ walletId, hasFunds })`.
 * Renders nothing for the 'hidden' state. 'gentle' renders a
 * info Notice whose X snoozes it; 'firm' renders a danger Notice without an X.
 *
 * The card itself does not navigate. Callers wire `onAction` to take the
 * user to the Settings > Backup flow.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {boolean} props.hasFunds
 * @param {boolean} [props.isDemo]
 * @param {string | null} [props.walletMode]
 * @param {() => void} [props.onAction]      "Back up now" CTA
 * @param {string} [props.walletFormat]      a hardware wallet keeps its keys on the device, so it gets no reminder
 */
export function BackupReminderCard({
    walletId,
    hasFunds,
    isDemo = false,
    walletMode = 'full',
    onAction,
    walletFormat,
}) {
    const [state, setState] = useState({ kind: 'hidden' });
    const seedless = walletFormat === 'hardware';

    useEffect(() => {
        if (!walletId || seedless) {
            setState({ kind: 'hidden' });
            return undefined;
        }
        const refresh = (event) => {
            if (event?.type === 'storage' && event.key !== 'xc:backupVerifiedAt') return;
            setState(flowsLib.computeBackupReminderState({
                walletId, hasFunds, isDemo, walletMode,
            }));
        };
        refresh();
        globalThis.addEventListener?.('storage', refresh);
        return () => globalThis.removeEventListener?.('storage', refresh);
    }, [walletId, hasFunds, isDemo, walletMode, seedless]);

    useEffect(() => {
        if (seedless || typeof state.recheckAt !== 'number') return undefined;
        const delay = Math.max(0, state.recheckAt - Date.now());
        const timer = setTimeout(() => {
            setState(flowsLib.computeBackupReminderState({
                walletId, hasFunds, isDemo, walletMode,
            }));
        }, delay);
        return () => clearTimeout(timer);
    }, [state.recheckAt, walletId, hasFunds, isDemo, walletMode, seedless]);

    if (seedless || state.kind === 'hidden') return null;

    // The Notice Standard: a reminder is an info note, and the firm state
    // (a wallet holding funds with no verified backup) a red warning. Both are
    // part of the page, so neither is a live region. The one action is Back up
    // now; the gentle state's snooze is the notice's X.
    const snooze = () => {
        flowsLib.dismissBackupReminder(walletId);
        setState(flowsLib.computeBackupReminderState({
            walletId, hasFunds, isDemo, walletMode,
        }));
    };

    return (
        <section className={styles.region} aria-label={state.headline}>
            <Notice
                tone={state.kind === 'firm' ? 'danger' : 'info'}
                role={null}
                flush
                title={state.headline}
                action={{
                    label: t('backupReminder.backupNow'),
                    onAction: onAction || (() => {}),
                    disabled: !onAction,
                    icon: <Icon.CheckIcon />,
                }}
                onDismiss={state.dismissable ? snooze : undefined}
                dismissLabel={t('backupReminder.remindTomorrow')}
            >
                {state.body}
            </Notice>
        </section>
    );
}
