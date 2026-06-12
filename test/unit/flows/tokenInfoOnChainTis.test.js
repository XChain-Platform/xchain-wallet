// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
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
} from '../../../packages/core/src/flows/tokenInfo.js';

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
    it('matches the on-chain pointer form only', () => {
        expect('action:123'.match(TIS_ACTION_REF_RE)?.[1]).toBe('123');
        expect('ACTION:9'.match(TIS_ACTION_REF_RE)?.[1]).toBe('9');
        expect('action:'.match(TIS_ACTION_REF_RE)).toBeNull();
        expect('action:12x'.match(TIS_ACTION_REF_RE)).toBeNull();
        expect('https://a/b.json'.match(TIS_ACTION_REF_RE)).toBeNull();
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
            fileRawUrl: (idx) => `https://explorer.example/RBTC/api/file/${idx}/raw`,
        };
        const bundle = await fetchOnChainTisBundle({ sdk, actionIndex: '102' });
        resolveMediaDataRefs(bundle, sdk);
        expect(bundle.images[0].url).toBe('https://explorer.example/RBTC/api/file/101/raw');
        // Already-resolved or non-ref entries are untouched
        const noop = resolveMediaDataRefs({ images: [{ url: 'https://a/b.png', dataRef: null }] }, sdk);
        expect(noop.images[0].url).toBe('https://a/b.png');
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
