// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    nativeLinksPlugin,
    nativeSiteHooks,
} from '../../../packages/web/src/deeplinks/nativeSiteDelivery.js';

function request(overrides = {}) {
    return {
        v: 1,
        id: 'req-1',
        method: 'login',
        return: 'https://site.example/back',
        callback: 'https://8.8.8.8/cb',
        ...overrides,
    };
}

describe('nativeLinksPlugin', () => {
    it.each([
        ['without Capacitor', {}],
        ['outside a native platform', {
            Capacitor: {
                isNativePlatform: () => false,
                Plugins: { XChainLinks: {} },
            },
        }],
        ['without XChainLinks', {
            Capacitor: { isNativePlatform: () => true, Plugins: {} },
        }],
    ])('returns null %s', (_label, env) => {
        expect(nativeLinksPlugin(env)).toBeNull();
    });

    it('returns XChainLinks on a native platform', () => {
        const plugin = {};
        expect(nativeLinksPlugin({
            Capacitor: {
                isNativePlatform: () => true,
                Plugins: { XChainLinks: plugin },
            },
        })).toBe(plugin);
    });
});

describe('nativeSiteHooks', () => {
    it.each([null, 'plugin', {}])('returns no hooks without native methods', (plugin) => {
        expect(nativeSiteHooks(plugin, request())).toEqual({});
    });

    it('sends the return URL and parsed browser to native', async () => {
        const returnToBrowser = vi.fn().mockResolvedValue(undefined);
        const { navigate } = nativeSiteHooks({ returnToBrowser }, request({ browser: 'chrome' }));

        await expect(navigate('https://site.example/back#result')).resolves.toBeUndefined();
        expect(returnToBrowser).toHaveBeenCalledWith({
            url: 'https://site.example/back#result',
            browser: 'chrome',
        });
    });

    it('omits browser when the request has none', async () => {
        const returnToBrowser = vi.fn().mockResolvedValue(undefined);
        const { navigate } = nativeSiteHooks({ returnToBrowser }, request());

        await navigate('https://site.example/back#result');
        expect(returnToBrowser).toHaveBeenCalledWith({
            url: 'https://site.example/back#result',
        });
        expect(Object.hasOwn(returnToBrowser.mock.calls[0][0], 'browser')).toBe(false);
    });

    it('settles when native browser return rejects', async () => {
        const { navigate } = nativeSiteHooks({
            returnToBrowser: vi.fn().mockRejectedValue(new Error('unavailable')),
        }, request());

        await expect(navigate('https://site.example/back#result')).resolves.toBeUndefined();
    });

    it('delivers through native post with the fixed callback arguments', async () => {
        const post = vi.fn().mockResolvedValue({ status: 200 });
        const runnerPost = vi.fn();
        const { deliver } = nativeSiteHooks({ post }, request());
        const delivered = await deliver(
            request(),
            { ok: true, result: { proof: 'ok' } },
            { post: runnerPost },
        );

        expect(post).toHaveBeenCalledOnce();
        expect(post).toHaveBeenCalledWith({
            href: 'https://8.8.8.8/cb',
            address: '8.8.8.8',
            body: JSON.stringify(delivered.callback.body),
            timeoutMs: 10000,
            redirect: 'manual',
            credentials: 'omit',
        });
        expect(Object.keys(post.mock.calls[0][0])).toEqual([
            'href',
            'address',
            'body',
            'timeoutMs',
            'redirect',
            'credentials',
        ]);
        expect(runnerPost).not.toHaveBeenCalled();
        expect(delivered.callbackResult).toEqual({ sent: true, status: 200 });
    });

    it('passes hostname resolution through to native post', async () => {
        const post = vi.fn().mockResolvedValue({ status: 204 });
        const resolve = vi.fn().mockResolvedValue(['1.1.1.1']);
        const { deliver } = nativeSiteHooks({ post }, request());

        await deliver(
            request({ callback: 'https://callback.example/cb' }),
            { ok: true, result: {} },
            { resolve },
        );

        expect(resolve).toHaveBeenCalledWith('callback.example');
        expect(post).toHaveBeenCalledWith(expect.objectContaining({ address: '1.1.1.1' }));
    });

    it.each([
        ['returns a non-integer status', vi.fn().mockResolvedValue({ status: '200' })],
        ['rejects with callback details', vi.fn().mockRejectedValue(new Error('https://8.8.8.8/cb failed'))],
    ])('reports NETWORK when native post %s', async (_label, post) => {
        const { deliver } = nativeSiteHooks({ post }, request());
        const delivered = await deliver(request(), { ok: true, result: {} });

        expect(delivered.callbackResult).toEqual({ sent: false, reason: 'NETWORK' });
    });
});
