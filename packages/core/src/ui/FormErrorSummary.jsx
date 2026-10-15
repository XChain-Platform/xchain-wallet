// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useMemo, useRef } from 'react';
import styles from './FormErrorSummary.module.css';
import statusStyles from './StatusMessage.module.css';
import { t } from '../i18n/index.js';

/**
 * True when the field label adds something to the message. A message that
 * already opens with the label ("Password must be at least 8 characters.")
 * would otherwise read "Password: Password must be...".
 *
 * @param {{ label?: string, message: string }} error
 */
function showsLabel(error) {
    const label = String(error.label || '').trim().toLowerCase();
    if (!label) return false;
    const message = String(error.message || '').trim().toLowerCase();
    // "Word 5" opens "Word 5 does not match" but not "Word 50 does not match".
    return !(message.startsWith(label) && !/^[\p{L}\p{N}]/u.test(message.slice(label.length)));
}

/**
 * Focusable validation summary. Every field-specific error is a link so the
 * user can move directly from the summary to the control that needs attention.
 *
 * @param {object} props
 * @param {{ id?: string, label?: string, message: string }[]} props.errors
 * @param {string | number} props.focusKey submit-attempt key; zero or empty keeps the summary hidden.
 * @param {{ label: string, onAction: () => void | Promise<void> }} [props.recovery]
 */
export function FormErrorSummary({ errors, focusKey, recovery }) {
    const summaryRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    const signature = useMemo(
        () => errors.map((error) => `${error.id || ''}:${error.message}`).join('|'),
        [errors],
    );

    useEffect(() => {
        if (errors.length > 0) summaryRef.current?.focus();
    }, [signature, focusKey, errors.length]);

    if (!focusKey || errors.length === 0) return null;

    const focusField = (event, id) => {
        event.preventDefault();
        const field = document.getElementById(id);
        field?.focus();
        field?.scrollIntoView?.({ block: 'center' });
    };

    return (
        <div
            ref={summaryRef}
            role="alert"
            tabIndex={-1}
            aria-label={t('ui.formErrorSummary.formErrors')}
            className={`${statusStyles.row} ${statusStyles.error}`}
            data-variant="error"
        >
            <span className={statusStyles.icon} aria-hidden="true">✕</span>
            <div className={statusStyles.text}>
                <p className={styles.heading}>
                    {errors.length === 1 ? t('ui.formErrorSummary.fixThisField') : t('ui.formErrorSummary.fixTheseFields', { length: errors.length })}
                </p>
                <ul className={styles.list}>
                    {errors.map((error, index) => (
                        <li key={`${error.id || 'form'}-${index}`}>
                            {error.id ? (
                                <a
                                    href={`#${error.id}`}
                                    onClick={(event) => focusField(event, error.id)}
                                    className={styles.link}
                                >
                                    {showsLabel(error) ? <span>{error.label}: </span> : null}
                                    <span>{error.message}</span>
                                </a>
                            ) : error.message}
                        </li>
                    ))}
                </ul>
                {recovery ? (
                    <button
                        type="button"
                        onClick={() => Promise.resolve(recovery.onAction()).catch(() => {})}
                        className={styles.recovery}
                    >
                        {recovery.label}
                    </button>
                ) : null}
            </div>
        </div>
    );
}
