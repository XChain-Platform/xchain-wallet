// §28.5 / G081 — History export. Pure converters from the History
// route's `HistoryEntry[]` shape to CSV / JSON file content. Filename
// helper produces `xchain-history-<scope>-<isoDate>.{csv,json}` so an
// export taken multiple times in one day stays sorted by chain scope.
//
// CSV is RFC-4180 — fields with commas / quotes / newlines get wrapped
// in double quotes and inner double quotes are doubled.
//
// Cluster I FOLLOWUP 5 (v0.288.0) — both converters now accept an
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
]);

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

function valueFor(entry, column) {
    if (column === 'iso') {
        return Number.isFinite(entry?.timestamp) && entry.timestamp > 0
            ? new Date(entry.timestamp * 1000).toISOString()
            : '';
    }
    return entry?.[column];
}

/**
 * @param {Array<{ chainId: string, address: string, action: string, actionIndex: string, txHash: string, blockIndex: number, timestamp: number, source: string, raw?: object, link?: object | null }>} entries
 * @param {{ columns?: string[] }} [opts]       optional column filter; defaults to every EXPORT_COLUMNS field
 * @returns {string}                            RFC-4180 CSV text
 */
export function entriesToCsv(entries, opts = {}) {
    const cols = pickColumns(opts.columns);
    const lines = [cols.join(',')];
    for (const e of entries || []) {
        const row = cols.map((c) => valueFor(e, c)).map(csvField).join(',');
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
    const payload = {
        format: 'xchain-wallet-history-export@1',
        exportedAt: new Date().toISOString(),
        ...metaRest,
        columns: cols,
        entries: (entries || []).map((e) => {
            const row = {};
            for (const c of cols) {
                if (c === 'iso') {
                    row.iso = Number.isFinite(e?.timestamp) && e.timestamp > 0
                        ? new Date(e.timestamp * 1000).toISOString()
                        : null;
                } else {
                    row[c] = e?.[c];
                }
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

/**
 * Filter entries by a `[fromTs, toTs]` epoch-seconds window. Rows
 * outside the window — or with no timestamp — are dropped. Either
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
        const ts = Number(e?.timestamp);
        if (!Number.isFinite(ts) || ts <= 0) return false;
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
