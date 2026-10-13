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

import { useEffect, useRef, useState } from 'react';
import { Button, EmptyState, ListPage, Screen, PageHeader } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { alertVersion, readAlertCenter, writeAlertCenter } from '../utils/alertCenterMemory.js';
import styles from '../components/AlertsOverlay.module.css';
import { alertSeverityPresentation } from '../components/alertSeverity.js';

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
    const emptyStateRef = useRef(null);
    const [pendingFocus, setPendingFocus] = useState(null);
    const [centerState, setCenterState] = useState(() => readAlertCenter(walletId));
    const visibleAlerts = sourceAlerts.filter((alert) => !centerState.cleared.has(alertVersion(alert)));
    const unreadAlerts = visibleAlerts.filter((alert) => !alert.read && !centerState.read.has(alertVersion(alert)));

    useEffect(() => {
        setCenterState(readAlertCenter(walletId));
    }, [walletId]);

    // Focus follows the control the user just removed, so keyboard users are not dropped to the page top.
    useEffect(() => {
        if (!pendingFocus) return;
        const target = pendingFocus === 'empty'
            ? emptyStateRef.current
            : document.querySelector(`[data-alert-focus="${pendingFocus}"]`);
        target?.focus();
        setPendingFocus(null);
    }, [centerState, pendingFocus]);

    const commitState = (next) => {
        writeAlertCenter(walletId, next);
        setCenterState(next);
    };

    const markRead = (alert, restoreFocus = false) => {
        const key = alertVersion(alert);
        if (centerState.read.has(key)) return;
        if (restoreFocus) setPendingFocus(alert.action ? `open-${alert.id}` : 'clear');
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
            <Button
                variant="secondary"
                size="sm"
                icon={null}
                disabled={unreadAlerts.length === 0}
                onClick={() => {
                    setPendingFocus('clear');
                    commitState({
                        ...centerState,
                        read: new Set([
                            ...centerState.read,
                            ...visibleAlerts.map(alertVersion),
                        ]),
                    });
                }}
            >
                Mark all read
            </Button>
            <Button
                variant="ghost"
                size="sm"
                icon={null}
                data-alert-focus="clear"
                onClick={() => {
                    setPendingFocus('empty');
                    commitState({
                        ...centerState,
                        cleared: new Set([
                            ...centerState.cleared,
                            ...visibleAlerts.map(alertVersion),
                        ]),
                    });
                }}
            >
                Clear alerts
            </Button>
        </div>
    ) : null;

    return (
        <Screen variant={variant} header={header}>
            <ListPage toolbar={toolbar}>
                {visibleAlerts.length === 0 ? (
                    <div
                        ref={emptyStateRef}
                        tabIndex={-1}
                        aria-label="No alerts. You're all caught up."
                    >
                        <EmptyState title="No alerts" body="You're all caught up." />
                    </div>
                ) : (
                    /* Safari needs an explicit list role because this class removes list styling. */
                    <ul className={styles.list} role="list">
                        {visibleAlerts.map((a) => {
                            const severity = alertSeverityPresentation(a.severity);
                            const isUnread = !a.read && !centerState.read.has(alertVersion(a));
                            return (
                                <li
                                    key={a.id}
                                    className={`${styles.alert} ${styles[severity.kind]} ${isUnread ? styles.unread : styles.read}`}
                                >
                                    <div className={styles.alertHead}>
                                        <span className={styles.severity}>{severity.label}</span>
                                        <span className={styles.alertTitle}>{a.title}</span>
                                        <span className={styles.readStatus}>{isUnread ? 'Unread' : 'Read'}</span>
                                    </div>
                                    <div className={styles.alertMessage}>{a.message}</div>
                                    {a.action ? (
                                        // Opening an alert's screen also marks it read.
                                        <Button
                                            variant="primary"
                                            size="sm"
                                            icon={null}
                                            data-alert-focus={`open-${a.id}`}
                                            onClick={() => openAlert(a)}
                                            style={{ alignSelf: 'flex-start' }}
                                        >
                                            {a.action.label}
                                        </Button>
                                    ) : null}
                                    {isUnread ? (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            icon={null}
                                            aria-label={`Mark ${a.title} read`}
                                            onClick={() => markRead(a, true)}
                                            style={{ alignSelf: 'flex-start' }}
                                        >
                                            Mark read
                                        </Button>
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
