// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { tokenInfoFor } from '../../../packages/core/src/flows/tokenInfo.js';

const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const TINY_PNG = Uint8Array.from(atob(TINY_PNG_B64), (char) => char.charCodeAt(0));

function fileRow(index) {
    return {
        action_index: index,
        name: `file-${index}.pdf`,
        title: `File ${index}`,
        type: 'application/pdf',
        block_index: 1000 + index,
        gated: 0,
    };
}

async function readFiles(count) {
    const getFiles = vi.fn().mockResolvedValue({ data: Array.from({ length: count }, (_, index) => fileRow(index + 1)) });
    const sdk = {
        getToken: vi.fn().mockResolvedValue({ info: { tick: 'FILES', owner: 'issuer' }, linked_files: [] }),
        getFiles,
        fileRawUrl: (index) => `https://explorer.example/RBTC/api/file/${index}/raw`,
    };
    const info = await tokenInfoFor({
        sdkRegistry: { get: () => sdk },
        chainId: 'bitcoin-regtest',
        tick: 'FILES',
        metadataFetchEnabled: false,
    });
    return { info, getFiles };
}

function artworkSdk({ description = null, bytes = TINY_PNG, type = 'image/png' } = {}) {
    const getGatedFileRaw = vi.fn(async () => bytes);
    return {
        getToken: vi.fn().mockResolvedValue({ info: { tick: 'FILES', owner: 'issuer', description } }),
        getFiles: vi.fn().mockResolvedValue({ data: [{ ...fileRow(20), name: 'art.png', type }] }),
        getGatedFileRaw,
        fileRawUrl: (index) => `https://explorer.example/RBTC/api/file/${index}/raw`,
    };
}

async function readArtwork(sdk) {
    return tokenInfoFor({
        sdkRegistry: { get: () => sdk },
        chainId: 'bitcoin-regtest',
        tick: 'FILES',
    });
}

describe('tokenInfoFor linked FILE content', () => {
    it.each([1, 25])('reads %i linked files with one bulk explorer call', async (count) => {
        const { info, getFiles } = await readFiles(count);

        expect(getFiles).toHaveBeenCalledTimes(1);
        expect(getFiles).toHaveBeenCalledWith('FILES', 'token', { limit: 100 });
        expect(info.linkedFiles).toHaveLength(count);
        expect(info.linkedFiles.at(-1)).toEqual(expect.objectContaining({
            actionIndex: String(count),
            title: `File ${count}`,
            url: `https://explorer.example/RBTC/api/file/${count}/raw`,
        }));
    });
});

describe('tokenInfoFor LINKed token artwork', () => {
    it('keeps TIS artwork ahead of a LINKed picture', async () => {
        const tis = new TextEncoder().encode(JSON.stringify({
            tick: 'FILES',
            name: 'Files token',
            images: [{ type: 'large', data: 'https://cdn.example/tis.png', name: 'tis.png' }],
        }));
        const sdk = artworkSdk({ description: 'action:19' });
        sdk.getGatedFileRaw.mockImplementation(async (index) => (index === '19' ? tis : TINY_PNG));

        const info = await readArtwork(sdk);

        expect(info.imageUrl).toBe('https://cdn.example/tis.png');
        expect(info.images).toHaveLength(1);
        expect(sdk.getGatedFileRaw).toHaveBeenCalledWith('19', null);
        expect(sdk.getGatedFileRaw).not.toHaveBeenCalledWith('20', null);
    });

    it('uses sniffed LINKed multipart image bytes when TIS has no artwork', async () => {
        const sdk = artworkSdk();

        const info = await readArtwork(sdk);

        expect(info.imageUrl).toBe(`data:image/png;base64,${TINY_PNG_B64}`);
        expect(info.images).toEqual([
            expect.objectContaining({ dataRef: 'action:20', type: 'large' }),
        ]);
        expect(info.tisAvailable).toBe(false);
        expect(sdk.getGatedFileRaw).toHaveBeenCalledWith('20', null);
    });

    it('shows no artwork when LINKed bytes are not an image', async () => {
        const sdk = artworkSdk({ bytes: new TextEncoder().encode('not an image') });

        const info = await readArtwork(sdk);

        expect(info.imageUrl).toBeNull();
        expect(info.images).toEqual([]);
        expect(sdk.getGatedFileRaw).toHaveBeenCalledWith('20', null);
    });
});
