// Recent-destinations join — §29.4 + §21 FOLLOWUP 4 source data.
//
// Pure helper. The shell is responsible for fetching the inputs (history
// rows for each of the wallet's addresses on the active chain, plus the
// vault's contacts). This function joins them into a `Suggestion[]`
// suitable for `<AddressCombobox>`.
//
// Two source kinds:
//   - `contact`  — entries[].chain matches the chain's coin family.
//                  Sort earlier (more authoritative).
//   - `history`  — destinations the user has previously sent to from
//                  any of their own addresses on this chain. Deduped
//                  by address; weighted by recency × frequency.
//
// Suggestion shape:
//   { address: string,
//     label: string,            // visible primary line
//     sublabel?: string,        // visible secondary line
//     source: 'contact' | 'history',
//     lastSentAt?: number       // unix ms — present for history rows
//   }

const HISTORY_ADDR_FIELDS = ['destination', 'DESTINATION', 'recipient'];

/**
 * @typedef {object} Suggestion
 * @property {string} address
 * @property {string} label
 * @property {string} [sublabel]
 * @property {'contact' | 'history'} source
 * @property {number} [lastSentAt]
 * @property {number} [count]
 */

/**
 * Build the suggestion list shown by `<AddressCombobox>` on Send.
 *
 * @param {object} opts
 * @param {Array<{ name?: string, entries?: Array<{ chain?: string, address?: string, label?: string }> }>} [opts.contacts]
 * @param {string} [opts.chainCoin]    coin family ('bitcoin' / 'litecoin' / 'dogecoin') matching `descriptor.coin`. Required for contact filtering.
 * @param {Array<{ action?: string, ACTION?: string } & Record<string, any>>} [opts.historyRows]    history.address rows for the user's own addresses on this chain
 * @param {number} [opts.historyLimit] cap on the number of history rows fed in (after that, only contacts surface). Default 100.
 * @returns {Suggestion[]}
 */
export function buildRecentDestinations({
    contacts = [],
    chainCoin,
    historyRows = [],
    historyLimit = 100,
} = {}) {
    /** @type {Suggestion[]} */
    const out = [];
    const seen = new Set();

    if (typeof chainCoin === 'string' && chainCoin.length > 0) {
        for (const c of contacts) {
            const name = (c?.name || '').trim();
            for (const e of c?.entries || []) {
                if (!e || e.chain !== chainCoin) continue;
                const addr = (e.address || '').trim();
                if (!addr || seen.has(addr)) continue;
                seen.add(addr);
                const entryLabel = (e.label || '').trim();
                out.push({
                    address: addr,
                    label: name || entryLabel || addr,
                    sublabel: name && entryLabel && name !== entryLabel ? entryLabel : undefined,
                    source: 'contact',
                });
            }
        }
    }

    /** @type {Map<string, { count: number, lastSentAt: number }>} */
    const byAddr = new Map();
    let scanned = 0;
    for (const row of historyRows) {
        if (scanned >= historyLimit) break;
        scanned += 1;
        const action = String(row?.action ?? row?.ACTION ?? '').toUpperCase();
        if (action !== 'SEND') continue;
        let dest;
        for (const f of HISTORY_ADDR_FIELDS) {
            if (typeof row[f] === 'string' && row[f].length > 0) {
                dest = row[f];
                break;
            }
        }
        if (!dest) continue;
        const ts = Number(row.timestamp ?? row.block_time ?? 0) || 0;
        const cur = byAddr.get(dest);
        if (cur) {
            cur.count += 1;
            if (ts > cur.lastSentAt) cur.lastSentAt = ts;
        } else {
            byAddr.set(dest, { count: 1, lastSentAt: ts });
        }
    }

    const histRanked = [...byAddr.entries()]
        .filter(([addr]) => !seen.has(addr))
        .sort((a, b) => {
            if (b[1].lastSentAt !== a[1].lastSentAt) {
                return b[1].lastSentAt - a[1].lastSentAt;
            }
            return b[1].count - a[1].count;
        });

    for (const [addr, agg] of histRanked) {
        seen.add(addr);
        out.push({
            address: addr,
            label: shorten(addr),
            sublabel: agg.count > 1
                ? `Sent ${agg.count} times`
                : 'Previously sent',
            source: 'history',
            lastSentAt: agg.lastSentAt || undefined,
            count: agg.count,
        });
    }

    return out;
}

/**
 * Filter suggestions by a user-typed query (substring; case-insensitive).
 * Matches against `label`, `sublabel`, AND the address itself so users
 * can type either the contact name or any portion of the address.
 *
 * @param {Suggestion[]} suggestions
 * @param {string} query
 * @returns {Suggestion[]}
 */
export function filterSuggestions(suggestions, query) {
    const q = (query || '').trim().toLowerCase();
    if (q.length === 0) return suggestions;
    return suggestions.filter((s) => {
        if (s.address.toLowerCase().includes(q)) return true;
        if (s.label.toLowerCase().includes(q)) return true;
        if (s.sublabel && s.sublabel.toLowerCase().includes(q)) return true;
        return false;
    });
}

function shorten(addr) {
    if (addr.length <= 14) return addr;
    return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}
