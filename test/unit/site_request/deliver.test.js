// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment node

import { base64urlnopad } from '@scure/base';
import { describe, expect, it, vi } from 'vitest';
import { CALLBACK_BODY_MAX_BYTES } from '../../../packages/core/src/site_request/claim.js';
import {
    deliverResult,
    prepareDelivery,
    sendDeliveryCallback,
} from '../../../packages/core/src/site_request/deliver.js';

const RETURN_URL = 'https://site.example/complete';
const CALLBACK_URL = 'https://api.example/callback';
const CLAIM = 'AAECAwQFBgcICQoLDA0ODw';
const randomBytes = vi.fn((length) => Uint8Array.from({ length }, (_, index) => index));

function request(overrides = {}) {
    return {
        id: 'request-id',
        method: 'login',
        return: RETURN_URL,
        callback: CALLBACK_URL,
        state: 'site-state',
        ...overrides,
    };
}

function decodeReturn(built) {
    const encoded = new URL(built.url).hash.slice('#xchain='.length);
    return JSON.parse(new TextDecoder().decode(base64urlnopad.decode(encoded)));
}

function resultForCallbackSize(byteLength) {
    const empty = prepareDelivery(
        request({ return: undefined, state: undefined }),
        { ok: true, result: '' },
    ).callback.body;
    return 'é' + 'a'.repeat(
        byteLength
        - new TextEncoder().encode(JSON.stringify(empty)).length
        - new TextEncoder().encode('é').length,
    );
}

describe('prepareDelivery', () => {
    it('shares one minted claim between a full return and callback body', () => {
        const prepared = prepareDelivery(
            request(),
            { ok: true, result: { address: 'bc1qexample' } },
            { randomBytes },
        );

        expect(randomBytes).toHaveBeenCalledWith(16);
        expect(prepared.claim).toBe(CLAIM);
        expect(prepared.callback).toEqual({
            url: CALLBACK_URL,
            body: {
                v: 1,
                id: 'request-id',
                method: 'login',
                ok: true,
                result: { address: 'bc1qexample' },
                state: 'site-state',
                claim: CLAIM,
            },
        });
        expect(prepared.browserReturn.full).toBe(true);
        expect(decodeReturn(prepared.browserReturn)).toEqual(prepared.callback.body);
        expect(prepared.resultTooLarge).toBe(false);
    });

    it('omits the claim for a callback-only request', () => {
        const source = vi.fn();
        const prepared = prepareDelivery(
            request({ return: undefined }),
            { ok: false, error: 'USER_REJECTED' },
            { randomBytes: source },
        );

        expect(source).not.toHaveBeenCalled();
        expect(prepared.claim).toBeUndefined();
        expect(prepared.browserReturn).toBeNull();
        expect(prepared.callback.body).toEqual({
            v: 1,
            id: 'request-id',
            method: 'login',
            ok: false,
            error: 'USER_REJECTED',
            state: 'site-state',
        });
    });

    it('accepts a callback body at 10,240 bytes', () => {
        const result = resultForCallbackSize(CALLBACK_BODY_MAX_BYTES);
        const prepared = prepareDelivery(
            request({ return: undefined, state: undefined }),
            { ok: true, result },
        );

        expect(new TextEncoder().encode(JSON.stringify(prepared.callback.body)))
            .toHaveLength(CALLBACK_BODY_MAX_BYTES);
        expect(prepared.resultTooLarge).toBe(false);
        expect(prepared.callback.body.result).toBe(result);
    });

    it('replaces a 10,241-byte callback result with RESULT_TOO_LARGE', () => {
        const result = resultForCallbackSize(CALLBACK_BODY_MAX_BYTES + 1);
        const prepared = prepareDelivery(
            request({ return: undefined, state: undefined }),
            { ok: true, result },
        );

        expect(prepared).toMatchObject({
            claim: undefined,
            payload: {
                v: 1,
                id: 'request-id',
                method: 'login',
                ok: false,
                error: 'RESULT_TOO_LARGE',
            },
            resultTooLarge: true,
        });
        expect(prepared.callback.body).toEqual(prepared.payload);
    });

    it('uses a short return only when the callback retains the full result', () => {
        const outcome = { ok: true, result: { signature: 'x'.repeat(300) } };
        const full = prepareDelivery(request(), outcome, { randomBytes });
        const shortened = prepareDelivery(request(), outcome, {
            randomBytes,
            maxReturnLength: full.browserReturn.url.length - 1,
        });

        expect(shortened.browserReturn.full).toBe(false);
        expect(decodeReturn(shortened.browserReturn)).toEqual({
            id: 'request-id',
            ok: true,
            claim: CLAIM,
        });
        expect(shortened.callback.body.result).toEqual(outcome.result);
        expect(shortened.resultTooLarge).toBe(false);
    });

    it('returns RESULT_TOO_LARGE instead of dropping a return-only result', () => {
        const outcome = { ok: true, result: { signature: 'x'.repeat(300) } };
        const full = prepareDelivery(
            request({ callback: undefined }),
            outcome,
            { randomBytes },
        );
        const prepared = prepareDelivery(request({ callback: undefined }), outcome, {
            randomBytes,
            maxReturnLength: full.browserReturn.url.length - 1,
        });

        expect(prepared.resultTooLarge).toBe(true);
        expect(prepared.browserReturn.full).toBe(true);
        expect(decodeReturn(prepared.browserReturn)).toEqual({
            v: 1,
            id: 'request-id',
            method: 'login',
            ok: false,
            error: 'RESULT_TOO_LARGE',
            state: 'site-state',
            claim: CLAIM,
        });
    });

    it.each([
        [null, { ok: true, result: {} }],
        [request(), null],
        [request(), { ok: 'yes', result: {} }],
        [request({ return: undefined, callback: undefined }), { ok: true, result: {} }],
    ])('refuses malformed delivery inputs', (siteRequest, outcome) => {
        expect(() => prepareDelivery(siteRequest, outcome)).toThrow(TypeError);
    });
});

