// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useId } from 'react';
import styles from './RadioGroup.module.css';

/**
 * A native, single-choice fieldset with optional supporting copy.
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.legend
 * @param {string} [props.name]
 * @param {string} props.value
 * @param {(value: string, event: import('react').ChangeEvent<HTMLInputElement>) => void} props.onChange
 * @param {Array<{ value: string, label: import('react').ReactNode, description?: import('react').ReactNode, disabled?: boolean }>} props.options
 * @param {import('react').ReactNode} [props.hint]
 * @param {import('react').ReactNode} [props.error]
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.required]
 * @param {string} [props.className]
 */
export function RadioGroup({
    legend,
    name,
    value,
    onChange,
    options,
    hint,
    error,
    disabled = false,
    required = false,
    className,
    'aria-describedby': externalDescribedBy,
    ...fieldsetProps
}) {
    const autoId = useId();
    const groupName = name || `${autoId}-radio-group`;
    const hintId = hint && !error ? `${autoId}-hint` : undefined;
    const errorId = error ? `${autoId}-error` : undefined;
    const groupDescribedBy = [externalDescribedBy, hintId, errorId]
        .filter(Boolean).join(' ') || undefined;
    const groupClassName = [
        styles.group,
        error ? styles.invalid : null,
        disabled ? styles.groupDisabled : null,
        className,
    ].filter(Boolean).join(' ');

    return (
        <fieldset
            {...fieldsetProps}
            className={groupClassName}
            disabled={disabled}
            aria-describedby={groupDescribedBy}
            aria-invalid={error ? 'true' : undefined}
        >
            <legend className={styles.legend}>{legend}</legend>
            <div className={styles.options}>
                {options.map((option, index) => {
                    const labelId = `${autoId}-label-${index}`;
                    const descriptionId = option.description
                        ? `${autoId}-description-${index}`
                        : undefined;
                    const describedBy = [descriptionId, groupDescribedBy]
                        .filter(Boolean).join(' ') || undefined;
                    const optionClassName = [
                        styles.option,
                        option.disabled ? styles.disabled : null,
                    ].filter(Boolean).join(' ');

                    return (
                        <label className={optionClassName} key={option.value}>
                            <input
                                className={styles.input}
                                type="radio"
                                name={groupName}
                                value={option.value}
                                checked={value === option.value}
                                disabled={option.disabled}
                                required={required}
                                aria-labelledby={labelId}
                                aria-describedby={describedBy}
                                aria-invalid={error ? 'true' : undefined}
                                onChange={(event) => onChange(option.value, event)}
                            />
                            <span className={styles.copy}>
                                <span className={styles.label} id={labelId}>{option.label}</span>
                                {option.description ? (
                                    <span className={styles.description} id={descriptionId}>
                                        {option.description}
                                    </span>
                                ) : null}
                            </span>
                        </label>
                    );
                })}
            </div>
            {hintId ? <div className={styles.hint} id={hintId}>{hint}</div> : null}
            {errorId ? <div className={styles.error} id={errorId} role="alert">{error}</div> : null}
        </fieldset>
    );
}
