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
import { fetchTokenInfo } from '../hooks/useTokenInfo.js';
import { chainIdForCoin, splitTickCoinItem } from '../utils/listTickCoin.js';

const ID_REST = /^\^([1-9]\d*)$/;
const NAME_STYLE = {
    display: 'inline-block',
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    verticalAlign: 'bottom',
    color: 'var(--xc-text)',
    fontSize: 'var(--xc-text-sm)',
};

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
    const lookupKey = coin && id ? `${chainId}:${coin}:^${id}` : null;
    const [resolved, setResolved] = useState({ key: null, canonicalTick: null, loading: false });

    useEffect(() => {
        if (!lookupKey) return undefined;
        setResolved({ key: lookupKey, canonicalTick: null, loading: true });
        let cancelled = false;
        fetchTokenInfo(messaging, chainIdForCoin(coin, chainId), `^${id}`)
            .then((info) => {
                if (cancelled) return;
                const canonicalTick = typeof info?.canonicalTick === 'string' && info.canonicalTick
                    ? info.canonicalTick
                    : null;
                setResolved({ key: lookupKey, canonicalTick, loading: false });
            })
            .catch(() => {
                if (!cancelled) {
                    setResolved({ key: lookupKey, canonicalTick: null, loading: false });
                }
            });
        return () => { cancelled = true; };
    }, [chainId, coin, id, lookupKey, messaging]);

    if (!split) {
        return <code aria-label={item} title={item} style={NAME_STYLE}>{item}</code>;
    }
    const current = resolved.key === lookupKey ? resolved : null;
    const rest = id === null ? split.rest : (current?.canonicalTick || `id ${id}`);
    const displayName = `${split.coin} ${rest}`;

    return (
        <code
            aria-busy={current?.loading || undefined}
            aria-label={displayName}
            title={displayName}
            style={NAME_STYLE}
        >
            <span data-testid="tick-member-coin">{split.coin}</span>
            {' '}
            {rest}
        </code>
    );
}
