// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// AlertsRoute: full-screen wallet alerts page. The routed (page)
// counterpart to AlertsOverlay, opened from the pancake menu's Alerts
// row. Mirrors MenuRoute: a normal <Screen> with a Back-titled header
// instead of a modal overlay, so it behaves like any other menu
// destination (Decentralized Exchange, Marketplace, ...). Reuses
// AlertsOverlay.module.css for the alert-row styling.

import { EmptyState, ListPage, Screen, PageHeader } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from '../components/AlertsOverlay.module.css';
import { alertSeverityPresentation } from '../components/alertSeverity.js';

/**
 * @param {object} props
 * @param {() => void} props.onBack
 * @param {Array<{ id: string, severity: 'info' | 'warning' | 'critical', title: string, message: string, action?: { label: string, onSelect: () => void } }>} [props.alerts]
 */
export function AlertsRoute({ onBack, alerts = [] }) {
    const { shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const header = <PageHeader onBack={onBack} title="Alerts" />;
    const visibleAlerts = Array.isArray(alerts) ? alerts : [];

    return (
        <Screen variant={variant} header={header}>
            <ListPage>
                {visibleAlerts.length === 0 ? (
                    <EmptyState title="No alerts" body="You're all caught up." />
                ) : (
                    <ul className={styles.list} role="list">
                        {visibleAlerts.map((a) => {
                            const severity = alertSeverityPresentation(a.severity);
                            return (
                                <li key={a.id} className={`${styles.alert} ${styles[severity.kind]}`}>
                                    <div className={styles.alertHead}>
                                        <span className={styles.severity}>{severity.label}</span>
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
                            );
                        })}
                    </ul>
                )}
            </ListPage>
        </Screen>
    );
}
