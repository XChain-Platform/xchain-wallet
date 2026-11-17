// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Ticker to token number lookups for an agent account's saved rules.
//
// The SDK compacts an indexed token's TICK to its immutable ^<id> form by
// default, so an agent account limited to ['MYTOKEN'] receives requests
// naming '^1234'. The co-signer must not ask an explorer what a number means
// when it decides what to sign, so the numbers are read once, when the owner
// saves the rules, and stored beside them as policy.tickIds ({ TICKER: id }),
// the declared map both the SDK evaluator and the wallet's allowed tokens rule
// read. Signing and its approval preview never call this file.
//
// Every ticker the rules name is looked up: the allowed tokens list and the
// tokens the per-action, rolling and confirmation limits name. The chain's own
// coin has no token row and is skipped (the protocol gas token does have one,
// issued at genesis, so it is looked up like any other). The explorer has no
// batch read, so the floor is one read per distinct ticker, run in parallel.
// An answer counts only when it echoes the ticker asked for. A ticker the
// explorer does not know, a read that fails or runs past the timeout, or two
// tickers answering with one number refuse the save. A token the explorer
// knows but gives no number (an id that is not the same on every node, which
// the SDK never sends) is saved without one.

import { foldTick, nativeTickForChain, normalizeAllowedTicks } from './allowedTicks.js';

// One read may take this long before its ticker counts as not checked.
export const TICK_LOOKUP_TIMEOUT_MS = 8_000;
// The most distinct tickers one save may look up.
export const MAX_TICK_LOOKUPS = 64;

function withTimeout(promise, ms) {
    let timer;
    const expiry = new Promise((resolve) => { timer = setTimeout(() => resolve({ state: 'failed' }), ms); });
    return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
}

function isNotFound(err) {
    const status = err && err.details ? err.details.status : undefined;
    return status === 404 || (err && err.code === 'EXPLORER_HTTP_404');
}

// One ticker's answer: { state: 'found', id }, { state: 'noId' } when the
// explorer knows the token but gives no stable number, { state: 'missing' }
// when it does not know the ticker, or { state: 'failed' }.
async function readOne(sdk, tick) {
    let info;
    try {
        if (typeof sdk.findToken === 'function') {
            info = await sdk.findToken(tick, { noRetry: true });
        } else if (typeof sdk.getToken === 'function') {
            const raw = await sdk.getToken(tick, { noRetry: true });
            const row = Array.isArray(raw) ? raw[0] : raw;
            info = row && row.info;
        } else {
            return { state: 'failed' };
        }
    } catch (err) {
        return { state: isNotFound(err) ? 'missing' : 'failed' };
    }
    if (info === null || info === undefined) return { state: 'missing' };
    if (typeof info !== 'object') return { state: 'failed' };
    const named = typeof info.tick === 'string' ? foldTick(info.tick.trim()) : '';
    // A row for some other ticker is no answer about this one.
    if (named !== tick) return { state: 'failed' };
    if (info.tick_id === null || info.tick_id === undefined) return { state: 'noId' };
    const id = Number(info.tick_id);
    if (!Number.isSafeInteger(id) || id <= 0) return { state: 'failed' };
    return { state: 'found', id };
}

function tableTicks(table) {
    return table && typeof table === 'object' ? Object.keys(table).filter((k) => k !== '*') : [];
}

/**
 * Every ticker a policy names, folded and de-duplicated in first-seen order:
 * the allowed tokens list, then the tokens the per-action, rolling and
 * confirmation limits name. The wildcard and the chain's own coin are left
 * out (neither has a token number).
 *
 * @param {object | null | undefined} policy
 * @param {{ nativeTick?: string | null }} [opts]
 * @returns {string[]}
 */
export function policyTickNames(policy, opts = {}) {
    if (!policy || typeof policy !== 'object') return [];
    const native = opts.nativeTick ? foldTick(opts.nativeTick) : null;
    const raw = [...(normalizeAllowedTicks(policy.allowedTicks) || [])];
    if (policy.maxPerAction && typeof policy.maxPerAction === 'object') {
        for (const action of Object.keys(policy.maxPerAction)) raw.push(...tableTicks(policy.maxPerAction[action]));
    }
    raw.push(...tableTicks(policy.maxPerWindow && policy.maxPerWindow.perTick));
    raw.push(...tableTicks(policy.confirmAbove && policy.confirmAbove.perTick));
    const out = [];
    const seen = new Set();
    for (const value of raw) {
        const tick = foldTick(String(value).trim());
        if (!tick || tick === native || tick.charAt(0) === '^' || seen.has(tick)) continue;
        seen.add(tick);
        out.push(tick);
    }
    return out;
}

