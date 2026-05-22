// Advanced history filtering for the History route (§28.6).
//
// The chain / cross-chain / multisig chips and the Grouped / Flat
// toggle live in History.jsx state — those are bookkeeping for the
// upstream data fetch and the post-filter render. This util handles
// the four §28.6 filters that operate on the already-fetched entry
// list:
//
//   - Action-type checkboxes (Send, Receive, Issue, Mint, ...).
//   - Status chips (Pending, Confirmed, Failed).
//   - Date range (from / to, inclusive on both ends).
//   - Free-text search over ACTION code, addresses, txHash, and a
//     curated set of payload fields (tick, memo, destination, ...).
//
// All inputs are passed in explicitly so the function stays pure and
// testable without mocking React state.

/**
 * @typedef {{
 *   key: string, chainId: string, address: string, actionIndex: string,
 *   action: string, blockIndex: number, timestamp: number,
 *   txHash: string, source: string, raw: any, link: any | null,
 * }} HistoryEntry
 */

/**
 * Spec-canonical action-type buckets. Send vs Receive split by checking
 * whether the entry's source is one of the wallet's own addresses.
 */
export const ACTION_TYPE_OPTIONS = [
    { id: 'send', label: 'Send' },
    { id: 'receive', label: 'Receive' },
    { id: 'issue', label: 'Issue' },
    { id: 'mint', label: 'Mint' },
    { id: 'destroy', label: 'Destroy' },
    { id: 'sweep', label: 'Sweep' },
    { id: 'dispenser', label: 'Dispenser' },
    { id: 'dispense', label: 'Dispense' },
    { id: 'order', label: 'Order' },
    { id: 'swap', label: 'Swap' },
    { id: 'dividend', label: 'Dividend' },
    { id: 'broadcast', label: 'Broadcast' },
    { id: 'message', label: 'Message' },
    { id: 'crosschain', label: 'Cross-chain' },
];

// Labels use the XChain platform terminology (VALID / INVALID) to
// match the status pill copy elsewhere in the wallet. The `id` values
// are still `confirmed` / `failed` because `classifyEntryStatus`
// emits those bucket names from the raw row payload.
export const STATUS_OPTIONS = [
    { id: 'pending', label: 'Pending' },
    { id: 'confirmed', label: 'Valid' },
    { id: 'failed', label: 'Invalid' },
];

/**
 * Map an entry's raw ACTION string into one of the spec-canonical
 * buckets. Unknown actions fall through to `'other'` and are filtered
 * out only when the user has explicitly checked some boxes (i.e., an
 * empty action-type filter still matches everything).
 *
 * @param {HistoryEntry} entry
 * @param {Set<string>} walletAddresses lowercase wallet addresses
 */
export function classifyEntryAction(entry, walletAddresses) {
    const a = String(entry?.action || '').toUpperCase();
    if (a === 'SEND') {
        const src = entrySource(entry).toLowerCase();
        if (src && walletAddresses && walletAddresses.has(src)) return 'send';
        return 'receive';
    }
    if (a === 'ISSUE' || a === 'ISSUANCE') return 'issue';
    if (a === 'MINT') return 'mint';
    if (a === 'DESTROY' || a === 'BURN') return 'destroy';
    if (a === 'SWEEP') return 'sweep';
    if (a === 'DISPENSER') return 'dispenser';
    if (a === 'DISPENSE') return 'dispense';
    if (a === 'ORDER') return 'order';
    if (a === 'ORDER_MATCH' || a === 'ORDERFILL' || a === 'ORDER_FILL') return 'swap';
    if (a === 'DIVIDEND') return 'dividend';
    if (a === 'BROADCAST') return 'broadcast';
    if (a === 'MESSAGE') return 'message';
    if (a === 'LINK') return 'crosschain';
    return 'other';
}

