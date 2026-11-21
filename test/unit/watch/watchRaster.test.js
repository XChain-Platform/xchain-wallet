// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { sha256 } from '@noble/hashes/sha2';
import { describe, expect, it, vi } from 'vitest';
import {
    rasterWatchArtwork,
    rasterWatchIcon,
    rasterWatchImage,
    MAX_WATCH_IMAGE_BYTES,
    WATCH_GLYPH,
} from '../../../packages/core/src/watch/watchRaster.js';

const encoded = new Uint8Array([7, 11, 13, 17]);
const digest = Array.from(sha256(encoded), (byte) => byte.toString(16).padStart(2, '0')).join('');

function harness({ width = 800, height = 400, alpha = false, exportBlob } = {}) {
    const close = vi.fn();
    const drawImage = vi.fn();
    const getImageData = vi.fn(() => ({
        data: new Uint8ClampedArray([0, 0, 0, alpha ? 128 : 255]),
    }));
    const context = { drawImage, getImageData };
    const canvas = {
        width: 0,
        height: 0,
        getContext: vi.fn(() => context),
        toBlob: vi.fn((callback, type) => callback(exportBlob ?? new Blob([encoded], { type }))),
    };
    const createImageBitmap = vi.fn(async () => ({ width, height, close }));
    return {
        canvas,
        close,
        context,
        options: { createImageBitmap, createCanvas: () => canvas },
    };
}

describe('watchRaster', () => {
    it('exports a 96 px PNG icon named by its encoded content hash', async () => {
        const h = harness();
        const result = await rasterWatchIcon(new Blob(['source']), h.options);

        expect(result).toMatchObject({
            kind: 'image',
            hash: digest,
            name: `${digest}.png`,
            width: 96,
            height: 96,
        });
        expect(result.blob.type).toBe('image/png');
        expect(h.canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png', undefined);
        expect(h.context.drawImage).toHaveBeenCalledWith(expect.any(Object), 0, 0, 96, 96);
        expect(h.close).toHaveBeenCalledOnce();
    });

    it('preserves aspect ratio at a 400 px longest edge and JPEG quality 0.8', async () => {
        const h = harness();
        const result = await rasterWatchArtwork(new Blob(['source']), h.options);

        expect(result).toMatchObject({ name: `${digest}.jpg`, width: 400, height: 200 });
        expect(result.blob.type).toBe('image/jpeg');
        expect(h.canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.8);
    });

    it('keeps artwork with alpha as PNG', async () => {
        const h = harness({ width: 200, height: 500, alpha: true });
        const result = await rasterWatchImage(new Blob(['source']), {
            ...h.options,
            kind: 'artwork',
        });

        expect(result).toMatchObject({ name: `${digest}.png`, width: 160, height: 400 });
        expect(result.blob.type).toBe('image/png');
    });

    it.each([
        ['zero size', () => harness({ width: 0 }).options],
        ['invalid size', () => harness({ width: Number.NaN }).options],
        ['taint', () => {
            const h = harness();
            h.context.getImageData.mockImplementation(() => { throw new Error('tainted'); });
            return h.options;
        }],
        ['export', () => harness({ exportBlob: new Blob([]) }).options],
    ])('falls back to the glyph on %s failure', async (_name, makeOptions) => {
        await expect(rasterWatchArtwork(new Blob(['source']), makeOptions())).resolves.toBe(WATCH_GLYPH);
    });

    it('falls back to the glyph when decoding rejects', async () => {
        const failure = Promise.reject(new Error('decode failed'));
        await expect(rasterWatchIcon(new Blob(['source']), {
            createImageBitmap: () => failure,
            createCanvas: vi.fn(),
        })).resolves.toBe(WATCH_GLYPH);
    });

    it('refuses sources over 5 MiB before decoding', async () => {
        const h = harness();
        await expect(rasterWatchIcon({ size: MAX_WATCH_IMAGE_BYTES + 1 }, h.options))
            .resolves.toBe(WATCH_GLYPH);
        expect(h.options.createImageBitmap).not.toHaveBeenCalled();
    });
});
