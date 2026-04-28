// Per-wallet last-view memory — §24 / G055. Persists the user's last
// `unlockedView` value to localStorage so unlocking the wallet returns
// them to where they were instead of always landing on Home.
//
// Why localStorage instead of vault settings: per the project memory
// rule, ephemeral per-wallet UI prefs that don't need to survive a
// from-seed restore live in localStorage. A user re-importing their
// seed onto a fresh device should land on Home rather than inherit
// the last view from a different device.
//
// Resume safety: only views that take no contextual props (token
// detail's selected token, history's initial query, dispenser detail's
// actionIndex, etc.) can be resumed without re-priming React state.
// `RESUMABLE_VIEWS` enumerates the safe set; everything else falls
// through to Home.

const NS = 'xc:lastView:';

// View identifiers safe to resume without re-priming context state.
// Keep in lockstep with the per-shell App.jsx switch — adding a new
// view to this set is the only call site to touch when extending
// resume coverage.
export const RESUMABLE_VIEWS = Object.freeze([
    'home',
    'history',
    'addresses',
    'actions',
    'contacts',
    'messaging',
    'markets',
    'staking-dashboard',
    'contracts-list',
    'cross-chain-templates',
]);

const RESUMABLE_SET = new Set(RESUMABLE_VIEWS);

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
 * Read the saved last view for a wallet. Returns null when no value
 * is stored, the wallet id is missing, or the persisted view is no
 * longer in the resumable set (handles spec drift — a view the user
 * last visited that we have since removed should no-op, not crash).
 *
 * @param {string | null | undefined} walletId
 * @returns {string | null}
 */
export function readLastView(walletId) {
    if (typeof walletId !== 'string' || !walletId) return null;
    const v = safeGet(walletId);
    if (typeof v !== 'string' || !v) return null;
    return RESUMABLE_SET.has(v) ? v : null;
}

/**
 * Persist the current view for a wallet. No-ops for non-resumable
 * views — only the safe set lands in storage so a future read can
 * trust the value.
 *
 * @param {string | null | undefined} walletId
 * @param {string | null | undefined} view
 */
export function writeLastView(walletId, view) {
    if (typeof walletId !== 'string' || !walletId) return;
    if (typeof view !== 'string' || !view) return;
    if (!RESUMABLE_SET.has(view)) return;
    if (view === 'home') {
        // Home is the implicit default; storing it just creates noise
        // and a future "go home" navigation reads the same answer.
        safeRemove(walletId);
        return;
    }
    safeSet(walletId, view);
}

/**
 * Drop the saved view for a wallet (e.g., on remove-wallet).
 *
 * @param {string | null | undefined} walletId
 */
export function clearLastView(walletId) {
    if (typeof walletId !== 'string' || !walletId) return;
    safeRemove(walletId);
}
