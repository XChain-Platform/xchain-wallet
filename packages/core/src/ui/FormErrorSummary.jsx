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
import { AlertCircleIcon } from './icons/index.jsx';
import { formErrorList } from './formErrors.js';
import { NoticeAction } from './StatusMessage.jsx';
import { NoticeList } from './NoticeList.jsx';
import statusStyles from './StatusMessage.module.css';
import { t } from '../i18n/index.js';
import '../i18n/locales/en/ui.js';

/**
 * Scrolls every scrolling box that holds `node` (the Screen body, a dialog's
 * panel, the document) back to its top. Plain scrollTop writes, so it works
 * where scrollTo is missing (jsdom) and never animates past the notice.
 *
 * @param {HTMLElement} node
 */
export function scrollPageToTop(node) {
    for (let el = node.parentElement; el; el = el.parentElement) {
        if (el.scrollTop > 0) el.scrollTop = 0;
    }
    const root = typeof document !== 'undefined' ? document.scrollingElement : null;
    if (root && root.scrollTop > 0) root.scrollTop = 0;
    // A notice placed lower than the top of its page (an inline Settings
    // form) is brought back into view; at the top this moves nothing.
    node.scrollIntoView?.({ block: 'nearest' });
}

/**
 * G130 for a reason the form already shows (offline): a press that cannot go
 * ahead scrolls the page to the form's notice box and focuses it, so the one
 * notice is seen and read without a second copy in an error summary.
 *
 * @param {EventTarget | null | undefined} form  the submitting form (the submit event's currentTarget)
 * @returns {boolean} true when a notice box was found and revealed
 */
export function revealFormStatus(form) {
    const box = form && typeof form.querySelector === 'function'
        ? form.querySelector('[data-form-status]')
        : null;
    if (!box) return false;
    scrollPageToTop(box);
    box.focus?.({ preventScroll: true });
    return true;
}

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
 * The form error notice (Notice Standard, 2026-11-15): the danger notice at
 * the top of a form after a failed Next or submit. Its bold title counts the
 * problems ("Fix 2 things to continue") and the body lists each one in plain
 * text, as a bulleted list when there are several (U101) and a plain line
 * when there is one. It has no close X, because it clears itself: each line leaves as soon
 * as its field changes, and the next press validates again. A form-level
 * failure (no field id) shows as a plain line with no title.
 *
 * Pass either `form` (from useFormErrors; FormPage and FormFrame do this for
 * a form that hands them `errors`) or the older `errors` list with a
 * `focusKey` that bumps on every submit attempt.
 *
 * @param {object} props
 * @param {{ id?: string, label?: string, message: string }[]} [props.errors]
 * @param {string | number} [props.focusKey] submit-attempt key; zero or empty keeps the summary hidden.
 * @param {import('./formErrors.js').FormErrors | null} [props.form]
 * @param {{ label: string, onAction: () => void | Promise<void>, ariaLabel?: string, disabled?: boolean, icon?: import('react').ReactNode }} [props.action]
 *   the notice's one action (Notice's, a kit secondary sm Button): a one-click fix such as Send's Use max
 * @param {{ label: string, onAction: () => void | Promise<void> }} [props.recovery]  older name for `action`
 */
export function FormErrorSummary({ errors: errorsProp, focusKey: focusKeyProp, form, action, recovery }) {
    const shownAction = [action, recovery].find((entry) => entry && entry.label && typeof entry.onAction === 'function') || null;
    const errors = form ? formErrorList(form) : (errorsProp || []);
    const focusKey = form ? form.attempt : focusKeyProp;
    const summaryRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    const summaryId = useId();
    const signature = errors.map((error) => `${error.id || ''}:${error.message}`).join('|');
    const hasErrors = errors.length > 0;

    // The notice takes focus once per press of Next, never while the user
    // types: a line leaving because its field changed must not pull the
    // cursor out of that field.
    // G129 (operator 2026-11-16): the press also scrolls the page to the top,
    // so the notice is the first thing seen, whatever the scroll position.
    useEffect(() => {
        const node = summaryRef.current;
        if (!hasErrors || !node) return;
        scrollPageToTop(node);
        node.focus({ preventScroll: true });
    }, [focusKey, hasErrors]);

    // The notice names the failing fields, so each of them says so too: a
    // screen reader on the field hears that it is invalid and reads the
    // notice as its description, and the field's border turns red. An
    // attribute the field already carries is left alone; only what is added
    // here is removed again.
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

    if (!focusKey || !hasErrors) return null;

    const namesFields = errors.some((error) => error.id);

    return (
        <div
            ref={summaryRef}
            id={summaryId}
            role="alert"
            tabIndex={-1}
            aria-label={t('ui.formErrorSummary.formErrors')}
            className={`${statusStyles.row} ${statusStyles.error}`}
            data-variant="error"
            data-tone="danger"
            data-form-errors=""
        >
            <span className={statusStyles.icon} aria-hidden="true"><AlertCircleIcon /></span>
            <div className={statusStyles.text}>
                {namesFields ? (
                    <p className={statusStyles.title}>
                        {errors.length === 1 ? t('ui.formErrorSummary.fixThisField') : t('ui.formErrorSummary.fixTheseFields', { length: errors.length })}
                    </p>
                ) : null}
                {/* One problem reads as a plain line under the title; several,
                    form-level failures included, are a bulleted list (U101). */}
                <div className={statusStyles.body}>
                    <NoticeList
                        items={errors.map((error, index) => ({
                            key: `${error.id || 'form'}-${index}`,
                            attrs: { 'data-error-for': error.id || undefined },
                            content: (
                                <>
                                    {showsLabel(error) ? <span>{error.label}: </span> : null}
                                    <span>{error.message}</span>
                                </>
                            ),
                        }))}
                    />
                </div>
            </div>
            {/* The one action sits where every Notice puts it. */}
            {shownAction ? <NoticeAction action={shownAction} /> : null}
        </div>
    );
}
