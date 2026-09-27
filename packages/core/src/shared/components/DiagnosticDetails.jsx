// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Show a compact diagnostic count with every underlying subject and message.
 * Strings are accepted for findings that have no separate subject.
 *
 * @param {object} props
 * @param {string} props.summary
 * @param {Array<string | { subject?: string, message: string, location?: string }>} props.items
 * @param {string} [props.className]
 */
export function DiagnosticDetails({ summary, items, className }) {
    if (!Array.isArray(items) || items.length === 0) return null;
    return (
        <details className={className}>
            <summary>{summary}</summary>
            <ul>
                {items.map((item, index) => {
                    const finding = typeof item === 'string' ? { message: item } : item;
                    return (
                        <li key={`${finding.subject || finding.location || finding.message}-${index}`}>
                            {finding.subject ? <><strong>{finding.subject}</strong>: </> : null}
                            {finding.message}
                            {finding.location ? <> <span>({finding.location})</span></> : null}
                        </li>
                    );
                })}
            </ul>
        </details>
    );
}
