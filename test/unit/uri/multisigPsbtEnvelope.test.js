// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
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

describe('multisig PSBT envelope', () => {
    it.each([
        ['multisig-request-nonce', undefined],
        ['multisig-request-signature', undefined],
        ['multisig-request-partial', 'cd'.repeat(66)],
    ])('round-trips request kind %s', (kind, aggNonceHex) => {
        const envelope = buildRequestEnvelope({ kind, sessionRef: SESSION_REF, aggNonceHex });
        const decoded = decodeEnvelope(encodeEnvelope(envelope));

        expect(decoded).toEqual(envelope);
        expect(decoded.fingerprint).toBe(FINGERPRINT);
    });

    it.each([
        [
            'multisig-round-1-reply',
            { pubkey: ALICE, publicNonce: '11'.repeat(66) },
        ],
        [
            'multisig-round-2-reply',
            { pubkey: ALICE, sig: '22'.repeat(32) },
        ],
        [
            'multisig-classical-reply',
            { pubkey: ALICE, sig: `30${'44'.repeat(35)}01` },
        ],
    ])('round-trips reply kind %s', (kind, contribution) => {
        const envelope = buildReplyEnvelope({ kind, fingerprint: FINGERPRINT, contribution });

        expect(decodeEnvelope(encodeEnvelope(envelope))).toEqual(envelope);
    });

    it('round-trips a finalized envelope', () => {
        const envelope = buildFinalizedEnvelope({
            sessionRef: SESSION_REF,
            txHex: '0200000001abcd',
            txid: 'transaction-id',
        });

        expect(decodeEnvelope(encodeEnvelope(envelope))).toEqual(envelope);
    });

    it.each(['p2sh-multisig', 'p2wsh-multisig', 'taproot-musig2'])(
        'fingerprints and validates the %s scheme',
        (scheme) => {
            const ref = { ...SESSION_REF, scheme };
            const envelope = buildRequestEnvelope({
                kind: 'multisig-request-signature',
                sessionRef: ref,
            });

            expect(envelope.fingerprint).toHaveLength(64);
            expect(validateEnvelope(envelope).sessionRef.scheme).toBe(scheme);
        },
    );

    it('canonicalizes case before fingerprinting', () => {
        expect(fingerprintSessionRef({
            ...SESSION_REF,
            cosignerPubkeys: SESSION_REF.cosignerPubkeys.map((key) => key.toUpperCase()),
            msgHash: SESSION_REF.msgHash.toUpperCase(),
            psbtHex: SESSION_REF.psbtHex.toUpperCase(),
        })).toBe(FINGERPRINT);
    });

    it.each([
        ['missing options', () => buildRequestEnvelope()],
        ['unknown request kind', () => buildRequestEnvelope({ kind: 'unknown', sessionRef: SESSION_REF })],
        ['missing session ref', () => buildRequestEnvelope({ kind: 'multisig-request-nonce' })],
        ['unknown scheme', () => buildRequestEnvelope({
            kind: 'multisig-request-nonce', sessionRef: { ...SESSION_REF, scheme: 'unknown' },
        })],
        ['zero threshold', () => buildRequestEnvelope({
            kind: 'multisig-request-nonce', sessionRef: { ...SESSION_REF, threshold: 0 },
        })],
        ['threshold above cosigner count', () => buildRequestEnvelope({
            kind: 'multisig-request-nonce', sessionRef: { ...SESSION_REF, threshold: 3 },
        })],
        ['short message hash', () => buildRequestEnvelope({
            kind: 'multisig-request-nonce', sessionRef: { ...SESSION_REF, msgHash: 'ab' },
        })],
        ['missing aggregate nonce', () => buildRequestEnvelope({
            kind: 'multisig-request-partial', sessionRef: SESSION_REF,
        })],
    ])('rejects malformed request: %s', (_label, build) => {
        expect(build).toThrow(MultisigEnvelopeError);
    });

    it.each([
        ['unknown reply kind', 'unknown', { pubkey: ALICE, sig: '11'.repeat(32) }],
        ['short fingerprint', 'multisig-round-2-reply', { pubkey: ALICE, sig: '11'.repeat(32) }, 'ab'],
        ['short pubkey', 'multisig-round-2-reply', { pubkey: '02', sig: '11'.repeat(32) }],
        ['short partial signature', 'multisig-round-2-reply', { pubkey: ALICE, sig: '11' }],
        ['short public nonce', 'multisig-round-1-reply', { pubkey: ALICE, publicNonce: '11' }],
        ['non-hex classical signature', 'multisig-classical-reply', { pubkey: ALICE, sig: 'not-hex' }],
    ])('rejects malformed reply: %s', (_label, kind, contribution, fingerprint = FINGERPRINT) => {
        expect(() => buildReplyEnvelope({ kind, fingerprint, contribution })).toThrow(
            MultisigEnvelopeError,
        );
    });

    it.each([
        ['non-object', null],
        ['unsupported version', { v: 2, kind: 'multisig-round-2-reply', fingerprint: FINGERPRINT }],
        ['unknown kind', { v: 1, kind: 'unknown', fingerprint: FINGERPRINT }],
        ['tampered session ref', {
            ...buildRequestEnvelope({ kind: 'multisig-request-nonce', sessionRef: SESSION_REF }),
            sessionRef: { ...SESSION_REF, msgHash: 'ff'.repeat(32) },
        }],
    ])('rejects malformed envelope: %s', (_label, envelope) => {
        expect(() => validateEnvelope(envelope)).toThrow(MultisigEnvelopeError);
    });

    it.each([
        ['wrong input type', 'not bytes'],
        ['invalid JSON', new TextEncoder().encode('{')],
        ['valid JSON with invalid envelope', new TextEncoder().encode('{}')],
    ])('rejects malformed encoded input: %s', (_label, bytes) => {
        expect(() => decodeEnvelope(bytes)).toThrow(MultisigEnvelopeError);
    });
});
