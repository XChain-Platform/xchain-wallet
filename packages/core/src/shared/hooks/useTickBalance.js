// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// useTickBalance: resolve one address's balance of one tick, backing the
// standardized AmountField's Max button + "X available" footer. Extracted
// from DispenserForm's escrow wiring so every amount-bearing form shares
// the same lookup (debounced so typing a ticker doesn't fan out a balance
// query per keystroke; failures leave the balance null and the footer
// simply stays empty).

import { useEffect, useState } from 'react';
import { decoder as decoderLib } from '@xchain-wallet/core';

/**
 * @param {object} opts
 * @param {any} opts.messaging                from useMessaging()
 * @param {string} opts.walletId
 * @param {string} [opts.accountId]
 * @param {string | null} opts.chainId
 * @param {string | null | undefined} opts.address    the SOURCE address whose balance backs Max/available
 * @param {string} opts.tick                  token ticker; empty hides the balance
 * @returns {string | null}                   coin-scale balance string, '0' for none, null while unresolved
 */
export function useTickBalance({ messaging, walletId, accountId, chainId, address, tick }) {
    const [balance, setBalance] = useState(/** @type {string | null} */ (null));
    const tickUpper = (tick || '').trim().toUpperCase();

    useEffect(() => {
        setBalance(null);
        if (!chainId || !address || !tickUpper) return undefined;
        if (typeof messaging?.getWalletBalances !== 'function') return undefined;
        let cancelled = false;
        const timer = setTimeout(() => {
            messaging.getWalletBalances(walletId, accountId)
                .then((byChain) => {
                    if (cancelled || !byChain) return;
                    const entries = byChain[chainId] || [];
                    const entry = entries.find((e) => e && e.address === address);
                    const rows = entry ? decoderLib.balancesFromSdk(entry.balances) || [] : [];
                    const match = rows.find((b) => String(b.tick).toUpperCase() === tickUpper);
                    setBalance(match ? String(match.amount) : '0');
                })
                .catch(() => { /* footer stays empty on failure */ });
        }, 400);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [messaging, walletId, accountId, chainId, address, tickUpper]);

    return balance;
}
