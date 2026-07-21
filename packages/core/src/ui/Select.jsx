// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { forwardRef, useId } from 'react';
import styles from './Input.module.css';

/**
 * Controlled `<select>` that shares Input's field/label/control styling, so a
 * dropdown sits in a form looking identical to a text Input (label on its own
 * line above, full-width control below). Pass `<option>`s as children; other
 * props (`value`, `onChange`, `disabled`, …) pass through to the `<select>`.
 *
 * @typedef {object} SelectOwnProps
 * @property {string} [label]
 * @property {string} [hint]
 * @property {string} [error]
 * @property {string} [id]
 * @property {'md' | 'lg'} [size]   field size, matching Input.
 */
export const Select = forwardRef(function Select(
    { label, hint, error, id, size = 'md', children, ...rest },
    ref,
) {
    const autoId = useId();
    const selectId = id || autoId;
    const hintId = hint ? `${selectId}-hint` : undefined;
    const errorId = error ? `${selectId}-error` : undefined;
    const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
    const selectClass = `${styles.input} ${error ? styles.invalid : ''}`.trim();

    return (
        <div className={`${styles.field} ${styles[size] || ''}`.trim()}>
            {label ? (
                <label htmlFor={selectId} className={styles.label}>
                    {label}
                </label>
            ) : null}
            <select
                ref={ref}
                id={selectId}
                className={selectClass}
                aria-invalid={error ? 'true' : undefined}
                aria-describedby={describedBy}
                {...rest}
            >
                {children}
            </select>
            {hint && !error ? (
                <div id={hintId} className={styles.hint}>{hint}</div>
            ) : null}
            {error ? (
                <div id={errorId} className={styles.error} role="alert">{error}</div>
            ) : null}
        </div>
    );
});
