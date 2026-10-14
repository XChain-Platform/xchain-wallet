// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    assertCompleteEnvelope,
    BroadcastFailedError,
    EnvelopeConfirmLaneError,
    isCompleteEnvelope,
    isEnvelopePair,
} from '../../../packages/core/src/sdk/submitWithSigner.js';

const COMPLETE = {
    encoding: 'TAPROOT',
    revealPsbt: '70736274ff',
    envelope: {
        commitTxid: 'aa'.repeat(32),
        commitVout: 0,
        commitValue: 0,
        commitAddress: 'bcrt1pcommit',
        tapleafHash: 'bb'.repeat(32),
    },
};

describe('submitWithSigner envelope edge branches', () => {
    it('recognises every signal that an object is an envelope pair', () => {
        expect(isEnvelopePair(null)).toBe(false);
        expect(isEnvelopePair('TAPROOT')).toBe(false);
        expect(isEnvelopePair({ encoding: 'TAPROOT' })).toBe(true);
        expect(isEnvelopePair({ encoding: 'P2SH', revealPsbt: 'psbt' })).toBe(true);
        expect(isEnvelopePair({ encoding: 'OP_RETURN', envelope: {} })).toBe(true);
    });

    it('accepts zero-valued commit fields but requires every recovery field', () => {
        expect(isCompleteEnvelope(COMPLETE)).toBe(true);

        const incomplete = [
            { encoding: 'P2SH' },
            { revealPsbt: '' },
            { envelope: null },
            { envelope: { ...COMPLETE.envelope, commitTxid: '' } },
            { envelope: { ...COMPLETE.envelope, commitVout: -1 } },
            { envelope: { ...COMPLETE.envelope, commitValue: null } },
            { envelope: { ...COMPLETE.envelope, commitAddress: '' } },
            { envelope: { ...COMPLETE.envelope, tapleafHash: '' } },
        ];
        for (const change of incomplete) {
            expect(isCompleteEnvelope({ ...COMPLETE, ...change })).toBe(false);
        }
    });

    it('refuses an implied pair with the default TAPROOT error label', () => {
        expect(() => assertCompleteEnvelope({ revealPsbt: 'psbt' }, 'FILE'))
            .toThrowError(expect.objectContaining({
                name: 'EnvelopeConfirmLaneError',
                action: 'FILE',
                encoding: 'TAPROOT',
            }));
        expect(() => assertCompleteEnvelope({ encoding: 'OP_RETURN' }, 'SEND')).not.toThrow();
    });

    it('distinguishes a signed commit mismatch from a missing envelope part', () => {
        const missing = new EnvelopeConfirmLaneError({ action: 'FILE', encoding: 'TAPROOT' });
        const mismatch = new EnvelopeConfirmLaneError({
            action: 'FILE', encoding: 'TAPROOT', commitMismatch: true,
        });

        expect(missing.message).toMatch(/nothing was signed/);
        expect(mismatch.message).toMatch(/nothing was broadcast/);
        expect(mismatch.commitMismatch).toBe(true);
        expect(missing.userFacing).toBe(true);
    });

    it('preserves primitive and object broadcast causes', () => {
        const fields = {
            signedTxHex: 'deadbeef', txid: 'txid', chainId: 'bitcoin-regtest',
            signedAt: 123, encoding: 'OP_RETURN', phase: 'phase1',
        };
        const objectCause = new Error('service down');
        const fromObject = new BroadcastFailedError({ ...fields, cause: objectCause });
        const fromPrimitive = new BroadcastFailedError({ ...fields, cause: 'socket closed' });

        expect(fromObject.message).toBe('broadcast failed (phase1): service down');
        expect(fromObject.cause).toBe(objectCause);
        expect(fromPrimitive.message).toBe('broadcast failed (phase1): socket closed');
        expect(fromPrimitive.signedTxHex).toBe('deadbeef');
    });
});
