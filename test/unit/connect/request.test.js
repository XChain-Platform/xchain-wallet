// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: MIT

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    REQUEST_EXP_MAX_MS,
    REQUEST_LINK_MAX_CHARS,
    RequestCodecError,
    buildRequest,
    parseRequest,
    parseReturn,
    requestLink,
} from '../../../packages/connect/src/request.js';

const vectors = JSON.parse(readFileSync(
    resolve('test/fixtures/connect/request-vectors.json'),
    'utf8',
));

function encode(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function returnUrl(payload) {
    return `https://request.example/connect/return#xchain=${encode(payload)}`;
}

function expectCode(run, code) {
    try {
        run();
    } catch (error) {
        expect(error).toBeInstanceOf(RequestCodecError);
        expect(error.code).toBe(code);
        return error;
    }
    throw new Error(`expected ${code}`);
}

describe('connect request codec', () => {
    it('builds a request with a fixed clock and injected 128-bit randomness', () => {
        const request = buildRequest('login', { appId: 'request.example', nonce: 'n' }, {
            return: 'https://request.example/connect/return',
            state: 'opaque',
            now: vectors.now,
            randomBytes: () => new Uint8Array(16),
        });

        expect(request).toEqual({
            v: 1,
            id: 'AAAAAAAAAAAAAAAAAAAAAA',
            method: 'login',
            params: { appId: 'request.example', nonce: 'n' },
            return: 'https://request.example/connect/return',
            state: 'opaque',
            exp: vectors.now + 5 * 60 * 1_000,
        });
    });

    it('supports the object form and explicit envelope options', () => {
        const request = buildRequest({
            method: 'signPsbt',
            params: { chainId: 'BTC', psbtHex: '00', signingPaths: [] },
            id: 'BBBBBBBBBBBBBBBBBBBBBA',
            callback: 'https://request.example/connect/callback',
            exp: vectors.now + REQUEST_EXP_MAX_MS,
            browser: 'safari',
        }, { now: vectors.now });

        expect(request.id).toBe('BBBBBBBBBBBBBBBBBBBBBA');
        expect(request.callback).toBe('https://request.example/connect/callback');
        expect(request.browser).toBe('safari');
    });

    it('encodes every shared valid vector and parses it into null-prototype records', () => {
        for (const { name, envelope } of vectors.valid) {
            const link = requestLink(envelope, { now: vectors.now });
            expect(link, name).toMatch(/^xchain:request\?v=1&req=[A-Za-z0-9_-]+$/);
            const parsed = parseRequest(link, { now: vectors.now });
            expect(parsed, name).toEqual(envelope);
            expect(Object.getPrototypeOf(parsed), name).toBeNull();
            expect(Object.getPrototypeOf(parsed.params), name).toBeNull();
        }
    });

    it('round-trips UTF-8 params without base64 padding', () => {
        const envelope = structuredClone(vectors.valid[1].envelope);
        envelope.params.message = '承認 🔐 café';
        const link = requestLink(envelope, { now: vectors.now });
        expect(link.split('&req=')[1]).not.toContain('=');
        expect(parseRequest(link, { now: vectors.now }).params.message).toBe('承認 🔐 café');
    });

    it('parses both published request-link hosts', () => {
        const link = requestLink(vectors.valid[0].envelope, { now: vectors.now });
        for (const base of [
            'https://wallet.xchain.io/link/?uri=',
            'https://xchain.io/wallet/link/?uri=',
        ]) {
            expect(parseRequest(`${base}${encodeURIComponent(link)}`, { now: vectors.now }))
                .toEqual(vectors.valid[0].envelope);
        }
    });

    it('refuses every shared invalid vector with a stable code', () => {
        for (const { name, rule, envelope } of vectors.invalid) {
            const raw = `xchain:request?v=1&req=${encode(envelope)}`;
            const expectedCode = rule === 'exp-past'
                ? 'REQUEST_EXPIRED'
                : rule === 'target-too-long'
                    ? 'REQUEST_TOO_LARGE'
                    : rule === 'bad-v'
                        ? 'BRIDGE_VERSION_MISMATCH'
                        : rule === 'unknown-method'
                            ? 'UNSUPPORTED_ACTION'
                            : 'INVALID_PARAMS';
            const error = expectCode(() => parseRequest(raw, { now: vectors.now }), expectedCode);
            expect(error.message, name).not.toBe('');
        }
    });

    it('enforces strict link grammar and base64url before decoding', () => {
        const valid = requestLink(vectors.valid[0].envelope, { now: vectors.now });
        for (const malformed of [
            valid.replace('?v=1&', '?v=1&v=1&'),
            `${valid}&extra=1`,
            'xchain:request?v=1&req=abc=',
            'xchain:request?v=1&req=A',
            'xchain:request?v=1&req=%41%41%41%41',
            'xchain:send?v=1&req=AAAA',
            'https://evil.example/link/?uri=xchain%3Arequest',
        ]) {
            expectCode(() => parseRequest(malformed, { now: vectors.now }), 'INVALID_PARAMS');
        }
        expectCode(
            () => parseRequest(valid.replace('v=1', 'v=2'), { now: vectors.now }),
            'BRIDGE_VERSION_MISMATCH',
        );
    });

    it('allows HTTP loopback only when Developer Mode is explicit', () => {
        const envelope = {
            ...vectors.valid[0].envelope,
            return: 'http://localhost:4173/connect/return',
        };
        const raw = `xchain:request?v=1&req=${encode(envelope)}`;
        expectCode(() => parseRequest(raw, { now: vectors.now }), 'INVALID_PARAMS');
        expect(parseRequest(raw, { now: vectors.now, developerMode: true }).return)
            .toBe(envelope.return);

        const remote = { ...envelope, return: 'http://request.example/connect/return' };
        expectCode(
            () => parseRequest(`xchain:request?v=1&req=${encode(remote)}`, {
                now: vectors.now,
                developerMode: true,
            }),
            'INVALID_PARAMS',
        );
    });

    it('checks the published wrapper against the 16,384-character cap', () => {
        const envelope = structuredClone(vectors.valid[0].envelope);
        envelope.params.padding = 'x'.repeat(20_000);
        expectCode(
            () => requestLink(envelope, { now: vectors.now }),
            'REQUEST_TOO_LARGE',
        );
        expectCode(
            () => parseRequest('x'.repeat(REQUEST_LINK_MAX_CHARS + 1), { now: vectors.now }),
            'REQUEST_TOO_LARGE',
        );

        let accepted;
        for (let size = 11_000; size < 13_000; size += 1) {
            const candidate = structuredClone(vectors.valid[0].envelope);
            candidate.params.padding = 'x'.repeat(size);
            try {
                accepted = requestLink(candidate, { now: vectors.now });
            } catch (error) {
                expect(error.code).toBe('REQUEST_TOO_LARGE');
                const projected = 'https://wallet.xchain.io/link/?uri='.length
                    + encodeURIComponent(`xchain:request?v=1&req=${encode(candidate)}`).length;
                expect(projected).toBeGreaterThan(REQUEST_LINK_MAX_CHARS);
                break;
            }
        }
        expect(accepted).toBeTypeOf('string');
        expect('https://wallet.xchain.io/link/?uri='.length + encodeURIComponent(accepted).length)
            .toBeLessThanOrEqual(REQUEST_LINK_MAX_CHARS);
    });

    it('refuses non-JSON values, cycles, and excessive nesting', () => {
        const cycle = {};
        cycle.self = cycle;
        const deep = {};
        let cursor = deep;
        for (let index = 0; index < 17; index += 1) {
            cursor.next = {};
            cursor = cursor.next;
        }
        for (const params of [{ amount: Number.NaN }, { when: new Date() }, cycle, deep]) {
            expectCode(() => requestLink({
                ...vectors.valid[0].envelope,
                params,
            }, { now: vectors.now }), 'INVALID_PARAMS');
        }
    });
});

describe('connect return codec', () => {
    const success = {
        v: 1,
        id: 'AAAAAAAAAAAAAAAAAAAAAA',
        method: 'login',
        ok: true,
        result: { address: 'bc1qresult', label: '登録' },
        state: 'login-state',
        claim: 'CCCCCCCCCCCCCCCCCCCCCA',
    };

    it('parses a full result and keeps decoded objects prototype-free', () => {
        const parsed = parseReturn(returnUrl(success));
        expect(parsed).toEqual(success);
        expect(Object.getPrototypeOf(parsed)).toBeNull();
        expect(Object.getPrototypeOf(parsed.result)).toBeNull();
    });

    it('parses failures and cap-shortened returns', () => {
        const failure = {
            ...success,
            ok: false,
            error: { code: 'USER_REJECTED', message: 'Request rejected' },
        };
        delete failure.result;
        expect(parseReturn(returnUrl(failure))).toEqual(failure);

        expect(parseReturn(returnUrl({ ...failure, error: 'USER_REJECTED' })).error)
            .toBe('USER_REJECTED');

        const short = {
            id: success.id,
            ok: true,
            claim: success.claim,
        };
        expect(parseReturn(`#xchain=${encode(short)}`)).toEqual(short);
    });

    it('returns null when the URL does not carry an XChain result', () => {
        expect(parseReturn('https://request.example/connect/return')).toBeNull();
        expect(parseReturn('https://request.example/connect/return#other=x')).toBeNull();
        expect(parseReturn('#other=x')).toBeNull();
    });

    it('refuses unknown keys and inconsistent result branches', () => {
        const cases = [
            { ...success, unexpected: true },
            { ...success, ok: false },
            { ...success, error: 'USER_REJECTED' },
            { ...success, claim: 'short' },
            { ...success, state: 42 },
            { id: success.id, ok: true, claim: success.claim, state: 'not-short' },
        ];
        for (const payload of cases) {
            expectCode(() => parseReturn(returnUrl(payload)), 'INVALID_PARAMS');
        }
    });

    it('refuses malformed encoding, invalid UTF-8, and oversized results', () => {
        for (const fragment of ['#xchain=', '#xchain=abc=', '#xchain=A', '#xchain=_w']) {
            expectCode(() => parseReturn(fragment), 'INVALID_PARAMS');
        }
        expectCode(() => parseReturn(`https://request.example/#xchain=${'A'.repeat(REQUEST_LINK_MAX_CHARS)}`), 'RESULT_TOO_LARGE');
    });
});
