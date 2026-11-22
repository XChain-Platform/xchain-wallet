// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    CALLBACK_TIMEOUT_MS,
    buildCallbackBody,
    callbackTarget,
    sendCallback,
} from '../../../packages/core/src/site_request/callbackSend.js';

const validBody = { v: 1, id: 'request-id', method: 'login', ok: true, result: {} };

function transport({ addresses = ['8.8.8.8'], status = 200 } = {}) {
    return {
        resolve: vi.fn().mockResolvedValue(addresses),
        post: vi.fn().mockResolvedValue({ status }),
    };
}

function bodyWithJsonByteLength(byteLength) {
    const prefix = JSON.stringify({ result: '' }).length;
    return { result: `é${'a'.repeat(byteLength - prefix - 2)}` };
}

describe('callbackTarget', () => {
    it('accepts https and normalizes the target', () => {
        expect(callbackTarget('https://example.com/callback')).toEqual({
            href: 'https://example.com/callback',
            hostname: 'example.com',
        });
    });

    it('allows http only for localhost in Developer Mode', () => {
        expect(callbackTarget('http://localhost:8080/cb')).toBeNull();
        expect(callbackTarget('http://localhost:8080/cb', { developerMode: true })).toEqual({
            href: 'http://localhost:8080/cb',
            hostname: 'localhost',
        });
        expect(callbackTarget('http://example.com/', { developerMode: true })).toBeNull();
    });
});

describe('buildCallbackBody', () => {
    it('keeps success keys ordered and includes state and a return claim', () => {
        const body = buildCallbackBody({
            id: 'id',
            method: 'login',
            ok: true,
            result: { address: 'x' },
            error: { code: 'unused' },
            state: 'state',
            claim: 'claim',
        }, { hasReturn: true });

        expect(Object.keys(body)).toEqual([
            'v', 'id', 'method', 'ok', 'result', 'state', 'claim',
        ]);
        expect(body).toEqual({
            v: 1,
            id: 'id',
            method: 'login',
            ok: true,
            result: { address: 'x' },
            state: 'state',
            claim: 'claim',
        });
    });

    it('keeps failure keys ordered and omits absent state and callback-only claim', () => {
        const body = buildCallbackBody({
            id: 'id',
            method: 'login',
            ok: false,
            result: { unused: true },
            error: { code: 'REJECTED' },
            claim: 'claim',
        }, { hasReturn: false });

        expect(Object.keys(body)).toEqual(['v', 'id', 'method', 'ok', 'error']);
        expect(body).toEqual({
            v: 1,
            id: 'id',
            method: 'login',
            ok: false,
            error: { code: 'REJECTED' },
        });
    });
});

