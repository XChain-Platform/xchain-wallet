// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import styles from './ChoiceControl.module.css';

/**
 * A token-sized checkbox or radio with a label-wide pointer target.
 *
 * @param {object} props
 * @param {'checkbox' | 'radio'} [props.type]
 * @param {string} [props.className]
 * @param {boolean} [props.disabled]
 * @param {import('react').ReactNode} props.children
 */
export function ChoiceControl({
    type = 'checkbox',
    className,
    disabled = false,
    children,
    ...inputProps
}) {
    const classes = [
        styles.control,
        disabled ? styles.disabled : null,
        className,
    ].filter(Boolean).join(' ');

    return (
        <label className={classes}>
            <input
                {...inputProps}
                className={styles.input}
                type={type}
                disabled={disabled}
            />
            <span className={styles.label}>{children}</span>
        </label>
    );
}
