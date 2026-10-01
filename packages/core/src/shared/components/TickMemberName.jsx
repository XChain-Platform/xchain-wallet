// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useState } from 'react';
import { fetchTokenInfo } from '../hooks/useTokenInfo.js';
import { chainIdForCoin, splitTickCoinItem } from '../utils/listTickCoin.js';

const TICK_ID = /^\^([1-9]\d*)$/;

/**
 * A token-list member. Known coin prefixes are separated from the token name,
 * and foreign-chain tick ids are resolved to their canonical token name.
 *
 * @param {{ item: string, messaging: object | null, chainId: string }} props
 */
export function TickMemberName({ item, messaging, chainId }) {
    const split = splitTickCoinItem(item);
    const coin = split?.coin || null;
    const id = split ? TICK_ID.exec(split.rest)?.[1] : null;
    const lookupKey = coin && id ? `${chainId}:${coin}:^${id}` : null;
    const [resolved, setResolved] = useState({ key: null, canonicalTick: null });

    useEffect(() => {
        if (!lookupKey) return undefined;
        let cancelled = false;
        fetchTokenInfo(messaging, chainIdForCoin(coin, chainId), `^${id}`)
            .then((info) => {
                if (!cancelled && typeof info?.canonicalTick === 'string' && info.canonicalTick) {
                    setResolved({ key: lookupKey, canonicalTick: info.canonicalTick });
                }
            });
        return () => { cancelled = true; };
    }, [chainId, coin, id, lookupKey, messaging]);

    if (!split) return <code>{item}</code>;
    const canonicalTick = resolved.key === lookupKey ? resolved.canonicalTick : null;

    return (
        <>
            <span>{split.coin}</span>{' '}
            <code>{id ? (canonicalTick || `id ${id}`) : split.rest}</code>
        </>
    );
}
