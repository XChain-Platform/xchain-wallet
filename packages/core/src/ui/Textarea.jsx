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
import { InfoTip } from './InfoTip.jsx';
import styles from './Input.module.css';
import { fieldHelpName, resolveFieldRequirement } from './fieldRequirement.js';
import { OptionalPill } from './OptionalPill.jsx';
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
 */
export const Textarea = /* @__PURE__ */ forwardRef(function Textarea(
    {
        label,
        help,
        hint,
        error,
        counter: customCounter,
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
    const optionalPillId = requirement.isOptional ? `${textareaId}-optional` : undefined;
    const hasCustomCounter = customCounter != null && customCounter !== false;
    const counterId = hasCustomCounter || maxLength != null ? `${textareaId}-counter` : undefined;
    const initialValue = value ?? defaultValue ?? '';
    const [uncontrolledLength, setUncontrolledLength] = useState(() => String(initialValue).length);
    const characterCount = value === undefined ? uncontrolledLength : String(value ?? '').length;
    const describedBy = [externalDescribedBy, optionalPillId, hintId, errorId, counterId]
        .filter(Boolean).join(' ') || undefined;
    const hasActions = actions != null && actions !== false;
    const hasFieldAction = fieldAction != null && fieldAction !== false;
    const hasHelp = Boolean(label && help);
    const textareaClass = [
        styles.input,
        hasActions ? styles.textareaWithActions : '',
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
    });
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
        if (error) setDismissedError(error);
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
            style={{ resize: hasActions ? 'none' : 'vertical', ...style }}
            value={value}
            defaultValue={defaultValue}
            maxLength={maxLength}
            onChange={handleChange}
            {...rest}
        />
    );
    const counter = hasCustomCounter || maxLength != null ? (
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
                    {requirement.isOptional ? <OptionalPill id={optionalPillId} /> : null}
                    {hasHelp ? (
                        <InfoTip
                            className={styles.labelHelp}
                            label={help}
                            aria={t('ui.field.about', { label: fieldHelpName(requirement.label, rest['aria-label']) })}
                        />
                    ) : null}
                    {counter}
                </div>
            ) : label ? (
                <label htmlFor={textareaId} className={styles.label}>
                    {requirement.label}
                </label>
            ) : null}
            {hasActions || hasFieldAction ? (
                <div className={styles.textareaControl}>
                    {control}
                    {hasFieldAction ? (
                        <div className={`${styles.controlActions} ${styles.textareaFieldAction}`}>
                            {fieldAction}
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
