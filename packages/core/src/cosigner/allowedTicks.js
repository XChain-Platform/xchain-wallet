// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Allowed tokens rule for agent accounts.
//
// The SDK policy evaluator binds actions, recipients and amounts but has no
// notion of which tokens an agent may touch, so the wallet checks that here,
// on both co-sign paths (the approval preview and the signing decision),
// after the SDK verdict allows the action.
//
// policy.allowedTicks has three states:
//   - absent or null: any token (accounts made before the rule read this way)
//   - []:             no tokens; the agent may move only the chain's own coin
//   - ['MYTOKEN', …]: only the listed tokens
//
// The check fails closed: every token an action names counts (both legs of
// an order or swap, a dividend's payout token, a vote's governance token and
// its gas escrow). The SDK sends tokens as ^<id> references by default, so a
// reference is matched to its ticker through the policy's declared tickIds
// map only, the same map the SDK evaluator reads. The signing decision never
// asks an explorer what a number means: the map is written when the owner
// saves the rules (tickIdResolver.js), and a number it does not list is
// refused with the SDK's own code until the rules are saved again. While any
// list is set, an action whose tokens the action string cannot show is
// refused too: a
// whole-balance sweep, a command bundle, a contract call, and any action that
// names no token but moves a value only an on-chain object it references
// defines (cancelling or topping up a referenced order or dispenser, a bet on
// a referenced market).

import { defaultRegistry } from '../registry/index.js';
import { tickerForCoin } from '../registry/coinTicker.js';
import {
    foldTick, normalizeAllowedTicks, normalizeTickIds, ownValue,
} from '../schemas/policyTicks.js';

export const TOKEN_NOT_ALLOWED = 'POLICY_TOKEN_NOT_ALLOWED';
// The SDK evaluator's code for a ^<id> its policy's tickIds do not name, so the
// approval screen gives one reason whichever check refused the number.
export const TOKEN_UNRESOLVED = 'POLICY_UNRESOLVED_TICK';
export const TOKEN_UNCHECKABLE = 'POLICY_TOKEN_UNCHECKABLE';

// The protocol gas token. Capability STAKE, the gas-token XBRIDGE versions and
// every VOTE escrow spend it without naming it in a TICK field.
export const GAS_TICK = 'XCHAIN';

// Actions that spend the gas token when they carry no TICK of their own.
const GAS_DEFAULT_ACTIONS = new Set(['STAKE', 'XBRIDGE']);
// Actions whose v0 escrows gas, whatever their TICK field names.
const GAS_ALWAYS_ACTIONS = new Set(['VOTE']);
// Actions whose moved tokens the action string never shows: a sweep moves
// every token held, a bundle carries sub-commands, a contract call moves
// whatever the contract's code decides.
const UNCHECKABLE_ACTIONS = new Set(['SWEEP', 'BATCH', 'EXECUTE']);

// The stored-form normalizers live beside the account schema, which validates
// with them; the evaluator re-exports them so its callers keep one import.
export { foldTick, normalizeAllowedTicks, normalizeTickIds };

/**
 * Which mode a stored policy is in, for the editor and the read surfaces.
 *
 * @param {{ allowedTicks?: unknown } | null | undefined} policy
 * @returns {'any' | 'none' | 'list'}
 */
export function allowedTicksMode(policy) {
    const list = normalizeAllowedTicks(policy?.allowedTicks);
    if (list === null) return 'any';
    return list.length === 0 ? 'none' : 'list';
}

// A param names a token when its field name ends in TICK or TICKER, in the
// decoder's UPPER_SNAKE form or the session layer's camelCase form
// (TICK, GIVE_TICK, GET_TICK, DIVIDEND_TICK, CALLBACK_TICK, giveTick, …).
function isTickField(key) {
    const upper = String(key).toUpperCase();
    return upper.endsWith('TICK') || upper.endsWith('TICKER');
}

/**
 * Every token an action names, in field order, folded and de-duplicated.
 *
 * @param {string} action
 * @param {Record<string, unknown> | null | undefined} params
 * @param {number} [version]  the decoded format version, when known
 * @returns {string[]}
 */
export function actionTicks(action, params, version) {
    const name = String(action || '').toUpperCase();
    const out = [];
    const seen = new Set();
    const add = (tick) => {
        const folded = foldTick(tick);
        if (!folded || seen.has(folded)) return;
        seen.add(folded);
        out.push(folded);
    };
    let namedOne = false;
    if (params && typeof params === 'object') {
        for (const key of Object.keys(params)) {
            if (!isTickField(key)) continue;
            const value = ownValue(params, key);
            if (value === undefined || value === null) continue;
            // A multi-leg field lists its ticks with ';', the action-string list separator.
            for (const part of String(value).split(';')) {
                const tick = part.trim();
                if (!tick) continue;
                namedOne = true;
                add(tick);
            }
        }
    }
    // A ballot (VOTE v1, v3) moves nothing; only the v0 proposal escrows gas.
    const escrowsGas = GAS_ALWAYS_ACTIONS.has(name) && (version === undefined || version === 0);
    if (escrowsGas) add(GAS_TICK);
    else if (!namedOne && GAS_DEFAULT_ACTIONS.has(name)) add(GAS_TICK);
    return out;
}

