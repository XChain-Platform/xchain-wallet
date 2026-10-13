// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { redactDiagnosticText } from '../utils/diagnosticText.js';

const MAX_VISIBLE_ITEMS = 200;

/**
 * Show a compact diagnostic count with a bounded list of subjects and messages.
 * Strings are accepted for findings that have no separate subject.
 *
 * @param {object} props
 * @param {string} props.summary
 * @param {Array<string | { subject?: string, message: string, location?: string }>} props.items
 * @param {string} [props.className]
 */
export function DiagnosticDetails({ summary, items, className }) {
    if (!Array.isArray(items) || items.length === 0) return null;
    const visibleItems = items.slice(0, MAX_VISIBLE_ITEMS);
    const safeSummary = redactDiagnosticText(summary);
    return (
        <details className={className}>
            <summary>{safeSummary}</summary>
            <ul>
                {visibleItems.map((item, index) => {
                    const finding = typeof item === 'string' ? { message: item } : item;
                    const subject = redactDiagnosticText(finding?.subject);
                    const message = redactDiagnosticText(finding?.message);
                    const location = redactDiagnosticText(finding?.location);
                    return (
                        <li key={`${subject || location || message}-${index}`}>
                            {subject ? <><strong>{subject}</strong>: </> : null}
                            {message}
                            {location ? <> <span>({location})</span></> : null}
                        </li>
                    );
                })}
            </ul>
            {items.length > visibleItems.length ? (
                <p>Showing the first {visibleItems.length} of {items.length} findings.</p>
            ) : null}
        </details>
    );
}
