// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const referencePath = resolve('packages/connect/wallet-requests.json');
const vectorsPath = resolve('test/fixtures/connect/request-vectors.json');
const reference = JSON.parse(readFileSync(referencePath, 'utf8'));
const vectors = JSON.parse(readFileSync(vectorsPath, 'utf8'));

const ENVELOPE_KEYS = [
    'v',
    'id',
    'method',
    'params',
    'return',
    'callback',
    'state',
    'exp',
    'app',
    'browser',
];
const BROWSER_VALUES = ['chrome', 'firefox', 'edge', 'safari', 'samsung'];
const METHODS = ['login', 'signMessage', 'signAction', 'signPsbt'];
const WEB_LINK_PREFIXES = [
    'https://xchain.io/wallet/link/',
    'https://wallet.xchain.io/link/',
];
const ERROR_CODES = [
    'USER_REJECTED',
    'NOT_CONNECTED',
    'WALLET_LOCKED',
    'CHAIN_NOT_SUPPORTED',
    'ACCOUNT_NOT_AUTHORIZED',
    'ADDRESS_NOT_AUTHORIZED',
    'UNSUPPORTED_ACTION',
    'INVALID_PARAMS',
    'CHALLENGE_EXPIRED',
    'BROADCAST_FAILED',
    'PANIC_MODE',
    'THROTTLED',
    'BLOCKED_BY_USER',
    'BRIDGE_VERSION_MISMATCH',
    'BALANCES_UNAVAILABLE',
    'INTERNAL_ERROR',
    'REQUEST_EXPIRED',
    'REQUEST_TOO_LARGE',
    'RESULT_TOO_LARGE',
    'NO_PENDING_REQUEST',
];

describe('wallet request machine-readable reference', () => {
    it('pins the protocol versions and request-link vocabulary', () => {
        expect(reference.protocol).toBe('0.2.0');
        expect(reference.supported).toEqual(['0.1.0', '0.2.0']);
        expect(reference.link).toEqual({
            grammar: 'xchain:request?v=1&req=<base64url(UTF-8 JSON)>',
            envelopeKeys: ENVELOPE_KEYS,
            browserValues: BROWSER_VALUES,
            webLinkPrefixes: WEB_LINK_PREFIXES,
        });
        expect(new Set(reference.link.envelopeKeys).size).toBe(ENVELOPE_KEYS.length);
    });

    it('matches the methods exercised by valid request vectors', () => {
        const methods = new Set(Object.keys(reference.methods));

        expect(Object.keys(reference.methods)).toEqual(METHODS);
        for (const { name, envelope } of vectors.valid) {
            expect(methods.has(envelope.method), name).toBe(true);
        }
    });

    it('publishes object schemas and complete closed-key examples', () => {
        const closedKeys = new Set(reference.link.envelopeKeys);

        for (const [method, definition] of Object.entries(reference.methods)) {
            expect(definition.params.type, `${method} params`).toBe('object');
            expect(definition.result.type, `${method} result`).toBe('object');
            expect(definition.example.method, method).toBe(method);
            expect(
                Object.keys(definition.example).every((key) => closedKeys.has(key)),
                `${method} example keys`
            ).toBe(true);

            for (const required of definition.params.required) {
                expect(
                    Object.hasOwn(definition.example.params, required),
                    `${method} example param ${required}`
                ).toBe(true);
            }
        }
    });

    it('pins request size and expiry caps', () => {
        expect(reference.caps).toEqual({
            linkMaxChars: 16_384,
            targetMaxChars: 2_048,
            expMaxMs: 600_000,
        });
    });

    it('publishes all error codes once and in contract order', () => {
        expect(reference.errors).toEqual(ERROR_CODES);
        expect(reference.errors).toHaveLength(20);
        expect(new Set(reference.errors).size).toBe(reference.errors.length);
    });
});
