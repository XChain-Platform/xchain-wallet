// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useId } from 'react';
import styles from './Switch.module.css';

/**
 * An independent on/off setting with a visible label and optional description.
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.label
 * @param {import('react').ReactNode} [props.description]
 * @param {boolean} props.checked
 * @param {(event: import('react').ChangeEvent<HTMLInputElement>) => void} props.onChange
 * @param {boolean} [props.disabled]
 * @param {string} [props.id]
 * @param {string} [props.className]
 */
export function Switch({
    label,
    description,
    checked,
    onChange,
    disabled = false,
    id,
    className,
    'aria-describedby': ariaDescribedBy,
    'aria-labelledby': ariaLabelledBy,
    ...inputProps
}) {
    const generatedId = useId();
    const inputId = id || `switch-${generatedId}`;
    const labelId = `${inputId}-label`;
    const descriptionId = description != null ? `${inputId}-description` : undefined;
    const describedBy = [ariaDescribedBy, descriptionId].filter(Boolean).join(' ') || undefined;
    const rootClassName = [styles.root, disabled ? styles.disabled : null, className]
        .filter(Boolean)
        .join(' ');
    const handleChange = (event) => {
        if (!disabled) onChange(event);
    };

    return (
        <label className={rootClassName} htmlFor={inputId}>
            <span className={styles.copy}>
                <span id={labelId} className={styles.label}>{label}</span>
                {description != null ? (
                    <span id={descriptionId} className={styles.description}>{description}</span>
                ) : null}
            </span>
            <span className={styles.hitArea}>
                <input
                    {...inputProps}
                    id={inputId}
                    className={styles.input}
                    type="checkbox"
                    role="switch"
                    aria-checked={checked}
                    aria-labelledby={ariaLabelledBy || labelId}
                    aria-describedby={describedBy}
                    checked={checked}
                    disabled={disabled}
                    onChange={handleChange}
                />
                <span className={styles.track} aria-hidden="true">
                    <span className={styles.thumb} />
                </span>
            </span>
        </label>
    );
}
