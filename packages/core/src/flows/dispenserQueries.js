// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// dispenserQueries: thin wrappers around the SDK's explorer methods
// for the §40.7.2 "My dispensers" + detail surfaces. Single-chain
// read-only queries; no vault, no signing.
//
// The explorer's /dispensers/{QUERY}/{TYPE} endpoint supports types
// [block, address, source, destination, token]. "source" returns
// dispensers the given address opened (owner-facing); "address"
// returns dispensers where the given address is source OR dispenser
// address; "token" filters by GIVE_TICK or GET_TICK. We expose each
// lane as a dedicated helper so callers don't reach for magic strings.
//
// Indexer surface is still incomplete (see xchain-explorer/db.js's
// getDispensers TODO: GIVE_ESCROW / current stock / dispense count
// aren't returned yet). Callers render what's present and fall back
// to a placeholder for missing fields.

/**
 * @typedef {Object} DispenserQueryOpts
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {string} [address]                  source address (owner) or dispenser address
 * @property {string} [token]                    GIVE_TICK or GET_TICK filter
 * @property {string} [actionIndex]              fetch one dispenser by action index
 * @property {object} [opts]                     passed through to the SDK call (pagination etc.)
 */

/**
 * List dispensers opened by a given address ("My dispensers").
 * @param {DispenserQueryOpts} params
 */
