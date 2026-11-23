// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { forwardRef, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ClearFieldButton, clearControlValue } from './ClearFieldButton.jsx';
import { InfoTip } from './InfoTip.jsx';
import styles from './Input.module.css';
import { fieldHelpName, resolveFieldRequirement } from './fieldRequirement.js';
import { OptionalPill } from './OptionalPill.jsx';
import { fitAutoGrow } from './textareaAutoGrow.js';
import { useFormFieldError } from './formErrors.js';
import { t } from '../i18n/index.js';
import '../i18n/locales/en/ui.js';

/**
 * Controlled `<textarea>` that shares Input's field/label/control styling, so a
 * multi-line field matches the rest of a form (label on its own line above,
 * full-width control below). `rows` sets the height; the box stays vertically
 * resizable. Other props pass through to the `<textarea>`.
 *
 * @typedef {object} TextareaOwnProps
 * @property {string} [label]
 * @property {import('react').ReactNode} [help] contextual help shown from the label-row InfoTip.
 * @property {string} [hint]
 * @property {string} [error]
 * @property {string | number} [errorKey]
 * @property {import('react').ReactNode} [counter] custom counter content shown
 *   in the label-row counter slot instead of the `maxLength` character count.
 * @property {string} [id]
 * @property {boolean} [optional]   shows the shared Optional pill and exposes the field as optional to assistive technology.
 * @property {'md' | 'lg'} [size]   field size, matching Input.
 * @property {import('react').ReactNode} [actions]  small buttons (Paste, Scan QR)
 *   drawn inside the box at its bottom end corner. The box reserves a strip
 *   under the text for them and grows with its content instead of scrolling,
 *   so typed text never runs underneath; the resize grip they would cover is
 *   turned off.
 * @property {import('react').ReactNode} [fieldAction] one small control drawn
 *   inside the field at its trailing edge, aligned with the first text line.
 * @property {boolean} [clearable] draws a small X inside the field at its
 *   trailing edge, shown only while the field has text, named "Clear <label>".
 * @property {() => void} [onClear] what the X does; by default it empties the
 *   field through an ordinary change event.
 * @property {boolean} [autoGrow]  one line (an Input's height) by default,
 *   growing with the text up to `maxRows` lines, then scrolling inside.
 * @property {number} [maxRows]    the auto-grow cap, default 3.
 */
