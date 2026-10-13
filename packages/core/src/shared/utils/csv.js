// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Parse RFC 4180-style CSV while retaining the physical line where each row
 * starts. Newlines and escaped quotes inside quoted fields remain part of the
 * field, so callers never mistake a continuation line for another record.
 *
 * @param {string} text
 * @param {{ strict?: boolean }} [options]
 * @returns {Array<{ cells: string[], line: number }>}
 */
export function parseCsvRecords(text, options = {}) {
    if (typeof text !== 'string' || text.length === 0) return [];
    const rows = [];
    let cells = [];
    let field = '';
    let line = 1;
    let rowLine = 1;
    let quoted = false;
    let closedQuote = false;
    let rowStarted = false;

    const finishRow = () => {
        cells.push(field);
        rows.push({ cells, line: rowLine });
        cells = [];
        field = '';
        closedQuote = false;
        rowStarted = false;
        rowLine = line;
    };

    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        if (quoted) {
            if (char === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i += 1;
                } else {
                    quoted = false;
                    closedQuote = true;
                }
            } else if (char === '\r' || char === '\n') {
                if (char === '\r' && text[i + 1] === '\n') i += 1;
                field += '\n';
                line += 1;
            } else {
                field += char;
            }
            continue;
        }

        if (closedQuote && char !== ',' && char !== '\r' && char !== '\n') {
            if (options.strict) throw new Error(`Line ${line}: unexpected character after closing quote.`);
            closedQuote = false;
        }
        if (char === '"' && field.length === 0) {
            quoted = true;
            rowStarted = true;
        } else if (char === '"' && options.strict) {
            throw new Error(`Line ${line}: unexpected quote in unquoted field.`);
        } else if (char === ',') {
            cells.push(field);
            field = '';
            closedQuote = false;
            rowStarted = true;
        } else if (char === '\r' || char === '\n') {
            if (char === '\r' && text[i + 1] === '\n') i += 1;
            finishRow();
            line += 1;
            rowLine = line;
        } else {
            field += char;
            rowStarted = true;
        }
    }

    if (quoted && options.strict) throw new Error(`Line ${rowLine}: unterminated quoted field.`);
    if (rowStarted || field.length > 0 || cells.length > 0) finishRow();
    return rows;
}

/** @param {unknown} value */
export function csvField(value) {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
