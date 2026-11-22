// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { base64urlnopad } from '@scure/base';
import { describe, expect, it } from 'vitest';
import {
    inspectRequestLink,
    parseRequestLink,
    REQUEST_LINK_MAX_LENGTH,
    REQUEST_LINK_METHODS,
} from '../../../packages/core/src/uri/requestLink.js';
import { parseXchainUri } from '../../../packages/core/src/uri/xchainUri.js';

const vectors = JSON.parse(readFileSync(resolve('test/fixtures/connect/request-vectors.json'), 'utf8'));
const encode = (envelope) => `xchain:request?v=1&req=${base64urlnopad.encode(
    new TextEncoder().encode(JSON.stringify(envelope)),
)}`;

function validEnvelope(overrides = {}) {
    return {
        v: 1,
        id: 'AAAAAAAAAAAAAAAAAAAAAA',
        method: 'login',
        params: { appId: 'request.example', nonce: 'nonce' },
        return: 'https://request.example/return',
        exp: vectors.now + 300_000,
        ...overrides,
    };
}

describe('request links', () => {
    it('parses every shared valid vector into null-prototype records', () => {
        expect(REQUEST_LINK_METHODS).toEqual(['login', 'signMessage', 'signAction', 'signPsbt']);
        for (const { name, envelope } of vectors.valid) {
            const parsed = parseRequestLink(encode(envelope), { now: vectors.now });
            expect(parsed, name).not.toBeNull();
            expect(Object.getPrototypeOf(parsed), name).toBeNull();
            expect(Object.getPrototypeOf(parsed.params), name).toBeNull();
            if (parsed.params.params) {
                expect(Object.getPrototypeOf(parsed.params.params), name).toBeNull();
            }
            if (parsed.app) expect(Object.getPrototypeOf(parsed.app), name).toBeNull();
        }
    });

    it('rejects every shared invalid vector', () => {
        for (const { name, envelope } of vectors.invalid) {
            expect(parseRequestLink(encode(envelope), { now: vectors.now }), name).toBeNull();
        }
    });

    it('routes a valid request before the general URI parser', () => {
        const intent = parseXchainUri(encode(validEnvelope()), { now: vectors.now });
        expect(intent.kind).toBe('request');
        expect(intent.request.method).toBe('login');
        expect(Object.getPrototypeOf(intent.request)).toBeNull();
    });

    it('routes unknown versions and methods to the unsupported request view', () => {
        const version = validEnvelope({ v: 2 });
        const method = validEnvelope({ method: 'futureMethod' });
        const outerVersion = encode(validEnvelope()).replace('?v=1&', '?v=2&');
        expect(inspectRequestLink(encode(version), { now: vectors.now }).status).toBe('unsupported');
        expect(parseXchainUri(encode(version), { now: vectors.now })).toEqual({ kind: 'request-unsupported' });
        expect(parseXchainUri(encode(method), { now: vectors.now })).toEqual({ kind: 'request-unsupported' });
        expect(parseXchainUri(outerVersion, { now: vectors.now })).toEqual({ kind: 'request-unsupported' });
    });

    it('unwraps both published web-link origins', () => {
        const request = encode(validEnvelope());
        for (const wrapper of [
            `https://xchain.io/wallet/link/?uri=${encodeURIComponent(request)}`,
            `https://wallet.xchain.io/link/?uri=${encodeURIComponent(request)}`,
        ]) {
            expect(parseXchainUri(wrapper, { now: vectors.now }).kind).toBe('request');
        }
    });

    it('hardens display text without restoring object prototypes', () => {
        const envelope = validEnvelope({
            method: 'signMessage',
            params: { message: 'pay\u202Etxt\u0000 now' },
            app: { name: 'app\u202Ename\u0000' },
        });
        const parsed = parseRequestLink(encode(envelope), { now: vectors.now });
        expect(parsed.params.message).toBe('pay\u2426txt now');
        expect(parsed.app.name).toBe('app\u2426name');
        expect(Object.getPrototypeOf(parsed.params)).toBeNull();
        expect(Object.getPrototypeOf(parsed.app)).toBeNull();
    });

    it('permits HTTP loopback only in Developer Mode', () => {
        for (const target of [
            'http://localhost:5173/return',
            'http://127.0.0.1:5173/return',
            'http://[::1]:5173/return',
        ]) {
            const link = encode(validEnvelope({ return: target }));
            expect(parseRequestLink(link, { now: vectors.now })).toBeNull();
            expect(parseRequestLink(link, { now: vectors.now, developerMode: true })).not.toBeNull();
        }
        const publicHttp = encode(validEnvelope({ return: 'http://request.example/return' }));
        expect(parseRequestLink(publicHttp, { now: vectors.now, developerMode: true })).toBeNull();
    });

    it('requires a strict outer grammar and valid UTF-8 JSON', () => {
        const req = encode(validEnvelope()).split('req=')[1];
        const malformed = [
            `xchain:request?req=${req}`,
            `xchain:request?v=1&req=${req}&extra=1`,
            `xchain:request?v=1&req=${req}&req=${req}`,
            'xchain:request?v=1&req=abc=',
            `xchain:request?v=1&req=${base64urlnopad.encode(Uint8Array.of(0xff))}`,
            `xchain:request?v=1&req=${base64urlnopad.encode(new TextEncoder().encode('{'))}`,
        ];
        for (const link of malformed) expect(parseRequestLink(link, { now: vectors.now })).toBeNull();
    });

    it('rejects non-record schemas, open app records, and excessive depth', () => {
        const nonRecords = [
            validEnvelope({ params: [] }),
            validEnvelope({ params: null }),
            validEnvelope({ app: { name: 'app', extra: true } }),
            validEnvelope({ app: { name: 7 } }),
            validEnvelope({ state: { opaque: true } }),
        ];
        for (const envelope of nonRecords) {
            expect(parseRequestLink(encode(envelope), { now: vectors.now })).toBeNull();
        }

        let nested = Object.create(null);
        const params = nested;
        for (let i = 0; i < 20; i += 1) {
            nested.next = Object.create(null);
            nested = nested.next;
        }
        expect(parseRequestLink(encode(validEnvelope({ params })), { now: vectors.now })).toBeNull();
    });

    it('applies the full-link cap before decoding', () => {
        expect(REQUEST_LINK_MAX_LENGTH).toBe(16_384);
        const oversized = `xchain:request?v=1&req=${'A'.repeat(REQUEST_LINK_MAX_LENGTH)}`;
        expect(parseRequestLink(oversized, { now: vectors.now })).toBeNull();
    });
});

describe('request-link dependency boundary', () => {
    it('does not import connect or the bridge specification package', () => {
        const source = readFileSync(resolve('packages/core/src/uri/requestLink.js'), 'utf8');
        expect(source).not.toMatch(/packages\/connect|@xchain-wallet\/bridge-spec/);
    });
});
