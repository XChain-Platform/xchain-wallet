// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { forwardRef, useCallback, useId } from 'react';
import styles from './Checkbox.module.css';

/**
 * A native checkbox with a token-styled box and a label-wide touch target.
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.label
 * @param {import('react').ReactNode} [props.description]
 * @param {import('react').ReactNode} [props.error]
 * @param {boolean} [props.indeterminate]
 * @param {string} [props.className]
 */
export const Checkbox = forwardRef(function Checkbox(
    {
        label,
        description,
        error,
        indeterminate = false,
        className,
        id,
        disabled = false,
        'aria-describedby': externalDescribedBy,
        'aria-invalid': externalInvalid,
        'aria-labelledby': externalLabelledBy,
        ...inputProps
    },
    forwardedRef,
) {
    const autoId = useId();
    const inputId = id || autoId;
    const labelId = `${inputId}-label`;
    const descriptionId = description ? `${inputId}-description` : undefined;
    const errorId = error ? `${inputId}-error` : undefined;
    const describedBy = [externalDescribedBy, descriptionId, errorId]
        .filter(Boolean).join(' ') || undefined;
    const invalid = Boolean(error) || externalInvalid === true || externalInvalid === 'true';
    const classes = [
        styles.root,
        disabled ? styles.disabled : null,
        invalid ? styles.invalid : null,
        className,
    ].filter(Boolean).join(' ');

    const setInputRef = useCallback((node) => {
        if (node) node.indeterminate = indeterminate;
        if (typeof forwardedRef === 'function') forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
    }, [forwardedRef, indeterminate]);

    return (
        <label className={classes} htmlFor={inputId}>
            <input
                {...inputProps}
                ref={setInputRef}
                id={inputId}
                className={styles.input}
                type="checkbox"
                disabled={disabled}
                aria-checked={indeterminate ? 'mixed' : undefined}
                aria-describedby={describedBy}
                aria-invalid={invalid ? 'true' : externalInvalid}
                aria-labelledby={externalLabelledBy || labelId}
            />
            <span className={styles.box} aria-hidden="true" />
            <span className={styles.content}>
                <span id={labelId} className={styles.label}>{label}</span>
                {description ? (
                    <span id={descriptionId} className={styles.description}>{description}</span>
                ) : null}
                {error ? (
                    <span id={errorId} className={styles.error} role="alert">{error}</span>
                ) : null}
            </span>
        </label>
    );
});