// Resolve a ^<id> reference through the policy's { NAME: id } map, the same
// declared map the SDK evaluator reads; undefined when nothing matches.
function resolveTickRef(tickIds, tick) {
    if (!tickIds || typeof tickIds !== 'object') return undefined;
    const id = String(tick).slice(1);
    for (const name of Object.keys(tickIds)) {
        if (String(ownValue(tickIds, name)) === id) return foldTick(name);
    }
    return undefined;
}

function deny(code, message, details) {
    return { ok: false, violation: { code, message, details } };
}

/**
 * Check one decoded action against the policy's allowed tokens.
 *
 * `valueUnreadable(action, version, params)` answers whether the action moves
 * a value its string cannot state (the SDK's value-derivability verdict). It
 * is asked only about an action that names no token; without it such an
 * action is refused, since nothing shows which token it moves.
 *
 * @param {{ allowedTicks?: unknown, tickIds?: Record<string, string|number> } | null | undefined} policy
 * @param {{ action: string, version?: number, params?: Record<string, unknown> | null }} actionData
 * @param {{ nativeTick?: string | null, valueUnreadable?: (action: string, version: number | undefined, params: object) => boolean }} [opts]
 * @returns {{ ok: true, violation: null } | { ok: false, violation: { code: string, message: string, details: object } }}
 */
export function evaluateAllowedTicks(policy, actionData, opts = {}) {
    const allowed = normalizeAllowedTicks(policy?.allowedTicks);
    if (allowed === null) return { ok: true, violation: null };
    const action = String(actionData?.action || '').toUpperCase();
    const uncheckable = () => deny(TOKEN_UNCHECKABLE,
        `${action} moves tokens the request does not name, so it cannot be signed while the allowed tokens are limited`,
        { action });
    if (UNCHECKABLE_ACTIONS.has(action)) return uncheckable();
    const version = Number.isInteger(actionData?.version) ? actionData.version : undefined;
    const named = actionTicks(action, actionData?.params, version);
    if (named.length === 0) {
        let unreadable = true;
        if (typeof opts.valueUnreadable === 'function') {
            try {
                unreadable = opts.valueUnreadable(action, actionData?.version, actionData?.params || {}) !== false;
            } catch {
                unreadable = true;
            }
        }
        return unreadable ? uncheckable() : { ok: true, violation: null };
    }
    const native = opts.nativeTick ? foldTick(opts.nativeTick) : null;
    const allowedSet = new Set(allowed);
    // Tokens named by ticker first, so a request that names an unlisted one
    // is refused for that token rather than for a number the rules do not list.
    const byTicker = named.filter((tick) => tick.charAt(0) !== '^');
    const byId = named.filter((tick) => tick.charAt(0) === '^');
    for (const ref of [...byTicker, ...byId]) {
        let tick = ref;
        if (tick.charAt(0) === '^') {
            const resolved = resolveTickRef(policy?.tickIds, tick);
            if (resolved === undefined) {
                return deny(TOKEN_UNRESOLVED,
                    `${action} names token ${tick} by number, which this account's saved rules do not list; `
                    + 'if it is one of the account\'s tokens, save the account\'s rules again to record its number',
                    { action, tick });
            }
            tick = resolved;
        }
        if (native && tick === native) continue;
        if (!allowedSet.has(tick)) {
            return deny(TOKEN_NOT_ALLOWED, `${tick} is not an allowed token`, { action, tick });
        }
    }
    return { ok: true, violation: null };
}

// A cap far above any real amount: the probe below only asks whether a cap
// could bind the action at all, never whether this one is exceeded.
const PROBE_CAP = '9'.repeat(40);

/**
 * Build the valueUnreadable question from the SDK's own policy evaluator: a
 * throwaway policy with a wildcard amount cap on the action is refused with
 * POLICY_UNBOUNDED_ACTION exactly when the SDK cannot read the value the
 * action moves from its string. Returns undefined when the SDK has no
 * evaluator, which leaves evaluateAllowedTicks failing closed.
 *
 * @param {{ coSigner?: { evaluatePolicy?: Function } } | null | undefined} sdk
 * @returns {((action: string, version: number | undefined, params: object) => boolean) | undefined}
 */
export function sdkValueUnreadable(sdk) {
    const evaluate = sdk && sdk.coSigner && sdk.coSigner.evaluatePolicy;
    if (typeof evaluate !== 'function') return undefined;
    return (action, version, params) => {
        const probe = { allowedActions: [action], maxPerAction: { [action]: { '*': PROBE_CAP } } };
        const verdict = evaluate(probe, { action, version, params });
        return Boolean(verdict && verdict.ok === false
            && verdict.violation && verdict.violation.code === 'POLICY_UNBOUNDED_ACTION');
    };
}

/**
 * The chain's own coin ticker for an agent account's chain id, or null when
 * the registry does not know the chain (then no coin is exempt).
 *
 * @param {string} chainId
 * @param {{ get: (id: string) => any }} [chainRegistry]
 * @returns {string | null}
 */
export function nativeTickForChain(chainId, chainRegistry = defaultRegistry()) {
    try {
        const descriptor = chainRegistry && typeof chainRegistry.get === 'function'
            ? chainRegistry.get(chainId)
            : null;
        // The protocol's name for the coin, not a custom chain's display override.
        return descriptor ? tickerForCoin(descriptor.coin) : null;
    } catch {
        return null;
    }
}
