import { forwardRef, useId, useState } from 'react';
import styles from './Input.module.css';

/**
 * Controlled text input with label, hint, and error slots. Pass-through
 * props land on the underlying `<input>` so callers can wire `value`,
 * `onChange`, `autoFocus`, `autoComplete`, etc. directly.
 *
 * Password fields render an inline Caps-Lock warning when the modifier
 * is on (§26 / G067). Detection runs only for `type="password"`; other
 * inputs see no behavior change. Caller-provided `onKeyDown` / `onKeyUp`
 * / `onFocus` / `onBlur` handlers are chained, never replaced.
 *
 * @typedef {object} InputOwnProps
 * @property {string} [label]
 * @property {string} [hint]
 * @property {string} [error]
 * @property {string} [id]
 */
export const Input = forwardRef(function Input(
    { label, hint, error, id, type = 'text', onKeyDown, onKeyUp, onFocus, onBlur, ...rest },
    ref,
) {
    const autoId = useId();
    const inputId = id || autoId;
    const hintId = hint ? `${inputId}-hint` : undefined;
    const errorId = error ? `${inputId}-error` : undefined;
    const capsLockId = `${inputId}-capslock`;

    const isPassword = type === 'password';
    const [capsLockOn, setCapsLockOn] = useState(false);
    const [focused, setFocused] = useState(false);
    const showCapsLock = isPassword && focused && capsLockOn;

    const describedBy = [
        hintId,
        errorId,
        showCapsLock ? capsLockId : undefined,
    ].filter(Boolean).join(' ') || undefined;
    const inputClass = `${styles.input} ${error ? styles.invalid : ''}`.trim();

    const readCapsLock = (event) => {
        if (!isPassword) return;
        if (typeof event.getModifierState !== 'function') return;
        setCapsLockOn(event.getModifierState('CapsLock'));
    };

    const handleKeyDown = (event) => {
        readCapsLock(event);
        onKeyDown?.(event);
    };
    const handleKeyUp = (event) => {
        readCapsLock(event);
        onKeyUp?.(event);
    };
    const handleFocus = (event) => {
        if (isPassword) {
            setFocused(true);
            readCapsLock(event);
        }
        onFocus?.(event);
    };
    const handleBlur = (event) => {
        if (isPassword) setFocused(false);
        onBlur?.(event);
    };

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
                onKeyDown={handleKeyDown}
                onKeyUp={handleKeyUp}
                onFocus={handleFocus}
                onBlur={handleBlur}
                {...rest}
            />
            {hint && !error ? (
                <div id={hintId} className={styles.hint}>{hint}</div>
            ) : null}
            {error ? (
                <div id={errorId} className={styles.error} role="alert">{error}</div>
            ) : null}
            {showCapsLock ? (
                <div
                    id={capsLockId}
                    className={styles.capsLock}
                    role="status"
                    aria-live="polite"
                >
                    Caps Lock is on
                </div>
            ) : null}
        </div>
    );
});
