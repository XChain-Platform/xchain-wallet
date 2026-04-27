// §28.5 / G081 — History export. Pure converters from the History
// route's `HistoryEntry[]` shape to CSV / JSON file content. Filename
// helper produces `xchain-history-<scope>-<isoDate>.{csv,json}` so an
// export taken multiple times in one day stays sorted by chain scope.
//
// CSV is RFC-4180 — fields with commas / quotes / newlines get wrapped
// in double quotes and inner double quotes are doubled.

const CSV_HEADERS = [
    'chainId',
    'address',
    'action',
    'actionIndex',
    'txHash',
    'blockIndex',
    'timestamp',
    'iso',
    'source',
];

/**
 * @param {Array<{ chainId: string, address: string, action: string, actionIndex: string, txHash: string, blockIndex: number, timestamp: number, source: string, raw?: object, link?: object | null }>} entries
 * @returns {string}                            RFC-4180 CSV text
 */
export function entriesToCsv(entries) {
    const lines = [CSV_HEADERS.join(',')];
    for (const e of entries || []) {
        const iso = Number.isFinite(e?.timestamp) && e.timestamp > 0
            ? new Date(e.timestamp * 1000).toISOString()
            : '';
        const row = [
            e?.chainId,
            e?.address,
            e?.action,
            e?.actionIndex,
            e?.txHash,
            e?.blockIndex,
            e?.timestamp,
            iso,
            e?.source,
        ].map(csvField).join(',');
        lines.push(row);
    }
    return lines.join('\n') + '\n';
}

/**
 * @param {Array<object>} entries
 * @param {object} [meta]                       { exportedAt, walletId, scope, ... }
 * @returns {string}                            pretty-printed JSON
 */
export function entriesToJson(entries, meta) {
    const payload = {
        format: 'xchain-wallet-history-export@1',
        exportedAt: new Date().toISOString(),
        ...(meta || {}),
        entries: (entries || []).map((e) => ({
            chainId: e?.chainId,
            address: e?.address,
            action: e?.action,
            actionIndex: e?.actionIndex,
            txHash: e?.txHash,
            blockIndex: e?.blockIndex,
            timestamp: e?.timestamp,
            iso: Number.isFinite(e?.timestamp) && e.timestamp > 0
                ? new Date(e.timestamp * 1000).toISOString()
                : null,
            source: e?.source,
            link: e?.link || null,
            raw: e?.raw,
        })),
    };
    return JSON.stringify(payload, null, 2);
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
