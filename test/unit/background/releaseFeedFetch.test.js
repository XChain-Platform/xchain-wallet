// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// updates.releaseFeed serves the About panel on a page that may not fetch (the
// desktop renderer, connect-src 'self'). It reads no request, fetches only the
// release-feed address and refuses an oversize body or a redirect.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import {
    RELEASE_FEED_MAX_BYTES,
    createReleaseFeedHandler,
} from '../../../packages/extension/src/background/releaseFeedFetch.js';
import { WALLET_RELEASE_FEED_URL } from '../../../packages/core/src/branding/branding.js';
import { chainRegistry, memCollection } from './_addressesByChainFixture.js';

const FEED = '{"latest":"1.0.0","channels":{}}';

function streamOf(...chunks) {
    const encoder = new TextEncoder();
    let index = 0;
    const cancel = vi.fn(async () => {});
    return {
        cancel,
        body: {
            getReader: () => ({
                read: async () => (index < chunks.length
                    ? { done: false, value: encoder.encode(chunks[index++]) }
                    : { done: true, value: undefined }),
                cancel,
            }),
        },
    };
}

function makeHost() {
    return createBackgroundHost({
        vault: {
            wallets: memCollection(),
            accounts: memCollection(),
            addresses: memCollection(),
            signers: memCollection(),
            settings: { async get() { return { schemaVersion: 1, activeNetwork: 'mainnet', privacy: {} }; }, async put() {} },
        },
        chainRegistry,
        sdkRegistry: { get: () => ({}) },
        signerPool: { get: () => null, has: () => false },
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
}

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('updates.releaseFeed host handler', () => {
    it('fetches only the release-feed address and ignores any url in the request', async () => {
        const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, ...streamOf(FEED) }));
        vi.stubGlobal('fetch', fetchSpy);

        const res = await makeHost().handle({
            type: 'updates.releaseFeed',
            request: { url: 'https://evil.example/steal', method: 'POST' },
        });

        expect(res.result).toEqual({ ok: true, text: FEED });
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(fetchSpy.mock.calls[0][0]).toBe(WALLET_RELEASE_FEED_URL);
        expect(fetchSpy.mock.calls[0][1]).toMatchObject({
            method: 'GET',
            redirect: 'error',
            credentials: 'omit',
            cache: 'no-store',
            referrerPolicy: 'no-referrer',
        });
        expect(fetchSpy.mock.calls[0][1].headers).toBeUndefined();
    });

    it('refuses a body over the feed size cap and stops reading it', async () => {
        const big = streamOf('x'.repeat(RELEASE_FEED_MAX_BYTES), 'y');
        const handler = createReleaseFeedHandler({ fetch: async () => ({ ok: true, status: 200, body: big.body }) });

        await expect(handler()).resolves.toEqual({ ok: false, status: 200, error: 'feed too large' });
        expect(big.cancel).toHaveBeenCalledOnce();
    });

    it('accepts a body exactly at the cap', async () => {
        const text = 'z'.repeat(RELEASE_FEED_MAX_BYTES);
        const handler = createReleaseFeedHandler({
            fetch: async () => ({ ok: true, status: 200, ...streamOf(text) }),
        });

        await expect(handler()).resolves.toEqual({ ok: true, text });
    });

    it('caps a response that has no readable stream by its text length', async () => {
        const handler = createReleaseFeedHandler({
            fetch: async () => ({ ok: true, status: 200, text: async () => 'q'.repeat(RELEASE_FEED_MAX_BYTES + 1) }),
        });

        await expect(handler()).resolves.toMatchObject({ ok: false, error: 'feed too large' });
    });

    it('reports an HTTP failure and a refused redirect as not ok', async () => {
        const down = createReleaseFeedHandler({ fetch: async () => ({ ok: false, status: 503 }) });
        const redirected = createReleaseFeedHandler({
            fetch: async () => { throw new TypeError('redirect mode is set to error'); },
        });

        await expect(down()).resolves.toEqual({ ok: false, status: 503, error: 'feed unavailable' });
        await expect(redirected()).resolves.toEqual({
            ok: false,
            status: 0,
            error: 'redirect mode is set to error',
        });
    });

    it('aborts a stalled request after eight seconds', async () => {
        vi.useFakeTimers();
        let requestSignal;
        const handler = createReleaseFeedHandler({
            fetch: (_url, init) => new Promise((_resolve, reject) => {
                requestSignal = init.signal;
                requestSignal.addEventListener('abort', () => reject(new Error('request timed out')));
            }),
        });

        const pending = handler();
        await vi.advanceTimersByTimeAsync(8000);

        expect(requestSignal.aborted).toBe(true);
        await expect(pending).resolves.toEqual({ ok: false, status: 0, error: 'request timed out' });
    });
});
