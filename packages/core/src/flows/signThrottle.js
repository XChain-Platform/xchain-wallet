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

/**
 * @param {object} [opts]
 * @param {number} [opts.burst]      Max requests per window.
 * @param {number} [opts.windowMs]   Sliding-window duration in ms.
 * @param {() => number} [opts.now]  Clock injection for tests.
 */
export function createSignThrottle(opts = {}) {
    const burst = Number.isFinite(opts.burst) && opts.burst > 0
        ? Math.floor(opts.burst)
        : SIGN_THROTTLE_DEFAULT_BURST;
    const windowMs = Number.isFinite(opts.windowMs) && opts.windowMs > 0
        ? Math.floor(opts.windowMs)
        : SIGN_THROTTLE_DEFAULT_WINDOW_MS;
    const now = typeof opts.now === 'function' ? opts.now : () => Date.now();

    const buckets = new Map();

    function check(origin) {
        if (typeof origin !== 'string' || origin.length === 0) {
            return { allowed: true };
        }
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
            return { allowed: false, retryAfterMs, burst, windowMs };
        }
        fresh.push(t);
        buckets.set(origin, fresh);
        return { allowed: true };
    }

    function clear(origin) {
        if (typeof origin === 'string' && origin.length > 0) {
            buckets.delete(origin);
        } else {
            buckets.clear();
        }
    }

    return { check, clear, burst, windowMs };
}
