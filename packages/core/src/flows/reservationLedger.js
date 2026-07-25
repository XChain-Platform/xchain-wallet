// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// In-flight approval reservation ledger ( §4.7).
//
// approvalBroker intentionally allows N concurrent approval WINDOWS. Two
// windows can each pass pre-flight against the SAME balance and both be
// approved, double-spending it. The reservation ledger closes that race:
// a window registers its approved-but-not-yet-broadcast amounts at
// Approve and releases them on a terminal state. A concurrent window's
// pre-flight nets these reservations (plus PendingTx-derived deltas)
// into `localDeltas`, so the second window warns instead of silently
// overcommitting.
//
// Release ordering (normative): on broadcast success the PendingTx row
// is written BEFORE the reservation is released, so a concurrent window
// transiently double-counts (conservative) rather than seeing neither.
//
// Backing store:
//   - web / desktop: pure in-memory Map (no SW-kill hazard).
//   - extension:     chrome.storage.session (survives the MV3 SW kill
//                    §5.4 tests); the host passes a session-storage
//                    adapter satisfying the { load, save } contract.

/**
 * @typedef {{ id: string, chainId: string, tick: string, amount: string, address?: string }} Reservation
 *
 * `address` (optional) tags the reservation with the funds' source
 * address so PC-34's force-close path can release exactly the holds
 * belonging to a swept address (releaseByAddress). Untagged entries are
 * never matched by that path - holds from older sessions err toward
 * staying reserved, the conservative direction.
 */

/**
 * @typedef {Object} ReservationStore
 * @property {() => Promise<Reservation[]> | Reservation[]} load
 * @property {(entries: Reservation[]) => Promise<void> | void} save
 */

/**
 * Create a reservation ledger. Pass a `store` (async load/save) to back
 * it with chrome.storage.session on the extension; omit it for the pure
 * in-memory web/desktop variant.
 *
 * @param {{ store?: ReservationStore }} [opts]
 */
export function createReservationLedger({ store } = {}) {
    /** @type {Reservation[]} */
    let mem = [];
    let hydrated = !store;

    async function ensureHydrated() {
        if (hydrated) return;
        try {
            const loaded = await store.load();
            mem = Array.isArray(loaded) ? loaded : [];
        } catch { mem = []; }
        hydrated = true;
    }

    async function persist() {
        if (!store) return;
        try { await store.save(mem.slice()); } catch { /* best-effort */ }
    }

    return {
        /**
         * Register an approved-but-not-yet-broadcast amount.
         * @param {Reservation} entry
         */
        async reserve(entry) {
            await ensureHydrated();
            if (!entry || !entry.id || !entry.chainId || !entry.tick) return;
            // Idempotent on id (re-reserve after a rehydrate must not double).
            mem = mem.filter((r) => r.id !== entry.id);
            mem.push({
                id: entry.id,
                chainId: entry.chainId,
                tick: entry.tick,
                amount: String(entry.amount),
                ...(entry.address ? { address: entry.address } : {}),
            });
            await persist();
        },

        /**
         * Release a reservation by id (terminal state: broadcast, reject, abort).
         * @param {string} id
         */
        async release(id) {
            await ensureHydrated();
            const before = mem.length;
            mem = mem.filter((r) => r.id !== id);
            if (mem.length !== before) await persist();
        },

        /**
         * Release every hold tagged with this (chainId, address) pair
         * (PC-34: a SWEEP force-closing the address's orders makes its
         * auto-pay holds moot). Only address-TAGGED entries match;
         * untagged holds stay put. Returns how many were released.
         * @param {string} chainId
         * @param {string} address
         */
        async releaseByAddress(chainId, address) {
            await ensureHydrated();
            if (!chainId || !address) return 0;
            const before = mem.length;
            mem = mem.filter((r) => !(r.chainId === chainId && r.address === address));
            const released = before - mem.length;
            if (released > 0) await persist();
            return released;
        },

        /**
         * Net reservations for a chain into per-tick `{tick, amount}` deltas
         * to subtract from balances (the shape sdk.preflight.localDeltas wants).
         * Excludes `excludeId` so a window never nets its OWN reservation.
         * @param {string} chainId
         * @param {string} [excludeId]
         * @returns {Promise<Array<{ tick: string, amount: string }>>}
         */
        async localDeltas(chainId, excludeId) {
            await ensureHydrated();
            /** @type {Record<string, number>} */
            const byTick = {};
            for (const r of mem) {
                if (r.chainId !== chainId || r.id === excludeId) continue;
                byTick[r.tick] = (byTick[r.tick] || 0) + Number(r.amount);
            }
            return Object.entries(byTick).map(([tick, amount]) => ({ tick, amount: String(amount) }));
        },

        /** All current reservations (for tests / diagnostics). */
        async all() {
            await ensureHydrated();
            return mem.slice();
        },
    };
}
