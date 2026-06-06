// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Per-origin sign-request throttle (§12 / G012).
//
// Token-bucket-style sliding-window limiter. Each origin keeps a list
// of recent sign-request timestamps; when the count inside the window
// reaches `burst`, subsequent requests are rejected with a structured
// `THROTTLED` shape and a `retryAfterMs` hint until the oldest entry
// falls out of the window.
//
// The throttle is intentionally process-scoped — one instance per
// background. State resets across service-worker restarts. That is
// acceptable for a rate limit: an attacker who can crash the SW also
// cannot sign anything because the wallet never caches the password.
//
// Why this exists:
//   1. A site granted `canSignMessage: true` (saved permanent) could
//      otherwise rapid-fire signs without an approval prompt.
//   2. UI denial-of-service — a malicious dApp spamming sign prompts
//      can be slowed to a human cadence by the limiter.
//
// Defaults are generous enough that a normal dApp flow (one connect +
// occasional sign) is never affected; a script driving > burst signs
// inside `windowMs` is the failure mode this catches.

export const SIGN_THROTTLE_DEFAULT_BURST = 5;
export const SIGN_THROTTLE_DEFAULT_WINDOW_MS = 60_000;

function coerceBurst(v) {
    return Number.isFinite(v) && v > 0
        ? Math.floor(v)
        : SIGN_THROTTLE_DEFAULT_BURST;
}
function coerceWindowMs(v) {
    return Number.isFinite(v) && v > 0
        ? Math.floor(v)
        : SIGN_THROTTLE_DEFAULT_WINDOW_MS;
}

/**
 * @param {object} [opts]
 * @param {number} [opts.burst]      Max requests per window. Static fallback when `getLimits` is not supplied.
 * @param {number} [opts.windowMs]   Sliding-window duration in ms. Static fallback when `getLimits` is not supplied.
 * @param {() => { burst?: number, windowMs?: number }} [opts.getLimits]   Cluster S FOLLOWUP 1 — live-reactive limits read on every `check()`. Lets the wallet update settings.signThrottle at runtime without rebuilding the throttle (state retained, in-flight buckets keep their timestamps).
 * @param {{ buckets?: Record<string, number[]> }} [opts.initialState]      Cluster S FOLLOWUP 2 — hydrate persisted bucket state on construction. Each entry is an ordered list of recent request timestamps.
 * @param {(snapshot: { buckets: Record<string, number[]> }) => void | Promise<void>} [opts.onPersist]   Cluster S FOLLOWUP 2 — fired on every mutation so the caller can persist the state across SW restarts. Called fire-and-forget from `check()` / `clear()`.
 * @param {() => number} [opts.now]  Clock injection for tests.
 */
export function createSignThrottle(opts = {}) {
    const staticBurst = coerceBurst(opts.burst);
    const staticWindowMs = coerceWindowMs(opts.windowMs);
    const getLimits = typeof opts.getLimits === 'function'
        ? () => {
            const live = opts.getLimits() ?? {};
            return {
                burst: coerceBurst(live.burst ?? opts.burst),
                windowMs: coerceWindowMs(live.windowMs ?? opts.windowMs),
            };
        }
        : () => ({ burst: staticBurst, windowMs: staticWindowMs });
    const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    const onPersist = typeof opts.onPersist === 'function' ? opts.onPersist : null;

    const buckets = new Map();
    if (opts.initialState && opts.initialState.buckets && typeof opts.initialState.buckets === 'object') {
        for (const [origin, list] of Object.entries(opts.initialState.buckets)) {
            if (typeof origin === 'string' && origin.length > 0
                && Array.isArray(list)
                && list.every((ts) => Number.isFinite(ts))) {
                buckets.set(origin, [...list]);
            }
        }
    }

    function persist() {
        if (!onPersist) return;
        // Snapshot to a plain object so the caller can JSON-serialize
        // without worrying about Map -> object conversion.
        const snapshot = { buckets: Object.fromEntries(buckets) };
        try {
            // Fire-and-forget: persistence is best-effort. The bucket
            // is correct in-memory even if persist throws.
            void Promise.resolve(onPersist(snapshot)).catch(() => {});
        } catch { /* ignore */ }
    }

    function check(origin) {
        if (typeof origin !== 'string' || origin.length === 0) {
            return { allowed: true };
        }
        const { burst, windowMs } = getLimits();
        const t = now();
        const cutoff = t - windowMs;
        const list = buckets.get(origin) ?? [];
        const fresh = [];
        for (const ts of list) {
            if (ts > cutoff) fresh.push(ts);
        }
        if (fresh.length >= burst) {
            const oldest = fresh[0];
            const retryAfterMs = Math.max(0, oldest + windowMs - t);
            buckets.set(origin, fresh);
            persist();
            return { allowed: false, retryAfterMs, burst, windowMs };
        }
        fresh.push(t);
        buckets.set(origin, fresh);
        persist();
        return { allowed: true };
    }

    function clear(origin) {
        if (typeof origin === 'string' && origin.length > 0) {
            buckets.delete(origin);
        } else {
            buckets.clear();
        }
        persist();
    }

    /**
     * Snapshot the live bucket state. Intended for tests / diagnostic
     * dumps; persistence callers receive the same shape via `onPersist`.
     */
    function snapshot() {
        return { buckets: Object.fromEntries(buckets) };
    }

    /**
     * Cluster S FOLLOWUP 2 — splice persisted bucket timestamps into the
     * live map. Used by the background host when async hydration finishes
     * after construction. New timestamps from intervening live calls are
     * preserved; persisted timestamps merge into the existing list and
     * the result is re-sorted.
     *
     * @param {Record<string, number[]>} persistedBuckets
     */
    function seed(persistedBuckets) {
        if (!persistedBuckets || typeof persistedBuckets !== 'object') return;
        for (const [origin, timestamps] of Object.entries(persistedBuckets)) {
            if (typeof origin !== 'string' || !origin) continue;
            if (!Array.isArray(timestamps)) continue;
            const fresh = timestamps.filter((ts) => Number.isFinite(ts));
            if (fresh.length === 0) continue;
            const existing = buckets.get(origin) ?? [];
            // Merge + sort so the windowMs eviction in check() processes
            // them in chronological order. No dedupe — distinct calls
            // in the same millisecond are legitimate and Set would
            // collapse them.
            const merged = [...existing, ...fresh].sort((a, b) => a - b);
            buckets.set(origin, merged);
        }
        // Don't fire onPersist here — caller hydrated us from storage,
        // so re-persisting is redundant.
    }

    return {
        check,
        clear,
        snapshot,
        seed,
        // Static fields kept for back-compat — callers reading these
        // get the construction-time fallback, NOT the latest live value.
        // Use `getLimits()` for live reads.
        burst: staticBurst,
        windowMs: staticWindowMs,
        getLimits,
    };
}
