// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import walletRequests from '../../../packages/connect/wallet-requests.json';
import {
    BRIDGE_ERROR_CODES,
    BRIDGE_SPEC_VERSION,
    BRIDGE_SUPPORTED_VERSIONS,
    ERROR_CODES,
    LOGIN_CHALLENGE_PREFIX,
    LOGIN_CHALLENGE_SEPARATOR,
    LOGIN_CHALLENGE_VERSION,
    LOGIN_DEFAULT_EXPIRY_MS,
    PROTOCOL_VERSION,
    SIGN_IN_CHALLENGE_PREFIX,
    SIGN_IN_CHALLENGE_SEPARATOR,
    SIGN_IN_CHALLENGE_VERSION,
    SIGN_IN_DEFAULT_EXPIRY_MS,
    SUPPORTED_PROTOCOL_VERSIONS,
    formatLoginChallenge,
    formatSignInChallenge,
    isBridgeErrorCode,
    isErrorCode,
    makeLoginParams,
    makeSignInParams,
    parseLoginChallenge,
    parseSignInChallenge,
    validateLoginChallenge,
    validateSignInChallenge,
} from '../../../packages/connect/src/runtime.js';

const REQUEST_ERROR_CODES = [
    'REQUEST_EXPIRED',
    'REQUEST_TOO_LARGE',
    'RESULT_TOO_LARGE',
    'NO_PENDING_REQUEST',
];

function challengeParts() {
    return {
        version: 2,
        appId: 'request.example',
        origin: 'https://request.example',
        address: 'bc1qexample',
        nonce: 'nonce',
        timestamp: 1_800_000_000_000,
        expiresAt: 1_800_000_300_000,
    };
}

describe('connect protocol 0.2.0', () => {
    it('publishes request protocol 0.2.0 without changing the injected bridge contract', () => {
        expect(PROTOCOL_VERSION).toBe('0.2.0');
        expect(SUPPORTED_PROTOCOL_VERSIONS).toEqual(['0.1.0', '0.2.0']);
        expect(Object.isFrozen(SUPPORTED_PROTOCOL_VERSIONS)).toBe(true);
        expect(BRIDGE_SPEC_VERSION).toBe('0.1.0');
        expect(BRIDGE_SUPPORTED_VERSIONS).toEqual(['0.1.0']);
    });

    it('publishes the request errors after the bridge errors', () => {
        expect(ERROR_CODES).toEqual([...BRIDGE_ERROR_CODES, ...REQUEST_ERROR_CODES]);
        expect(ERROR_CODES).toEqual(walletRequests.errors);
        expect(Object.isFrozen(ERROR_CODES)).toBe(true);

        for (const code of REQUEST_ERROR_CODES) {
            expect(isErrorCode(code), code).toBe(true);
            expect(isBridgeErrorCode(code), code).toBe(false);
        }
        expect(isErrorCode('NOT_AN_ERROR')).toBe(false);
    });

    it('uses Login names while retaining every SignIn alias', () => {
        expect(LOGIN_CHALLENGE_VERSION).toBe(SIGN_IN_CHALLENGE_VERSION);
        expect(LOGIN_DEFAULT_EXPIRY_MS).toBe(SIGN_IN_DEFAULT_EXPIRY_MS);
        expect(LOGIN_CHALLENGE_PREFIX).toBe(SIGN_IN_CHALLENGE_PREFIX);
        expect(LOGIN_CHALLENGE_SEPARATOR).toBe(SIGN_IN_CHALLENGE_SEPARATOR);
        expect(makeLoginParams).toBe(makeSignInParams);
        expect(formatLoginChallenge).toBe(formatSignInChallenge);
        expect(parseLoginChallenge).toBe(parseSignInChallenge);
        expect(validateLoginChallenge).toBe(validateSignInChallenge);

        const parts = challengeParts();
        const challenge = formatLoginChallenge(parts);
        expect(parseLoginChallenge(challenge)).toEqual(parts);
        expect(validateLoginChallenge(parts, {
            appId: parts.appId,
            origin: parts.origin,
            nonce: parts.nonce,
            now: parts.timestamp,
        })).toBeNull();

        expect(makeLoginParams(parts.appId, {
            nonce: parts.nonce,
            expiresInMs: parts.expiresAt - parts.timestamp,
        })).toEqual({
            appId: parts.appId,
            nonce: parts.nonce,
            expiresInMs: 300_000,
        });
    });
});
