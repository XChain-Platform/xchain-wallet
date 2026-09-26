// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Home's escrow read: what each shown address holds in its own open dispensers,
// orders and swaps, merged into the balance entries as `balances.escrow` so
// buildBalanceRows keeps a fully escrowed token on screen (see
// flows/escrowedTokens.js for why the balance read alone loses it).
//
// Deliberately slower than the balance poll. It costs three explorer reads per
// address, and Home already runs close to the zones' rate limits (see the 429
// note in Home.jsx), so it refreshes at most once a minute, only for the
// addresses Home actually shows, and a failed read keeps the last good answer
// instead of blanking the rows.

import { useEffect, useMemo, useRef, useState } from 'react';

export const ESCROW_REFRESH_MS = 60000;
// Upper bound on addresses read per chain when Home shows the whole account
// rather than one active address per chain.
export const ESCROW_ADDRESSES_PER_CHAIN = 10;

/**
 * The (chainId, address) pairs Home shows: the active address where one is
 * set for the chain, otherwise the chain's entries up to the per-chain cap.
 *
 * @param {Record<string, any[]> | null} balances
 * @param {Record<string, { address: string }> | null} activeByChain
 * @returns {Array<{ chainId: string, address: string }>}
 */
export function escrowTargets(balances, activeByChain) {
    const out = [];
    for (const [chainId, entries] of Object.entries(balances || {})) {
        if (!Array.isArray(entries)) continue;
        const active = activeByChain?.[chainId]?.address;
        const addresses = active
            ? [active]
            : [...new Set(entries.map((e) => e?.address).filter(Boolean))].slice(0, ESCROW_ADDRESSES_PER_CHAIN);
        for (const address of addresses) out.push({ chainId, address });
    }
    return out;
}

/**
 * Merge escrow rows (keyed `chainId:address`) into balance entries without
 * touching entries that have none.
 *
 * @param {Record<string, any[]> | null} balances
 * @param {Record<string, Array<{ tick: string, amount: string }>>} escrowByKey
 */
export function mergeEscrow(balances, escrowByKey) {
    if (!balances) return balances;
    let changed = false;
    const out = {};
    for (const [chainId, entries] of Object.entries(balances)) {
        out[chainId] = !Array.isArray(entries) ? entries : entries.map((entry) => {
            const escrow = escrowByKey[`${chainId}:${entry?.address}`];
            if (!escrow || escrow.length === 0 || !entry?.balances) return entry;
            changed = true;
            return { ...entry, balances: { ...entry.balances, escrow } };
        });
    }
    return changed ? out : balances;
}

/**
 * @param {{ balances: Record<string, any[]> | null, activeByChain: Record<string, { address: string }> | null,
 *           balancesFetchedAt?: number | null, messaging: any }} args
 * @returns {Record<string, any[]> | null} `balances` with escrow merged in
 */
export function useEscrowedBalances({ balances, activeByChain, balancesFetchedAt, messaging }) {
    const [escrowByKey, setEscrowByKey] = useState(/** @type {Record<string, any[]>} */ ({}));
    const lastRunRef = useRef({ key: '', at: 0 });
    // Unmount only, not effect re-runs: a balance refresh inside the throttle
    // window re-runs the effect and skips, and must not drop the read in flight.
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);
    const targets = useMemo(() => escrowTargets(balances, activeByChain), [balances, activeByChain]);
    const targetKey = targets.map((t) => `${t.chainId}:${t.address}`).join('|');

    useEffect(() => {
        if (!targetKey || typeof messaging?.getEscrowedTokens !== 'function') return undefined;
        const now = Date.now();
        const last = lastRunRef.current;
        if (last.key === targetKey && now - last.at < ESCROW_REFRESH_MS) return undefined;
        lastRunRef.current = { key: targetKey, at: now };
        Promise.all(targets.map((t) => messaging.getEscrowedTokens({ chainId: t.chainId, address: t.address })
            .then((r) => [`${t.chainId}:${t.address}`, Array.isArray(r?.rows) ? r.rows : null])
            .catch(() => [`${t.chainId}:${t.address}`, null])))
            .then((pairs) => {
                if (!mountedRef.current) return;
                setEscrowByKey((prev) => {
                    const next = {};
                    for (const [key, rows] of pairs) next[key] = rows ?? prev[key] ?? [];
                    return next;
                });
            });
        return undefined;
    // `targets` is derived from targetKey; balancesFetchedAt re-arms the refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [targetKey, balancesFetchedAt, messaging]);

    return useMemo(() => mergeEscrow(balances, escrowByKey), [balances, escrowByKey]);
}
