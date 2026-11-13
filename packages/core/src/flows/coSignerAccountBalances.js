// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Balances of a wallet's agent accounts, for the account list rows and the
// account page.
//
// The shared addresses are not wallet addresses, so walletBalances never
// reads them. This read groups them by chain and asks each chain's explorer
// once per batch of BALANCES_BATCH_MAX_ADDRESSES through the batch route, so
// the request count follows the number of chains, not the number of rows.
// There is deliberately no per-address fallback: an explorer without the
// batch route leaves the balances unavailable rather than fanning out one
// request per account.

import { listCoSignerAccounts } from './coSignerAccountQueries.js';
import {
    BALANCES_BATCH_MAX_ADDRESSES,
    readsFromBatchEntry,
    shapeFromReads,
} from './balances.js';
import { tickerForCoin } from '../registry/coinTicker.js';

/**
 * @typedef {Object} CoSignerAccountBalance
 * @property {{ native: unknown, tokens: unknown[], unavailable?: string[] } | null} balances
 * @property {string | null} error
 */

function unavailable(message) {
    return { balances: null, error: message };
}

/**
 * @param {object} opts
 * @param {import('../storage/Vault.js').Vault} opts.vault
 * @param {import('../sdk/SDKRegistry.js').SDKRegistry} opts.sdkRegistry
 * @param {import('../registry/index.js').ChainRegistry} [opts.chainRegistry]
 * @param {string} opts.walletId
 * @param {object} [opts.opts]          passed through to sdk.getBalancesBatch
 * @returns {Promise<Record<string, CoSignerAccountBalance>>}  keyed by account id
 */
export async function coSignerAccountBalances({ vault, sdkRegistry, chainRegistry, walletId, opts } = {}) {
    if (!sdkRegistry || typeof sdkRegistry.get !== 'function') {
        throw new Error('coSignerAccountBalances: sdkRegistry is required');
    }
    const accounts = await listCoSignerAccounts(vault, walletId);

    /** @type {Map<string, Map<string, string[]>>} chain id -> address -> account ids */
    const byChain = new Map();
    for (const account of accounts) {
        if (!account.aggregateAddress) continue;
        if (!byChain.has(account.chainId)) byChain.set(account.chainId, new Map());
        const addresses = byChain.get(account.chainId);
        if (!addresses.has(account.aggregateAddress)) addresses.set(account.aggregateAddress, []);
        addresses.get(account.aggregateAddress).push(account.id);
    }

    /** @type {Record<string, CoSignerAccountBalance>} */
    const result = {};
    await Promise.all([...byChain.entries()].map(async ([chainId, addressMap]) => {
        const addresses = [...addressMap.keys()];
        const assign = (address, value) => {
            for (const id of addressMap.get(address)) result[id] = value;
        };
        let sdk = null;
        try { sdk = sdkRegistry.get(chainId); } catch { sdk = null; }
        if (!sdk || typeof sdk.getBalancesBatch !== 'function') {
            for (const address of addresses) assign(address, unavailable('balance service unavailable'));
            return;
        }
        const descriptor = chainRegistry && typeof chainRegistry.descriptorFor === 'function'
            ? chainRegistry.descriptorFor(chainId)
            : null;
        const nativeTicker = descriptor ? tickerForCoin(descriptor.coin) : null;
        const chunks = [];
        for (let i = 0; i < addresses.length; i += BALANCES_BATCH_MAX_ADDRESSES) {
            chunks.push(addresses.slice(i, i + BALANCES_BATCH_MAX_ADDRESSES));
        }
        await Promise.all(chunks.map(async (chunk) => {
            let resp;
            try {
                resp = await sdk.getBalancesBatch(chunk, opts);
            } catch (e) {
                const message = e && e.message ? String(e.message) : String(e);
                for (const address of chunk) assign(address, unavailable(message));
                return;
            }
            for (const address of chunk) {
                const slot = resp && typeof resp === 'object' && Object.prototype.hasOwnProperty.call(resp, address)
                    ? resp[address]
                    : null;
                const { balResp, addrResp } = readsFromBatchEntry(slot, address);
                try {
                    assign(address, { balances: shapeFromReads({ balResp, addrResp, nativeTicker, address }), error: null });
                } catch (e) {
                    assign(address, unavailable(e && e.message ? String(e.message) : String(e)));
                }
            }
        }));
    }));
    return result;
}
