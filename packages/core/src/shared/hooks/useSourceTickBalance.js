// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// useSourceTickBalance: the source address's balance of one token for an
// irreversible form, with an unknown balance kept apart from zero. Debounced
// like useTickBalance so typing a ticker does not fan out a read per
// keystroke; `amount` stays null until a read lands, and `unreadable` is set
// when the read failed or the explorer's figure could not be parsed.

import { useEffect, useState } from 'react';
import { readSourceTickBalance } from '../../flows/sourceTickBalance.js';

/**
 * @param {object} opts
 * @param {any} opts.messaging
 * @param {string} opts.walletId
 * @param {string} [opts.accountId]
 * @param {string | null} opts.chainId
 * @param {string | null | undefined} opts.address
 * @param {string} opts.tick
 * @param {number} [opts.refreshKey]        a change re-reads the balance
 * @returns {{ amount: string | null, unreadable: boolean }}
 */
export function useSourceTickBalance({ messaging, walletId, accountId, chainId, address, tick, refreshKey = 0 }) {
    const [state, setState] = useState(/** @type {{ amount: string | null, unreadable: boolean }} */ ({ amount: null, unreadable: false }));
    const tickUpper = (tick || '').trim().toUpperCase();

    useEffect(() => {
        setState({ amount: null, unreadable: false });
        if (!chainId || !address || !tickUpper) return undefined;
        let cancelled = false;
        const timer = setTimeout(() => {
            readSourceTickBalance({ messaging, walletId, accountId, chainId, address, tick: tickUpper })
                .then((read) => {
                    if (cancelled) return;
                    setState(read.ok ? { amount: read.amount, unreadable: false } : { amount: null, unreadable: true });
                });
        }, 400);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [messaging, walletId, accountId, chainId, address, tickUpper, refreshKey]);

    return state;
}
