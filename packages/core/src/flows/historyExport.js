// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §28.5 / G081: History export. Pure converters from the History
// route's `HistoryEntry[]` shape to CSV / JSON file content. Filename
// helper produces `xchain-history-<scope>-<isoDate>.{csv,json}` so an
// export taken multiple times in one day stays sorted by chain scope.
//
// CSV is RFC-4180: fields with commas / quotes / newlines get wrapped
// in double quotes and inner double quotes are doubled.
//
// Cluster I FOLLOWUP 5 (v0.288.0): both converters now accept an
// optional `columns` parameter that filters which fields land in the
// output. Default behaviour matches the pre-FOLLOWUP shape (all fields
// in EXPORT_COLUMNS order), so existing callers keep working without
// touching the call site.

export const EXPORT_COLUMNS = /** @type {const} */ ([
    'chainId',
    'address',
    'action',
    'actionIndex',
    'txHash',
    'blockIndex',
    'timestamp',
    'iso',
    'source',
    'tick',
    'amount',
    'memo',
    'fiatCurrency',
]);

/**
 * Human-readable names and meanings for every selectable export field.
 * The keys remain stable for JSON consumers while CSV and the export dialog
 * can explain fields whose storage names are terse.
 */
export const EXPORT_COLUMN_DETAILS = Object.freeze({
    chainId: Object.freeze({ label: 'Chain', description: 'Chain and network identifier.' }),
    address: Object.freeze({ label: 'Wallet address', description: 'Wallet address associated with the history row.' }),
    action: Object.freeze({ label: 'Action', description: 'Transaction action type.' }),
    actionIndex: Object.freeze({ label: 'Action index', description: 'Chain action index.' }),
    txHash: Object.freeze({ label: 'Transaction hash', description: 'Transaction identifier.' }),
    blockIndex: Object.freeze({ label: 'Block index', description: 'Confirmed block height, or zero while pending.' }),
    timestamp: Object.freeze({ label: 'Unix timestamp', description: 'Source timestamp in seconds or milliseconds.' }),
    iso: Object.freeze({ label: 'Date (ISO 8601 UTC)', description: 'Timestamp normalized to ISO 8601 with a UTC zone.' }),
    source: Object.freeze({ label: 'Source', description: 'Sending address reported by the action.' }),
    tick: Object.freeze({ label: 'Asset', description: 'Native coin or token ticker for the amount.' }),
    amount: Object.freeze({ label: 'Amount', description: 'Exact source decimal text with no floating-point conversion.' }),
    memo: Object.freeze({ label: 'Memo', description: 'Action memo, when present.' }),
    fiatCurrency: Object.freeze({ label: 'Fiat currency', description: 'Selected three-letter fiat currency code.' }),
});

const COLUMN_SET = new Set(EXPORT_COLUMNS);

function pickColumns(columns) {
    if (!Array.isArray(columns) || columns.length === 0) return EXPORT_COLUMNS.slice();
    const seen = new Set();
    const out = [];
    for (const c of columns) {
        if (typeof c === 'string' && COLUMN_SET.has(c) && !seen.has(c)) {
            seen.add(c);
            out.push(c);
        }
    }
    return out.length > 0 ? out : EXPORT_COLUMNS.slice();
}

function timestampToSeconds(timestamp) {
    const value = Number(timestamp);
    if (!Number.isFinite(value) || value <= 0) return null;
    return value >= 1e12 ? value / 1000 : value;
}

function rawValue(entry, ...keys) {
    const raw = entry?.raw || {};
    for (const key of keys) {
        const value = entry?.[key] ?? raw?.[key];
        if (value !== null && value !== undefined) return value;
    }
    return '';
}

function valueFor(entry, column, { fiatCurrency }) {
    if (column === 'iso') {
        const timestamp = timestampToSeconds(entry?.timestamp);
        return timestamp !== null
            ? new Date(timestamp * 1000).toISOString()
            : '';
    }
    if (column === 'memo') {
        return rawValue(entry, 'memo', 'MEMO');
    }
    if (column === 'tick') return rawValue(entry, 'tick', 'TICK', 'token');
    // String conversion performs no arithmetic, so source decimal strings
    // remain exact instead of passing through IEEE-754 operations.
    if (column === 'amount') {
        const value = rawValue(entry, 'amount', 'AMOUNT', 'quantity', 'QUANTITY');
        return value === '' ? '' : String(value);
    }
    if (column === 'fiatCurrency') return fiatCurrency;
    return entry?.[column];
}

