// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// oracleQueries (PC-30): read side of the "my oracle" surface. A PRICE v1
// oracle publishes a TOKEN price in a fiat currency; oracle-priced
// DISPENSERs (Mode B) then cross-convert it through the validator
// federation's COIN/FIAT snapshot to settle a bare coin payment.
// See claude/specs/DISPENSER_ORACLE_FIAT_PRICE_PLAN.md §2, §5.2.
//
// Two facts drive every rule in here, and both surprise people:
//
//   1. EVERY publish is effective 24h after the block it lands in, the
//      FIRST one for a pair included (xchain-hub PriceAggregator.js:383,
//      unconditional). Updates are delayed so an operator cannot watch a
//      payment arrive and rush a new price out under it; first publishes
//      are delayed for consensus, because an immediately-effective row
//      would be readable before it exists in any indexer's hub mirror and
//      would settle differently on replay. DISPENSER.md claimed the
//      opposite until 2026-07-24; it was wrong.
//
//   2. The published rows are HISTORY, not a mutable record. Publishing
//      again appends a row; the old one stays effective until the new one
//      matures. So "my current price" is the newest row whose effective_at
//      has passed, and a pending row is visible but inert.

// Seconds between a PRICE v1 publish and the moment it can price anything.
// Frozen protocol behavior, not a wallet preference: the hub applies it
// unconditionally, so the wallet only ever displays it.
export const ORACLE_ACTIVATION_DELAY_S = 86400;

function rowsOf(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    return [];
}

