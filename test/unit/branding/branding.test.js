// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: branding/branding.js: product identity constants + URL helpers.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    PRODUCT_NAME,
    TAGLINE,
    CANONICAL_DOMAIN,
    HOMEPAGE_URL,
    ACCENT_PRIMARY,
    ACCENT_SECONDARY,
    DEFAULT_EXPLORER_BASE,
    DEFAULT_HUB_BASE,
    COINGECKO_API_BASE,
    IPFS_GATEWAY_BASE,
    ARWEAVE_GATEWAY_BASE,
    ANDROID_UPDATE_FEED_URL,
    TREZOR_CONNECT_ORIGIN,
    TREZOR_CONNECT_SCRIPT_URL,
    TREZOR_MANIFEST,
    LOCAL_CONNECT_SOURCES,
    DEFAULT_MINER_URL,
    EXTERNAL_EXPLORERS,
    LOGO_FILE,
    FAVICON_FILE,
    CHAIN_ICON_SMALL,
    CHAIN_ICON_LARGE,
    brandingUrl,
    logoUrl,
    faviconUrl,
    chainIconSmallUrl,
    chainIconLargeUrl,
} from '../../../packages/core/src/branding/branding.js';

const IMAGES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../packages/core/src/branding/images');

describe('branding constants', () => {
    it('PRODUCT_NAME is XChain Wallet', () => {
        expect(PRODUCT_NAME).toBe('XChain Wallet');
    });

    it('TAGLINE is a non-empty string', () => {
        expect(typeof TAGLINE).toBe('string');
        expect(TAGLINE.length).toBeGreaterThan(0);
    });

    it('CANONICAL_DOMAIN is wallet.xchain.io', () => {
        expect(CANONICAL_DOMAIN).toBe('wallet.xchain.io');
    });

    it('HOMEPAGE_URL starts with https://', () => {
        expect(HOMEPAGE_URL.startsWith('https://')).toBe(true);
        expect(HOMEPAGE_URL).toContain(CANONICAL_DOMAIN);
    });

    it('ACCENT_PRIMARY is a hex colour', () => {
        expect(ACCENT_PRIMARY).toMatch(/^#[0-9a-fA-F]{6}$/);
    });

    it('ACCENT_SECONDARY is a hex colour', () => {
        expect(ACCENT_SECONDARY).toMatch(/^#[0-9a-fA-F]{6}$/);
    });

    it('DEFAULT_EXPLORER_BASE is a URL string', () => {
        expect(DEFAULT_EXPLORER_BASE).toMatch(/^https?:\/\//);
    });

    it('DEFAULT_HUB_BASE is a URL string', () => {
        expect(DEFAULT_HUB_BASE).toMatch(/^https?:\/\//);
    });

    it('keeps runtime service and explorer URLs in the product config', () => {
        const serviceUrls = [
            COINGECKO_API_BASE,
            IPFS_GATEWAY_BASE,
            ARWEAVE_GATEWAY_BASE,
            ANDROID_UPDATE_FEED_URL,
            TREZOR_CONNECT_ORIGIN,
            TREZOR_CONNECT_SCRIPT_URL,
            TREZOR_MANIFEST.appUrl,
            DEFAULT_MINER_URL,
            ...Object.values(EXTERNAL_EXPLORERS)
                .flatMap(({ baseUrl, iconUrl }) => [baseUrl, iconUrl]),
        ];
        expect(serviceUrls.every((value) => URL.canParse(value))).toBe(true);
        expect(LOCAL_CONNECT_SOURCES).toEqual([
            'http://localhost:*',
            'http://127.0.0.1:*',
            'ws://localhost:*',
            'ws://127.0.0.1:*',
        ]);
        expect(TREZOR_CONNECT_SCRIPT_URL.startsWith(`${TREZOR_CONNECT_ORIGIN}/`)).toBe(true);
        expect(Object.isFrozen(EXTERNAL_EXPLORERS)).toBe(true);
        expect(Object.values(EXTERNAL_EXPLORERS).every(Object.isFrozen)).toBe(true);
    });

    it('LOGO_FILE is a .png filename', () => {
        expect(LOGO_FILE).toMatch(/\.png$/);
    });

    it('FAVICON_FILE is a .png filename', () => {
        expect(FAVICON_FILE).toMatch(/\.png$/);
    });
});

describe('CHAIN_ICON_SMALL + CHAIN_ICON_LARGE', () => {
    const chains = [
        'bitcoin-mainnet', 'bitcoin-testnet', 'bitcoin-regtest',
        'dogecoin-mainnet', 'dogecoin-testnet', 'dogecoin-regtest',
        'litecoin-mainnet', 'litecoin-testnet', 'litecoin-regtest',
    ];

    for (const chain of chains) {
        it(`CHAIN_ICON_SMALL has an entry for ${chain}`, () => {
            expect(CHAIN_ICON_SMALL[chain]).toMatch(/\.png$/);
        });
        it(`CHAIN_ICON_LARGE has an entry for ${chain}`, () => {
            expect(CHAIN_ICON_LARGE[chain]).toMatch(/\.png$/);
        });
    }
});

describe('brandingUrl', () => {
    it('returns a non-empty string URL', () => {
        const url = brandingUrl('logo.png');
        expect(typeof url).toBe('string');
        expect(url.length).toBeGreaterThan(0);
    });

    it('returns a file:// or https:// URL rooted in the branding directory', () => {
        const url = brandingUrl('myimage.png');
        // In Node/jsdom the URL is a file:// URL rooted at the module's location.
        // The filename may render oddly in template-literal resolution under jsdom,
        // but the 'branding' path segment is always present.
        expect(url).toMatch(/^(file|https?):\/\//);
        expect(url).toContain('branding');
    });
});

describe('logoUrl / faviconUrl', () => {
    it('logoUrl returns a non-empty URL string', () => {
        const url = logoUrl();
        expect(typeof url).toBe('string');
        expect(url.length).toBeGreaterThan(0);
        expect(url).toMatch(/^(file|https?):\/\//);
    });

    it('faviconUrl returns a non-empty URL string', () => {
        const url = faviconUrl();
        expect(typeof url).toBe('string');
        expect(url.length).toBeGreaterThan(0);
        expect(url).toMatch(/^(file|https?):\/\//);
    });
});

describe('chainIconSmallUrl / chainIconLargeUrl', () => {
    it('returns a non-empty URL string for a known chainId (small)', () => {
        const url = chainIconSmallUrl('bitcoin-mainnet');
        expect(typeof url).toBe('string');
        expect(url.length).toBeGreaterThan(0);
        // The return value is the result of brandingUrl which builds a file:// URL;
        // we assert it's a proper URL shape.
        expect(url).toMatch(/^(file|https?):\/\//);
    });

    it('returns a non-empty URL string for a known chainId (large)', () => {
        const url = chainIconLargeUrl('dogecoin-mainnet');
        expect(typeof url).toBe('string');
        expect(url.length).toBeGreaterThan(0);
        expect(url).toMatch(/^(file|https?):\/\//);
    });

    it('ships every small icon at 144px, sharp at 48 CSS px on a 3x screen', () => {
        // A 20px raster drawn at 48px on a 2.6x phone was upscaled about six
        // times and looked blurry; the PNG width sits at bytes 16..19 of IHDR.
        for (const id of Object.keys(CHAIN_ICON_SMALL)) {
            // Read from the source tree: under Vite the branding URL is a
            // served path, not a file.
            const png = readFileSync(join(IMAGES_DIR, CHAIN_ICON_SMALL[id]));
            expect([id, png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([id, 144, 144]);
        }
    });

    it('returns null for an unknown chainId (small)', () => {
        expect(chainIconSmallUrl('unknown-chain')).toBeNull();
    });

    it('returns null for an unknown chainId (large)', () => {
        expect(chainIconLargeUrl('unknown-chain')).toBeNull();
    });
});
