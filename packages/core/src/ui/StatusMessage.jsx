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

/**
 * §53.3 / G169: shared status / error / success row that every form can
 * use in place of an unannounced `<p>` or `<div>`. Picks the right
 * `role` + `aria-live` per variant so screen readers announce the
 * message exactly once when it appears.
 *
 *   variant="status"   role="status" aria-live="polite"  (neutral progress / informational copy)
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
 * @param {'status' | 'error' | 'success'} [props.variant]   default 'status'
 * @param {string} [props.id]
 * @param {import('react').ReactNode} props.children
 * @param {string} [props.className]                          appended after the variant class so callers can space-suffix layout adjustments
 * @param {{ label: string, onAction: () => void | Promise<void>, ariaLabel?: string }} [props.recovery]   one-click fix shown inline with the message
 */
export function StatusMessage({ variant = 'status', id, children, className, recovery }) {
    if (children === null || children === undefined || children === '') return null;
    const role = variant === 'error' ? 'alert' : 'status';
    const live = variant === 'error' ? 'assertive' : 'polite';
    const variantClass = variant === 'error'
        ? styles.error
        : variant === 'success'
            ? styles.success
            : styles.status;
    const classNames = [styles.row, variantClass, className].filter(Boolean).join(' ');
    return (
        <div role={role} aria-live={live} id={id} className={classNames}>
            <span className={styles.text}>{children}</span>
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