describe('callback delivery', () => {
    it('pins the POST to a checked public address with fixed transport policy', async () => {
        const resolve = vi.fn().mockResolvedValue(['8.8.8.8']);
        const post = vi.fn().mockResolvedValue({ status: 204 });

        const delivered = await deliverResult(
            request({ return: undefined }),
            { ok: true, result: { address: 'bc1qexample' } },
            { resolve, post },
        );

        expect(delivered.callbackResult).toEqual({ sent: true, status: 204 });
        expect(resolve).toHaveBeenCalledWith('api.example');
        expect(post).toHaveBeenCalledWith({
            href: CALLBACK_URL,
            address: '8.8.8.8',
            body: JSON.stringify(delivered.callback.body),
            timeoutMs: 10000,
            redirect: 'manual',
            credentials: 'omit',
        });
    });

    it('refuses the POST when any resolved address is private', async () => {
        const post = vi.fn();
        const delivered = await deliverResult(
            request({ return: undefined }),
            { ok: true, result: {} },
            {
                resolve: vi.fn().mockResolvedValue(['8.8.8.8', '10.0.0.1']),
                post,
            },
        );

        expect(delivered.callbackResult).toEqual({
            sent: false,
            reason: 'REFUSED_ADDRESS',
        });
        expect(post).not.toHaveBeenCalled();
    });

    it('retries the same prepared callback without minting a new claim', async () => {
        const prepared = prepareDelivery(
            request(),
            { ok: true, result: {} },
            { randomBytes },
        );
        const resolve = vi.fn().mockResolvedValue(['8.8.8.8']);
        const firstPost = vi.fn().mockRejectedValue(new Error('offline'));
        const retryPost = vi.fn().mockResolvedValue({ status: 200 });

        await expect(sendDeliveryCallback(prepared, { resolve, post: firstPost }))
            .resolves.toEqual({ sent: false, reason: 'NETWORK' });
        await expect(sendDeliveryCallback(prepared, { resolve, post: retryPost }))
            .resolves.toEqual({ sent: true, status: 200 });
        expect(JSON.parse(retryPost.mock.calls[0][0].body).claim).toBe(CLAIM);
        expect(prepared.claim).toBe(CLAIM);
    });

    it('does nothing when a prepared delivery has no callback', async () => {
        const prepared = prepareDelivery(
            request({ callback: undefined }),
            { ok: true, result: {} },
            { randomBytes },
        );

        await expect(sendDeliveryCallback(prepared)).resolves.toBeNull();
    });
});

describe('dependency boundary', () => {
    it('does not import the connect package', async () => {
        const source = await import('node:fs').then(({ readFileSync }) => readFileSync(
            new URL('../../../packages/core/src/site_request/deliver.js', import.meta.url),
            'utf8',
        ));

        expect(source).not.toContain('packages/connect');
        expect(source).not.toContain('ERROR_CODES');
        expect(source).toContain("'RESULT_TOO_LARGE'");
    });
});
