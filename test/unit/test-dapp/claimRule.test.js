// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { claimLogin } from '../../../packages/test-dapp/claimRule.js';

const signedResult = {
    address: 'bc1qclaimant',
    challenge: 'site-login-challenge',
    signature: 'signed-site-login-challenge',
};

function loginRecord(overrides = {}) {
    return {
        body: { method: 'login', ok: true, result: { ...signedResult } },
        verified: { address: signedResult.address },
        nonceMode: 'same-device',
        claim: 'claim-token-123456',
        claimed: false,
        status: 'approved-unclaimed',
        ...overrides,
    };
}

describe('claimLogin', () => {
    it('claims a login with the matching claim without changing the input record', () => {
        const record = loginRecord();
        const before = structuredClone(record);

        const result = claimLogin(record, { claim: record.claim });

        expect(result).toEqual({
            ok: true,
            address: signedResult.address,
            record: { ...before, claimed: true, status: 'approved' },
        });
        expect(result.record).not.toBe(record);
        expect(record).toEqual(before);
    });

    it.each([
        ['one character differs', 'claim-token-123457'],
        ['the length differs', 'claim-token-123456-extra'],
    ])('rejects a claim when %s', (_description, claim) => {
        expect(claimLogin(loginRecord(), { claim })).toEqual({
            ok: false,
            reason: 'NO_MATCH',
        });
    });

    it('rejects a claim when the stored claim is null', () => {
        expect(claimLogin(loginRecord({ claim: null }), { claim: 'claim-token-123456' }))
            .toEqual({ ok: false, reason: 'NO_MATCH' });
    });

    it('claims a login with the matching full signed result', () => {
        const record = loginRecord();

        expect(claimLogin(record, { result: { ...signedResult } })).toEqual({
            ok: true,
            address: signedResult.address,
            record: { ...record, claimed: true, status: 'approved' },
        });
    });

    it.each([
        ['a changed signature', { ...signedResult, signature: 'different-signature' }],
        ['a missing challenge', {
            address: signedResult.address,
            signature: signedResult.signature,
        }],
    ])('rejects a full result with %s', (_description, result) => {
        expect(claimLogin(loginRecord(), { result })).toEqual({
            ok: false,
            reason: 'NO_MATCH',
        });
    });

    it('rejects a cross-device record already approved without a claim', () => {
        const record = loginRecord({
            nonceMode: 'cross-device',
            claim: null,
            claimed: true,
            status: 'approved',
        });

        expect(claimLogin(record, { result: { ...signedResult } })).toEqual({
            ok: false,
            reason: 'ALREADY_CLAIMED',
        });
    });

    it('rejects a second claim made against the returned record', () => {
        const first = claimLogin(loginRecord(), { claim: 'claim-token-123456' });

        expect(claimLogin(first.record, { claim: 'claim-token-123456' })).toEqual({
            ok: false,
            reason: 'ALREADY_CLAIMED',
        });
    });

    it.each([
        ['a non-login body', loginRecord({ body: { method: 'signMessage', ok: true } })],
        ['a failed login body', loginRecord({ body: { method: 'login', ok: false } })],
    ])('rejects %s', (_description, record) => {
        expect(claimLogin(record, { claim: record.claim })).toEqual({
            ok: false,
            reason: 'NOT_A_LOGIN',
        });
    });

    it.each([null, 'not a record'])('rejects a non-object record %#', (record) => {
        expect(claimLogin(record, { claim: 'claim-token-123456' })).toEqual({
            ok: false,
            reason: 'NO_RECORD',
        });
    });

    it.each([null, {}])('rejects an absent claim presentation %#', (presented) => {
        expect(claimLogin(loginRecord(), presented)).toEqual({
            ok: false,
            reason: 'NO_MATCH',
        });
    });
});