export async function dispensersForSource({ sdkRegistry, chainId, address, opts }) {
    if (!sdkRegistry) throw new Error('dispensersForSource: sdkRegistry is required');
    if (!chainId) throw new Error('dispensersForSource: chainId is required');
    if (!address) throw new Error('dispensersForSource: address is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getDispensers(address, 'source', opts);
}

/**
 * List dispensers where the address is either source OR dispenser
 * address. Useful when the address is both owner + vendor.
 * @param {DispenserQueryOpts} params
 */
export async function dispensersForAddress({ sdkRegistry, chainId, address, opts }) {
    if (!sdkRegistry) throw new Error('dispensersForAddress: sdkRegistry is required');
    if (!chainId) throw new Error('dispensersForAddress: chainId is required');
    if (!address) throw new Error('dispensersForAddress: address is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getDispensers(address, 'address', opts);
}

/**
 * List dispensers filtered by token (GIVE_TICK or GET_TICK).
 * Used by the buyer-facing explorer in Step 22b.
 * @param {DispenserQueryOpts} params
 */
export async function dispensersForToken({ sdkRegistry, chainId, token, opts }) {
    if (!sdkRegistry) throw new Error('dispensersForToken: sdkRegistry is required');
    if (!chainId) throw new Error('dispensersForToken: chainId is required');
    if (!token) throw new Error('dispensersForToken: token is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getDispensers(token, 'token', opts);
}

/**
 * Fetch a single dispenser (and the associated DISPENSER action) by
 * action index. Used by the detail page.
 * @param {DispenserQueryOpts} params
 */
export async function dispenserByActionIndex({ sdkRegistry, chainId, actionIndex }) {
    if (!sdkRegistry) throw new Error('dispenserByActionIndex: sdkRegistry is required');
    if (!chainId) throw new Error('dispenserByActionIndex: chainId is required');
    if (!actionIndex) throw new Error('dispenserByActionIndex: actionIndex is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getAction(actionIndex);
}

/**
 * The terms a dispenser is running under RIGHT NOW (D-39).
 *
 * A dispenser's create columns are frozen at creation, so status stays
 * 'valid' and expiration / allow / block keep their original values however
 * the dispenser later behaves. Everything that moves - the 1-hour
 * 'cancelling' close window, expiry, sold-out, an edited expiration or
 * list, escrow drawn down by fills - arrives in the `state` block the
 * by-action-index read path returns beside them.
 *
 * Reading the create columns instead left the detail page's status at
 * 'valid' forever, which disabled Close / Refill / Edit on every real
 * dispenser and hid the close-window banner. `current_status` is the
 * list-lane spelling of the same thing; demo fixtures carry only `status`.
 *
 * @param {any} dispenser dispenser row / flattened DISPENSER action
 * @returns {{ status: string, expiration: any, allowList: any, blockList: any, giveRemaining: any }}
 */
export function dispenserLiveState(dispenser) {
    const state = dispenser?.state || {};
    return {
        status: String(state.status || dispenser?.current_status || dispenser?.status || ''),
        expiration: state.expiration ?? dispenser?.expiration,
        allowList: state.allow_list ?? dispenser?.allow_list,
        blockList: state.block_list ?? dispenser?.block_list,
        giveRemaining: state.give_remaining
            ?? dispenser?.escrow_remaining
            ?? dispenser?.give_remaining
            ?? null,
    };
}

/**
 * Keep only the fills that belong to ONE dispenser (D-38).
 *
 * A dispense row names its dispenser through `dispenser_action_index`, and
 * that is the only key that separates two dispensers sharing an address -
 * the normal case, because a dispenser opens on its creator's source. Ticks
 * cannot do it: the pair may be identical, and a coin-paid fill carries
 * `get_tick` NULL, which an `||` fallback lets match any dispenser.
 *
 * Explorers older than the `dispenser` query lane omit the key. Those rows
 * fall back to the tick comparison, which over-reports rather than showing a
 * dispenser no history at all.
 *
 * Every returned row carries a `valid` boolean beside the explorer's own
 * `status`. The explorer serves refused dispenses too (a payment the list
 * barred, a payer equal to the pay-to address), each with its attempted
 * `give_amount` intact, and nothing moved on those. One flag here keeps the
 * fills tab, the lifecycle timeline and the vended total agreeing on what
 * counts; a row with no status at all is a fill from an explorer that
 * predates the column and is taken as valid.
 *
 * @param {any[]} rows              dispense rows as returned by the explorer
 * @param {string|number} actionIndex  the dispenser's action index
 * @param {{ give_tick?: string, get_tick?: string|null }} [dispenser] for the fallback
 * @returns {any[]} the rows belonging to this dispenser, each tagged `valid`
 */
export function dispensesOfDispenser(rows, actionIndex, dispenser) {
    if (!Array.isArray(rows)) return [];
    return rows
        .filter((d) => (
            d?.dispenser_action_index != null
                ? String(d.dispenser_action_index) === String(actionIndex)
                : String(d?.get_tick || dispenser?.get_tick) === String(dispenser?.get_tick)
                    && String(d?.give_tick || dispenser?.give_tick) === String(dispenser?.give_tick)
        ))
        .map((d) => ({ ...d, valid: dispenseIsValid(d) }));
}

/**
 * Did this dispense row move tokens? The indexer writes `valid` for a fill it
 * honoured and `invalid: <reason>` for one it refused.
 *
 * @param {{ status?: string|null } | null | undefined} row
 * @returns {boolean}
 */
export function dispenseIsValid(row) {
    const status = String(row?.status ?? 'valid').trim().toLowerCase();
    return status === '' || status === 'valid';
}

/**
 * The reason an explorer attached to a refused dispense, without the
 * `invalid:` prefix, or '' for a valid row or a bare `invalid`.
 *
 * @param {{ status?: string|null } | null | undefined} row
 * @returns {string}
 */
export function dispenseInvalidReason(row) {
    if (dispenseIsValid(row)) return '';
    return String(row?.status ?? '').replace(/^\s*invalid\s*:?\s*/i, '').trim();
}

/**
 * Total `give_amount` across the rows that actually dispensed, as an exact
 * plain-decimal string; null when no row counts. Rows are the tagged output of
 * dispensesOfDispenser, and a refused row contributes nothing however large
 * its attempted amount was.
 *
 * Summed at a common decimal scale with BigInt: token amounts are decimal
 * strings and float addition drifts on ordinary values ('0.1' + '0.2').
 *
 * @param {Array<{ valid?: boolean, give_amount?: string|number|null }>} rows
 * @returns {string | null}
 */
export function vendedTotal(rows) {
    if (!Array.isArray(rows)) return null;
    const amounts = rows
        .filter((d) => d && d.valid !== false)
        .map((d) => String(d.give_amount ?? '').trim())
        .filter((s) => /^\d+(\.\d+)?$/.test(s));
    if (amounts.length === 0) return null;
    const scale = Math.max(...amounts.map((s) => (s.split('.')[1] || '').length));
    let sum = 0n;
    for (const s of amounts) {
        const [int, frac = ''] = s.split('.');
        sum += BigInt(int + frac.padEnd(scale, '0'));
    }
    const digits = sum.toString().padStart(scale + 1, '0');
    const cut = digits.length - scale;
    const fracPart = digits.slice(cut).replace(/0+$/, '');
    return fracPart ? `${digits.slice(0, cut)}.${fracPart}` : digits.slice(0, cut);
}

/**
 * List dispense events (fill receipts) for a dispenser / source / address / token.
 * Used by the detail page's "Recent dispenses" list.
 * @param {{ sdkRegistry: any, chainId: string, query: string, type: 'address' | 'source' | 'destination' | 'token' | 'block' | 'dispenser', opts?: object }} params
 */
export async function dispensesFor({ sdkRegistry, chainId, query, type, opts }) {
    if (!sdkRegistry) throw new Error('dispensesFor: sdkRegistry is required');
    if (!chainId) throw new Error('dispensesFor: chainId is required');
    if (!query) throw new Error('dispensesFor: query is required');
    if (!type) throw new Error('dispensesFor: type is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getDispenses(query, type, opts);
}

/**
 * PC-21 trade lifecycle: the non-dispense dispenser lifecycle events -
 * refills/edits (DISPENSER v2), closes (SWEEP/cancel), and expirations -
 * for a source / address / token. `kind` selects the event stream; the
 * caller merges these with dispensesFor() into one chronological timeline
 * on the detail page. Thin passthrough to the PC-55 SDK wrappers.
 * 'cancels' is the OWNER's cancel action (the one that opens the 1-hour close
 * window); 'closes' is the completion the chain writes when that window ends.
 * Fetching only 'closes' left the owner's own cancel missing from the timeline
 * for the whole hour after they took it (D-45).
 * @param {{ sdkRegistry: any, chainId: string, kind: 'cancels' | 'closes' | 'edits' | 'expires', query: string, type?: string, opts?: object }} params
 */
export async function dispenserLifecycleFor({ sdkRegistry, chainId, kind, query, type, opts }) {
    if (!sdkRegistry) throw new Error('dispenserLifecycleFor: sdkRegistry is required');
    if (!chainId) throw new Error('dispenserLifecycleFor: chainId is required');
    if (!query) throw new Error('dispenserLifecycleFor: query is required');
    const fn = {
        cancels: 'getDispenserCancels',
        closes: 'getDispenserCloses',
        edits: 'getDispenserEdits',
        expires: 'getDispenserExpires',
    }[kind];
    if (!fn) throw new Error(`dispenserLifecycleFor: unknown kind ${kind}`);
    const sdk = sdkRegistry.get(chainId);
    return sdk[fn](query, type || 'address', opts);
}
