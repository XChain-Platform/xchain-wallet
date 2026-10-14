// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Canonical UI metadata for bundled coin families (§9). Descriptor overrides
// let custom and remotely registered chains supply the same values without a
// UI edit. Unmapped coins retain UTXO-safe defaults and an uppercased ticker.

const COIN_CONFIG = {
    bitcoin: {
        ticker: 'BTC',
        nativeDecimals: 8,
        smallBalanceBaseUnits: 546n,
        transactionExplorers: {
            mainnet: [
                { id: 'mempool', label: 'Mempool', iconImg: 'https://mempool.space/resources/favicons/favicon.ico', url: 'https://mempool.space/tx/{txid}' },
                { id: 'blockstream', label: 'Blockstream', iconImg: 'https://blockstream.info/favicon.ico', url: 'https://blockstream.info/tx/{txid}' },
            ],
            testnet: [
                { id: 'mempool', label: 'Mempool', iconImg: 'https://mempool.space/resources/favicons/favicon.ico', url: 'https://mempool.space/testnet4/tx/{txid}' },
                { id: 'blockstream', label: 'Blockstream', iconImg: 'https://blockstream.info/favicon.ico', url: 'https://blockstream.info/testnet/tx/{txid}' },
            ],
        },
    },
    litecoin: {
        ticker: 'LTC',
        nativeDecimals: 8,
        smallBalanceBaseUnits: 5460n,
        transactionExplorers: {
            mainnet: [
                { id: 'litecoinspace', label: 'LitecoinSpace', iconImg: 'https://litecoinspace.org/favicon.ico', url: 'https://litecoinspace.org/tx/{txid}' },
                { id: 'blockchair', label: 'Blockchair', iconImg: 'https://blockchair.com/favicon.ico', url: 'https://blockchair.com/litecoin/transaction/{txid}' },
            ],
            testnet: [
                { id: 'litecoinspace', label: 'LitecoinSpace', iconImg: 'https://litecoinspace.org/favicon.ico', url: 'https://litecoinspace.org/testnet/tx/{txid}' },
            ],
        },
    },
    dogecoin: {
        ticker: 'DOGE',
        nativeDecimals: 8,
        smallBalanceBaseUnits: 1000000n,
        transactionExplorers: {
            mainnet: [
                { id: 'blockchair', label: 'Blockchair', iconImg: 'https://blockchair.com/favicon.ico', url: 'https://blockchair.com/dogecoin/transaction/{txid}' },
                { id: 'blockcypher', label: 'BlockCypher', iconImg: 'https://www.blockcypher.com/tokens/favicon/favicon.ico', url: 'https://live.blockcypher.com/doge/tx/{txid}' },
            ],
        },
    },
};

const DEFAULT_NATIVE_DECIMALS = 8;
const DEFAULT_SMALL_BALANCE_BASE_UNITS = 546n;

function coinFor(subject) {
    return typeof subject === 'object' && subject
        ? String(subject.coin || '').toLowerCase()
        : String(subject || '').toLowerCase();
}

/**
 * @param {string} coin   a descriptor's `coin`, e.g. 'bitcoin'
 * @returns {string}      native ticker, e.g. 'BTC'; uppercased coin id for
 *                        chains not in the map
 */
export function tickerForCoin(coin) {
    const key = String(coin || '').toLowerCase();
    return COIN_CONFIG[key]?.ticker || key.toUpperCase();
}

/** Native ticker from descriptor metadata, falling back to the bundled coin config. */
export function tickerForDescriptor(descriptor) {
    const configured = String(descriptor?.nativeTicker || '').trim();
    return configured || tickerForCoin(descriptor?.coin);
}

/** Native amount precision from descriptor metadata or the bundled coin config. */
export function nativeDecimalsFor(subject) {
    const configured = typeof subject === 'object' && subject
        ? Number(subject.nativeDecimals)
        : NaN;
    if (Number.isInteger(configured) && configured >= 0 && configured <= 18) return configured;
    return COIN_CONFIG[coinFor(subject)]?.nativeDecimals ?? DEFAULT_NATIVE_DECIMALS;
}

/** Smallest-unit scale for the chain's native amount precision. */
export function nativeUnitScaleFor(subject) {
    return 10n ** BigInt(nativeDecimalsFor(subject));
}

