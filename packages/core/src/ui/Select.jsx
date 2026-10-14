// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { forwardRef, useEffect, useId, useState } from 'react';
import styles from './Input.module.css';
import { resolveFieldRequirement } from './fieldRequirement.js';

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
 * @property {boolean} [optional]   appends the standard "(optional)" suffix and exposes the field as optional to assistive technology.
 * @property {'sm' | 'md' | 'lg'} [size] field size, matching Input.
 */
export const Select = forwardRef(function Select(
    {
        label,
        hint,
        error,
        id,
        optional = false,
        size = 'md',
        children,
        className,
        onChange,
        required = false,
        'aria-invalid': externalInvalid,
        'aria-describedby': externalDescribedBy,
        'aria-required': externalRequired,
        ...rest
    },
    ref,
) {
    const autoId = useId();
    const selectId = id || autoId;
    const requirement = resolveFieldRequirement({
        label,
        optional,
        required,
        ariaRequired: externalRequired,
    });
    const [dismissedError, setDismissedError] = useState(null);
    const visibleError = error && error !== dismissedError ? error : null;
    const hintId = hint && !visibleError ? `${selectId}-hint` : undefined;
    const errorId = visibleError ? `${selectId}-error` : undefined;
    const describedBy = [externalDescribedBy, hintId, errorId]
        .filter(Boolean).join(' ') || undefined;
    const selectClass = [styles.input, visibleError ? styles.invalid : '', className]
        .filter(Boolean).join(' ');

    useEffect(() => {
        if (!error) setDismissedError(null);
    }, [error]);

    const handleChange = (event) => {
        if (error) setDismissedError(error);
        onChange?.(event);
    };

    return (
        <div className={`${styles.field} ${styles[size] || ''}`.trim()}>
            {label ? (
                <label htmlFor={selectId} className={styles.label}>
                    {requirement.label}
                </label>
            ) : null}
            <div className={styles.controlHitArea} onPointerDown={activateControlHitArea}>
                <select
                    ref={ref}
                    id={selectId}
                    className={selectClass}
                    aria-invalid={visibleError ? 'true' : externalInvalid}
                    aria-describedby={describedBy}
                    aria-required={requirement.ariaRequired}
                    required={required}
                    onChange={handleChange}
                    {...rest}
                >
                    {children}
                </select>
            </div>
            {hint && !visibleError ? (
                <div id={hintId} className={styles.hint}>{hint}</div>
            ) : null}
            {visibleError ? (
                <div id={errorId} className={styles.error} role="alert">{visibleError}</div>
            ) : null}
        </div>
    );
});

function activateControlHitArea(event) {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    const control = event.currentTarget.firstElementChild;
    control?.focus();
    control?.click();
}
