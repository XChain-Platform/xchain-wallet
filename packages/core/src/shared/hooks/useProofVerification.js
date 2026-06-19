// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// useProofVerification (§7/§8). Given the per-address `balances` shape
// Home holds, fan out an SPV proof check for every (address, token) pair
// via `messaging.verifyBalance`, and reduce the per-address verdicts into
// a per-row (`chainId:tick`) verdict the balance list can badge.
//
// Progressive enhancement: the fast balance path renders first; this runs
// after, bounded by a small concurrency pool, and the returned map fills
// in as proofs resolve. Native coins are never verified (not in the state
// SMT). A row is `verified` only if EVERY contributing address verified;
// any `failed` makes the row `failed` (a server that cannot back its own
// number); otherwise `unavailable` (thin replica / pre-commitment), and
// `pending` while proofs are still in flight.
//
// The pure pieces (job collection, verdict reduction) are exported and
// unit-tested directly; the hook just wires them to React state + the
// concurrency pool.

import { useEffect, useState } from 'react';

const POOL = 6;

/**
 * Collect one verification job per (chainId, address, token tick) from the
 * per-address balances shape. Only token rows are provable; the native coin
 * is intentionally skipped (it is not in the state SMT).
 *
 * @param {Record<string, Array<{ address: string, balances?: { tokens?: Array<{ tick?: string }> } }>> | null} balances
 * @returns {Array<{ chainId: string, address: string, tick: string, key: string }>}
 */
export function collectBalanceJobs(balances) {
    const jobs = [];
    if (!balances || typeof balances !== 'object') return jobs;
    for (const [chainId, entries] of Object.entries(balances)) {
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
            const toks = entry?.balances?.tokens;
            if (!Array.isArray(toks)) continue;
            for (const t of toks) {
                if (!t || typeof t.tick !== 'string' || !t.tick) continue;
                jobs.push({ chainId, address: entry.address, tick: t.tick, key: `${chainId}:${t.tick}` });
            }
        }
    }
    return jobs;
}

/**
 * Reduce a per-row tally into a single verdict. Any failed address fails the
 * row; while proofs are still outstanding it is pending; otherwise it is
 * verified only when every address verified, else unavailable.
 *
 * @param {{ total: number, done: number, failed: number, verified: number }} a
 * @returns {'verified' | 'failed' | 'unavailable' | 'pending'}
 */
export function reduceBalanceVerdict(a) {
    if (a.failed > 0) return 'failed';
    if (a.done < a.total) return 'pending';
    return a.verified === a.total ? 'verified' : 'unavailable';
}

/**
 * @param {object} params
 * @param {{ verifyBalance?: (req: { chainId: string, address: string, tick: string }) => Promise<{ status: string, reason: string | null }> }} params.messaging
 * @param {Record<string, Array<{ address: string, balances?: { tokens?: Array<{ tick?: string }> } }>> | null} params.balances
 * @param {boolean} params.enabled
 * @returns {Record<string, { status: 'verified' | 'failed' | 'unavailable' | 'pending', reason: string | null }>}
 */
export function useProofVerification({ messaging, balances, enabled }) {
    const [verifyMap, setVerifyMap] = useState(/** @type {Record<string, any>} */ ({}));

    useEffect(() => {
        if (!enabled || !balances || typeof messaging?.verifyBalance !== 'function') {
            setVerifyMap({});
            return undefined;
        }
        const jobs = collectBalanceJobs(balances);
        if (jobs.length === 0) {
            setVerifyMap({});
            return undefined;
        }

        let cancelled = false;
        // Seed every row as pending; tally per key as verdicts arrive.
        const agg = new Map(); // key -> { total, done, failed, verified, lastReason }
        const seed = {};
        for (const j of jobs) {
            const a = agg.get(j.key) || { total: 0, done: 0, failed: 0, verified: 0, lastReason: null };
            a.total += 1;
            agg.set(j.key, a);
            seed[j.key] = { status: 'pending', reason: null };
        }
        setVerifyMap(seed);

        let cursor = 0;
        const worker = async () => {
            while (!cancelled && cursor < jobs.length) {
                const j = jobs[cursor++];
                let res;
                try {
                    res = await messaging.verifyBalance({ chainId: j.chainId, address: j.address, tick: j.tick });
                } catch (e) {
                    res = { status: 'unavailable', reason: e && e.message ? String(e.message) : 'verify failed' };
                }
                if (cancelled) return;
                const a = agg.get(j.key);
                a.done += 1;
                if (res && res.status === 'failed') a.failed += 1;
                else if (res && res.status === 'verified') a.verified += 1;
                else if (res && res.reason) a.lastReason = res.reason;
                const status = reduceBalanceVerdict(a);
                setVerifyMap((prev) => ({
                    ...prev,
                    [j.key]: { status, reason: status === 'verified' || status === 'pending' ? null : a.lastReason },
                }));
            }
        };

        const pool = Math.min(POOL, jobs.length);
        Promise.all(Array.from({ length: pool }, () => worker())).catch(() => { /* per-job errors already folded in */ });

        return () => { cancelled = true; };
    }, [messaging, balances, enabled]);

    return verifyMap;
}

/**
 * Verify a list of actions against quorum-signed checkpoints via
 * `messaging.verifyAction`, keyed by each item's `key`. Used by the
 * History timeline (one item per visible, checkpointable entry). Re-runs
 * only when the SET of keys changes (a stable signature dep), not on every
 * filter-driven array re-create. An action whose block is not yet
 * checkpointed resolves to `unavailable` (reason `NOT_YET_CHECKPOINTED`).
 *
 * @param {object} params
 * @param {{ verifyAction?: (req: { chainId: string, actionIndex: string | number }) => Promise<{ status: string, reason: string | null }> }} params.messaging
 * @param {Array<{ key: string, chainId: string, actionIndex: string | number }>} params.items
 * @param {boolean} params.enabled
 * @returns {Record<string, { status: 'verified' | 'failed' | 'unavailable' | 'pending', reason: string | null }>}
 */
export function useActionProofVerification({ messaging, items, enabled }) {
    const [verifyMap, setVerifyMap] = useState(/** @type {Record<string, any>} */ ({}));
    const list = Array.isArray(items) ? items : [];
    const sig = list.map((i) => i.key).join('|');

    useEffect(() => {
        if (!enabled || typeof messaging?.verifyAction !== 'function' || list.length === 0) {
            setVerifyMap({});
            return undefined;
        }
        let cancelled = false;
        const seed = {};
        for (const it of list) seed[it.key] = { status: 'pending', reason: null };
        setVerifyMap(seed);

        let cursor = 0;
        const worker = async () => {
            while (!cancelled && cursor < list.length) {
                const it = list[cursor++];
                let res;
                try {
                    res = await messaging.verifyAction({ chainId: it.chainId, actionIndex: it.actionIndex });
                } catch (e) {
                    res = { status: 'unavailable', reason: e && e.message ? String(e.message) : 'verify failed' };
                }
                if (cancelled) return;
                const status = res && res.status ? res.status : 'unavailable';
                setVerifyMap((prev) => ({
                    ...prev,
                    [it.key]: { status, reason: status === 'verified' ? null : (res && res.reason) || null },
                }));
            }
        };

        const pool = Math.min(POOL, list.length);
        Promise.all(Array.from({ length: pool }, () => worker())).catch(() => { /* per-job errors already folded in */ });

        return () => { cancelled = true; };
    // `sig` captures the set of keys; `list` identity changes on every
    // filter render but its contents (and thus the work) do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messaging, enabled, sig]);

    return verifyMap;
}
