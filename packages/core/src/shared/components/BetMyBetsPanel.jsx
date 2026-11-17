// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The wallet's bets for Bet Markets: one loader for every bet across ALL of
// the wallet's addresses, and the card chip that names this wallet's stake.
// Bet Markets' My bets tab is the All list narrowed to the markets these bets
// sit in (operator ruling 2026-11-13), so there is no separate bets renderer.

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDecimalAmount } from '../utils/amountFormat.js';
import { addDecimals } from './BetMarketCard.jsx';

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    return [];
}

/**
 * Every bet this wallet has placed, across all of its addresses (address
 * aggregated for the same reason My Bets is: payouts credit the placing
 * address, and a sweep does not move a bet escrow). One read per address,
 * never one per market.
 *
 * Takes the page's own address read (`byChain`) instead of asking for the
 * wallet's addresses a second time; null means that read is still pending.
 *
 * @returns {{ rows: any[] | null, error: string | null, reload: () => void }}
 */
export function useWalletBets({ byChain, messaging }) {
    const [rows, setRows] = useState(/** @type {any[] | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const loadRequestId = useRef(0);

    const load = useCallback(async () => {
        const requestId = ++loadRequestId.current;
        if (!byChain) { setRows(null); return; }
        if (typeof messaging?.bets !== 'function') {
            setRows([]); return;
        }
        setRows(null);
        setError(null);
        try {
            const chains = byChain;
            const pairs = [];
            for (const [chainId, addrs] of Object.entries(chains)) {
                for (const a of addrs || []) pairs.push({ chainId, address: a.address });
            }
            const results = await Promise.all(pairs.map((p) => Promise.resolve()
                .then(() => messaging.bets({ chainId: p.chainId, query: p.address, type: 'address', opts: { limit: 100 } }))
                .then((r) => ({ p, bets: extractRows(r) }))
                .catch(() => ({ p, bets: [], failed: true }))));
            if (requestId !== loadRequestId.current) return;
            const seen = new Set();
            const all = [];
            for (const r of results) {
                for (const b of r.bets) {
                    const key = `${r.p.chainId}:${b.action_index}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    all.push({ ...b, chainId: r.p.chainId, owner: r.p.address });
                }
            }
            all.sort((a, b) => {
                const ao = a.bet_status === 'open' ? 0 : 1;
                const bo = b.bet_status === 'open' ? 0 : 1;
                if (ao !== bo) return ao - bo;
                return Number(b.action_index || 0) - Number(a.action_index || 0);
            });
            const failures = results.filter((r) => r.failed).length;
            if (failures > 0) {
                setError(failures === results.length
                    ? 'Could not load positions for any of your addresses.'
                    : `Could not load positions for ${failures} of your addresses. The list may be incomplete.`);
            }
            setRows(all);
        } catch {
            if (requestId !== loadRequestId.current) return;
            setError('Could not load your positions. Try again.');
            setRows([]);
        }
    }, [byChain, messaging]);

    useEffect(() => {
        load();
        return () => { loadRequestId.current += 1; };
    }, [load]);

    return { rows, error, reload: load };
}

/**
 * The one short summary for this wallet's accepted positions in one market,
 * or null: "15 XCHAIN", the total amount and asset only. Positions on more
 * than one outcome are summed into that total. Rejected rows hold no position
 * and therefore draw no chip.
 */
export function yourPositionText(bets, market) {
    if (!Array.isArray(bets) || bets.length === 0) return null;
    const mine = bets.filter((b) => b.bet_status !== 'invalid');
    if (mine.length === 0) return null;
    const total = addDecimals(mine.map((row) => row.amount));
    const tick = market?.tick || mine.find((row) => row.tick)?.tick || '';
    return `${formatDecimalAmount(total)} ${tick}`.replace(/\s+/g, ' ').trim();
}
