import { forwardRef, useId } from 'react';
import styles from './Input.module.css';

/**
 * Controlled text input with label, hint, and error slots. Pass-through
 * props land on the underlying `<input>` so callers can wire `value`,
 * `onChange`, `autoFocus`, `autoComplete`, etc. directly.
 *
 * @typedef {object} InputOwnProps
 * @property {string} [label]
 * @property {string} [hint]
 * @property {string} [error]
 * @property {string} [id]
 */
export const Input = forwardRef(function Input(
    { label, hint, error, id, type = 'text', ...rest },
    ref,
) {
    const autoId = useId();
    const inputId = id || autoId;
    const hintId = hint ? `${inputId}-hint` : undefined;
    const errorId = error ? `${inputId}-error` : undefined;
    const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
    const inputClass = `${styles.input} ${error ? styles.invalid : ''}`.trim();
    return (
        <div className={styles.field}>
            {label ? (
                <label htmlFor={inputId} className={styles.label}>
                    {label}
                </label>
            ) : null}
            <input
                ref={ref}
                id={inputId}
                type={type}
                className={inputClass}
                aria-invalid={error ? 'true' : undefined}
                aria-describedby={describedBy}
                {...rest}
            />
            {hint && !error ? (
                <div id={hintId} className={styles.hint}>{hint}</div>
            ) : null}
            {error ? (
                <div id={errorId} className={styles.error} role="alert">{error}</div>
            ) : null}
        </div>
    );
});
