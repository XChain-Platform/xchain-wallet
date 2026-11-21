// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { sha256 } from '@noble/hashes/sha2';

export const WATCH_GLYPH = Object.freeze({ kind: 'glyph' });
export const MAX_WATCH_IMAGE_BYTES = 5 * 1024 * 1024;

function exportCanvas(canvas, type, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob?.size) resolve(blob);
            else reject(new Error('canvas export failed'));
        }, type, quality);
    });
}

function hasAlpha(context, width, height) {
    const pixels = context.getImageData(0, 0, width, height).data;
    for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] !== 255) return true;
    }
    return false;
}

function hex(bytes) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function rasterWatchImage(source, options = {}) {
    const settings = typeof options === 'string' ? { kind: options } : options;
    const kind = settings.kind ?? 'icon';
    const createBitmap = settings.createImageBitmap ?? globalThis.createImageBitmap;
    const createCanvas = settings.createCanvas
        ?? (() => globalThis.document.createElement('canvas'));
    let bitmap;
    try {
        if (kind !== 'icon' && kind !== 'artwork') throw new Error('invalid image kind');
        if (source?.size > MAX_WATCH_IMAGE_BYTES) throw new Error('image too large');
        bitmap = await createBitmap(source);
        if (!Number.isFinite(bitmap.width) || !Number.isFinite(bitmap.height)
            || bitmap.width < 1 || bitmap.height < 1) throw new Error('invalid image size');

        const scale = kind === 'icon' ? 1 : 400 / Math.max(bitmap.width, bitmap.height);
        const width = kind === 'icon' ? 96 : Math.max(1, Math.round(bitmap.width * scale));
        const height = kind === 'icon' ? 96 : Math.max(1, Math.round(bitmap.height * scale));
        const canvas = createCanvas();
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('canvas unavailable');
        context.drawImage(bitmap, 0, 0, width, height);

        const type = kind === 'artwork' && !hasAlpha(context, width, height)
            ? 'image/jpeg' : 'image/png';
        const blob = await exportCanvas(canvas, type, type === 'image/jpeg' ? 0.8 : undefined);
        const hash = hex(sha256(new Uint8Array(await blob.arrayBuffer())));
        const name = `${hash}.${type === 'image/jpeg' ? 'jpg' : 'png'}`;
        return { kind: 'image', hash, name, blob, width, height };
    } catch {
        return WATCH_GLYPH;
    } finally {
        bitmap?.close?.();
    }
}

export function rasterWatchIcon(source, options) {
    return rasterWatchImage(source, { ...options, kind: 'icon' });
}

export function rasterWatchArtwork(source, options) {
    return rasterWatchImage(source, { ...options, kind: 'artwork' });
}
