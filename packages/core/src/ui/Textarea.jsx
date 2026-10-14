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
 * Controlled `<textarea>` that shares Input's field/label/control styling, so a
 * multi-line field matches the rest of a form (label on its own line above,
 * full-width control below). `rows` sets the height; the box stays vertically
 * resizable. Other props pass through to the `<textarea>`.
 *
 * @typedef {object} TextareaOwnProps
 * @property {string} [label]
 * @property {string} [hint]
 * @property {string} [error]
 * @property {string} [id]
 * @property {boolean} [optional]   appends the standard "(optional)" suffix and exposes the field as optional to assistive technology.
 * @property {'md' | 'lg'} [size]   field size, matching Input.
 */
export const Textarea = forwardRef(function Textarea(
    {
        label,
        hint,
        error,
        id,
        optional = false,
        size = 'md',
        style,
        value,
        defaultValue,
        maxLength,
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
    const textareaId = id || autoId;
    const requirement = resolveFieldRequirement({
        label,
        optional,
        required,
        ariaRequired: externalRequired,
    });
    const [dismissedError, setDismissedError] = useState(null);
    const visibleError = error && error !== dismissedError ? error : null;
    const hintId = hint && !visibleError ? `${textareaId}-hint` : undefined;
    const errorId = visibleError ? `${textareaId}-error` : undefined;
    const counterId = maxLength != null ? `${textareaId}-counter` : undefined;
    const initialValue = value ?? defaultValue ?? '';
    const [uncontrolledLength, setUncontrolledLength] = useState(() => String(initialValue).length);
    const characterCount = value === undefined ? uncontrolledLength : String(value ?? '').length;
    const describedBy = [externalDescribedBy, hintId, errorId, counterId]
        .filter(Boolean).join(' ') || undefined;
    const textareaClass = [styles.input, visibleError ? styles.invalid : '', className]
        .filter(Boolean).join(' ');

    useEffect(() => {
        if (!error) setDismissedError(null);
    }, [error]);

    const handleChange = (event) => {
        setUncontrolledLength(event.currentTarget.value.length);
        if (error) setDismissedError(error);
        onChange?.(event);
    };

    return (
        <div className={`${styles.field} ${styles[size] || ''}`.trim()}>
            {label ? (
                <label htmlFor={textareaId} className={styles.label}>
                    {requirement.label}
                </label>
            ) : null}
            <textarea
                ref={ref}
                id={textareaId}
                className={textareaClass}
                aria-invalid={visibleError ? 'true' : externalInvalid}
                aria-describedby={describedBy}
                aria-required={requirement.ariaRequired}
                required={required}
                style={{ resize: 'vertical', ...style }}
                value={value}
                defaultValue={defaultValue}
                maxLength={maxLength}
                onChange={handleChange}
                {...rest}
            />
            {hint && !visibleError ? (
                <div id={hintId} className={styles.hint}>{hint}</div>
            ) : null}
            {visibleError ? (
                <div id={errorId} className={styles.error} role="alert">{visibleError}</div>
            ) : null}
            {maxLength != null ? (
                <div id={counterId} className={styles.counter} aria-live="polite">
                    {characterCount} / {maxLength}
                </div>
            ) : null}
        </div>
    );
});
