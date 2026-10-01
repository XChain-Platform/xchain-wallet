// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import React, { useEffect, useState } from 'react';
import { splitTickCoinItem, chainIdForCoin } from '../utils/listTickCoin.js';
import { fetchTokenInfo } from '../hooks/useTokenInfo.js';

const ID_REST = /^\^(\d+)$/;

/**
 * A tick-list member: the item as written, or for a coin-qualified id item
 * the looked-up canonical name on that coin's chain.
 *
 * @param {{ item: string, messaging: object | null, chainId: string }} props
 */
export function TickMemberName({ item, messaging, chainId }) {
    const split = splitTickCoinItem(item);
    const idMatch = split ? ID_REST.exec(split.rest) : null;
    const id = idMatch ? idMatch[1] : null;
    const coin = split ? split.coin : null;
    const [name, setName] = useState(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        setName(null);
        setLoading(id !== null);
        if (id === null) return undefined;
        let cancelled = false;
        fetchTokenInfo(messaging, chainIdForCoin(coin, chainId), '^' + id)
            .then((info) => {
                if (cancelled) return;
                setName(info?.canonicalTick ?? null);
                setLoading(false);
            })
            .catch(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [messaging, coin, chainId, id]);

    if (!split) return <code>{item}</code>;
    const rest = id === null ? split.rest : (name ?? `id ${id}`);
    return (
        <code aria-busy={loading || undefined}>
            <span data-testid="tick-member-coin">{split.coin}</span>
            {' '}
            {rest}
        </code>
    );
}
