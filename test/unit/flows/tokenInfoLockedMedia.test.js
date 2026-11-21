// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2025-2026 Dankest, LLC

import { describe, expect, it } from 'vitest';
import {
    normalizeTokenInfo,
    resolveMediaDataRefs,
    tisToMediaBundle,
} from '../../../packages/core/src/flows/tokenInfo.js';

const lockedEntry = {
    data_ref: 'action:123',
    locked: true,
    pack_id: 'pack-one',
    title: 'Holder media',
};

describe('locked TIS media', () => {
    it('preserves lock and pack fields on every media array', () => {
        const bundle = tisToMediaBundle({
            images: [lockedEntry, 'ipfs://public-image'],
            audio: [lockedEntry],
            video: [lockedEntry],
            files: [lockedEntry, 'ipfs://public-file'],
        });

        for (const key of ['images', 'audio', 'video', 'files']) {
            expect(bundle[key][0]).toMatchObject({
                locked: true,
                packId: 'pack-one',
                title: 'Holder media',
                url: null,
            });
        }
        expect(bundle.images[1]).toMatchObject({ locked: false, packId: null, title: null });
        expect(bundle.files[1]).toMatchObject({ locked: false, packId: null, title: null });
    });

    it('never resolves locked data references to ciphertext URLs', () => {
        const bundle = tisToMediaBundle({
            images: [lockedEntry, { data_ref: 'action:456', name: 'Public image' }],
        });
        const calls = [];
        resolveMediaDataRefs(bundle, {
            fileRawUrl: (index) => {
                calls.push(index);
                return `raw:${index}`;
            },
        });

        expect(bundle.images[0].url).toBeNull();
        expect(bundle.images[0]).toMatchObject({ locked: true, packId: 'pack-one' });
        expect(bundle.images[1].url).toBe('raw:456');
        expect(calls).toEqual(['456']);
    });

    it('derives the hero image from the first unlocked image', () => {
        const bundle = tisToMediaBundle({
            images: [lockedEntry, 'ipfs://public-image'],
        });
        const info = normalizeTokenInfo('bitcoin-mainnet', 'MEDIA', { info: {} }, bundle);
        expect(info.imageUrl).toBe(bundle.images[1].url);

        const lockedOnly = tisToMediaBundle({ images: [lockedEntry] });
        const withoutHero = normalizeTokenInfo('bitcoin-mainnet', 'MEDIA', { info: {} }, lockedOnly);
        expect(withoutHero.imageUrl).toBeNull();
    });

    it.each(['images', 'files'])('keeps %s data when data_ref is not an action reference', (key) => {
        const data = 'https://192.0.2.1/public.png';
        const bundle = tisToMediaBundle({ [key]: [{ data, data_ref: 'not-a-ref' }] });
        expect(bundle[key]).toHaveLength(1);
        expect(bundle[key][0]).toMatchObject({ url: data, dataRef: null });
    });

    it.each(['images', 'files'])('normalizes and resolves padded %s action references', (key) => {
        const bundle = tisToMediaBundle({ [key]: [{ data_ref: ' action:DOGE:55 ' }] });
        expect(bundle[key][0]).toMatchObject({ url: null, dataRef: 'action:DOGE:55' });
        resolveMediaDataRefs(bundle, { fileRawUrl: (index, coin) => `raw:${coin}:${index}` });
        expect(bundle[key][0].url).toBe('raw:DOGE:55');
    });

    it('uses a valid action reference over data and drops an unusable reference-only entry', () => {
        const data = 'https://192.0.2.1/public.png';
        const bundle = tisToMediaBundle({
            images: [
                { data, data_ref: 'action:12' },
                { data_ref: 'https://192.0.2.2/not-an-action' },
            ],
        });
        expect(bundle.images).toHaveLength(1);
        expect(bundle.images[0]).toMatchObject({ url: null, dataRef: 'action:12', source: data });
    });
});
