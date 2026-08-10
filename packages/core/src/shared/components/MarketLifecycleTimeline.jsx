// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// MarketLifecycleTimeline (PC-21): the per-order / per-swap lifecycle rail
// rendered inline when a MyOrdersView / MySwapsView row is expanded. It is
// the DEX-side twin of DispenserDetail's Lifecycle tab: one chronological
// (newest-first) list merging the trade's own creation with its edit,
// match/fill, expire, and cancel events.
//
// Read-only, best-effort. `kind` picks the ORDER vs SWAP messaging path.
// Edits/expires/cancels are fetched by the owner address and filtered
// client-side by the parent action index (order_action_index /
// swap_action_index). Matches are block-keyed with no per-trade query, so
// we read the RECENT global match feed and filter by give/get_action_index
// - this can miss an old trade's fills, which is acceptable for a P3
// display surface (the row's status chip remains the authoritative state).

import { useEffect, useState } from 'react';
import S from './MarketLifecycleTimeline.module.css';
import { StatusMessage } from '@xchain-wallet/core/ui';

const LABEL = {
    created: 'Created',
    edits: 'Edited',
    matches: 'Filled / matched',
    expires: 'Expired',
    cancels: 'Cancelled',
};

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    return [];
}

// Sort weight: prefer block height, then block time, then the event's own
// action index. Higher = more recent (rendered first).
function sortKey(row) {
    return Number(row.block_index ?? row.timestamp ?? row.action_index ?? 0);
}

/**
 * @param {object} props
 * @param {any} props.messaging               shell messaging module
 * @param {'order' | 'swap'} props.kind
 * @param {string} props.chainId
 * @param {string} props.address              owner address (source)
 * @param {string | number} props.actionIndex the trade's action index
 * @param {string | number} [props.createdBlock] block the trade was created in
 */
export function MarketLifecycleTimeline({ messaging, kind, chainId, address, actionIndex, createdBlock }) {
    const [state, setState] = useState(
        /** @type {{ loading: boolean, events: any[] | null, error: string | null }} */
        ({ loading: true, events: null, error: null }),
    );

    useEffect(() => {
        let cancelled = false;
        const fetchLifecycle = kind === 'order' ? messaging?.getOrderLifecycle : messaging?.getSwapLifecycle;
        if (typeof fetchLifecycle !== 'function') {
            setState({ loading: false, events: [], error: null });
            return undefined;
        }
        const idx = String(actionIndex);
        const parentKey = kind === 'order' ? 'order_action_index' : 'swap_action_index';
        setState({ loading: true, events: null, error: null });

        const lane = (k, req) => fetchLifecycle({ chainId, kind: k, ...req })
            .then((r) => ({ k, rows: extractRows(r) }))
            .catch(() => ({ k, rows: [] }));

        Promise.all([
            lane('edits', { query: address, type: 'address' }),
            lane('expires', { query: address, type: 'address' }),
            lane('cancels', { query: address, type: 'address' }),
            lane('matches', { query: '', type: 'block' }),
        ]).then((results) => {
            if (cancelled) return;
            const events = [{ kind: 'created', row: { action_index: idx, block_index: createdBlock } }];
            for (const { k, rows } of results) {
                for (const row of rows) {
                    if (k === 'matches') {
                        if (String(row.give_action_index) !== idx && String(row.get_action_index) !== idx) continue;
                    } else if (String(row[parentKey]) !== idx) {
                        continue;
                    }
                    events.push({ kind: k, row });
                }
            }
            events.sort((a, b) => sortKey(b.row) - sortKey(a.row));
            setState({ loading: false, events, error: null });
        }).catch((err) => {
            if (!cancelled) setState({ loading: false, events: [], error: err?.message || 'Failed to load timeline.' });
        });

        return () => { cancelled = true; };
    }, [messaging, kind, chainId, address, actionIndex, createdBlock]);

    if (state.loading) return <div className={S.status}>Loading timeline…</div>;
    if (state.error) return <StatusMessage variant="error" className={S.status}>{state.error}</StatusMessage>;
    if (!state.events || state.events.length === 0) return <div className={S.status}>No lifecycle events yet.</div>;

    return (
        <ul className={S.timeline} aria-label="Trade lifecycle">
            {state.events.slice(0, 40).map((e, i) => (
                <li key={`${e.kind}-${e.row.action_index ?? i}`} className={S.event}>
                    <span className={S.label}>{LABEL[e.kind] || e.kind}</span>
                    <span className={S.meta}>
                        {e.kind === 'matches' && e.row.give_amount != null
                            ? `${e.row.give_amount} ${e.row.give_tick || e.row.give_coin || ''}`.trim()
                            : e.row.block_index != null
                                ? `block ${e.row.block_index}`
                                : (e.row.action_index != null ? `#${e.row.action_index}` : '')}
                    </span>
                </li>
            ))}
        </ul>
    );
}
