// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// On-chain TIS documents (Token_Information_Standard.md On-Chain
// Format): DESCRIPTION = "action:<index>" names a same-chain FILE whose
// bytes are the TIS JSON. The wallet resolves it through the explorer's
// raw FILE endpoint instead of an external fetch.

import { describe, it, expect } from 'vitest';
import {
    TIS_ACTION_REF_RE,
    fetchOnChainTisBundle,
    resolveMediaDataRefs,
    tokenInfoFor,
} from '../../../packages/core/src/flows/tokenInfo.js';
import { safeHttpUrl, safeImageSrc } from '../../../packages/core/src/shared/utils/externalUrl.js';
import { isAssetImageSourceAllowed } from '../../../packages/core/src/shared/components/BalanceList.jsx';

const TIS_JSON = JSON.stringify({
    tick: 'ART1',
    name: 'Art One',
    categories: [{ type: 'main', data: 'NFT' }],
    images: [{ data_ref: 'action:101', type: 'image/png', name: 'art.png' }],
});

function sdkReturning(bytes) {
    return { getGatedFileRaw: async () => bytes };
}

describe('TIS_ACTION_REF_RE', () => {
    it('matches the same-chain pointer form', () => {
        expect('action:123'.match(TIS_ACTION_REF_RE)?.[2]).toBe('123');
        expect('ACTION:9'.match(TIS_ACTION_REF_RE)?.[2]).toBe('9');
        expect('action:'.match(TIS_ACTION_REF_RE)).toBeNull();
        expect('action:12x'.match(TIS_ACTION_REF_RE)).toBeNull();
        expect('https://a/b.json'.match(TIS_ACTION_REF_RE)).toBeNull();
    });

    it('matches the sibling-chain pointer form with a base coin ticker', () => {
        const m = 'action:DOGE:55'.match(TIS_ACTION_REF_RE);
        expect(m?.[1]).toBe('DOGE');
        expect(m?.[2]).toBe('55');
        expect('action:doge:55'.match(TIS_ACTION_REF_RE)?.[2]).toBe('55');
        expect('action:ETH:55'.match(TIS_ACTION_REF_RE)).toBeNull();
        expect('action:RDOGE:55'.match(TIS_ACTION_REF_RE)).toBeNull();
    });
});

describe('fetchOnChainTisBundle', () => {
    it('parses raw FILE bytes into a media bundle, keeping data_ref entries', async () => {
        const bytes = new TextEncoder().encode(TIS_JSON);
        const bundle = await fetchOnChainTisBundle({ sdk: sdkReturning(bytes), actionIndex: '102' });
        expect(bundle).not.toBeNull();
        expect(bundle.name).toBe('Art One');
        expect(bundle.images.length).toBe(1);
        expect(bundle.images[0].dataRef).toBe('action:101');
        expect(bundle.images[0].url).toBeNull();
    });

    it('resolveMediaDataRefs turns dataRef entries into explorer raw URLs', async () => {
        const bytes = new TextEncoder().encode(TIS_JSON);
        const sdk = {
            ...sdkReturning(bytes),
            fileRawUrl: (idx, coin) => `https://explorer.example/${coin || 'RBTC'}/api/file/${idx}/raw`,
        };
        const bundle = await fetchOnChainTisBundle({ sdk, actionIndex: '102' });
        resolveMediaDataRefs(bundle, sdk);
        expect(bundle.images[0].url).toBe('https://explorer.example/RBTC/api/file/101/raw');
        // Already-resolved or non-ref entries are untouched
        const noop = resolveMediaDataRefs({ images: [{ url: 'https://a/b.png', dataRef: null }] }, sdk);
        expect(noop.images[0].url).toBe('https://a/b.png');
    });

    it('resolveMediaDataRefs passes the base coin for sibling-chain refs', () => {
        const sdk = {
            fileRawUrl: (idx, coin) => `https://explorer.example/${coin || 'SAME'}/api/file/${idx}/raw`,
        };
        const bundle = { images: [{ url: null, dataRef: 'action:DOGE:55' }] };
        resolveMediaDataRefs(bundle, sdk);
        expect(bundle.images[0].url).toBe('https://explorer.example/DOGE/api/file/55/raw');
    });

    it('returns null for non-JSON bytes', async () => {
        const bytes = new TextEncoder().encode('\x89PNG not json');
        expect(await fetchOnChainTisBundle({ sdk: sdkReturning(bytes), actionIndex: '1' })).toBeNull();
    });

    it('returns null when the fetch throws or the sdk lacks the method', async () => {
        expect(await fetchOnChainTisBundle({ sdk: {}, actionIndex: '1' })).toBeNull();
        const sdk = { getGatedFileRaw: async () => { throw new Error('404'); } };
        expect(await fetchOnChainTisBundle({ sdk, actionIndex: '1' })).toBeNull();
    });

    it('returns null for empty bytes', async () => {
        expect(await fetchOnChainTisBundle({ sdk: sdkReturning(new Uint8Array(0)), actionIndex: '1' })).toBeNull();
    });
});

