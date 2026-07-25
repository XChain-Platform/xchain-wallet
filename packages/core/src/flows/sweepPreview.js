// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// sweepPreview (PC-34): API-derived, INDICATIVE preview of what a SWEEP
// from `address` would move, per protocol category (SWEEP.md):
//
//   balances    token balances the address currently holds
//   ownerships  ticks the address is the current OWNER of (tokens table)
//   orders      open ORDERs whose give-escrow would be released
//   swaps       open SWAPs whose give-escrow would be released
//   dispensers  open DISPENSERs whose remaining escrow would be released
//
// SWEEP itself moves whatever the chain says at index time, so the
// preview is never authoritative: the form's typed-confirm copy states
// that everything in the selected categories moves, including anything
// not listed here. Each category degrades independently (a down
// explorer endpoint marks that category `error` instead of failing the
// whole preview), failing toward "preview unavailable", never toward
// blocking the sweep.
//
// `gatedTicks` backs the PC-26 warning leg and the PC-34 migrate gate:
// SWEEP hands off NO unlock keys (the gated-content rule is SEND-only),
// so any held gated tick swept to a third party strands the recipient,
// and a self-migration must carry the keys in the vault instead.

import { tokensFromBalances } from './balances.js';
import { normalizeTokenRow } from './listOwnedTokens.js';
import { listGatedFiles } from './gatedContent.js';
import { isDemoGatedActionIndex } from './demoGatedContent.js';

// Order/swap/dispenser rows whose status marks them already closed.
// Deny-list rather than an allow-list on 'open': the explorer's status
// vocabulary differs per table (and per create-vs-current column), and
// an over-inclusive preview only over-states what moves - the safe
// direction for an indicative display.
const CLOSED_STATUSES = new Set([
    'cancelled', 'cancelling', 'closed', 'expired', 'filled', 'invalid',
]);

function rowsOf(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    return [];
}

function liveStatus(row) {
    return String(row?.current_status || row?.status || '').toLowerCase();
}

function isOpenRow(row, address) {
    const source = row?.source || row?.address;
    if (source && address && source !== address) return false;
    const status = liveStatus(row);
    if (!status) return true; // unknown status: over-state, never hide
    return !CLOSED_STATUSES.has(status);
}

async function leg(fn) {
    try {
        return { rows: await fn(), error: null };
    } catch (e) {
        return { rows: [], error: e?.message || String(e) };
    }
}

// Cap the gated-file fan-out: one explorer call per held tick. Past the
// cap the preview reports gated detection as partial rather than
// hammering the explorer for a pathological holder.
const GATED_SCAN_TICK_CAP = 25;

/**
 * @param {{
 *   sdkRegistry: import('../sdk/SDKRegistry.js').SDKRegistry,
 *   chainId: string,
 *   address: string,
 * }} params
 * @returns {Promise<{
 *   balances:   { rows: Array<{ tick: string, quantity: string, divisibility: number }>, error: string | null },
 *   ownerships: { rows: Array<{ tick: string }>, error: string | null },
 *   orders:     { rows: Array<{ actionIndex: string, giveTick: string | null, giveCoin: string | null, giveAmount: string | null, giveOwnership: boolean }>, error: string | null },
 *   swaps:      { rows: Array<{ actionIndex: string, giveTick: string | null, giveAmount: string | null, giveOwnership: boolean }>, error: string | null },
 *   dispensers: { rows: Array<{ actionIndex: string, tick: string | null, escrowRemaining: string | null, giveOwnership: boolean }>, error: string | null },
 *   gatedTicks: { rows: string[], partial: boolean, error: string | null },
 * }>}
 */
