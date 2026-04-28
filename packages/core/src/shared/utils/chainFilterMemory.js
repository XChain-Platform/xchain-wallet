// Per-list chain-filter memory — §23.5 / G052. Persists the user's last
// chain-filter choice to localStorage so navigating away and back
// restores the same view. Each list (history, balances) owns its own
// key so filters don't bleed across surfaces with different semantics
// (history filters a Set of full chainIds; UnifiedBalanceList filters
// a single coin family or 'all').
//
// Defensive reads: missing / corrupt / empty values resolve to null
// (caller falls back to its own default). Defensive writes: failures
// are swallowed — localStorage can be disabled in private modes, full,
// or otherwise unwritable.
//
// Why localStorage instead of vault settings: per the project memory
// rule, ephemeral per-wallet UI prefs that don't need to survive a
// from-seed restore live in localStorage. A user re-importing their
// seed onto a fresh device should land on a fresh "show all" view
// rather than inherit whatever filter they last had on a different
// device.

const NS = 'xc:chainFilter:';

function safeGet(key) {
    try {
        if (typeof localStorage === 'undefined') return null;
        return localStorage.getItem(NS + key);
    } catch { return null; }
}

function safeSet(key, value) {
    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(NS + key, value);
    } catch { /* noop */ }
}

function safeRemove(key) {
    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.removeItem(NS + key);
    } catch { /* noop */ }
}

/**
 * Read a saved Set of chainIds for a list. Returns null when no value
 * is stored, the value is malformed, or no entries pass the optional
 * `validIds` filter (so a Set whose every entry has been removed by
 * chain-registry rotation reads as null and the caller can pick a
 * sensible default).
 *
 * @param {string} key
 * @param {Iterable<string>} [validIds]
 * @returns {Set<string> | null}
 */
export function readChainSet(key, validIds) {
    const raw = safeGet(key);
    if (!raw) return null;
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return null; }
    if (!Array.isArray(parsed)) return null;
    const valid = validIds ? new Set(validIds) : null;
    const out = new Set();
    for (const id of parsed) {
        if (typeof id !== 'string') continue;
        if (valid && !valid.has(id)) continue;
        out.add(id);
    }
    return out.size > 0 ? out : null;
}

/**
 * Write a Set of chainIds. Empty sets are removed entirely so a
 * "deselect everything" state doesn't surprise the user later.
 *
 * @param {string} key
 * @param {Set<string> | null | undefined} value
 */
export function writeChainSet(key, value) {
    if (!value || value.size === 0) {
        safeRemove(key);
        return;
    }
    safeSet(key, JSON.stringify(Array.from(value).sort()));
}

/**
 * Read a single string filter value (e.g. 'all' or a coin family
 * name). Returns null when missing or empty.
 *
 * @param {string} key
 * @returns {string | null}
 */
export function readChainString(key) {
    const v = safeGet(key);
    return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Write a single string filter value. 'all' is removed (the natural
 * default) so a stale entry doesn't confuse a future format change.
 *
 * @param {string} key
 * @param {string | null | undefined} value
 */
export function writeChainString(key, value) {
    if (!value || value === 'all') {
        safeRemove(key);
        return;
    }
    safeSet(key, value);
}