function headerFor(column, fiatCurrency) {
    const label = EXPORT_COLUMN_DETAILS[column]?.label || column;
    return column === 'fiatCurrency' ? `${label} (${fiatCurrency})` : label;
}

function columnHeaders(columns, fiatCurrency) {
    return Object.fromEntries(columns.map((column) => [column, headerFor(column, fiatCurrency)]));
}

/**
 * @param {Array<{ chainId: string, address: string, action: string, actionIndex: string, txHash: string, blockIndex: number, timestamp: number, source: string, raw?: object, link?: object | null }>} entries
 * @param {{ columns?: string[], fiatCurrency?: string }} [opts] optional column filter and selected fiat code
 * @returns {string}                            RFC-4180 CSV text
 */
export function entriesToCsv(entries, opts = {}) {
    const cols = pickColumns(opts.columns);
    const fiatCurrency = normalizeFiatCurrency(opts.fiatCurrency);
    const lines = [cols.map((column) => csvField(headerFor(column, fiatCurrency))).join(',')];
    for (const e of entries || []) {
        const row = cols
            .map((c) => valueFor(e, c, { fiatCurrency }))
            .map(csvField)
            .join(',');
        lines.push(row);
    }
    return lines.join('\n') + '\n';
}

/**
 * @param {Array<object>} entries
 * @param {{ columns?: string[], [key: string]: any }} [meta]   { exportedAt, walletId, scope, columns, ... }
 * @returns {string}                            pretty-printed JSON
 */
export function entriesToJson(entries, meta) {
    const { columns: requestedColumns, ...metaRest } = meta || {};
    const cols = pickColumns(requestedColumns);
    const fiatCurrency = normalizeFiatCurrency(metaRest.fiatCurrency);
    const payload = {
        format: 'xchain-wallet-history-export@1',
        exportedAt: new Date().toISOString(),
        ...metaRest,
        fiatCurrency,
        columns: cols,
        columnHeaders: columnHeaders(cols, fiatCurrency),
        entries: (entries || []).map((e) => {
            const row = {};
            for (const c of cols) {
                const value = valueFor(e, c, { fiatCurrency });
                row[c] = c === 'iso' && value === '' ? null : value;
            }
            // Preserve link + raw outside the column-set so JSON exports
            // stay decodable end-to-end (CSV intentionally drops them).
            if (e?.link !== undefined) row.link = e.link || null;
            if (e?.raw !== undefined) row.raw = e.raw;
            return row;
        }),
    };
    return JSON.stringify(payload, null, 2);
}

function normalizeFiatCurrency(value) {
    const code = String(value || 'USD').trim().toUpperCase();
    return /^[A-Z]{3}$/.test(code) ? code : 'USD';
}

/**
 * Filter entries by a `[fromTs, toTs]` epoch-seconds window. Rows
 * outside the window (or with no timestamp) are dropped. Either
 * bound can be null/undefined to leave that side open.
 *
 * @param {Array<{ timestamp?: number }>} entries
 * @param {{ fromTs?: number | null, toTs?: number | null }} range
 */
export function filterEntriesByDateRange(entries, range = {}) {
    const arr = Array.isArray(entries) ? entries : [];
    const from = Number.isFinite(range?.fromTs) ? Number(range.fromTs) : null;
    const to = Number.isFinite(range?.toTs) ? Number(range.toTs) : null;
    if (from === null && to === null) return arr.slice();
    return arr.filter((e) => {
        const ts = timestampToSeconds(e?.timestamp);
        if (ts === null) return false;
        if (from !== null && ts < from) return false;
        if (to !== null && ts > to) return false;
        return true;
    });
}

/**
 * @param {object} opts
 * @param {string} [opts.scope]                 chain filter scope (`all` / `bitcoin` / `BTC-XCP` / etc.)
 * @param {'csv' | 'json'} opts.format
 * @param {Date} [opts.date]                    defaults to now
 */
export function buildExportFilename({ scope = 'all', format, date }) {
    const d = date instanceof Date ? date : new Date();
    const iso = d.toISOString().slice(0, 10);
    return `xchain-history-${scope}-${iso}.${format}`;
}

function csvField(v) {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (/[",\n\r]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}
