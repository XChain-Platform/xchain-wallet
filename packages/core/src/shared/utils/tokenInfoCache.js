// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// : the tick-metadata cache behind `useTokenInfo`, lifted out of the
// hook so the flows layer can invalidate it without importing React.
//
// The cache used to be a plain module-level Map with no TTL and no
// invalidation, which meant a token record fetched once stayed authoritative
// for the whole session. That is wrong the moment the wallet itself changes
// the token: after an ownership TRANSFER the Manage Token page kept naming the
// PREVIOUS owner and hid every issuer action from the new one, and after a
// MINT / LOCK / mint-settings edit the issuer panel kept rendering pre-action
// supply and lock flags. Only a full page reload recovered, and nothing on
// screen suggested one.
//
// Two mechanisms replace that:
//   - INVALIDATION, the precise one. Every successful `submitAction` drops the
//     entries for the ticks its action named, and notifies subscribers so a
//     hook that is already mounted refetches instead of waiting for a remount.
//   - A TTL, the backstop. Covers changes this wallet did not make (another
//     wallet, another device) at the cost of one refetch per minute per tick.
//
// The extension runs its flows in a service worker, a different JS realm from
// the popup that holds this Map, so its popup-side messaging wrapper calls the
// same invalidation on `action.*` routes. The web and desktop shells host the
// background in-process and are covered by `submitAction` directly.

/**
 * How long a cached tick record is trusted without a refetch. Token
 * metadata only moves when a block lands, so a minute is short enough that
 * an out-of-band change self-heals quickly and long enough that navigating
 * Detail -> back -> Detail still costs no network.
 */
export const TOKEN_INFO_TTL_MS = 60_000;

/** @type {Map<string, { value: any, at: number }>} */
const cache = new Map();

/** @type {Set<(target: { chainId: string, tick: string }) => void>} */
const listeners = new Set();

/**
 * Cache key for a (chainId, tick) pair, or null when either is missing.
 *
 * @param {string | null | undefined} chainId
 * @param {string | null | undefined} tick
 * @returns {string | null}
 */
export function tokenInfoCacheKey(chainId, tick) {
    return chainId && tick ? `${chainId}:${tick}` : null;
}

/**
 * Read a cached record, honouring the TTL. Returns `{ hit: false }` for a
 * miss AND for an expired entry, so callers refetch in both cases. An
 * expired entry is dropped on read rather than swept on a timer.
 *
 * @param {string | null} key
 * @param {number} [now]
 * @returns {{ hit: boolean, value: any }}
 */
export function readTokenInfoCache(key, now = Date.now()) {
    if (!key) return { hit: false, value: null };
    const entry = cache.get(key);
    if (!entry) return { hit: false, value: null };
    if (now - entry.at >= TOKEN_INFO_TTL_MS) {
        cache.delete(key);
        return { hit: false, value: null };
    }
    return { hit: true, value: entry.value };
}

/**
 * @param {string | null} key
 * @param {any} value
 * @param {number} [now]
 */
export function writeTokenInfoCache(key, value, now = Date.now()) {
    if (!key) return;
    cache.set(key, { value, at: now });
}

/**
 * Ticks a submitted action names, so a successful broadcast can drop exactly
 * the records it just made wrong. Covers the single-tick fields plus the DEX
 * pair and the two cross-tick fields (dividends, callbacks), each of which can
 * appear as a scalar or an array on a multi-leg action.
 *
 * @param {object | null | undefined} params
 * @returns {string[]}
 */
export function ticksFromActionParams(params) {
    if (!params || typeof params !== 'object') return [];
    const fields = ['TICK', 'GIVE_TICK', 'GET_TICK', 'DIVIDEND_TICK', 'CALLBACK_TICK'];
    const out = [];
    for (const field of fields) {
        const raw = /** @type {any} */ (params)[field];
        if (raw == null) continue;
        for (const one of [].concat(raw)) {
            const tick = String(one).trim();
            if (tick && !out.includes(tick)) out.push(tick);
        }
    }
    return out;
}

/**
 * Drop the cached record for a (chainId, tick) pair and tell subscribers.
 *
 * Tick matching is case-insensitive: the cache key is whatever string the
 * rendering surface passed in, while the tick on an action's params comes from
 * a form, and a case difference between the two must not leave a stale record
 * behind. chainId is matched exactly (they are canonical ids, not user input).
 *
 * Subscribers are notified even on a miss, because a mounted hook holds its
 * record in React state and needs the nudge whether or not the Map still has
 * a copy.
 *
 * @param {string | null | undefined} chainId
 * @param {string | null | undefined} tick
 */
export function invalidateTokenInfo(chainId, tick) {
    if (!chainId || !tick) return;
    const wanted = String(tick).toUpperCase();
    for (const key of [...cache.keys()]) {
        const split = key.indexOf(':');
        if (split < 0) continue;
        if (key.slice(0, split) !== chainId) continue;
        if (key.slice(split + 1).toUpperCase() !== wanted) continue;
        cache.delete(key);
    }
    const target = { chainId: String(chainId), tick: String(tick) };
    for (const listener of [...listeners]) {
        try {
            listener(target);
        } catch { /* a subscriber's own failure must not block the others */ }
    }
}

/**
 * Invalidate every tick an action touched. Called on the success path of
 * `submitAction`, and by the extension popup once an `action.*` route
 * resolves (its flows run in another realm).
 *
 * @param {string | null | undefined} chainId
 * @param {{ action?: string, params?: object } | null | undefined} actionData
 */
export function invalidateTokenInfoForAction(chainId, actionData) {
    if (!chainId || !actionData) return;
    for (const tick of ticksFromActionParams(actionData.params)) {
        invalidateTokenInfo(chainId, tick);
    }
}

/**
 * Subscribe to invalidations. Returns the unsubscribe function.
 *
 * @param {(target: { chainId: string, tick: string }) => void} listener
 * @returns {() => void}
 */
export function subscribeTokenInfoInvalidation(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/**
 * True when an invalidation target names the same (chainId, tick) a caller is
 * rendering, under the same case-insensitive tick rule the cache sweep uses.
 *
 * @param {{ chainId: string, tick: string }} target
 * @param {string | null | undefined} chainId
 * @param {string | null | undefined} tick
 * @returns {boolean}
 */
export function tokenInfoTargetMatches(target, chainId, tick) {
    if (!target || !chainId || !tick) return false;
    return target.chainId === chainId
        && String(target.tick).toUpperCase() === String(tick).toUpperCase();
}

/** Drop every cached record. Test helper; also the wallet-reset escape hatch. */
export function clearTokenInfoCache() {
    cache.clear();
}