/**
 * Pending / confirmed / failed classification.
 * - Failed wins when the row carries an explicit invalid / failed flag
 *   from the explorer.
 * - blockIndex > 0 → confirmed.
 * - Anything else → pending.
 */
export function classifyEntryStatus(entry) {
    if (!entry) return 'pending';
    const raw = entry.raw || {};
    const statusField = String(raw.status || raw.STATUS || '').toLowerCase();
    if (statusField === 'invalid' || statusField === 'failed') return 'failed';
    if (raw.valid === 0 || raw.valid === false) return 'failed';
    if (Number(entry.blockIndex) > 0) return 'confirmed';
    return 'pending';
}

/**
 * Apply all four §28.6 filters in one pass. Each parameter is optional;
 * an empty / null value disables that filter so callers can supply only
 * the dimensions the user has actually touched.
 *
 * @param {HistoryEntry[]} entries
 * @param {{
 *   searchQuery?: string,
 *   actionTypes?: Set<string> | null,
 *   statusSet?: Set<string> | null,
 *   dateFromMs?: number | null,
 *   dateToMs?: number | null,
 *   walletAddresses?: Set<string>,
 * }} opts
 */
export function applyHistoryFilters(entries, opts) {
    if (!Array.isArray(entries) || entries.length === 0) return [];
    const {
        searchQuery = '',
        actionTypes = null,
        statusSet = null,
        dateFromMs = null,
        dateToMs = null,
        walletAddresses = new Set(),
    } = opts || {};

    const q = String(searchQuery || '').trim().toLowerCase();
    const hasActionFilter = actionTypes && actionTypes.size > 0;
    const hasStatusFilter = statusSet && statusSet.size > 0;
    const hasDateFilter = dateFromMs != null || dateToMs != null;
    if (!q && !hasActionFilter && !hasStatusFilter && !hasDateFilter) {
        return entries;
    }

    return entries.filter((e) => {
        if (hasActionFilter) {
            if (!actionTypes.has(classifyEntryAction(e, walletAddresses))) return false;
        }
        if (hasStatusFilter) {
            if (!statusSet.has(classifyEntryStatus(e))) return false;
        }
        if (hasDateFilter) {
            const ts = entryTimestampMs(e);
            // Pending entries lack a timestamp. The spec lets users
            // filter by status (Pending) or by date — we don't try to
            // satisfy both. If the user constrained the date range, we
            // exclude unconfirmed rows from that window.
            if (ts == null) return false;
            if (dateFromMs != null && ts < dateFromMs) return false;
            if (dateToMs != null && ts > dateToMs) return false;
        }
        if (q && !entryMatchesSearch(e, q)) return false;
        return true;
    });
}

function entrySource(entry) {
    if (!entry) return '';
    const raw = entry.raw || {};
    return String(entry.source || raw.source || raw.SOURCE || '');
}

function entryTimestampMs(entry) {
    const t = Number(entry?.timestamp || 0);
    if (!t) return null;
    return t < 1e12 ? t * 1000 : t;
}

const SEARCH_RAW_KEYS = [
    'memo', 'MEMO',
    'tick', 'TICK', 'tick', 'ASSET',
    'destination', 'DESTINATION', 'recipient', 'RECIPIENT',
    'source', 'SOURCE',
    'token', 'TOKEN',
    'description', 'DESCRIPTION',
    'text', 'TEXT',
];

function entryMatchesSearch(entry, q) {
    if (!entry) return false;
    if (containsCi(entry.action, q)) return true;
    if (containsCi(entry.address, q)) return true;
    if (containsCi(entry.source, q)) return true;
    if (containsCi(entry.txHash, q)) return true;
    const raw = entry.raw || {};
    for (const k of SEARCH_RAW_KEYS) {
        if (raw[k] != null && containsCi(String(raw[k]), q)) return true;
    }
    return false;
}

function containsCi(haystack, needleLower) {
    if (haystack == null) return false;
    return String(haystack).toLowerCase().includes(needleLower);
}
