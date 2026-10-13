// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Cumulative supply series for one token, folded from the explorer's mint,
// destroy and issue rows. Supply is the sum of the genesis ISSUE's MINT_SUPPLY
// and every MINT, less every DESTROY; later ISSUE rows only amend parameters
// and add nothing. The series is then reconciled against the token's current
// supply, so a gap (fees destroyed, rows not yet indexed) shows up as a delta
// instead of a chart that quietly disagrees with the token page.
//
// Amounts are decimal strings of up to 18 places. They are folded as BigInt
// scaled to 18 places so a long series never drifts the way float sums do.

const SCALE = 18;
const AMOUNT_RE = /^(-?)(\d+)(?:\.(\d*))?$/;

function toScaled(value) {
    if (value == null || value === '') return null;
    const m = AMOUNT_RE.exec(String(value).trim());
    if (!m) return null;
    const frac = (m[3] ?? '').slice(0, SCALE).padEnd(SCALE, '0');
    const n = BigInt(m[2]) * 10n ** BigInt(SCALE) + BigInt(frac);
    return m[1] === '-' ? -n : n;
}

function fromScaled(n) {
    const neg = n < 0n;
    const abs = neg ? -n : n;
    const unit = 10n ** BigInt(SCALE);
    const whole = (abs / unit).toString();
    const frac = (abs % unit).toString().padStart(SCALE, '0').replace(/0+$/, '');
    return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

function rowsOf(res) {
    if (Array.isArray(res)) return res;
    return Array.isArray(res?.data) ? res.data : [];
}

function orderKey(row) {
    const block = Number(row.block_index ?? row.block ?? 0);
    const action = Number(row.action_index ?? row.tx_index ?? 0);
    return [Number.isFinite(block) ? block : 0, Number.isFinite(action) ? action : 0];
}

function byChainOrder(a, b) {
    const [ab, aa] = orderKey(a.row);
    const [bb, ba] = orderKey(b.row);
    return ab - bb || aa - ba || a.seq - b.seq;
}

/**
 * Fold explorer rows into a cumulative supply series.
 *
 * Rows with an unparseable amount are skipped and counted in `skipped`. Only
 * the earliest issue row contributes its `mint_supply`.
 *
 * @param {{ mints?: object[], destroys?: object[], issues?: object[] }} rows
 * @returns {{ points: Array<{ kind: 'issue'|'mint'|'destroy', blockIndex: number, actionIndex: number|null, delta: string, supply: string }>, supply: string, skipped: number }}
 */
export function foldSupplyHistory({ mints = [], destroys = [], issues = [] } = {}) {
    let skipped = 0;
    const events = [];
    let seq = 0;
    const push = (kind, row, sign, raw) => {
        const amount = toScaled(raw);
        if (amount == null) {
            skipped += 1;
            return;
        }
        events.push({ kind, row, delta: sign * amount, seq: seq++ });
    };

    const genesis = [...issues].map((row, i) => ({ row, seq: i })).sort(byChainOrder)[0]?.row;
    if (genesis && genesis.mint_supply != null && genesis.mint_supply !== '') {
        push('issue', genesis, 1n, genesis.mint_supply);
    }
    for (const row of mints) push('mint', row, 1n, row?.amount);
    for (const row of destroys) push('destroy', row, -1n, row?.amount);

    events.sort(byChainOrder);
    let running = 0n;
    const points = events.map((e) => {
        running += e.delta;
        const [blockIndex, actionIndex] = orderKey(e.row);
        return {
            kind: e.kind,
            blockIndex,
            actionIndex: e.row.action_index != null || e.row.tx_index != null ? actionIndex : null,
            delta: fromScaled(e.delta),
            supply: fromScaled(running),
        };
    });
    return { points, supply: fromScaled(running), skipped };
}

/**
 * Compare a folded supply with the token's current supply.
 *
 * `delta` is current minus folded; `reconciled` is true only when both are
 * known and equal. An unknown current supply is not a mismatch, so it reports
 * `reconciled: null` and no delta.
 *
 * @param {string} folded
 * @param {string|number|null|undefined} current
 */
export function reconcileSupply(folded, current) {
    const cur = toScaled(current);
    if (cur == null) return { current: null, delta: null, reconciled: null };
    const delta = cur - (toScaled(folded) ?? 0n);
    return { current: fromScaled(cur), delta: fromScaled(delta), reconciled: delta === 0n };
}

async function fetchRows(sdk, method, tick, opts) {
    if (typeof sdk[method] !== 'function') return [];
    return rowsOf(await sdk[method](tick, 'token', opts));
}

/**
 * Cumulative supply series for one token, reconciled against current supply.
 *
 * @param {{ sdkRegistry: { get(chainId: string): any }, chainId: string, tick: string, opts?: object }} params
 */
export async function supplyHistoryFor({ sdkRegistry, chainId, tick, opts } = {}) {
    if (!sdkRegistry) throw new Error('supplyHistoryFor: sdkRegistry is required');
    if (!chainId) throw new Error('supplyHistoryFor: chainId is required');
    if (!tick) throw new Error('supplyHistoryFor: tick is required');
    const sdk = sdkRegistry.get(chainId);
    const [mints, destroys, issues, token] = await Promise.all([
        fetchRows(sdk, 'getMints', tick, opts),
        fetchRows(sdk, 'getDestroys', tick, opts),
        fetchRows(sdk, 'getIssues', tick, opts),
        typeof sdk.getToken === 'function' ? sdk.getToken(tick) : null,
    ]);
    const row = Array.isArray(token) ? token[0] : token;
    const folded = foldSupplyHistory({ mints, destroys, issues });
    return {
        tick,
        chainId,
        points: folded.points,
        supply: folded.supply,
        skipped: folded.skipped,
        ...reconcileSupply(folded.supply, row?.supply?.current),
    };
}
