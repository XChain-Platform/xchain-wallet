// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect } from 'react';
import { Icon } from '@xchain-wallet/core/ui';
import styles from './AlertsOverlay.module.css';

/**
 * Full-overlay alerts panel. Surfaces wallet-level notifications that
 * the user should see but that don't belong inline above the balance
 * list (where they pile up and become noise). The first inhabitants:
 *   - Legacy FreeWallet format → migrate
 *   - (future) inbound message
 *   - (future) order-match settled
 *   - (future) MuSig2 signing round needs attention
 *
 * Each alert: { id, severity, title, message, action? }
 *   severity ∈ 'info' | 'warning' | 'critical'  → tints the side rail
 *   action: { label, onSelect } renders a CTA button on the alert row
 *
 * @param {object} props
 * @param {Array<{ id: string, severity: 'info' | 'warning' | 'critical', title: string, message: string, action?: { label: string, onSelect: () => void } }>} props.alerts
 * @param {() => void} props.onClose
 */
export function AlertsOverlay({ alerts, onClose }) {
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    return (
        <div
            className={styles.overlay}
            role="dialog"
            aria-modal="true"
            aria-label="Wallet alerts"
            onClick={onClose}
            tabIndex={-1}
        >
            <div className={styles.panel} onClick={(e) => e.stopPropagation()} role="presentation" tabIndex={-1}>
                <header className={styles.header}>
                    <span className={styles.title}>
                        Alerts
                        {alerts.length > 0 ? (
                            <span className={styles.count}>{alerts.length}</span>
                        ) : null}
                    </span>
                    <button
                        type="button"
                        className={styles.close}
                        onClick={onClose}
                        aria-label="Close alerts"
                    >
                        <Icon.XIcon />
                    </button>
                </header>
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
                                            onClick={() => { a.action.onSelect(); onClose(); }}
                                        >
                                            {a.action.label}
                                        </button>
                                    ) : null}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
}
