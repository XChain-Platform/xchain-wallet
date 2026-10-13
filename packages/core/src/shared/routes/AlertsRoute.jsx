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

import { useState } from 'react';
import { EmptyState, ListPage, Screen, PageHeader } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { alertVersion, readAlertCenter, writeAlertCenter } from '../utils/alertCenterMemory.js';
import styles from '../components/AlertsOverlay.module.css';

/**
 * @param {object} props
 * @param {() => void} props.onBack
 * @param {string} [props.walletId]
 * @param {Array<{ id: string, severity: 'info' | 'warning' | 'critical', title: string, message: string, read?: boolean, action?: { label: string, onSelect: () => void } }>} [props.alerts]
 */
export function AlertsRoute({ onBack, walletId, alerts = [] }) {
    const { shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const header = <PageHeader onBack={onBack} title="Alerts" />;
    const sourceAlerts = Array.isArray(alerts) ? alerts : [];
    const [centerState, setCenterState] = useState(() => readAlertCenter(walletId));
    const visibleAlerts = sourceAlerts.filter((alert) => !centerState.cleared.has(alertVersion(alert)));
    const unreadAlerts = visibleAlerts.filter((alert) => !alert.read && !centerState.read.has(alertVersion(alert)));

    const commitState = (next) => {
        writeAlertCenter(walletId, next);
        setCenterState(next);
    };

    const markRead = (alert) => {
        const key = alertVersion(alert);
        if (centerState.read.has(key)) return;
        commitState({
            ...centerState,
            read: new Set([...centerState.read, key]),
        });
    };

    const openAlert = (alert) => {
        markRead(alert);
        alert.action?.onSelect();
    };

    const toolbar = visibleAlerts.length > 0 ? (
        <div className={styles.controls}>
            <span className={styles.unreadCount} aria-live="polite">
                {unreadAlerts.length} unread
            </span>
            <button
                type="button"
                className={styles.controlButton}
                disabled={unreadAlerts.length === 0}
                onClick={() => commitState({
                    ...centerState,
                    read: new Set([
                        ...centerState.read,
                        ...visibleAlerts.map(alertVersion),
                    ]),
                })}
            >
                Mark all read
            </button>
            <button
                type="button"
                className={styles.controlButton}
                onClick={() => commitState({
                    ...centerState,
                    cleared: new Set([
                        ...centerState.cleared,
                        ...visibleAlerts.map(alertVersion),
                    ]),
                })}
            >
                Clear alerts
            </button>
        </div>
    ) : null;

    return (
        <Screen variant={variant} header={header}>
            <ListPage toolbar={toolbar}>
                {visibleAlerts.length === 0 ? (
                    <EmptyState title="No alerts" body="You're all caught up." />
                ) : (
                    /* Safari needs an explicit list role because this class removes list styling. */
                    <ul className={styles.list} role="list">
                        {visibleAlerts.map((a) => {
                            const isUnread = !a.read && !centerState.read.has(alertVersion(a));
                            const content = (
                                <>
                                    <div className={styles.alertHead}>
                                        <span className={styles.alertTitle}>{a.title}</span>
                                        <span className={styles.readStatus}>{isUnread ? 'Unread' : 'Read'}</span>
                                    </div>
                                    <div className={styles.alertMessage}>{a.message}</div>
                                    {a.action ? (
                                        <span className={styles.alertAction}>{a.action.label}</span>
                                    ) : null}
                                </>
                            );
                            return (
                                <li
                                    key={a.id}
                                    className={`${styles.alert} ${styles[a.severity] || styles.info} ${isUnread ? styles.unread : styles.read}`}
                                >
                                    {a.action ? (
                                        <button
                                            type="button"
                                            className={styles.alertOpen}
                                            aria-label={a.action.label}
                                            onClick={() => openAlert(a)}
                                        >
                                            {content}
                                        </button>
                                    ) : (
                                        <div className={styles.alertContent}>{content}</div>
                                    )}
                                    {isUnread ? (
                                        <button
                                            type="button"
                                            className={styles.markRead}
                                            aria-label={`Mark ${a.title} read`}
                                            onClick={() => markRead(a)}
                                        >
                                            Mark read
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
