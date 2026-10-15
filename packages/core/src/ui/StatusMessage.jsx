// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import styles from './StatusMessage.module.css';
import { t } from '../i18n/index.js';

/**
 * §53.3 / G169: shared info / warning / error / success row that every form can
 * use in place of an unannounced `<p>` or `<div>`. Picks the right
 * `role` + `aria-live` per variant so screen readers announce the
 * message exactly once when it appears.
 *
 *   variant="status"   role="status" aria-live="polite"  (alias for informational copy)
 *   variant="info"     role="status" aria-live="polite"  (informational copy)
 *   variant="warning"  role="status" aria-live="polite"  (caution / degraded state)
 *   variant="error"    role="alert"  aria-live="assertive" (validation failure / runtime error)
 *   variant="success"  role="status" aria-live="polite"  (confirmation copy after a successful action)
 *
 * Renders nothing when `children` is empty, so callers can mount the
 * component conditionally inside an effect-driven flow without an
 * extra null branch.
 *
 * §37 / G121: `recovery` slot lets a caller surface a one-click fix
 * inline with the error message (e.g. "Insufficient balance? Use Max",
 * "Backup file missing? Browse"). The button shares the message
 * row's aria-live region so the recovery affordance is announced
 * together with the diagnostic.
 *
 * @param {object} props
 * @param {'status' | 'info' | 'warning' | 'error' | 'success'} [props.variant]   default 'status'
 * @param {string} [props.id]
 * @param {import('react').ReactNode} props.children
 * @param {string} [props.className]                          appended after the variant class so callers can space-suffix layout adjustments
 * @param {string} [props.details]                            technical text shown only in a collapsed disclosure
 * @param {{ label: string, onAction: () => void | Promise<void>, ariaLabel?: string }} [props.recovery]   one-click fix shown inline with the message
 * @param {'alert' | 'status' | 'note' | null} [props.role]   overrides the tone's role: a warning that must interrupt passes 'alert', a
 *   message that is part of the page from the first paint passes null so it is not a live region at all
 * @param {string} [props.testId]                             data-testid for tests that find the message by hook
 *
 * Children may be several block elements (one `<p>` per line of a multi-line
 * warning, or a `<ul>`): they stay one box and one announcement.
 */
export function StatusMessage({ variant = 'status', id, children, className, details, recovery, role: roleOverride, testId }) {
    if (children === null || children === undefined || children === '') return null;
    const presentation = STATUS_PRESENTATION[variant] || STATUS_PRESENTATION.status;
    const role = roleOverride === undefined
        ? (presentation.tone === 'error' ? 'alert' : 'status')
        : roleOverride || undefined;
    const live = role === 'alert' ? 'assertive' : role === 'status' ? 'polite' : undefined;
    const variantClass = styles[presentation.tone];
    const classNames = [styles.row, variantClass, className].filter(Boolean).join(' ');
    return (
        <div
            role={role}
            aria-live={live}
            aria-atomic={live ? 'true' : undefined}
            id={id}
            className={classNames}
            data-variant={presentation.tone}
            data-testid={testId}
        >
            <span className={styles.icon} aria-hidden="true">{presentation.icon}</span>
            <div className={styles.text}>
                <div className={styles.body}>{children}</div>
                {details ? (
                    <details className={styles.details}>
                        <summary>{t('pending.detail.technicalDetails')}</summary>
                        <code>{details}</code>
                    </details>
                ) : null}
            </div>
            {recovery && recovery.label && typeof recovery.onAction === 'function' ? (
                <button
                    type="button"
                    className={styles.recovery}
                    aria-label={recovery.ariaLabel || recovery.label}
                    onClick={() => {
                        Promise.resolve(recovery.onAction()).catch(() => {
                            /* swallow; caller surfaces its own follow-up */
                        });
                    }}
                >
                    {recovery.label}
                </button>
            ) : null}
        </div>
    );
}

const STATUS_PRESENTATION = {
    status: { tone: 'info', icon: 'ℹ' },
    info: { tone: 'info', icon: 'ℹ' },
    warning: { tone: 'warning', icon: '⚠' },
    error: { tone: 'error', icon: '✕' },
    success: { tone: 'success', icon: '✓' },
};
