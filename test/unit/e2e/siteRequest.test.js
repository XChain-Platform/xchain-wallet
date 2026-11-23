// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildReturnUrl } from '../../../packages/core/src/site_request/returnFragment.js';
import {
    decodeRequestLink,
    publishedLink,
    readReturn,
    requestLink,
    webWalletLink,
} from '../../e2e/fixtures/siteRequest.js';

const vectors = JSON.parse(readFileSync(
    resolve('test/fixtures/connect/request-vectors.json'),
    'utf8',
));
const REQUEST_PATTERN = /^xchain:request\?v=1&req=[A-Za-z0-9_-]+$/;
const RETURN_URL = 'https://request.example/connect/return';

function encodedJson(value) {
    return requestLink(value).split('&req=')[1];
}

describe('site request link oracle', () => {
    it.each(vectors.valid)('round-trips valid envelope: $name', ({ envelope }) => {
        const link = requestLink(envelope);

        expect(link).toMatch(REQUEST_PATTERN);
        expect(decodeRequestLink(link)).toEqual(envelope);
        expect(decodeRequestLink(publishedLink(link))).toEqual(envelope);
        expect(decodeRequestLink(publishedLink(link, {
            base: 'https://publish.example/custom/link/',
        }))).toEqual(envelope);
        expect(decodeRequestLink(webWalletLink(link))).toEqual(envelope);
        expect(decodeRequestLink(webWalletLink(link, {
            base: 'https://web.example/wallet/',
        }))).toEqual(envelope);
    });

    it('round-trips non-ASCII request text as UTF-8', () => {
        const envelope = {
            v: 1,
            id: 'unicode-request',
            method: 'signMessage',
            params: { message: 'ウォレット 🔐 café' },
        };

        expect(decodeRequestLink(requestLink(envelope))).toEqual(envelope);
    });

    it('re-encodes an envelope without a return target', () => {
        const envelope = decodeRequestLink(requestLink(vectors.valid[0].envelope));
        delete envelope.return;

        const decoded = decodeRequestLink(requestLink(envelope));
        expect(decoded).toEqual(envelope);
        expect(decoded).not.toHaveProperty('return');
    });

    it.each([
        ['another scheme', 'mailto:request@example.com'],
        ['an https wrapper without uri', 'https://wallet.example/link/'],
        ['an https wrapper path without a trailing slash', 'https://wallet.example/link?uri=x'],
        ['a version other than 1', `xchain:request?v=2&req=${encodedJson({})}`],
        ['a missing req', 'xchain:request?v=1'],
        ['a req with a character outside base64url', 'xchain:request?v=1&req=abc%2Bdef'],
        ['req JSON that is not a plain object', requestLink([])],
        ['req that is not JSON', 'xchain:request?v=1&req=eA'],
    ])('rejects malformed request link with %s', (_label, link) => {
        expect(() => decodeRequestLink(link)).toThrow(TypeError);
    });
});

describe('site return oracle', () => {
    const payload = {
        v: 1,
        id: 'request-1',
        method: 'signMessage',
        ok: true,
        result: { signedMessage: 'approved' },
        state: 'site-state',
        claim: 'claim-1',
    };

    it('reads full and short return payloads built by core', () => {
        const full = buildReturnUrl(RETURN_URL, payload);
        const short = buildReturnUrl(RETURN_URL, payload, {
            maxLength: full.url.length - 1,
        });

        expect(full.full).toBe(true);
        expect(readReturn(full.url)).toEqual(payload);
        expect(short.full).toBe(false);
        expect(readReturn(short.url)).toEqual({
            id: payload.id,
            ok: payload.ok,
            claim: payload.claim,
        });
    });

    it.each([
        ['no fragment', RETURN_URL],
        ['another fragment', `${RETURN_URL}#other=x`],
    ])('returns null for %s', (_label, url) => {
        expect(readReturn(url)).toBeNull();
    });

    it.each([
        ['an empty payload', `${RETURN_URL}#xchain=`],
        ['a character outside base64url', `${RETURN_URL}#xchain=abc%2Bdef`],
        ['JSON that is not a plain object', `${RETURN_URL}#xchain=${encodedJson([])}`],
        ['an unknown key', `${RETURN_URL}#xchain=${encodedJson({ id: 'id', ok: true, extra: 1 })}`],
        ['a missing id', `${RETURN_URL}#xchain=${encodedJson({ ok: true })}`],
        ['an empty id', `${RETURN_URL}#xchain=${encodedJson({ id: '', ok: true })}`],
        ['a non-string id', `${RETURN_URL}#xchain=${encodedJson({ id: 42, ok: true })}`],
        ['a missing ok', `${RETURN_URL}#xchain=${encodedJson({ id: 'id' })}`],
        ['a non-boolean ok', `${RETURN_URL}#xchain=${encodedJson({ id: 'id', ok: 1 })}`],
    ])('rejects malformed return with %s', (_label, url) => {
        expect(() => readReturn(url)).toThrow(TypeError);
    });
});
