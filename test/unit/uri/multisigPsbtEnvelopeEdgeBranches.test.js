// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    buildFinalizedEnvelope,
    buildReplyEnvelope,
    buildRequestEnvelope,
    decodeEnvelope,
    encodeEnvelope,
    fingerprintSessionRef,
    MultisigEnvelopeError,
    validateEnvelope,
} from '../../../packages/core/src/uri/multisigPsbtEnvelope.js';

const ALICE = `02${'a'.repeat(64)}`;
const BOB = `03${'b'.repeat(64)}`;
const SESSION_REF = {
    scheme: 'taproot-musig2',
    threshold: 2,
    cosignerPubkeys: [ALICE, BOB],
    msgHash: 'ab'.repeat(32),
    psbtHex: '70736274ff0100',
};
const FINGERPRINT = fingerprintSessionRef(SESSION_REF);

describe('multisig envelope edge branches', () => {
    it.each([
        ['request options', () => buildRequestEnvelope()],
        ['reply options', () => buildReplyEnvelope()],
        ['finalized options', () => buildFinalizedEnvelope()],
        ['fingerprint session reference', () => fingerprintSessionRef(null)],
        ['reply contribution', () => buildReplyEnvelope({
            kind: 'multisig-round-2-reply', fingerprint: FINGERPRINT,
        })],
    ])('rejects missing %s', (_label, call) => {
        expect(call).toThrow(MultisigEnvelopeError);
    });

    it.each([
        ['non-array cosigners', { cosignerPubkeys: ALICE }],
        ['one cosigner', { cosignerPubkeys: [ALICE] }],
        ['fractional threshold', { threshold: 1.5 }],
        ['empty PSBT', { psbtHex: '' }],
    ])('rejects a session with %s', (_label, patch) => {
        expect(() => buildRequestEnvelope({
            kind: 'multisig-request-nonce',
            sessionRef: { ...SESSION_REF, ...patch },
        })).toThrow(MultisigEnvelopeError);
    });

    it.each([
        ['14-character classical signature', 'aa'.repeat(7)],
        ['202-character classical signature', 'aa'.repeat(101)],
    ])('rejects a %s', (_label, sig) => {
        expect(() => buildReplyEnvelope({
            kind: 'multisig-classical-reply',
            fingerprint: FINGERPRINT,
            contribution: { pubkey: ALICE, sig },
        })).toThrow(/length out of expected range/);
    });

    it.each(['', 42])('rejects finalized txid value %j', (txid) => {
        expect(() => buildFinalizedEnvelope({
            sessionRef: SESSION_REF,
            txHex: '0200',
            txid,
        })).toThrow(/txid must be a non-empty string/);
    });

    it('normalizes every reply contribution field', () => {
        const roundOne = validateEnvelope({
            v: 1,
            kind: 'multisig-round-1-reply',
            fingerprint: FINGERPRINT.toUpperCase(),
            contribution: {
                pubkey: ALICE.toUpperCase(),
                publicNonce: 'AB'.repeat(66),
            },
        });
        const roundTwo = validateEnvelope({
            v: 1,
            kind: 'multisig-round-2-reply',
            fingerprint: FINGERPRINT,
            contribution: { pubkey: ALICE, sig: 'CD'.repeat(32) },
        });

        expect(roundOne.fingerprint).toBe(FINGERPRINT);
        expect(roundOne.contribution).toEqual({
            pubkey: ALICE,
            publicNonce: 'ab'.repeat(66),
        });
        expect(roundTwo.contribution.sig).toBe('cd'.repeat(32));
    });

    it('normalizes a finalized envelope without adding an absent txid', () => {
        const envelope = buildFinalizedEnvelope({
            sessionRef: SESSION_REF,
            txHex: 'AABB',
        });

        expect(envelope.contribution).toEqual({ txHex: 'aabb' });
        expect(validateEnvelope(envelope).contribution).toEqual({ txHex: 'aabb' });
    });

    it('decodes byte-wide typed arrays and rejects wider views', () => {
        const envelope = buildRequestEnvelope({
            kind: 'multisig-request-nonce',
            sessionRef: SESSION_REF,
        });
        const bytes = encodeEnvelope(envelope);

        expect(decodeEnvelope(new Uint8ClampedArray(bytes))).toEqual(envelope);
        expect(() => decodeEnvelope(new Uint16Array([1]))).toThrow(/Uint8Array/);
        expect(() => decodeEnvelope(new DataView(bytes.buffer))).toThrow(/Uint8Array/);
    });
});