export const Textarea = /* @__PURE__ */ forwardRef(function Textarea(
    {
        label,
        help,
        hint,
        error: errorProp,
        errorKey: errorKeyProp,
        counter: customCounter,
        // A host that shows the count elsewhere (a section header)
        // keeps maxLength's cap without the field's own count.
        hideCounter = false,
        id,
        optional = false,
        size = 'md',
        style,
        value,
        defaultValue,
        maxLength,
        className,
        onChange,
        actions,
        fieldAction,
        clearable = false,
        onClear,
        autoGrow = false,
        maxRows = 3,
        rows,
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
    // The form error standard: this field's entry in the form's error map,
    // dropped on change; an `error` the caller passes wins.
    const formField = useFormFieldError(id);
    const error = errorProp || formField.error;
    const errorKey = errorProp ? errorKeyProp : formField.errorKey;
    const requirement = resolveFieldRequirement({
        label,
        optional,
        required,
        ariaRequired: externalRequired,
    });
    const [dismissedError, setDismissedError] = useState(null);
    const errorIsDismissed = dismissedError !== null && dismissedError.message === error
        && Object.is(dismissedError.key, errorKey);
    const visibleError = error && !errorIsDismissed ? error : null;
    const hintId = hint && !visibleError ? `${textareaId}-hint` : undefined;
    const errorId = visibleError ? `${textareaId}-error` : undefined;
    const optionalPillId = requirement.isOptional ? `${textareaId}-optional` : undefined;
    const hasCustomCounter = customCounter != null && customCounter !== false;
    // A hidden counter is never drawn, so the field must not point at it.
    const counterId = !hideCounter && (hasCustomCounter || maxLength != null) ? `${textareaId}-counter` : undefined;
    const initialValue = value ?? defaultValue ?? '';
    const [uncontrolledLength, setUncontrolledLength] = useState(() => String(initialValue).length);
    const characterCount = value === undefined ? uncontrolledLength : String(value ?? '').length;
    const describedBy = [externalDescribedBy, optionalPillId, hintId, errorId, counterId]
        .filter(Boolean).join(' ') || undefined;
    const hasActions = actions != null && actions !== false;
    const showClear = clearable && characterCount > 0 && !rest.disabled && !rest.readOnly;
    const hasFieldAction = showClear || (fieldAction != null && fieldAction !== false);
    const hasHelp = Boolean(label && help);
    // Actions already grow the box without a cap; autoGrow is the capped one.
    const growing = autoGrow && !hasActions;
    const textareaClass = [
        styles.input,
        hasActions ? styles.textareaWithActions : '',
        growing ? styles.textareaAutoGrow : '',
        hasFieldAction ? styles.inputWithFieldAction : '',
        visibleError ? styles.invalid : '',
        className,
    ].filter(Boolean).join(' ');
    const innerRef = useRef(/** @type {HTMLTextAreaElement | null} */ (null));
    const setRefs = useCallback((node) => {
        innerRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
    }, [ref]);

    // The reserved strip only keeps text clear of the actions while the box
    // never scrolls, so a box with actions grows to fit its content; `rows`
    // stays the floor. Runs after every render so programmatic value changes
    // (Paste, a scan, a dropped file) resize it too.
    const fitToContent = useCallback(() => {
        const node = innerRef.current;
        if (!node) return;
        node.style.height = 'auto';
        const borders = Math.max(0, node.offsetHeight - node.clientHeight);
        node.style.height = `${node.scrollHeight + borders}px`;
    }, []);
    useLayoutEffect(() => {
        if (hasActions) fitToContent();
        else if (growing) fitAutoGrow(innerRef.current, maxRows);
    });
    // An auto-growing box refits when its width changes: a rotation, a
    // resize, or a closed section opening (zero width until it shows).
    useEffect(() => {
        const node = innerRef.current;
        if (!growing || !node || typeof ResizeObserver !== 'function') return undefined;
        let width = node.clientWidth;
        const observer = new ResizeObserver(() => {
            if (node.clientWidth === width) return;
            width = node.clientWidth;
            fitAutoGrow(node, maxRows);
        });
        observer.observe(node);
        return () => observer.disconnect();
    }, [growing, maxRows]);
    // A width change (rotation, window resize) or a late web font rewraps
    // the text, so the fitted height is recomputed then too.
    useEffect(() => {
        if (!hasActions || typeof window === 'undefined') return undefined;
        let live = true;
        window.addEventListener('resize', fitToContent);
        globalThis.document?.fonts?.ready?.then(() => { if (live) fitToContent(); }, () => {});
        return () => {
            live = false;
            window.removeEventListener('resize', fitToContent);
        };
    }, [hasActions, fitToContent]);

    useEffect(() => {
        if (!error) setDismissedError(null);
    }, [error]);

    const handleChange = (event) => {
        setUncontrolledLength(event.currentTarget.value.length);
        if (error) setDismissedError({ message: error, key: errorKey });
        formField.clear();
        onChange?.(event);
    };

    const control = (
        <textarea
            ref={setRefs}
            id={textareaId}
            className={textareaClass}
            aria-invalid={visibleError ? 'true' : externalInvalid}
            aria-describedby={describedBy}
            aria-required={requirement.ariaRequired}
            required={required}
            style={{ resize: hasActions || growing ? 'none' : 'vertical', ...style }}
            rows={rows ?? (growing ? 1 : undefined)}
            value={value}
            defaultValue={defaultValue}
            maxLength={maxLength}
            onChange={handleChange}
            {...rest}
        />
    );
    const counter = !hideCounter && (hasCustomCounter || maxLength != null) ? (
        <div id={counterId} className={styles.counter} aria-live="polite">
            {hasCustomCounter ? customCounter : <>{characterCount} / {maxLength}</>}
        </div>
    ) : null;

    return (
        <div className={`${styles.field} ${styles[size] || ''}`.trim()}>
            {label && (requirement.isOptional || hasHelp || counter) ? (
                <div className={styles.labelRow}>
                    <label htmlFor={textareaId} className={styles.label}>
                        {requirement.label}
                    </label>
                    {hasHelp ? (
                        <InfoTip
                            className={styles.labelHelp}
                            label={help}
                            aria={t('ui.field.about', { label: fieldHelpName(requirement.label, rest['aria-label']) })}
                        />
                    ) : null}
                    {/* The ? help comes first, then the Optional tag. */}
                    {requirement.isOptional ? <OptionalPill id={optionalPillId} /> : null}
                    {counter}
                </div>
            ) : label ? (
                <label htmlFor={textareaId} className={styles.label}>
                    {requirement.label}
                </label>
            ) : null}
            {hasActions || hasFieldAction || clearable ? (
                <div className={styles.textareaControl}>
                    {control}
                    {hasFieldAction ? (
                        <div className={`${styles.controlActions} ${styles.textareaFieldAction}`}>
                            {fieldAction}
                            {showClear ? (
                                <ClearFieldButton
                                    label={typeof rest['aria-label'] === 'string' ? rest['aria-label'] : label}
                                    onClear={() => (onClear ? onClear() : clearControlValue(innerRef.current))}
                                />
                            ) : null}
                        </div>
                    ) : null}
                    {hasActions ? <div className={styles.textareaActions}>{actions}</div> : null}
                </div>
            ) : control}
            {hint && !visibleError ? (
                <div id={hintId} className={styles.hint}>{hint}</div>
            ) : null}
            {visibleError ? (
                <div id={errorId} className={styles.error} role="alert">{visibleError}</div>
            ) : null}
            {!label ? counter : null}
        </div>
    );
});
