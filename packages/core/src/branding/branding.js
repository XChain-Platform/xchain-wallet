// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Product identity constants — spec §5.
//
// This module is the single source of truth for user-facing brand
// strings and tick pointers. §5.5 placeholders (tagline candidates,
// marketing-owned copy) are kept inline so a `grep PLACEHOLDER_` can
// verify nothing stale ships to mainnet.
//
// Consumers:
//   - Extension popup / full-screen shells read `PRODUCT_NAME`,
//     `faviconUrl()`, `logoUrl()` for headers + HTML entries.
//   - Web SPA shell reads the same for its index.html and app shell.
//   - Chain descriptors (registry/descriptors/*.js) point `icon` at a
//     filename in ./images/; UI code resolves URLs via `brandingUrl()`.
//
// Build-time behaviour:
//   `brandingUrl(filename)` uses `new URL('./images/...', import.meta.url)`
//   which Vite rewrites at build time to a hashed static-asset URL. In
//   Node (tests), it returns a file:// URL that still resolves on disk.

export const PRODUCT_NAME = 'XChain Wallet';
export const TAGLINE = 'The open-source, non-custodial wallet for the XChain Platform.';

export const CANONICAL_DOMAIN = 'wallet.xchain.io';
export const HOMEPAGE_URL = `https://${CANONICAL_DOMAIN}`;

// Accent colours sampled from the XChain logo (see ./images/xchain-color-750.png).
// Blue is the primary interactive accent. Purple is a secondary accent for
// highlighting cross-chain elements. Chain-specific colours live on the
// chain descriptors themselves (§5.4 Chain color language).
export const ACCENT_PRIMARY = '#1E90C7';
export const ACCENT_SECONDARY = '#7B2C8F';

// Product-level default endpoints. Per-chain descriptors (registry/descriptors/*.js)
// carry the authoritative URLs used by the SDK; these constants exist so the
// UI can surface an "About" / "Settings" default before a chain is selected.
export const DEFAULT_EXPLORER_BASE = 'https://explorer.xchain.io';
export const DEFAULT_HUB_BASE = 'https://hub.xchain.io';

// Filenames (not URLs) — UI code calls `brandingUrl(filename)` to get a
// bundler-friendly URL. Keep these as strings so chain descriptors can
// carry them without importing Vite-specific syntax.
export const LOGO_FILE = 'xchain-color-750.png';
export const FAVICON_FILE = 'favicon.png';

/** Small (20px) chain icon filenames keyed by ChainDescriptor.id. */
export const CHAIN_ICON_SMALL = {
    'bitcoin-mainnet': 'bitcoin-mainnet-icon-20.png',
    'bitcoin-testnet': 'bitcoin-testnet-icon-20.png',
    'bitcoin-regtest': 'bitcoin-regtest-icon-20.png',
    'dogecoin-mainnet': 'dogecoin-mainnet-icon-20.png',
    'dogecoin-testnet': 'dogecoin-testnet-icon-20.png',
    'dogecoin-regtest': 'dogecoin-regtest-icon-20.png',
    'litecoin-mainnet': 'litecoin-mainnet-icon-20.png',
    'litecoin-testnet': 'litecoin-testnet-icon-20.png',
    'litecoin-regtest': 'litecoin-regtest-icon-20.png',
};

/** Large (500px) chain icon filenames keyed by ChainDescriptor.id. */
export const CHAIN_ICON_LARGE = {
    'bitcoin-mainnet': 'bitcoin-mainnet-500.png',
    'bitcoin-testnet': 'bitcoin-testnet-500.png',
    'bitcoin-regtest': 'bitcoin-regtest-500.png',
    'dogecoin-mainnet': 'dogecoin-mainnet-500.png',
    'dogecoin-testnet': 'dogecoin-testnet-500.png',
    'dogecoin-regtest': 'dogecoin-regtest-500.png',
    'litecoin-mainnet': 'litecoin-mainnet-500.png',
    'litecoin-testnet': 'litecoin-testnet-500.png',
    'litecoin-regtest': 'litecoin-regtest-500.png',
};

/**
 * Resolve a branding image filename to a runtime URL.
 * Vite rewrites this at build time to a hashed static-image URL.
 * Node / test environments get a file:// URL that still resolves on disk.
 * @param {string} filename  Filename inside ./images/
 * @returns {string}
 */
export function brandingUrl(filename) {
    return new URL(`./images/${filename}`, import.meta.url).href;
}

/** @returns {string} Product logo URL. */
export function logoUrl() {
    return brandingUrl(LOGO_FILE);
}

/** @returns {string} Favicon URL. */
export function faviconUrl() {
    return brandingUrl(FAVICON_FILE);
}

/**
 * @param {string} chainId ChainDescriptor.id (e.g. 'bitcoin-mainnet')
 * @returns {string | null} Small (20px) icon URL, or null if the chain isn't mapped.
 */
export function chainIconSmallUrl(chainId) {
    const f = CHAIN_ICON_SMALL[chainId];
    return f ? brandingUrl(f) : null;
}

/**
 * @param {string} chainId ChainDescriptor.id
 * @returns {string | null} Large (500px) icon URL, or null if the chain isn't mapped.
 */
export function chainIconLargeUrl(chainId) {
    const f = CHAIN_ICON_LARGE[chainId];
    return f ? brandingUrl(f) : null;
}
