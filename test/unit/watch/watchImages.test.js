// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it, vi } from 'vitest';
import {
    fetchWatchImage,
    WATCH_IMAGE_GLYPH,
} from '../../../packages/core/src/watch/watchImages.js';

const remoteSource = 'remote-token-image';

function settings(privacy = {}) {
    return {
        privacy: {
            metadataFetchEnabled: true,
            torRouting: false,
            ...privacy,
        },
    };
}

describe('fetchWatchImage', () => {
    it('fetches allowed artwork in CORS mode and returns its blob', async () => {
        const blob = new Blob(['image'], { type: 'image/png' });
        const fetchImpl = vi.fn(async () => ({ ok: true, blob: async () => blob }));

        await expect(fetchWatchImage({
            source: remoteSource,
            settings: settings(),
            fetchImpl,
        })).resolves.toBe(blob);
        expect(fetchImpl).toHaveBeenCalledWith(remoteSource, { mode: 'cors' });
    });

    it.each([
        ['metadata fetching is off', settings({ metadataFetchEnabled: false })],
        ['metadata fetching is missing', { privacy: { torRouting: false } }],
        ['metadata fetching is undefined', settings({ metadataFetchEnabled: undefined })],
        ['privacy settings are missing', {}],
        ['settings have not loaded', undefined],
        ['Tor routing is on', settings({ torRouting: true })],
    ])('refuses remote artwork when %s', async (_case, walletSettings) => {
        const fetchImpl = vi.fn();

        await expect(fetchWatchImage({
            source: remoteSource,
            settings: walletSettings,
            fetchImpl,
        })).resolves.toBe(WATCH_IMAGE_GLYPH);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('applies the metadata gate to inline artwork', async () => {
        const fetchImpl = vi.fn();

        await expect(fetchWatchImage({
            source: 'data:image/png;base64,aW1hZ2U=',
            settings: settings({ metadataFetchEnabled: false }),
            fetchImpl,
        })).resolves.toBe(WATCH_IMAGE_GLYPH);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it.each([
        ['the source is empty', '', settings()],
        ['fetch is unavailable', remoteSource, settings(), null],
    ])('returns the glyph without fetching when %s', async (_case, source, walletSettings, fetchImpl = vi.fn()) => {
        await expect(fetchWatchImage({
            source,
            settings: walletSettings,
            fetchImpl,
        })).resolves.toBe(WATCH_IMAGE_GLYPH);
        if (fetchImpl) expect(fetchImpl).not.toHaveBeenCalled();
    });

    it.each([
        ['the request rejects', async () => { throw new Error('offline'); }],
        ['the response is not successful', async () => ({ ok: false })],
        ['reading the blob rejects', async () => ({
            ok: true,
            blob: async () => { throw new Error('bad body'); },
        })],
    ])('returns the glyph when %s', async (_case, implementation) => {
        await expect(fetchWatchImage({
            source: remoteSource,
            settings: settings(),
            fetchImpl: vi.fn(implementation),
        })).resolves.toBe(WATCH_IMAGE_GLYPH);
    });
});
