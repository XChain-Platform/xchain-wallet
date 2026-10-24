// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useId, useMemo, useRef } from 'react';
import styles from './FormErrorSummary.module.css';
import statusStyles from './StatusMessage.module.css';
import { t } from '../i18n/index.js';
import '../i18n/locales/en/ui.js';

const LABEL_FILLER = new Set(['a', 'an', 'the', 'to', 'of', 'for', 'in', 'on', 'at', 'optional']);

function words(text) {
    return String(text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}

/**
 * True when the field label adds something to the message. A message that
 * already names the field would otherwise read "Password: Password must be..."
 * or "Transfer ownership to: Transfer ownership address is not valid".
 * The label is redundant when the message opens with it, or when a label of
 * two or more meaningful words (not "to", "the", "optional") has every one of
 * them in the message. A number must match whole ("Word 5" is not "Word 50"); a word
 * of four letters or more also matches a longer form ("send" in "sending").
 *
 * @param {{ label?: string, message: string }} error
 */
function showsLabel(error) {
    const label = String(error.label || '').trim().toLowerCase();
    if (!label) return false;
    const message = String(error.message || '').trim().toLowerCase();
    if (message.startsWith(label) && !/^[\p{L}\p{N}]/u.test(message.slice(label.length))) return false;
    const significant = words(label).filter((word) => !LABEL_FILLER.has(word));
    if (significant.length < 2) return true;
    const messageWords = words(message);
    const named = significant.every((word) => messageWords.some((candidate) => (
        candidate === word
        || (/^\p{L}{4,}$/u.test(word) && candidate.startsWith(word))
    )));
    return !named;
}

/**
 * Focusable error summary. Every field-specific error is a link so the user can
 * move directly from the summary to the control that needs attention. Errors
 * without an id describe a form-level failure.
 *
 * @param {object} props
 * @param {{ id?: string, label?: string, message: string }[]} props.errors
 * @param {string | number} props.focusKey submit-attempt key; zero or empty keeps the summary hidden.
 * @param {{ label: string, onAction: () => void | Promise<void> }} [props.recovery]
 */
export function FormErrorSummary({ errors, focusKey, recovery }) {
    const summaryRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    const summaryId = useId();
    const signature = useMemo(
        () => errors.map((error) => `${error.id || ''}:${error.message}`).join('|'),
        [errors],
    );

    useEffect(() => {
        if (errors.length > 0) summaryRef.current?.focus();
    }, [signature, focusKey, errors.length]);

    // The summary names the failing fields, so each of them says so too: a
    // screen reader on the field hears that it is invalid and reads the
    // summary as its description. An attribute the field already carries is
    // left alone; only what is added here is removed again.
    const fieldIds = useMemo(
        () => (focusKey ? [...new Set(errors.map((error) => error.id).filter(Boolean))] : []),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `signature` stands for the error list's content
        [signature, focusKey],
    );
    useEffect(() => {
        const touched = [];
        for (const id of fieldIds) {
            const field = document.getElementById(id);
            if (!field) continue;
            const entry = { field, invalid: false, describedBy: false };
            if (field.getAttribute('aria-invalid') !== 'true') {
                field.setAttribute('aria-invalid', 'true');
                entry.invalid = true;
            }
            const tokens = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
            if (!tokens.includes(summaryId)) {
                field.setAttribute('aria-describedby', [...tokens, summaryId].join(' '));
                entry.describedBy = true;
            }
            touched.push(entry);
        }
        return () => {
            for (const entry of touched) {
                if (entry.invalid) entry.field.removeAttribute('aria-invalid');
                if (entry.describedBy) {
                    const rest = (entry.field.getAttribute('aria-describedby') || '')
                        .split(/\s+/).filter((token) => token && token !== summaryId);
                    if (rest.length > 0) entry.field.setAttribute('aria-describedby', rest.join(' '));
                    else entry.field.removeAttribute('aria-describedby');
                }
            }
        };
    }, [fieldIds, summaryId]);

    if (!focusKey || errors.length === 0) return null;

    const hasOnlyFieldErrors = errors.every((error) => error.id);

    const focusField = (event, id) => {
        event.preventDefault();
        const field = document.getElementById(id);
        field?.focus();
        field?.scrollIntoView?.({ block: 'center' });
    };

    return (
        <div
            ref={summaryRef}
            id={summaryId}
            role="alert"
            tabIndex={-1}
            aria-label={t('ui.formErrorSummary.formErrors')}
            className={`${statusStyles.row} ${statusStyles.error}`}
            data-variant="error"
        >
            <span className={statusStyles.icon} aria-hidden="true">✕</span>
            <div className={statusStyles.text}>
                {hasOnlyFieldErrors ? (
                    <p className={styles.heading}>
                        {errors.length === 1 ? t('ui.formErrorSummary.fixThisField') : t('ui.formErrorSummary.fixTheseFields', { length: errors.length })}
                    </p>
                ) : null}
                <ul className={hasOnlyFieldErrors ? styles.list : styles.listBare}>
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
