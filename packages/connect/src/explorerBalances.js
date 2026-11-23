// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: MIT

import { DEFAULT_EXPLORER_BASE } from '../../core/src/branding/branding.js';

export const EXPLORER_COINS = Object.freeze({
    'bitcoin-mainnet': 'BTC',
    'bitcoin-testnet': 'TBTC',
    'bitcoin-regtest': 'RBTC',
    'litecoin-mainnet': 'LTC',
    'litecoin-testnet': 'TLTC',
    'litecoin-regtest': 'RLTC',
    'dogecoin-mainnet': 'DOGE',
    'dogecoin-testnet': 'TDOGE',
    'dogecoin-regtest': 'RDOGE',
});

export const DEFAULT_EXPLORER_URL = DEFAULT_EXPLORER_BASE;

export function explorerBalancesUrl(chainId, address, { explorerUrl = DEFAULT_EXPLORER_URL } = {}) {
    if (!Object.hasOwn(EXPLORER_COINS, chainId)) {
        const error = new Error(`Unsupported chain: ${chainId}`);
        error.code = 'CHAIN_NOT_SUPPORTED';
        throw error;
    }
    const coin = EXPLORER_COINS[chainId];
    if (typeof address !== 'string' || address.trim() === '') {
        throw new TypeError('address must be a non-empty string');
    }
    if (typeof explorerUrl !== 'string') {
        throw new TypeError('explorerUrl must be an absolute http or https URL');
    }

    let parsedUrl;
    try {
        parsedUrl = new URL(explorerUrl);
    } catch {
        throw new TypeError('explorerUrl must be an absolute http or https URL');
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new TypeError('explorerUrl must be an absolute http or https URL');
    }

    const base = explorerUrl.replace(/\/+$/, '');
    return `${base}/${coin}/api/balances/${encodeURIComponent(address)}`;
}

export function readExplorerBalances(address, body) {
    if (!body || typeof body !== 'object' || !Array.isArray(body.data)) {
        throw new TypeError('explorer response must be an object with a data array');
    }

    const data = body.data.map((entry) => ({
        tick: entry.tick,
        amount: entry.amount,
    }));
    return {
        address,
        data,
        total: Number.isInteger(body.total) ? body.total : data.length,
    };
}