function num(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/**
 * The identity of an oracle feed. A publisher may run many in parallel;
 * each (coin, tick, fiat) triple is priced independently and a dispenser
 * points at one of them by naming ORACLE_ADDRESS + FIAT_CODE alongside
 * its own GIVE_COIN / GIVE_TICK.
 *
 * @param {{ coin?: string, tick?: string, fiat?: string }} row
 * @returns {string}
 */
export function pairKey(row) {
    return [
        String(row?.coin || '').toUpperCase(),
        String(row?.tick || '').toUpperCase(),
        String(row?.fiat || '').toUpperCase(),
    ].join('/');
}

/**
 * @typedef {Object} OracleQuote
 * @property {string} key                  pairKey()
 * @property {string} coin
 * @property {string} tick
 * @property {string} fiat
 * @property {string | null} value         the published price, as the decimal string that was signed
 * @property {string | null} fee           oracle usage fee as a fraction ('0.01' = 1%)
 * @property {number | null} blockTime      when the publish was mined
 * @property {number | null} effectiveAt    when it starts (or started) pricing
 * @property {boolean} effective            effective_at has passed
 * @property {number | null} secondsUntilEffective  null once effective
 * @property {string | null} memo
 * @property {number | null} actionIndex
 */

/**
 * @typedef {Object} OracleFeed
 * @property {string} key
 * @property {string} coin
 * @property {string} tick
 * @property {string} fiat
 * @property {OracleQuote | null} live      newest quote already in effect; null while the first publish matures
 * @property {OracleQuote | null} pending   newest quote not yet in effect; null when nothing is maturing
 * @property {OracleQuote[]} history        every quote for this pair, newest first
 */

/**
 * Shape one raw oracle_prices row into a quote, resolved against a clock.
 *
 * @param {object} row
 * @param {number} nowSec   epoch seconds; the caller supplies it so this stays pure
 * @returns {OracleQuote}
 */
export function toQuote(row, nowSec) {
    const effectiveAt = num(row?.effective_at ?? row?.effectiveAt);
    const effective = effectiveAt == null ? false : effectiveAt <= nowSec;
    return {
        key: pairKey(row),
        coin: String(row?.coin || '').toUpperCase(),
        tick: String(row?.tick || '').toUpperCase(),
        fiat: String(row?.fiat || '').toUpperCase(),
        value: row?.value == null || row.value === '' ? null : String(row.value),
        fee: row?.fee == null || row.fee === '' ? null : String(row.fee),
        blockTime: num(row?.block_time ?? row?.blockTime),
        effectiveAt,
        effective,
        secondsUntilEffective: effective || effectiveAt == null ? null : effectiveAt - nowSec,
        memo: row?.memo ?? null,
        actionIndex: num(row?.action_index ?? row?.actionIndex),
    };
}

/**
 * Every feed this address publishes, each resolved into its live quote and
 * its pending (still-maturing) quote.
 *
 * Ordering matters and is not the API's: rows come back id-ordered, which
 * is mirror-insertion order, not publish order. Sort on effective_at with
 * action_index as the tiebreak, the same key the indexer's matcher walks
 * (`getOraclePricesInTimeRange` orders `effective_at DESC, action_index
 * DESC`), so the wallet names the same "newest" row settlement would pick.
 *
 * @param {{
 *   sdkRegistry: import('../sdk/SDKRegistry.js').SDKRegistry,
 *   chainId: string,
 *   address: string,
 *   nowSec?: number,
 * }} params
 * @returns {Promise<OracleFeed[]>}
 */
export async function myOracleFeeds({ sdkRegistry, chainId, address, nowSec }) {
    if (!sdkRegistry) throw new Error('myOracleFeeds: sdkRegistry is required');
    if (!chainId) throw new Error('myOracleFeeds: chainId is required');
    if (!address) throw new Error('myOracleFeeds: address is required');
    const now = nowSec == null ? Math.floor(Date.now() / 1000) : nowSec;
    const sdk = sdkRegistry.get(chainId);
    if (typeof sdk.getOraclePrices !== 'function') return [];

    const resp = await sdk.getOraclePrices(String(address), 'address');
    const quotes = rowsOf(resp).map((r) => toQuote(r, now));

    /** @type {Map<string, OracleQuote[]>} */
    const byPair = new Map();
    for (const q of quotes) {
        if (!byPair.has(q.key)) byPair.set(q.key, []);
        byPair.get(q.key).push(q);
    }

    const feeds = [];
    for (const [key, list] of byPair) {
        list.sort((a, b) => {
            const ae = a.effectiveAt ?? 0;
            const be = b.effectiveAt ?? 0;
            if (ae !== be) return be - ae;
            return (b.actionIndex ?? 0) - (a.actionIndex ?? 0);
        });
        feeds.push({
            key,
            coin: list[0].coin,
            tick: list[0].tick,
            fiat: list[0].fiat,
            live: list.find((q) => q.effective) || null,
            pending: list.find((q) => !q.effective) || null,
            history: list,
        });
    }
    feeds.sort((a, b) => a.key.localeCompare(b.key));
    return feeds;
}

/**
 * Dispensers currently priced by this oracle address. An operator should
 * see these before republishing: they settle at whatever price matures,
 * and the publisher cannot take it back for 24h.
 *
 * Returns `{ supported: false }` against an explorer too old to carry the
 * `oracle` lane, so the form can say "cannot check" rather than "none",
 * which would read as an all-clear it has not earned.
 *
 * @param {{
 *   sdkRegistry: import('../sdk/SDKRegistry.js').SDKRegistry,
 *   chainId: string,
 *   address: string,
 * }} params
 * @returns {Promise<{ supported: boolean, dispensers: object[] }>}
 */
export async function oracleConsumers({ sdkRegistry, chainId, address }) {
    if (!sdkRegistry) throw new Error('oracleConsumers: sdkRegistry is required');
    if (!chainId) throw new Error('oracleConsumers: chainId is required');
    if (!address) throw new Error('oracleConsumers: address is required');
    const sdk = sdkRegistry.get(chainId);
    if (typeof sdk.getDispensers !== 'function') return { supported: false, dispensers: [] };
    try {
        const resp = await sdk.getDispensers(String(address), 'oracle');
        const open = rowsOf(resp).filter((r) => String(r.status || 'valid') === 'valid');
        return { supported: true, dispensers: open };
    } catch {
        return { supported: false, dispensers: [] };
    }
}

/**
 * Percentage move from a previously published price to a proposed one.
 * The comparison basis is deliberately the publisher's OWN prior on-chain
 * value, not an external market feed: the wallet has no trustworthy
 * outside price for an arbitrary token, and inventing one would put a
 * third party in the path of a consensus input.
 *
 * @param {string | number | null} prevValue
 * @param {string | number | null} nextValue
 * @returns {number | null}   signed percent, null when there is nothing to compare
 */
export function quoteDeviationPct(prevValue, nextValue) {
    const prev = num(prevValue);
    const next = num(nextValue);
    if (prev == null || next == null || prev === 0) return null;
    return ((next - prev) / prev) * 100;
}

/**
 * Format a countdown to a quote becoming effective. Coarse on purpose: a
 * to-the-second countdown on a 24h delay implies a precision the block
 * clock does not have.
 *
 * @param {number | null} seconds
 * @returns {string | null}
 */
export function activationCountdownText(seconds) {
    if (seconds == null || seconds <= 0) return null;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours >= 1) return `${hours}h ${minutes}m`;
    if (minutes >= 1) return `${minutes}m`;
    return 'under a minute';
}