/**
 * @typedef {Object} TickLookup
 * @property {Record<string, number>} ids  ticker -> token number, for the tickers that have one
 * @property {string[]} missing            tickers the explorer does not know
 * @property {string[]} failed             tickers the lookup could not check
 * @property {string[]} duplicate          tickers that answered with a number another one also has
 * @property {string[]} noId               tickers the explorer knows but gives no stable number
 */

/**
 * Look up each ticker's token number on one chain's explorer, one read per
 * distinct ticker, in parallel. Never throws.
 *
 * @param {object | null | undefined} sdk   the chain's SDK instance
 * @param {string[]} tickers
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<TickLookup>}
 */
export async function lookupTickerIds(sdk, tickers, opts = {}) {
    /** @type {TickLookup} */
    const out = { ids: {}, missing: [], failed: [], duplicate: [], noId: [] };
    const unique = [];
    for (const value of Array.isArray(tickers) ? tickers : []) {
        const tick = foldTick(String(value ?? '').trim());
        if (tick && tick.charAt(0) !== '^' && !unique.includes(tick)) unique.push(tick);
    }
    if (unique.length === 0) return out;
    if (!sdk || typeof sdk !== 'object' || unique.length > MAX_TICK_LOOKUPS) {
        out.failed = unique;
        return out;
    }
    const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : TICK_LOOKUP_TIMEOUT_MS;
    const answers = await Promise.all(unique.map((tick) => withTimeout(readOne(sdk, tick), timeoutMs)));
    const byId = new Map();
    unique.forEach((tick, i) => {
        const answer = answers[i];
        if (answer.state === 'found') {
            const owners = byId.get(answer.id) || [];
            owners.push(tick);
            byId.set(answer.id, owners);
        } else {
            out[answer.state].push(tick);
        }
    });
    for (const [id, owners] of byId) {
        if (owners.length === 1) out.ids[owners[0]] = id;
        else out.duplicate.push(...owners);
    }
    return out;
}

/**
 * The host route behind the policy editor's save: look up every ticker the
 * rules name on the account's chain.
 *
 * @param {{ sdkRegistry: { get: (chainId: string) => any }, chainRegistry?: { get: (id: string) => any }, chainId: string, ticks: string[], timeoutMs?: number }} opts
 * @returns {Promise<TickLookup>}
 */
export async function resolveCoSignerTokenIds({ sdkRegistry, chainRegistry, chainId, ticks, timeoutMs } = {}) {
    if (!sdkRegistry || typeof sdkRegistry.get !== 'function') {
        throw new Error('resolveCoSignerTokenIds: sdkRegistry is required');
    }
    if (typeof chainId !== 'string' || chainId.length === 0) {
        throw new Error('resolveCoSignerTokenIds: chainId is required');
    }
    const native = nativeTickForChain(chainId, chainRegistry || undefined);
    const wanted = (Array.isArray(ticks) ? ticks : [])
        .map((tick) => foldTick(String(tick ?? '').trim()))
        .filter((tick) => tick && tick !== native);
    let sdk = null;
    try {
        sdk = sdkRegistry.get(chainId);
    } catch {
        sdk = null;
    }
    return lookupTickerIds(sdk, wanted, { timeoutMs });
}

/**
 * Fold a lookup into the policy being saved. The tickIds map is rebuilt from
 * this lookup alone, never merged with what was stored before, so a ticker
 * the rules no longer name drops out and a stale number cannot linger. Any
 * ticker missing, unchecked or sharing a number refuses the save.
 *
 * @param {object} policy  the built policy, without tickIds
 * @param {TickLookup} lookup
 * @returns {{ ok: true, policy: object } | { ok: false, problems: Record<string, 'missing' | 'failed' | 'duplicate'> }}
 */
export function applyTickLookup(policy, lookup) {
    /** @type {Record<string, 'missing' | 'failed' | 'duplicate'>} */
    const problems = {};
    for (const tick of lookup?.missing || []) problems[tick] = 'missing';
    for (const tick of lookup?.failed || []) problems[tick] = 'failed';
    for (const tick of lookup?.duplicate || []) problems[tick] = 'duplicate';
    if (Object.keys(problems).length > 0) return { ok: false, problems };
    const { tickIds: _dropped, ...rest } = policy || {};
    const ids = lookup && lookup.ids && Object.keys(lookup.ids).length > 0 ? { ...lookup.ids } : null;
    return { ok: true, policy: ids ? { ...rest, tickIds: ids } : rest };
}