describe('sendCallback', () => {
    it.each([
        ['credentials', 'https://user:password@example.com/cb'],
        ['a fragment', 'https://example.com/cb#answer'],
        ['javascript', 'javascript:alert(1)'],
        ['a non-string', null],
        ['2,049 characters', `https://example.com/${'a'.repeat(2029)}`],
    ])('refuses a target with %s before transport', async (_label, url) => {
        const { resolve, post } = transport();

        await expect(sendCallback({ url, body: validBody, resolve, post })).resolves.toEqual({
            sent: false,
            reason: 'BAD_TARGET',
        });
        expect(resolve).not.toHaveBeenCalled();
        expect(post).not.toHaveBeenCalled();
    });

    it('refuses a 10,241-byte body before transport', async () => {
        const { resolve, post } = transport();
        const body = bodyWithJsonByteLength(10241);

        expect(new TextEncoder().encode(JSON.stringify(body))).toHaveLength(10241);
        await expect(sendCallback({
            url: 'https://example.com/cb',
            body,
            resolve,
            post,
        })).resolves.toEqual({ sent: false, reason: 'RESULT_TOO_LARGE' });
        expect(resolve).not.toHaveBeenCalled();
        expect(post).not.toHaveBeenCalled();
    });

    it('posts a named host to the first checked address with fixed options', async () => {
        const { resolve, post } = transport();

        await expect(sendCallback({
            url: 'https://example.com/cb',
            body: validBody,
            resolve,
            post,
        })).resolves.toEqual({ sent: true, status: 200 });
        expect(resolve).toHaveBeenCalledWith('example.com');
        expect(post).toHaveBeenCalledWith({
            href: 'https://example.com/cb',
            address: '8.8.8.8',
            body: JSON.stringify(validBody),
            timeoutMs: CALLBACK_TIMEOUT_MS,
            redirect: 'manual',
            credentials: 'omit',
        });
        expect(CALLBACK_TIMEOUT_MS).toBe(10000);
    });

    it('refuses the whole host when any resolved address is private', async () => {
        const { resolve, post } = transport({ addresses: ['8.8.8.8', '10.0.0.1'] });

        await expect(sendCallback({
            url: 'https://example.com/',
            body: validBody,
            resolve,
            post,
        })).resolves.toEqual({ sent: false, reason: 'REFUSED_ADDRESS' });
        expect(post).not.toHaveBeenCalled();
    });

    it('refuses IPv4 loopback except in Developer Mode without resolving it', async () => {
        const refused = transport();
        await expect(sendCallback({
            url: 'https://127.0.0.1/',
            body: validBody,
            ...refused,
        })).resolves.toEqual({ sent: false, reason: 'REFUSED_ADDRESS' });
        expect(refused.resolve).not.toHaveBeenCalled();
        expect(refused.post).not.toHaveBeenCalled();

        const allowed = transport();
        await expect(sendCallback({
            url: 'https://127.0.0.1/',
            body: validBody,
            developerMode: true,
            ...allowed,
        })).resolves.toEqual({ sent: true, status: 200 });
        expect(allowed.resolve).not.toHaveBeenCalled();
        expect(allowed.post).toHaveBeenCalledWith(expect.objectContaining({ address: '127.0.0.1' }));
    });

    it('refuses IPv6 loopback without resolving it', async () => {
        const { resolve, post } = transport();

        await expect(sendCallback({
            url: 'https://[::1]/',
            body: validBody,
            resolve,
            post,
        })).resolves.toEqual({ sent: false, reason: 'REFUSED_ADDRESS' });
        expect(resolve).not.toHaveBeenCalled();
        expect(post).not.toHaveBeenCalled();
    });

    it('refuses IP literals under Tor without resolving or posting', async () => {
        const { resolve, post } = transport();

        await expect(sendCallback({
            url: 'https://1.2.3.4/',
            body: validBody,
            tor: true,
            resolve,
            post,
        })).resolves.toEqual({ sent: false, reason: 'REFUSED_ADDRESS' });
        expect(resolve).not.toHaveBeenCalled();
        expect(post).not.toHaveBeenCalled();
    });

    it('lets Tor resolve a named host and posts with a null address', async () => {
        const { resolve, post } = transport();

        await expect(sendCallback({
            url: 'https://example.com/',
            body: validBody,
            tor: true,
            resolve,
            post,
        })).resolves.toEqual({ sent: true, status: 200 });
        expect(resolve).not.toHaveBeenCalled();
        expect(post).toHaveBeenCalledWith(expect.objectContaining({ address: null }));
    });

    it('maps a thrown resolver and invalid answers to RESOLVE_FAILED', async () => {
        const thrown = transport();
        thrown.resolve.mockRejectedValue(new Error('dns failure'));
        await expect(sendCallback({
            url: 'https://example.com/',
            body: validBody,
            ...thrown,
        })).resolves.toEqual({ sent: false, reason: 'RESOLVE_FAILED' });
        expect(thrown.post).not.toHaveBeenCalled();

        const empty = transport({ addresses: [] });
        await expect(sendCallback({
            url: 'https://example.com/',
            body: validBody,
            ...empty,
        })).resolves.toEqual({ sent: false, reason: 'RESOLVE_FAILED' });
        expect(empty.post).not.toHaveBeenCalled();

        const nonArray = transport({ addresses: '8.8.8.8' });
        await expect(sendCallback({
            url: 'https://example.com/',
            body: validBody,
            ...nonArray,
        })).resolves.toEqual({ sent: false, reason: 'RESOLVE_FAILED' });
        expect(nonArray.post).not.toHaveBeenCalled();
    });

    it.each([
        [200, { sent: true, status: 200 }],
        [204, { sent: true, status: 204 }],
        [302, { sent: false, reason: 'HTTP_STATUS', status: 302 }],
        [500, { sent: false, reason: 'HTTP_STATUS', status: 500 }],
    ])('maps HTTP status %i', async (status, expected) => {
        const current = transport({ status });
        await expect(sendCallback({
            url: 'https://example.com/',
            body: validBody,
            ...current,
        })).resolves.toEqual(expected);
    });

    it('maps a throwing post to NETWORK', async () => {
        const current = transport();
        current.post.mockRejectedValue(new Error('network failure'));

        await expect(sendCallback({
            url: 'https://example.com/',
            body: validBody,
            ...current,
        })).resolves.toEqual({ sent: false, reason: 'NETWORK' });
    });
});
