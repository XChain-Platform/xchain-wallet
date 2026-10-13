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

/**
 * Focusable validation summary. Every field-specific error is a link so the
 * user can move directly from the summary to the control that needs attention.
 *
 * @param {object} props
 * @param {{ id?: string, label?: string, message: string }[]} props.errors
 * @param {string | number} [props.focusKey]
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

    if (errors.length === 0) return null;

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
            aria-label="Form errors"
            style={{
                padding: 'var(--xc-space-3)',
                border: '1px solid var(--xc-danger-fg)',
                borderRadius: 'var(--xc-radius-md)',
                color: 'var(--xc-danger-fg)',
            }}
        >
            <p style={{ margin: 0, fontWeight: 600 }}>
                {errors.length === 1 ? 'Fix this field:' : `Fix these ${errors.length} fields:`}
            </p>
            <ul style={{ margin: 'var(--xc-help-gap) 0 0', paddingInlineStart: 'var(--xc-space-5)' }}>
                {errors.map((error, index) => (
                    <li key={`${error.id || 'form'}-${index}`}>
                        {error.id ? (
                            <a
                                href={`#${error.id}`}
                                onClick={(event) => focusField(event, error.id)}
                                style={{ color: 'inherit', textDecoration: 'underline' }}
                            >
                                {error.label ? <span>{error.label}: </span> : null}
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
                    style={{
                        marginTop: 'var(--xc-help-gap)',
                        color: 'inherit',
                        background: 'transparent',
                        border: 0,
                        padding: 0,
                        textDecoration: 'underline',
                        cursor: 'pointer',
                    }}
                >
                    {recovery.label}
                </button>
            ) : null}
        </div>
    );
}