/** Render a native amount expressed in the chain's smallest unit. */
export function formatNativeBaseUnits(value, subject) {
    let amount;
    try {
        amount = BigInt(value);
    } catch {
        return null;
    }
    const negative = amount < 0n;
    const magnitude = negative ? -amount : amount;
    const decimals = nativeDecimalsFor(subject);
    const scale = nativeUnitScaleFor(subject);
    const whole = magnitude / scale;
    const fraction = String(magnitude % scale).padStart(decimals, '0').replace(/0+$/, '');
    return `${negative ? '-' : ''}${fraction ? `${whole}.${fraction}` : whole}`;
}

/** Display-only small-balance threshold in the chain's smallest unit. */
export function smallBalanceBaseUnitsFor(subject) {
    if (typeof subject === 'object' && subject?.smallBalanceBaseUnits !== undefined) {
        try {
            const configured = BigInt(subject.smallBalanceBaseUnits);
            if (configured >= 0n) return configured;
        } catch { /* malformed optional metadata falls back to bundled policy */ }
    }
    return COIN_CONFIG[coinFor(subject)]?.smallBalanceBaseUnits
        ?? DEFAULT_SMALL_BALANCE_BASE_UNITS;
}

/**
 * Third-party transaction links from descriptor metadata or bundled defaults.
 * Regtest and unsupported networks intentionally return no external links.
 */
export function transactionExplorerLinks(descriptor, txid) {
    if (!descriptor || !txid) return [];
    if (descriptor.networkKind === 'regtest') return [];
    const configured = Array.isArray(descriptor.transactionExplorers)
        ? descriptor.transactionExplorers
        : COIN_CONFIG[coinFor(descriptor)]?.transactionExplorers?.[descriptor.networkKind];
    if (!Array.isArray(configured)) return [];
    const encodedTxid = encodeURIComponent(String(txid));
    return configured.flatMap((entry) => {
        if (!entry || typeof entry.url !== 'string' || !entry.url.includes('{txid}')) return [];
        const url = entry.url.replace('{txid}', encodedTxid);
        try {
            if (new URL(url).protocol !== 'https:') return [];
        } catch {
            return [];
        }
        return [{
            id: String(entry.id || entry.label || url),
            label: String(entry.label || entry.id || 'Explorer'),
            iconImg: typeof entry.iconImg === 'string' ? entry.iconImg : undefined,
            url,
        }];
    });
}

/** Every native ticker the XChain protocol runs on (mirrors xchain-sdk VALID_COINS). */
const PROTOCOL_TICKERS = new Set(Object.values(COIN_CONFIG).map((config) => config.ticker));

/**
 * True when `ticker` is a chain the XChain protocol itself runs on, as opposed
 * to a custom/unknown chain a user added. Callers that must reason about
 * protocol rules (fees, action support) need this distinction: an unrecognized
 * chain gets no protocol behavior applied to it at all.
 *
 * @param {string} ticker   native ticker, e.g. 'LTC'
 * @returns {boolean}
 */
export function isProtocolCoinTicker(ticker) {
    return PROTOCOL_TICKERS.has(String(ticker || '').toUpperCase());
}

// The coin-path segment the platform routes explorer requests by, e.g.
// bitcoin-mainnet -> BTC, bitcoin-testnet -> TBTC, dogecoin-regtest -> RDOGE.
// Mirrors xchain-sdk endpoints.coinPrefix + explorer.js COIN_PREFIX_MAP. The
// explorer BASE url is bare (no coin) by design - the SDK explorer client and
// every wallet-side explorer link must append THIS segment, or they either
// double it (coin-in-base + client-appends) or drop it (bare-base + no-append).
const NETWORK_CODE_PREFIX = { mainnet: '', testnet: 'T', regtest: 'R' };

/**
 * @param {{ coin?: string, networkKind?: string } | null | undefined} descriptor
 * @returns {string}  explorer coin code (e.g. 'RBTC'); '' for an unknown network
 */
export function explorerCoinCode(descriptor) {
    if (!descriptor) return '';
    const prefix = NETWORK_CODE_PREFIX[descriptor.networkKind];
    if (prefix === undefined) return '';
    return prefix + tickerForCoin(descriptor.coin);
}
