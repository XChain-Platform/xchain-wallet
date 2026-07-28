// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Broadcast-failure permanence classifier ( §5.3.4).

import { describe, it, expect } from 'vitest';
import {
    classifyBroadcastFailure,
    broadcastFailureKindFromError,
    BROADCAST_FAILED_PERMANENT_NAME,
    BROADCAST_FAILED_TRANSIENT_NAME,
} from '../../../packages/core/src/flows/broadcastPermanence.js';

describe('classifyBroadcastFailure', () => {

    it('classifies spent/missing inputs as PERMANENT', () => {
        expect(classifyBroadcastFailure(new Error('bad-txns-inputs-missingorspent'))).toBe('permanent');
        expect(classifyBroadcastFailure('missing or spent')).toBe('permanent');
        expect(classifyBroadcastFailure(new Error('txn-already-known'))).toBe('permanent');
    });

    it('classifies a dust rejection as PERMANENT, not a retryable blip', () => {
        // Measured live: a DIVIDEND to one holder priced its protocol fee at 2 sats, the
        // encoder answered `Transaction broadcast failed: dust`, and the transient default
        // queued it for a rebroadcast that can never succeed - the same bytes are dust on
        // every node - while the form rendered a terminal "Dividend sent".
        expect(classifyBroadcastFailure(new Error('dust'))).toBe('permanent');
        expect(classifyBroadcastFailure(new Error('Transaction broadcast failed: dust'))).toBe('permanent');
        expect(classifyBroadcastFailure({ cause: { message: 'dust' } })).toBe('permanent');
        // Not a substring match on any word containing "dust".
        expect(classifyBroadcastFailure(new Error('industrial node error'))).toBe('transient');
    });

    it('classifies connection/mempool issues as TRANSIENT', () => {
        expect(classifyBroadcastFailure(new Error('ECONNREFUSED 127.0.0.1:8332'))).toBe('transient');
        expect(classifyBroadcastFailure(new Error('too-long-mempool-chain'))).toBe('transient');
        expect(classifyBroadcastFailure(new Error('min relay fee not met'))).toBe('transient');
        expect(classifyBroadcastFailure('request timed out')).toBe('transient');
    });

    it('reads the nested cause of a BroadcastFailedError-shaped object', () => {
        const err = { name: 'BroadcastFailedError', message: 'broadcast failed', cause: { message: 'bad-txns-inputs-missingorspent' } };
        expect(classifyBroadcastFailure(err)).toBe('permanent');
    });

    it('reads a nested RPC response error', () => {
        const err = { cause: { response: { data: { error: 'txn-mempool-conflict' } } } };
        expect(classifyBroadcastFailure(err)).toBe('transient');
    });

    it('prefers an explicit structured rejectReason', () => {
        const err = { rejectReason: 'bad-txns-inputs-missingorspent', message: 'generic' };
        expect(classifyBroadcastFailure(err)).toBe('permanent');
    });

    it('defaults ambiguous failures to TRANSIENT (keep the signed tx recoverable)', () => {
        expect(classifyBroadcastFailure(new Error('something weird happened'))).toBe('transient');
        expect(classifyBroadcastFailure(null)).toBe('transient');
    });
});

// Permanence has to survive the messaging boundary, whose envelope carries
// ONLY { name, message } - so it rides in the error NAME.
describe('broadcastFailureKindFromError', () => {

    it('recovers permanence from the stamped name', () => {
        expect(broadcastFailureKindFromError({ name: BROADCAST_FAILED_PERMANENT_NAME })).toBe('permanent');
        expect(broadcastFailureKindFromError({ name: BROADCAST_FAILED_TRANSIENT_NAME })).toBe('transient');
    });

    it('survives a boundary crossing that keeps only name + message', () => {
        const wire = { name: BROADCAST_FAILED_TRANSIENT_NAME, message: 'broadcast failed (phase1): ECONNREFUSED' };
        expect(broadcastFailureKindFromError(wire)).toBe('transient');
    });

    it('returns null for anything that is not a broadcast failure', () => {
        expect(broadcastFailureKindFromError(new Error('nope'))).toBe(null);
        expect(broadcastFailureKindFromError({ name: 'InvalidPasswordError' })).toBe(null);
        expect(broadcastFailureKindFromError(null)).toBe(null);
    });
});
