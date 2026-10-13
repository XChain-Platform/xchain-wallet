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
 * deadline form parses it as local time. Date, date-time, and time fields
 * retain their native picker and report required, malformed, min, max, and
 * step validity errors through the same accessible error slot.
 *
 * @typedef {object} InputOwnProps
 * @property {string} [label]
 * @property {string} [hint]
 * @property {string} [error]
 * @property {string | number} [errorKey]
 * @property {string} [id]
 * @property {boolean} [optional]   appends the standard "(optional)" suffix and exposes the field as optional to assistive technology.
 * @property {'md' | 'lg'} [size]   field size: 'md' (36px, default) or 'lg' (48px hero field). Mirrors Button's size API.
 */
export const Input = forwardRef(function Input(
    {
        label,
        hint,
        error,
        errorKey,
        id,
        optional = false,
        size = 'md',
        type = 'text',
        value,
        defaultValue,
        maxLength,
        className,
        onChange,
        autoCapitalize = 'off',
        autoCorrect = 'off',
        spellCheck = false,
        inputMode,
        dir,
        enterKeyHint,
        onKeyDown,
        onKeyUp,
        onFocus,
        onBlur,
        required = false,
        onInvalid,
        'aria-invalid': externalInvalid,
        'aria-describedby': externalDescribedBy,
        'aria-required': externalRequired,
        ...rest
    },
    ref,
) {
    const autoId = useId();
    const inputId = id || autoId;
    const requirement = resolveFieldRequirement({
        label,
        optional,
        required,
        ariaRequired: externalRequired,
    });
    const [dismissedError, setDismissedError] = useState(null);
    const errorIsDismissed = dismissedError !== null && dismissedError.message === error
        && Object.is(dismissedError.key, errorKey);
    const isDateOrTime = type === 'date' || type === 'datetime-local' || type === 'time';
    const [dateError, setDateError] = useState(null);
    const callerError = error && !errorIsDismissed ? error : null;
    const visibleError = dateError || callerError;
    const hintId = hint && !visibleError ? `${inputId}-hint` : undefined;
    const errorId = visibleError ? `${inputId}-error` : undefined;
    const capsLockId = `${inputId}-capslock`;
    const isDateTime = type === 'datetime-local';
    const zoneId = isDateTime ? `${inputId}-zone` : undefined;
    const counterId = maxLength != null ? `${inputId}-counter` : undefined;
    const initialValue = value ?? defaultValue ?? '';
    const [uncontrolledLength, setUncontrolledLength] = useState(() => String(initialValue).length);
    const characterCount = value === undefined ? uncontrolledLength : String(value ?? '').length;
    const resolvedInputMode = inputMode ?? ({
        email: 'email',
        number: 'decimal',
        search: 'search',
        tel: 'tel',
        url: 'url',
    }[type]);
    const resolvedEnterKeyHint = enterKeyHint || (type === 'search' ? 'search' : 'done');
    const resolvedDir = dir || (resolvedInputMode === 'decimal' || resolvedInputMode === 'numeric'
        ? 'ltr'
        : undefined);

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
        if (isDateOrTime) setDateError(dateValidationMessage(event.currentTarget));
        onBlur?.(event);
    };
    const handleChange = (event) => {
        setUncontrolledLength(event.currentTarget.value.length);
        if (isDateOrTime) setDateError(null);
        if (error) setDismissedError({ message: error, key: errorKey });
        onChange?.(event);
    };
    const handleInvalid = (event) => {
        if (isDateOrTime) {
            setDateError(dateValidationMessage(event.currentTarget));
            event.preventDefault();
        }
        onInvalid?.(event);
    };

    return (
        <div className={`${styles.field} ${styles[size] || ''}`.trim()}>
            {label ? (
                <label htmlFor={inputId} className={styles.label}>
                    {requirement.label}
                </label>
            ) : null}
            <input
                ref={ref}
                id={inputId}
                type={type}
                autoCapitalize={autoCapitalize}
                autoCorrect={autoCorrect}
                spellCheck={spellCheck}
                inputMode={resolvedInputMode}
                dir={resolvedDir}
                enterKeyHint={resolvedEnterKeyHint}
                className={inputClass}
                aria-invalid={visibleError ? 'true' : externalInvalid}
                aria-describedby={describedBy}
                aria-required={requirement.ariaRequired}
                required={required}
                value={value}
                defaultValue={defaultValue}
                maxLength={maxLength}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                onKeyUp={handleKeyUp}
                onFocus={handleFocus}
                onBlur={handleBlur}
                onInvalid={handleInvalid}
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

function dateValidationMessage(input) {
    const { validity, type } = input;
    if (!validity || validity.valid) return null;

    const valueName = type === 'time' ? 'time' : type === 'date' ? 'date' : 'date and time';
    if (validity.valueMissing) return `Choose a ${valueName}.`;
    if (validity.badInput || validity.typeMismatch) return `Enter a complete, valid ${valueName}.`;
    if (validity.rangeUnderflow) {
        return `Choose a ${valueName} on or after ${readableDateConstraint(input.min)}.`;
    }
    if (validity.rangeOverflow) {
        return `Choose a ${valueName} on or before ${readableDateConstraint(input.max)}.`;
    }
    if (validity.stepMismatch) return `Choose a ${valueName} that matches the allowed interval.`;
    return `Enter a valid ${valueName}.`;
}

function readableDateConstraint(value) {
    return String(value || '').replace('T', ' at ');
}
