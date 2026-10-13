// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Per-wallet last-view memory (§24 / G055). Persists the user's last
// `unlockedView` value to localStorage so unlocking the wallet returns
// them to where they were instead of always landing on Home.
//
// Why localStorage instead of vault settings: per the project memory
// rule, ephemeral per-wallet UI prefs that don't need to survive a
// from-seed restore live in localStorage. A user re-importing their
// seed onto a fresh device should land on Home rather than inherit
// the last view from a different device.
//
// Resume safety: context-free views need only their name. The four deep
// views below also persist a small, validated parameter object so their
// React state can be primed before the shell renders them.

import { clearHistoryCacheForWallet } from './historyCache.js';

const NS = 'xc:lastView:';

// View identifiers safe to resume without re-priming context state.
// Keep in lockstep with the per-shell App.jsx switch. Adding a new
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
    'lists',
    'shared-lists',
    'dispensers-list',
    'dispenser-explorer',
    'token-detail',
    'list-detail',
    'dispenser-detail',
    'market',
]);

const RESUMABLE_SET = new Set(RESUMABLE_VIEWS);
const PARAM_VIEWS = new Set(['token-detail', 'list-detail', 'dispenser-detail', 'market']);

const isText = (value) => typeof value === 'string' && value.length > 0 && value.length <= 512;

function copyOptional(target, source, fields) {
    for (const field of fields) {
        const value = source[field];
        if ((typeof value === 'string' && value.length <= 512)
            || (typeof value === 'number' && Number.isFinite(value))
            || typeof value === 'boolean'
            || value === null) {
            target[field] = value;
        }
    }
    return target;
}

/**
 * Validate and trim the state carried by a contextual route. Unknown fields
 * never reach storage or session history.
 *
 * @param {string} view
 * @param {unknown} params
 * @returns {Record<string, any> | null}
 */
export function normalizeRouteParams(view, params) {
    if (!PARAM_VIEWS.has(view)) return null;
    if (!params || typeof params !== 'object' || Array.isArray(params)) return null;
    if (!isText(params.chainId)) return null;
    if (view === 'token-detail') {
        if (!isText(params.tick)) return null;
        return copyOptional({ chainId: params.chainId, tick: params.tick }, params, [
            'kind', 'displayName', 'divisibility', 'fiatRate', 'quantity', 'imageUrl', 'issuer',
        ]);
    }
    if (view === 'market') {
        if (!isText(params.tick1) || !isText(params.tick2)) return null;
        return { chainId: params.chainId, tick1: params.tick1, tick2: params.tick2 };
    }
    if (!isText(params.actionIndex)) return null;
    return copyOptional({ chainId: params.chainId, actionIndex: params.actionIndex }, params, [
        'origin', 'directoryChainId',
    ]);
}

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
 * longer in the resumable set (handles spec drift: a view the user
 * last visited that we have since removed should no-op, not crash).
 *
 * @param {string | null | undefined} walletId
 * @returns {{ view: string, params: Record<string, any> | null } | null}
 */
export function readLastViewRoute(walletId) {
    if (typeof walletId !== 'string' || !walletId) return null;
    const raw = safeGet(walletId);
    if (typeof raw !== 'string' || !raw) return null;
    if (RESUMABLE_SET.has(raw) && !PARAM_VIEWS.has(raw)) return { view: raw, params: null };
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || !RESUMABLE_SET.has(parsed.view)) return null;
        if (!PARAM_VIEWS.has(parsed.view)) return { view: parsed.view, params: null };
        const params = normalizeRouteParams(parsed.view, parsed.params);
        return params ? { view: parsed.view, params } : null;
    } catch {
        return null;
    }
}

export function readLastView(walletId, includeParams = false) {
    const route = readLastViewRoute(walletId);
    return includeParams ? route : (route?.view || null);
}

/**
 * Persist the current view for a wallet. No-ops for non-resumable
 * views. Only the safe set lands in storage so a future read can
 * trust the value.
 *
 * @param {string | null | undefined} walletId
 * @param {string | null | undefined} view
 * @param {unknown} [params]
 */
export function writeLastView(walletId, view, params = null) {
    if (typeof walletId !== 'string' || !walletId) return;
    if (typeof view !== 'string' || !view) return;
    if (!RESUMABLE_SET.has(view)) return;
    if (view === 'home') {
        // Home is the implicit default; storing it just creates noise
        // and a future "go home" navigation reads the same answer.
        safeRemove(walletId);
        return;
    }
    if (PARAM_VIEWS.has(view)) {
        const normalized = normalizeRouteParams(view, params);
        if (!normalized) return;
        safeSet(walletId, JSON.stringify({ view, params: normalized }));
        return;
    }
    safeSet(walletId, view);
}

/**
 * Drop route-owned local memory when a wallet is removed.
 *
 * @param {string | null | undefined} walletId
 */
export function clearLastView(walletId) {
    if (typeof walletId !== 'string' || !walletId) return;
    safeRemove(walletId);
    clearHistoryCacheForWallet(walletId);
}
