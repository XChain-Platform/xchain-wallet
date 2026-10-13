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
import { Button, Icon } from '@xchain-wallet/core/ui';
import styles from './BackupReminderCard.module.css';
import { t } from '../../i18n/index.js';

/**
 * §19.7 / G034 + G062: progressive backup reminder card on Home.
 *
 * Evaluates `flowsLib.computeBackupReminderState({ walletId,
 * walletCreatedAt })`. Renders nothing for the 'hidden' state. 'gentle' renders a
 * quiet card with a snooze button; 'firm' renders a more prominent card
 * without a dismiss.
 *
 * The card itself does not navigate. Callers wire `onAction` to take the
 * user to the Settings > Backup flow.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string | null | undefined} [props.walletCreatedAt]
 * @param {() => void} [props.onAction]      "Back up now" CTA
 */
export function BackupReminderCard({ walletId, walletCreatedAt, onAction }) {
    const [state, setState] = useState({ kind: 'hidden' });

    useEffect(() => {
        if (!walletId) {
            setState({ kind: 'hidden' });
            return;
        }
        setState(flowsLib.computeBackupReminderState({
            walletId,
            walletCreatedAt: walletCreatedAt || null,
        }));
    }, [walletId, walletCreatedAt]);

    if (state.kind === 'hidden') return null;

    const variantClass = state.kind === 'firm' ? styles.firm : styles.gentle;

    return (
        <div className={`${styles.card} ${variantClass}`} role="region" aria-label={state.headline}>
            <div className={styles.body}>
                <h3 className={styles.headline}>{state.headline}</h3>
                <p className={styles.copy}>{state.body}</p>
            </div>
            <div className={styles.actions}>
                <Button
                    size="sm"
                    variant="primary"
                    onClick={onAction}
                    disabled={!onAction}
                    icon={<Icon.CheckIcon />}
                >
                    {t('backupReminder.backupNow')}
                </Button>
                {state.dismissable ? (
                    <button
                        type="button"
                        className={styles.dismissBtn}
                        onClick={() => {
                            flowsLib.dismissBackupReminder(walletId);
                            setState({ kind: 'hidden' });
                        }}
                    >
                        {t('backupReminder.remindTomorrow')}
                    </button>
                ) : null}
            </div>
        </div>
    );
}
