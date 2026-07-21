// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Broadcast-failure permanence classifier ( §5.3.4).

import { describe, it, expect } from 'vitest';
import { classifyBroadcastFailure } from '../../../packages/core/src/flows/broadcastPermanence.js';

describe('classifyBroadcastFailure', () => {

    it('classifies spent/missing inputs as PERMANENT', () => {
        expect(classifyBroadcastFailure(new Error('bad-txns-inputs-missingorspent'))).toBe('permanent');
        expect(classifyBroadcastFailure('missing or spent')).toBe('permanent');
        expect(classifyBroadcastFailure(new Error('txn-already-known'))).toBe('permanent');
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
