// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useRef } from 'react';
import { Button, Icon } from '@xchain-wallet/core/ui';
import styles from './AlertsOverlay.module.css';
import { alertSeverityPresentation } from './alertSeverity.js';
import { useBackHandler } from '../../ui/backStack.js';
import { useFocusTrap } from '../utils/focusTrap.js';

/**
 * Full-overlay alerts panel. Surfaces wallet-level notifications that
 * the user should see but that don't belong inline above the balance
 * list (where they pile up and become noise). The first inhabitants:
 *   - Older recovery phrase format (FreeWallet) → upgrade recovery phrase
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
    // The system Back gesture closes this before it leaves the screen.
    useBackHandler(onClose);
    // Tab stays inside the dialog and focus returns to whatever opened it.
    const dialogRef = useRef(null);
    useFocusTrap(dialogRef, { active: true });
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    return (
        <div
            ref={dialogRef}
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
                        /* Safari needs an explicit list role because this class removes list styling. */
                        <ul className={styles.list} role="list">
                            {alerts.map((a) => {
                                const severity = alertSeverityPresentation(a.severity);
                                return (
                                    <li key={a.id} className={`${styles.alert} ${styles[severity.kind]}`}>
                                        <div className={styles.alertHead}>
                                            <span className={styles.severity}>{severity.label}</span>
                                            <span className={styles.alertTitle}>{a.title}</span>
                                        </div>
                                        <div className={styles.alertMessage}>{a.message}</div>
                                        {a.action ? (
                                            <Button
                                                variant="primary"
                                                size="sm"
                                                icon={null}
                                                onClick={() => { a.action.onSelect(); onClose(); }}
                                                style={{ alignSelf: 'flex-start' }}
                                            >
                                                {a.action.label}
                                            </Button>
                                        ) : null}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
}