// 1x1 transparent PNG.
const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const TINY_PNG = Uint8Array.from(atob(TINY_PNG_B64), (c) => c.charCodeAt(0));

function explorerSdk(bytes) {
    return {
        getGatedFileRaw: async () => bytes,
        fileRawUrl: (idx, coin) => `https://explorer.example/${coin || 'RBTC'}/api/file/${idx}/raw`,
    };
}

describe('fetchOnChainTisBundle with a raw picture FILE', () => {
    it('turns PNG bytes into the token picture as a data: URL', async () => {
        const sdk = explorerSdk(TINY_PNG);
        const bundle = await fetchOnChainTisBundle({ sdk, actionIndex: '102' });
        expect(bundle).not.toBeNull();
        expect(bundle.images).toEqual([
            { url: `data:image/png;base64,${TINY_PNG_B64}`, dataRef: 'action:102', type: 'large', name: null },
        ]);
        expect(bundle.description).toBeNull();
        // The picture is already resolved, so no remote raw-FILE URL replaces it.
        resolveMediaDataRefs(bundle, sdk);
        expect(bundle.images[0].url).toBe(`data:image/png;base64,${TINY_PNG_B64}`);
        // The image components accept it, and no link opens it.
        expect(safeImageSrc(bundle.images[0].url)).toBe(bundle.images[0].url);
        expect(safeHttpUrl(bundle.images[0].url)).toBeNull();
        expect(isAssetImageSourceAllowed(bundle.images[0].url, false)).toBe(true);
    });

    it('keeps the sibling-chain coin on the picture reference', async () => {
        const sdk = explorerSdk(TINY_PNG);
        const bundle = await fetchOnChainTisBundle({ sdk, actionIndex: '55', coin: 'DOGE' });
        expect(bundle.images[0].dataRef).toBe('action:DOGE:55');
    });

    it('accepts an SVG document by its root element', async () => {
        const text = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>';
        const bundle = await fetchOnChainTisBundle({ sdk: explorerSdk(new TextEncoder().encode(text)), actionIndex: '7' });
        expect(bundle.images[0].url).toBe(`data:image/svg+xml;base64,${btoa(text)}`);
        expect(safeImageSrc(bundle.images[0].url)).toBe(bundle.images[0].url);
    });

    it('refuses non-picture and non-base64 data: URLs as image sources', () => {
        expect(safeImageSrc('data:text/html;base64,PGI+')).toBeNull();
        expect(safeImageSrc('data:image/svg+xml,<svg onload=x>')).toBeNull();
        expect(safeImageSrc('javascript:alert(1)')).toBeNull();
        expect(safeImageSrc('https://a.example/b.png')).toBe('https://a.example/b.png');
    });

    it('refuses a picture over the inline preview cap', async () => {
        const big = new Uint8Array(5 * 1024 * 1024 + 1);
        big.set(TINY_PNG);
        expect(await fetchOnChainTisBundle({ sdk: explorerSdk(big), actionIndex: '1' })).toBeNull();
    });

    it('returns null for bytes that are neither JSON nor a picture', async () => {
        const bytes = new TextEncoder().encode('plain words, not a picture');
        expect(await fetchOnChainTisBundle({ sdk: explorerSdk(bytes), actionIndex: '1' })).toBeNull();
    });

    it('still parses a JSON bundle as TIS, not as a picture', async () => {
        const bytes = new TextEncoder().encode(TIS_JSON);
        const bundle = await fetchOnChainTisBundle({ sdk: explorerSdk(bytes), actionIndex: '102' });
        expect(bundle.name).toBe('Art One');
        expect(bundle.images).toHaveLength(1);
        expect(bundle.images[0].dataRef).toBe('action:101');
        expect(bundle.images[0].mime).toBeUndefined();
    });

    it('tokenInfoFor shows the picture as the token image', async () => {
        const sdk = {
            ...explorerSdk(TINY_PNG),
            getToken: async () => ({ info: { tick: 'ART2', description: 'action:102' } }),
        };
        const info = await tokenInfoFor({
            sdkRegistry: { get: () => sdk },
            chainId: 'RBTC',
            tick: 'ART2',
            fetch: async () => { throw new Error('no external fetch expected'); },
        });
        expect(info.imageUrl).toBe(`data:image/png;base64,${TINY_PNG_B64}`);
        expect(info.images[0].type).toBe('large');
        expect(info.description).toBe('action:102');
    });
});
