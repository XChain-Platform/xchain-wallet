// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The three account views every wallet type shares (G131): Networks,
// Accounts and Addresses. An account is one account number (index) across
// every network; its addresses are one per network it has. The vault already
// stores it that way (one Account record per index, Address records naming
// it by accountId), so these helpers only shape what a page shows.
//
// Hardware setup reads its addresses as flat entries ({ chainId,
// accountIndex, address, ... }), the payload addHardwareWallet saves; the
// shared account pages read the vault's Address records by chain. Both meet
// here so the counts and flat address rows are worked out once.

/**
 * One row per account number, in number order, with how many addresses it
 * has on the networks that are on and how many networks those span.
 *
 * @param {{
 *   indexes: number[],
 *   addresses: Array<{ chainId: string, accountIndex: number }>,
 *   enabledChainIds: string[],
 * }} input
 * @returns {Array<{ index: number, addressCount: number, networkCount: number }>}
 */
export function accountRowsByIndex({ indexes, addresses, enabledChainIds }) {
    const on = new Set(enabledChainIds || []);
    const unique = [...new Set((indexes || []).filter((n) => Number.isInteger(n) && n >= 0))].sort((a, b) => a - b);
    return unique.map((index) => {
        const mine = (addresses || []).filter((a) => a?.accountIndex === index && on.has(a.chainId));
        return {
            index,
            addressCount: mine.length,
            networkCount: new Set(mine.map((a) => a.chainId)).size,
        };
    });
}

/**
 * The hardware setup Addresses view: one flat list ordered by network, then
 * account number. Only accounts and networks that are on are included.
 *
 * @template {{ chainId: string, accountIndex: number }} T
 * @param {{
 *   indexes: number[],
 *   addresses: T[],
 *   enabledChainIds: string[],
 *   offIndexes?: number[],
 * }} input   enabledChainIds also sets the network order
 * @returns {T[]}
 */
export function addressRows({ indexes, addresses, enabledChainIds, offIndexes = [] }) {
    const off = new Set(offIndexes);
    const activeIndexes = [...new Set((indexes || [])
        .filter((index) => Number.isInteger(index) && index >= 0 && !off.has(index)))]
        .sort((a, b) => a - b);
    const out = [];
    for (const chainId of enabledChainIds || []) {
        for (const index of activeIndexes) {
            out.push(...(addresses || []).filter((entry) => (
                entry?.chainId === chainId && entry.accountIndex === index
            )));
        }
    }
    return out;
}

/**
 * The entries a hardware setup saves: every address read on a network that
 * is on, for an account that is on.
 *
 * @template {{ chainId: string, accountIndex: number }} T
 * @param {{ addresses: T[], enabledChainIds: string[], offIndexes?: number[] }} input
 * @returns {T[]}
 */
export function selectedAccountEntries({ addresses, enabledChainIds, offIndexes = [] }) {
    const on = new Set(enabledChainIds || []);
    const off = new Set(offIndexes);
    return (addresses || []).filter((a) => on.has(a?.chainId) && !off.has(a.accountIndex));
}

/**
 * The account numbers on the networks that are on that still have no
 * address on `chainId`: what turning that network on has to read.
 *
 * @param {{ chainId: string, indexes: number[], addresses: Array<{ chainId: string, accountIndex: number }> }} input
 * @returns {number[]}
 */
export function indexesMissingChain({ chainId, indexes, addresses }) {
    const have = new Set((addresses || []).filter((a) => a?.chainId === chainId).map((a) => a.accountIndex));
    return [...new Set(indexes || [])].filter((index) => !have.has(index)).sort((a, b) => a - b);
}

/**
 * One account's vault addresses as a flat list ordered by network, then by
 * derivation path within each network.
 *
 * @param {Record<string, Array<{ accountId?: string | null, derivationPath?: string }>> | null | undefined} byChain
 * @param {string} accountId
 * @param {string[]} [chainOrder]
 * @returns {Array<{ chainId: string, record: any }>}
 */
export function accountAddressRows(byChain, accountId, chainOrder = []) {
    const map = byChain && typeof byChain === 'object' ? byChain : {};
    const ids = [...new Set([...chainOrder.filter((id) => id in map), ...Object.keys(map)])];
    const out = [];
    for (const chainId of ids) {
        const list = (Array.isArray(map[chainId]) ? map[chainId] : [])
            .filter((a) => a && a.accountId === accountId)
            .sort((a, b) => String(a.derivationPath || '').localeCompare(String(b.derivationPath || ''), 'en', { numeric: true }));
        out.push(...list.map((record) => ({ chainId, record })));
    }
    return out;
}