export async function sweepPreview({ sdkRegistry, chainId, address }) {
    if (!sdkRegistry) throw new Error('sweepPreview: sdkRegistry is required');
    if (!chainId) throw new Error('sweepPreview: chainId is required');
    if (typeof address !== 'string' || address.trim().length === 0) {
        throw new Error('sweepPreview: address is required');
    }
    const sdk = sdkRegistry.get(chainId);
    const trimmed = address.trim();

    const [balances, ownerships, orders, swaps, dispensers] = await Promise.all([
        leg(async () => tokensFromBalances(await sdk.getBalances(trimmed))
            .filter((t) => t.quantity != null && String(t.quantity) !== '0' && Number(t.quantity) > 0)
            .map((t) => ({ tick: t.tick, quantity: t.quantity, divisibility: t.divisibility }))),
        leg(async () => rowsOf(await sdk.getTokens(trimmed, 'address'))
            .map((r) => normalizeTokenRow(r))
            .filter((r) => r && r.tick)
            .map((r) => ({ tick: r.tick.toUpperCase() }))),
        leg(async () => rowsOf(await sdk.getOrders(trimmed, 'address'))
            .filter((r) => isOpenRow(r, trimmed))
            .map((r) => ({
                actionIndex: String(r.action_index ?? r.actionIndex ?? ''),
                giveTick: r.give_tick ?? r.giveTick ?? null,
                giveCoin: r.give_coin ?? r.giveCoin ?? null,
                giveAmount: r.give_remaining != null ? String(r.give_remaining)
                    : (r.give_amount != null ? String(r.give_amount) : null),
                giveOwnership: Number(r.give_ownership ?? r.giveOwnership ?? 0) === 1,
            }))),
        leg(async () => rowsOf(await sdk.getSwaps(trimmed, 'address'))
            .filter((r) => isOpenRow(r, trimmed))
            .map((r) => ({
                actionIndex: String(r.action_index ?? r.actionIndex ?? ''),
                giveTick: r.give_tick ?? r.giveTick ?? null,
                giveAmount: r.give_amount != null ? String(r.give_amount) : null,
                giveOwnership: Number(r.give_ownership ?? r.giveOwnership ?? 0) === 1,
            }))),
        leg(async () => rowsOf(await sdk.getDispensers(trimmed, 'source'))
            .filter((r) => isOpenRow(r, trimmed))
            .map((r) => ({
                actionIndex: String(r.action_index ?? r.actionIndex ?? ''),
                tick: r.tick ?? r.give_tick ?? null,
                escrowRemaining: r.give_remaining != null ? String(r.give_remaining)
                    : (r.escrow_remaining != null ? String(r.escrow_remaining) : null),
                giveOwnership: Number(r.give_ownership ?? r.giveOwnership ?? 0) === 1,
            }))),
    ]);

    // Gated detection over every tick the sweep can move directly
    // (balances + ownerships). Escrowed ticks ride the offer-close path
    // and reach the same DESTINATION, so include offer give-ticks too.
    const candidateTicks = new Set();
    for (const t of balances.rows) candidateTicks.add(String(t.tick).toUpperCase());
    for (const t of ownerships.rows) candidateTicks.add(String(t.tick).toUpperCase());
    for (const list of [orders.rows, swaps.rows, dispensers.rows]) {
        for (const r of list) {
            const tick = r.giveTick ?? r.tick;
            if (tick) candidateTicks.add(String(tick).toUpperCase());
        }
    }
    // Native/^id entries can never be gated ticks.
    for (const tick of [...candidateTicks]) {
        if (tick.startsWith('^') || !/^[A-Z0-9.]+$/.test(tick)) candidateTicks.delete(tick);
    }

    const scanTicks = [...candidateTicks].slice(0, GATED_SCAN_TICK_CAP);
    const gatedRows = [];
    let gatedError = null;
    for (const tick of scanTicks) {
        try {
            const groups = (await listGatedFiles({ sdk, tick })).filter((g) => {
                const files = Array.isArray(g?.files) ? g.files : [];
                return files.length > 0 && !files.every((f) => isDemoGatedActionIndex(f.actionIndex));
            });
            if (groups.length > 0) gatedRows.push(tick);
        } catch (e) {
            gatedError = gatedError || (e?.message || String(e));
        }
    }

    return {
        balances,
        ownerships,
        orders,
        swaps,
        dispensers,
        gatedTicks: {
            rows: gatedRows,
            partial: candidateTicks.size > scanTicks.length || gatedError != null,
            error: gatedError,
        },
    };
}
