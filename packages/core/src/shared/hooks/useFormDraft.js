// useFormDraft — §37 / G125. Per-(shell, view, walletId) localStorage
// helper for in-progress form drafts so a tab refresh or accidental
// navigation doesn't wipe what the user has typed.
//
// Storage shape:
//   key:   `xc:formdraft:<view>:<walletId|none>`
//   value: `{"savedAt": <ms>, "values": {...whitelisted fields...}}`
//
// Key design choices:
//
//   1. Per-walletId so a from-seed restore (which provisions a new
//      wallet id) lands fresh — strangers' drafts never bleed into
//      a freshly imported wallet.
//   2. localStorage (not vault) so the draft survives a wallet lock
//      / unlock cycle without needing the password. Drafts contain
//      no signing material — Send keeps {amount, address, memo, tick}
//      out of the draft and password / mnemonic / passphrase fields
//      stay in component state only.
//   3. TTL — draft is discarded on read if it's older than `ttlMs`
//      (default 24 h). Stops a months-old "send 9999 BTC to bc1q…"
//      draft from popping back up after a long idle.
//   4. Imperative API (`load` / `save` / `clear` / `hasDraft`) rather
//      than auto-syncing state — each form already owns its state
//      and decides when to write / restore. The hook just centralises
//      the storage shape so future-Claude can reason about what's in
//      localStorage at a glance.
//
// Caller responsibilities:
//   - NEVER pass sensitive fields (password, mnemonic, passphrase) into
//     `save({ values })`. The hook does no field-level filtering.
//   - Call `clear()` after a successful submission so the draft doesn't
//     "stick" past the action that consumed it.

import { useCallback, useMemo } from 'react';

const NS = 'xc:formdraft:';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function safeStorage() {
    if (typeof localStorage === 'undefined') return null;
    try {
        const probe = '__xc_probe__';
        localStorage.setItem(probe, '1');
        localStorage.removeItem(probe);
        return localStorage;
    } catch {
        return null;
    }
}

/**
 * @param {object} options
 * @param {string} options.view              short view name (e.g. 'send', 'sign-message')
 * @param {string | null | undefined} options.walletId  active wallet id; falsy → keyed under 'none'
 * @param {number} [options.ttlMs]           drafts older than this are discarded on load. Default 24h. Cluster P FOLLOWUP 6 — pass `0` to disable persistence entirely (the user's privacy.formDraftTtlMs = 0 setting case). load() returns null + save() no-ops + clear() still works (so the call site can clean up an existing draft from a previous setting).
 */
export function useFormDraft({ view, walletId, ttlMs = DEFAULT_TTL_MS }) {
    const draftDisabled = ttlMs === 0;
    const storageKey = useMemo(
        () => `${NS}${view || 'unknown'}:${walletId || 'none'}`,
        [view, walletId],
    );

    const load = useCallback(() => {
        const store = safeStorage();
        if (!store) return null;
        // Cluster P FOLLOWUP 6 — Off setting evicts any persisted
        // draft and returns null. Switching from 24h → Off should
        // wipe pre-existing drafts on next load, not orphan them.
        if (draftDisabled) {
            try { store.removeItem(storageKey); } catch { /* swallow */ }
            return null;
        }
        try {
            const raw = store.getItem(storageKey);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return null;
            if (
                Number.isFinite(parsed.savedAt)
                && Date.now() - parsed.savedAt > ttlMs
            ) {
                store.removeItem(storageKey);
                return null;
            }
            return parsed.values || null;
        } catch {
            return null;
        }
    }, [storageKey, ttlMs, draftDisabled]);

    const save = useCallback((values) => {
        if (draftDisabled) return;
        const store = safeStorage();
        if (!store) return;
        if (!values || typeof values !== 'object') return;
        // Empty draft → remove rather than persist a blob of empty
        // strings. Avoids "1 saved draft" badges over inert state.
        const isEmpty = Object.values(values).every(
            (v) => v === '' || v === null || v === undefined,
        );
        if (isEmpty) {
            try { store.removeItem(storageKey); } catch { /* swallow */ }
            return;
        }
        try {
            store.setItem(
                storageKey,
                JSON.stringify({ savedAt: Date.now(), values }),
            );
        } catch {
            /* QuotaExceeded etc. — swallow; the draft is best-effort */
        }
    }, [storageKey, draftDisabled]);

    const clear = useCallback(() => {
        const store = safeStorage();
        if (!store) return;
        try { store.removeItem(storageKey); } catch { /* swallow */ }
    }, [storageKey]);

    const hasDraft = useCallback(() => {
        const store = safeStorage();
        if (!store) return false;
        try { return store.getItem(storageKey) !== null; } catch { return false; }
    }, [storageKey]);

    return { load, save, clear, hasDraft, storageKey };
}
