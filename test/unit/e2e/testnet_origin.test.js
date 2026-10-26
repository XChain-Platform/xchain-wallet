// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// @vitest-environment node

import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
    assertOriginsAllowed,
    preflightUrl,
    runOriginPreflight,
    suiteOrigin,
    suitePort,
} from '../../e2e/fixtures/testnet_origin.js';

const ORIGIN = 'http://localhost:4193';
const ENDPOINTS = Object.freeze({
    encoderUrl: 'encoder-service',
    explorerUrl: 'explorer-service',
    hubUrl: '',
});

function response(status, allowedOrigin) {
    return {
        status,
        headers: {
            get: vi.fn((name) => name === 'access-control-allow-origin'
                ? (allowedOrigin ?? null)
                : null),
        },
    };
}

describe('testnet origin preflight runner', () => {
    it('returns zero without logging when the injected endpoints allow the origin', async () => {
        const fetch = vi.fn(async () => response(204, ORIGIN));
        const log = vi.fn();

        await expect(runOriginPreflight({
            env: { XC_PREVIEW_PORT: '4193' },
            endpoints: { encoderUrl: 'encoder-service', explorerUrl: '', hubUrl: '' },
            fetch,
            log,
        })).resolves.toBe(0);

        expect(fetch).toHaveBeenCalledOnce();
        expect(log).not.toHaveBeenCalled();
    });

    it.each([
        ['a refused header', async () => response(200, 'https://wallet.example')],
        ['a rejected fetch', async () => { throw new Error('private transport detail'); }],
    ])('returns one and logs one refusal for %s', async (_label, fetchImpl) => {
        const log = vi.fn();

        await expect(runOriginPreflight({
            env: { XC_PREVIEW_PORT: '4193' },
            endpoints: { encoderUrl: 'encoder-service', explorerUrl: '', hubUrl: '' },
            fetch: vi.fn(fetchImpl),
            log,
        })).resolves.toBe(1);

        expect(log).toHaveBeenCalledOnce();
        expect(log.mock.calls[0][0]).toMatch(/^Origin preflight refused/);
    });

    it('has no static import of the testnet fixture', () => {
        const source = fs.readFileSync(
            new URL('../../e2e/fixtures/testnet_origin.js', import.meta.url),
            'utf8',
        );

        expect(source).not.toMatch(
            /\b(?:import|export)\s+(?:[^'"]*\s+from\s+)?['"]\.\/testnet\.js['"]/,
        );
    });
});

describe('testnet origin preflight', () => {
    it('accepts wildcard and exact-origin headers and skips an empty hub URL', async () => {
        const fetch = vi.fn(async (endpoint) => response(
            204,
            endpoint === `${ENDPOINTS.encoderUrl}/` ? '*' : ORIGIN,
        ));

        await expect(assertOriginsAllowed(ENDPOINTS, { origin: ORIGIN, fetch })).resolves.toBeUndefined();

        expect(fetch).toHaveBeenCalledTimes(2);
        expect(fetch.mock.calls.map(([endpoint]) => endpoint)).toEqual([
            `${ENDPOINTS.encoderUrl}/`,
            `${ENDPOINTS.explorerUrl}/`,
        ]);
    });

    it('uses OPTIONS and the browser preflight headers for every request', async () => {
        const endpoints = { ...ENDPOINTS, hubUrl: 'hub-service' };
        const fetch = vi.fn(async () => response(200, '*'));

        await assertOriginsAllowed(endpoints, { origin: ORIGIN, fetch });

        expect(fetch.mock.calls).toEqual(Object.values(endpoints).map((endpoint) => [`${endpoint}/`, {
            method: 'OPTIONS',
            headers: {
                Origin: ORIGIN,
                'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': 'content-type',
            },
        }]));
    });

    it('refuses a header naming another origin and names its role and value', async () => {
        const fetch = vi.fn(async () => response(200, 'https://wallet.example'));

        await expect(assertOriginsAllowed(
            { encoderUrl: ENDPOINTS.encoderUrl, explorerUrl: '', hubUrl: '' },
            { origin: ORIGIN, fetch },
        )).rejects.toThrow(
            `Origin preflight refused: encoder for ${ORIGIN} `
            + '(status 200; access-control-allow-origin: https://wallet.example)',
        );
    });

    it('reports none when the allow-origin header is absent', async () => {
        const fetch = vi.fn(async () => response(200));

        await expect(assertOriginsAllowed(
            { encoderUrl: '', explorerUrl: ENDPOINTS.explorerUrl, hubUrl: '' },
            { origin: ORIGIN, fetch },
        )).rejects.toThrow(
            `Origin preflight refused: explorer for ${ORIGIN} `
            + '(status 200; access-control-allow-origin: none)',
        );
    });

    it('refuses a non-2xx response even when its origin header matches', async () => {
        const fetch = vi.fn(async () => response(403, ORIGIN));

        await expect(assertOriginsAllowed(
            { encoderUrl: '', explorerUrl: '', hubUrl: ENDPOINTS.hubUrl || 'hub-service' },
            { origin: ORIGIN, fetch },
        )).rejects.toThrow(
            `Origin preflight refused: hub for ${ORIGIN} `
            + `(status 403; access-control-allow-origin: ${ORIGIN})`,
        );
    });

    it.each([
        ['URL host', 'https://service.example/path'],
        ['single-label host', 'internal-service'],
        ['bc1 address', 'bc1qexampleaddress000000000000000000000'],
        ['xprv', 'xprv9exampleprivatekeymaterial'],
        ['xpub', 'xpub6examplepublickeymaterial'],
    ])('reports only an allowlisted rejection code when the message contains a %s', async (_label, secret) => {
        const rejection = new Error(`request failed with sensitive detail ${secret}`);
        rejection.code = 'NETWORK_FAILURE';
        const fetch = vi.fn(async () => { throw rejection; });

        let refusal;
        try {
            await assertOriginsAllowed(
                { encoderUrl: ENDPOINTS.encoderUrl, explorerUrl: '', hubUrl: '' },
                { origin: ORIGIN, fetch },
            );
        } catch (error) {
            refusal = error;
        }

        expect(refusal).toBeInstanceOf(Error);
        expect(refusal.message).toContain('fetch rejected: NETWORK_FAILURE');
        expect(refusal.message).not.toContain(secret);
        expect(refusal.message).not.toContain(ENDPOINTS.encoderUrl);
    });

    it('prefers a valid cause code and replaces a non-allowlisted code with unknown', async () => {
        const cause = Object.assign(new Error('cause detail'), { code: 'CAUSE_CODE' });
        const coded = Object.assign(new Error('outer detail', { cause }), { code: 'OUTER_CODE' });
        const invalid = Object.assign(new Error('other detail'), { code: 'bad-code' });
        const fetch = vi.fn()
            .mockRejectedValueOnce(coded)
            .mockRejectedValueOnce(invalid);

        await expect(assertOriginsAllowed(
            { encoderUrl: ENDPOINTS.encoderUrl, explorerUrl: ENDPOINTS.explorerUrl, hubUrl: '' },
            { origin: ORIGIN, fetch },
        )).rejects.toThrow(
            `encoder for ${ORIGIN} (fetch rejected: CAUSE_CODE); `
            + `explorer for ${ORIGIN} (fetch rejected: unknown)`,
        );
    });

    it('uses an allowlisted error name when no rejection code exists', async () => {
        const rejection = new Error('private transport detail');
        rejection.name = 'TransportError';
        const fetch = vi.fn(async () => { throw rejection; });

        await expect(assertOriginsAllowed(
            { encoderUrl: ENDPOINTS.encoderUrl, explorerUrl: '', hubUrl: '' },
            { origin: ORIGIN, fetch },
        )).rejects.toThrow(`encoder for ${ORIGIN} (fetch rejected: TransportError)`);
    });
});

describe('testnet suite origin', () => {
    it.each([
        ['5077', 5077],
        [undefined, 4193],
        ['', 4193],
        ['0', 4193],
        ['-1', 4193],
        ['4193.5', 4193],
        ['65536', 4193],
        ['not-a-port', 4193],
    ])('resolves preview port %s to %i', (XC_PREVIEW_PORT, expectedPort) => {
        const env = { XC_PREVIEW_PORT };

        expect(suitePort(env)).toBe(expectedPort);
        expect(suiteOrigin(env)).toBe(`http://localhost:${suitePort(env)}`);
    });
});

describe('testnet origin preflight URL', () => {
    it('asks the base URL with the trailing slash the SDK clients request under', () => {
        expect(preflightUrl('https://encoder.xchain.io/TBTC')).toBe('https://encoder.xchain.io/TBTC/');
        expect(preflightUrl('https://explorer.xchain.io')).toBe('https://explorer.xchain.io/');
    });

    it('leaves a URL that already ends in a slash unchanged', () => {
        expect(preflightUrl('https://encoder.xchain.io/TBTC/')).toBe('https://encoder.xchain.io/TBTC/');
    });

    it('accepts an origin that only the slash path allows, as encoder.xchain.io/TBTC does', async () => {
        const base = 'https://encoder.xchain.io/TBTC';
        const fetch = vi.fn(async (url) => (url === `${base}/`
            ? response(204, ORIGIN)
            : response(200)));

        await expect(assertOriginsAllowed(
            { encoderUrl: base, explorerUrl: '', hubUrl: '' },
            { origin: ORIGIN, fetch },
        )).resolves.toBeUndefined();
        expect(fetch).toHaveBeenCalledOnce();
        expect(fetch.mock.calls[0][0]).toBe(`${base}/`);
    });
});
