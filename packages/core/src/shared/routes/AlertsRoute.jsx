// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Screen, PageHeader } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from '../components/AlertsOverlay.module.css';

/**
 * @param {object} props
 * @param {() => void} props.onBack
 * @param {Array<{ id: string, severity: 'info' | 'warning' | 'critical', title: string, message: string, action?: { label: string, onSelect: () => void } }>} [props.alerts]
 */
export function AlertsRoute({ onBack, alerts = [] }) {
    const { shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const header = <PageHeader onBack={onBack} title="Alerts" />;

    return (
        <Screen variant={variant} header={header}>
            <div className={styles.body}>
                {alerts.length === 0 ? (
                    <p className={styles.empty}>No alerts. You&apos;re all caught up.</p>
                ) : (
                    <ul className={styles.list} role="list">
                        {alerts.map((a) => (
                            <li key={a.id} className={`${styles.alert} ${styles[a.severity] || styles.info}`}>
                                <div className={styles.alertHead}>
                                    <span className={styles.alertTitle}>{a.title}</span>
                                </div>
                                <div className={styles.alertMessage}>{a.message}</div>
                                {a.action ? (
                                    <button
                                        type="button"
                                        className={styles.alertAction}
                                        onClick={() => a.action.onSelect()}
                                    >
                                        {a.action.label}
                                    </button>
                                ) : null}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </Screen>
    );
}
