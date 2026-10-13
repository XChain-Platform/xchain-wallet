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
import { localTimeZoneNote } from './localTimeZoneNote.js';

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
 * Date-time fields (`type="datetime-local"`) always carry a line naming the
 * device time zone the value is read in, plus the entered moment in UTC,
 * because the browser control shows no zone and every expiration and
 * deadline form parses it as local time.
 *
 * @typedef {object} InputOwnProps
 * @property {string} [label]
 * @property {string} [hint]
 * @property {string} [error]
 * @property {string} [id]
 * @property {'md' | 'lg'} [size]   field size: 'md' (36px, default) or 'lg' (48px hero field). Mirrors Button's size API.
 */
export const Input = forwardRef(function Input(
    {
        label,
        hint,
        error,
        id,
        size = 'md',
        type = 'text',
        value,
        defaultValue,
        maxLength,
        className,
        onChange,
        onKeyDown,
        onKeyUp,
        onFocus,
        onBlur,
        'aria-invalid': externalInvalid,
        'aria-describedby': externalDescribedBy,
        ...rest
    },
    ref,
) {
    const autoId = useId();
    const inputId = id || autoId;
    const [dismissedError, setDismissedError] = useState(null);
    const visibleError = error && error !== dismissedError ? error : null;
    const hintId = hint && !visibleError ? `${inputId}-hint` : undefined;
    const errorId = visibleError ? `${inputId}-error` : undefined;
    const capsLockId = `${inputId}-capslock`;
    const isDateTime = type === 'datetime-local';
    const zoneId = isDateTime ? `${inputId}-zone` : undefined;
    const counterId = maxLength != null ? `${inputId}-counter` : undefined;
    const initialValue = value ?? defaultValue ?? '';
    const [uncontrolledLength, setUncontrolledLength] = useState(() => String(initialValue).length);
    const characterCount = value === undefined ? uncontrolledLength : String(value ?? '').length;

    const isPassword = type === 'password';
    const [capsLockOn, setCapsLockOn] = useState(false);
    const [focused, setFocused] = useState(false);
    const showCapsLock = isPassword && focused && capsLockOn;

    const describedBy = [
        externalDescribedBy,
        hintId,
        errorId,
        zoneId,
        counterId,
        showCapsLock ? capsLockId : undefined,
    ].filter(Boolean).join(' ') || undefined;
    const inputClass = [styles.input, visibleError ? styles.invalid : '', className]
        .filter(Boolean).join(' ');

    useEffect(() => {
        if (!error) setDismissedError(null);
    }, [error]);

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
    const handleChange = (event) => {
        setUncontrolledLength(event.currentTarget.value.length);
        if (error) setDismissedError(error);
        onChange?.(event);
    };

    return (
        <div className={`${styles.field} ${styles[size] || ''}`.trim()}>
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
                aria-invalid={visibleError ? 'true' : externalInvalid}
                aria-describedby={describedBy}
                value={value}
                defaultValue={defaultValue}
                maxLength={maxLength}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                onKeyUp={handleKeyUp}
                onFocus={handleFocus}
                onBlur={handleBlur}
                {...rest}
            />
            {hint && !visibleError ? (
                <div id={hintId} className={styles.hint}>{hint}</div>
            ) : null}
            {isDateTime ? (
                <div id={zoneId} className={styles.hint}>{localTimeZoneNote(value)}</div>
            ) : null}
            {visibleError ? (
                <div id={errorId} className={styles.error} role="alert">{visibleError}</div>
            ) : null}
            {maxLength != null ? (
                <div id={counterId} className={styles.counter} aria-live="polite">
                    {characterCount} / {maxLength}
                </div>
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
