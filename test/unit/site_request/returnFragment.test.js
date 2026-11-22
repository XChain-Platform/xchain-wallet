// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment node

import { base64urlnopad } from '@scure/base';
import { describe, expect, it } from 'vitest';
import { buildReturnUrl } from '../../../packages/core/src/site_request/returnFragment.js';

const RETURN_URL = 'https://site.example/complete';

function decodeFragment(url) {
    const encoded = new URL(url).hash.slice('#xchain='.length);
    return JSON.parse(new TextDecoder().decode(base64urlnopad.decode(encoded)));
}

describe('buildReturnUrl', () => {
    it('round-trips a successful result in the browser-return fragment', () => {
        const payload = {
            v: 1,
            id: 'request-1',
            method: 'login',
            ok: true,
            result: { address: 'bc1qexample' },
            state: 'site-state',
            claim: 'claim-1',
        };

        const built = buildReturnUrl(RETURN_URL, payload);

        expect(built.full).toBe(true);
        expect(decodeFragment(built.url)).toEqual(payload);
        expect(built.url.split('#xchain=')[1]).not.toContain('=');
    });

    it('round-trips an error response in the browser-return fragment', () => {
        const payload = {
            v: 1,
            id: 'request-2',
            method: 'signMessage',
            ok: false,
            error: { code: 'USER_REJECTED', message: 'Request rejected' },
            claim: 'claim-2',
        };

        expect(decodeFragment(buildReturnUrl(RETURN_URL, payload).url)).toEqual(payload);
    });

    it('uses fixed key order regardless of input order', () => {
        const payload = {
            claim: 'claim-3',
            state: 'site-state',
            result: { txid: 'abc' },
            ok: true,
            method: 'signAction',
            id: 'request-3',
            v: 1,
        };

        const decodedJson = new TextDecoder().decode(base64urlnopad.decode(
            new URL(buildReturnUrl(RETURN_URL, payload).url).hash.slice('#xchain='.length),
        ));

        expect(decodedJson).toBe(
            '{"v":1,"id":"request-3","method":"signAction","ok":true,'
            + '"result":{"txid":"abc"},"state":"site-state","claim":"claim-3"}',
        );
    });

    it('keeps the full result at the limit and falls back one character past it', () => {
        const payload = {
            v: 1,
            id: 'request-4',
            method: 'signMessage',
            ok: true,
            result: { signature: 'x'.repeat(100) },
            claim: 'claim-4',
        };
        const full = buildReturnUrl(RETURN_URL, payload);

        expect(buildReturnUrl(RETURN_URL, payload, { maxLength: full.url.length }))
            .toEqual(full);
        const shortened = buildReturnUrl(RETURN_URL, payload, {
            maxLength: full.url.length - 1,
        });
        expect(shortened.full).toBe(false);
        expect(decodeFragment(shortened.url)).toEqual({
            id: payload.id,
            ok: payload.ok,
            claim: payload.claim,
        });
    });

    it('round-trips multibyte result text as UTF-8', () => {
        const payload = {
            v: 1,
            id: 'request-5',
            method: 'signMessage',
            ok: true,
            result: { signedMessage: 'ウォレット 🔐 café' },
            claim: 'claim-5',
        };

        expect(decodeFragment(buildReturnUrl(RETURN_URL, payload).url)).toEqual(payload);
    });

    it.each([
        ['a non-string return URL', 42, { id: 'id', claim: 'claim' }],
        ['a return URL with a fragment', `${RETURN_URL}#existing`, { id: 'id', claim: 'claim' }],
        ['a non-string id', RETURN_URL, { id: 42, claim: 'claim' }],
        ['an empty id', RETURN_URL, { id: '', claim: 'claim' }],
        ['a non-string claim', RETURN_URL, { id: 'id', claim: 42 }],
        ['an empty claim', RETURN_URL, { id: 'id', claim: '' }],
    ])('throws TypeError for %s', (_label, returnUrl, payload) => {
        expect(() => buildReturnUrl(returnUrl, payload)).toThrow(TypeError);
    });

    it('throws TypeError when even the short form exceeds maxLength', () => {
        const payload = { id: 'request-6', ok: true, claim: 'claim-6' };
        const short = buildReturnUrl(RETURN_URL, payload, { maxLength: 1_000 });

        expect(() => buildReturnUrl(RETURN_URL, payload, {
            maxLength: short.url.length - 1,
        })).toThrow(TypeError);
    });
});
