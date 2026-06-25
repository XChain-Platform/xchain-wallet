// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { forwardRef, useId } from 'react';
import styles from './Input.module.css';

/**
 * Controlled `<textarea>` that shares Input's field/label/control styling, so a
 * multi-line field matches the rest of a form (label on its own line above,
 * full-width control below). `rows` sets the height; the box stays vertically
 * resizable. Other props pass through to the `<textarea>`.
 *
 * @typedef {object} TextareaOwnProps
 * @property {string} [label]
 * @property {string} [hint]
 * @property {string} [error]
 * @property {string} [id]
 */
export const Textarea = forwardRef(function Textarea(
    { label, hint, error, id, style, ...rest },
    ref,
) {
    const autoId = useId();
    const textareaId = id || autoId;
    const hintId = hint ? `${textareaId}-hint` : undefined;
    const errorId = error ? `${textareaId}-error` : undefined;
    const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
    const textareaClass = `${styles.input} ${error ? styles.invalid : ''}`.trim();

    return (
        <div className={styles.field}>
            {label ? (
                <label htmlFor={textareaId} className={styles.label}>
                    {label}
                </label>
            ) : null}
            <textarea
                ref={ref}
                id={textareaId}
                className={textareaClass}
                aria-invalid={error ? 'true' : undefined}
                aria-describedby={describedBy}
                style={{ resize: 'vertical', ...style }}
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
