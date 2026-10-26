// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Reads a wallet's balances one chain at a time so a chain whose explorer
// accepts the connection and never answers holds back only itself. The
// aggregate `getWalletBalances(walletId, accountId)` resolves when its slowest
// chain does, which left an asset picker on skeletons for as long as the one
// stuck chain took to give up, however healthy the others were.

/**
 * How long a chain may take before the picker stops waiting for it and says
 * so. Its answer still lands in the list whenever it arrives.
 */
export const CHAIN_BALANCE_WAIT_MS = 8000;

/**
 * @param {object} args
 * @param {{ getWalletBalances: Function }} args.messaging
 * @param {string} args.walletId
 * @param {string} [args.accountId]
 * @param {string[]} args.chainIds
 * @param {number} [args.waitMs]
 * @param {() => boolean} [args.isCancelled]
 * @param {(chainId: string, entries: any[]) => void} args.onChain    a chain answered
 * @param {(chainId: string) => void} [args.onSlow]                   a chain passed the wait without answering
 * @param {(chainId: string, error: Error) => void} [args.onError]    a chain's read failed
 * @returns {Promise<void>} resolves when every chain has answered or failed
 */
export function loadBalancesByChain({
    messaging, walletId, accountId, chainIds, waitMs = CHAIN_BALANCE_WAIT_MS,
    isCancelled = () => false, onChain, onSlow, onError,
}) {
    return Promise.all(chainIds.map((chainId) => {
        const timer = setTimeout(() => {
            if (!isCancelled() && onSlow) onSlow(chainId);
        }, waitMs);
        return Promise.resolve()
            .then(() => messaging.getWalletBalances(walletId, accountId, chainId))
            .then((byChain) => {
                clearTimeout(timer);
                if (isCancelled()) return;
                const entries = byChain && Array.isArray(byChain[chainId]) ? byChain[chainId] : [];
                onChain(chainId, entries);
            })
            .catch((err) => {
                clearTimeout(timer);
                if (isCancelled()) return;
                if (onError) onError(chainId, err instanceof Error ? err : new Error(String(err)));
            });
    })).then(() => undefined);
}
