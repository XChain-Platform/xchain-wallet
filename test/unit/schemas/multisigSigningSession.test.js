// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: schemas/multisigSigningSession — create, validate, pendingCosignerPubkeys, progressSummary.

import { describe, it, expect } from 'vitest';
import {
    createMultisigSigningSession,
    validateMultisigSigningSession,
    pendingCosignerPubkeys,
    progressSummary,
    CURRENT_VERSION,
    MULTISIG_SESSION_STATUSES,
} from '../../../packages/core/src/schemas/multisigSigningSession.js';

// --- test fixtures ---
const PK_A = '02' + 'a'.repeat(64);
const PK_B = '03' + 'b'.repeat(64);
const MSG_HASH = 'a'.repeat(64);   // 32 bytes = 64 hex chars

const BASE_INPUT = {
    walletId: 'wallet-1',
    chainId: 'bitcoin-mainnet',
    scheme: 'p2wsh-multisig',
    threshold: 2,
    cosignerPubkeys: [PK_A, PK_B],
    msgHash: MSG_HASH,
    psbtHex: '70736274ff',
    actionSummary: 'Send 1 BTC',
};

describe('createMultisigSigningSession', () => {
    it('creates a well-formed P2WSH session', () => {
        const s = createMultisigSigningSession(BASE_INPUT);
        expect(s.schemaVersion).toBe(CURRENT_VERSION);
        expect(typeof s.id).toBe('string');
        expect(s.walletId).toBe('wallet-1');
        expect(s.chainId).toBe('bitcoin-mainnet');
        expect(s.scheme).toBe('p2wsh-multisig');
        expect(s.threshold).toBe(2);
        expect(s.status).toBe('collecting-sigs');
        expect(s.nonces).toEqual([]);
        expect(s.partialSigs).toEqual([]);
        expect(s.signatures).toEqual([]);
        expect(s.aggNonce).toBeNull();
        expect(s.aggregatedSchnorrSig).toBeNull();
        expect(s.finalizedTxHex).toBeNull();
        expect(s.txid).toBeNull();
    });

    it('creates a MuSig2 session starting in collecting-nonces', () => {
        const s = createMultisigSigningSession({ ...BASE_INPUT, scheme: 'taproot-musig2' });
        expect(s.status).toBe('collecting-nonces');
    });

    it('lowercases cosigner pubkeys + msgHash', () => {
        const s = createMultisigSigningSession({
            ...BASE_INPUT,
            cosignerPubkeys: [PK_A.toUpperCase(), PK_B.toUpperCase()],
            msgHash: MSG_HASH.toUpperCase(),
        });
        expect(s.cosignerPubkeys[0]).toBe(PK_A.toLowerCase());
        expect(s.msgHash).toBe(MSG_HASH.toLowerCase());
    });

    it('accepts an empty actionSummary string', () => {
        const s = createMultisigSigningSession({ ...BASE_INPUT, actionSummary: '' });
        expect(s.actionSummary).toBe('');
    });

    it('defaults actionSummary to empty string when not a string', () => {
        const s = createMultisigSigningSession({ ...BASE_INPUT, actionSummary: 42 });
        expect(s.actionSummary).toBe('');
    });

    it('throws when input is missing', () => {
        expect(() => createMultisigSigningSession(null)).toThrow();
        expect(() => createMultisigSigningSession(undefined)).toThrow();
    });

    it('throws on missing walletId', () => {
        expect(() => createMultisigSigningSession({ ...BASE_INPUT, walletId: '' })).toThrow(/walletId/);
    });

    it('throws on missing chainId', () => {
        expect(() => createMultisigSigningSession({ ...BASE_INPUT, chainId: '' })).toThrow(/chainId/);
    });

    it('throws on unsupported scheme', () => {
        expect(() => createMultisigSigningSession({ ...BASE_INPUT, scheme: 'not-a-scheme' })).toThrow(/scheme/);
    });

    it('throws on non-positive threshold', () => {
        expect(() => createMultisigSigningSession({ ...BASE_INPUT, threshold: 0 })).toThrow(/threshold/);
    });

    it('throws when threshold > cosigner count', () => {
        expect(() => createMultisigSigningSession({ ...BASE_INPUT, threshold: 3 })).toThrow(/threshold/);
    });

    it('throws when cosignerPubkeys has < 2 entries', () => {
        expect(() => createMultisigSigningSession({ ...BASE_INPUT, cosignerPubkeys: [PK_A] })).toThrow();
    });

    it('throws on invalid msgHash length', () => {
        expect(() => createMultisigSigningSession({ ...BASE_INPUT, msgHash: 'a'.repeat(60) })).toThrow(/msgHash/);
    });

    it('throws when psbtHex is not a string', () => {
        expect(() => createMultisigSigningSession({ ...BASE_INPUT, psbtHex: 42 })).toThrow(/psbtHex/);
    });
});

describe('validateMultisigSigningSession', () => {
    it('accepts a freshly created session', () => {
        const s = createMultisigSigningSession(BASE_INPUT);
        const r = validateMultisigSigningSession(s);
        expect(r.ok).toBe(true);
        expect(r.errors).toHaveLength(0);
    });

    it('returns errors for non-object input', () => {
        const r = validateMultisigSigningSession('not an object');
        expect(r.ok).toBe(false);
    });

    it('rejects wrong schemaVersion', () => {
        const s = createMultisigSigningSession(BASE_INPUT);
        const r = validateMultisigSigningSession({ ...s, schemaVersion: 99 });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('schemaVersion'))).toBe(true);
    });

    it('rejects invalid status', () => {
        const s = createMultisigSigningSession(BASE_INPUT);
        const r = validateMultisigSigningSession({ ...s, status: 'not-a-status' });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('status'))).toBe(true);
    });

    it('rejects threshold > cosignerPubkeys.length', () => {
        const s = createMultisigSigningSession(BASE_INPUT);
        const r = validateMultisigSigningSession({ ...s, threshold: 5 });
        expect(r.ok).toBe(false);
    });

    it('accepts all valid statuses', () => {
        const s = createMultisigSigningSession(BASE_INPUT);
        for (const status of MULTISIG_SESSION_STATUSES) {
            const r = validateMultisigSigningSession({ ...s, status });
            expect(r.ok).toBe(true);
        }
    });
});

describe('pendingCosignerPubkeys', () => {
    it('returns all pubkeys when no sigs contributed yet (P2WSH)', () => {
        const s = createMultisigSigningSession(BASE_INPUT);
        const pending = pendingCosignerPubkeys(s);
        expect(pending).toEqual([PK_A, PK_B]);
    });

    it('excludes pubkeys that have signed (P2WSH)', () => {
        const s = createMultisigSigningSession(BASE_INPUT);
        s.signatures = [{ pubkey: PK_A, sig: 'a'.repeat(72), contributedAt: new Date().toISOString() }];
        const pending = pendingCosignerPubkeys(s);
        expect(pending).toEqual([PK_B]);
    });

    it('returns [] when status is not collecting (P2WSH)', () => {
        const s = createMultisigSigningSession(BASE_INPUT);
        s.status = 'finalized';
        expect(pendingCosignerPubkeys(s)).toEqual([]);
    });

    it('MuSig2 collecting-nonces returns all when no nonces yet', () => {
        const s = createMultisigSigningSession({ ...BASE_INPUT, scheme: 'taproot-musig2' });
        expect(pendingCosignerPubkeys(s)).toEqual([PK_A, PK_B]);
    });

    it('MuSig2 collecting-nonces excludes contributed nonces', () => {
        const s = createMultisigSigningSession({ ...BASE_INPUT, scheme: 'taproot-musig2' });
        s.nonces = [{ pubkey: PK_A, publicNonce: 'f'.repeat(132), contributedAt: new Date().toISOString() }];
        const pending = pendingCosignerPubkeys(s);
        expect(pending).toEqual([PK_B]);
    });

    it('MuSig2 collecting-sigs excludes contributed partial sigs', () => {
        const s = createMultisigSigningSession({ ...BASE_INPUT, scheme: 'taproot-musig2' });
        s.status = 'collecting-sigs';
        s.partialSigs = [{ pubkey: PK_A, sig: 'a'.repeat(64), contributedAt: new Date().toISOString() }];
        const pending = pendingCosignerPubkeys(s);
        expect(pending).toEqual([PK_B]);
    });

    it('MuSig2 terminal statuses return []', () => {
        const s = createMultisigSigningSession({ ...BASE_INPUT, scheme: 'taproot-musig2' });
        for (const status of ['ready-to-finalize', 'finalized', 'broadcast', 'cancelled']) {
            s.status = status;
            expect(pendingCosignerPubkeys(s)).toEqual([]);
        }
    });

    it('returns [] for null/undefined session', () => {
        expect(pendingCosignerPubkeys(null)).toEqual([]);
        expect(pendingCosignerPubkeys(undefined)).toEqual([]);
    });
});

describe('progressSummary', () => {
    it('collecting-sigs shows 0/threshold (P2WSH)', () => {
        const s = createMultisigSigningSession(BASE_INPUT);
        const ps = progressSummary(s);
        expect(ps.label).toBe('Signatures collected');
        expect(ps.current).toBe(0);
        expect(ps.threshold).toBe(2);
    });

    it('reflects actual signature count', () => {
        const s = createMultisigSigningSession(BASE_INPUT);
        s.signatures = [{ pubkey: PK_A, sig: 'a'.repeat(72), contributedAt: new Date().toISOString() }];
        const ps = progressSummary(s);
        expect(ps.current).toBe(1);
    });

    it('cancelled status', () => {
        const s = createMultisigSigningSession(BASE_INPUT);
        s.status = 'cancelled';
        const ps = progressSummary(s);
        expect(ps.label).toBe('Cancelled');
        expect(ps.current).toBe(0);
    });

    it('broadcast status', () => {
        const s = createMultisigSigningSession(BASE_INPUT);
        s.status = 'broadcast';
        const ps = progressSummary(s);
        expect(ps.label).toBe('Broadcast');
        expect(ps.current).toBe(s.threshold);
    });

    it('finalized status', () => {
        const s = createMultisigSigningSession(BASE_INPUT);
        s.status = 'finalized';
        const ps = progressSummary(s);
        expect(ps.label).toBe('Finalized');
    });

    it('ready-to-finalize status', () => {
        const s = createMultisigSigningSession(BASE_INPUT);
        s.status = 'ready-to-finalize';
        const ps = progressSummary(s);
        expect(ps.label).toBe('Ready to finalize');
    });

    it('MuSig2 collecting-nonces label', () => {
        const s = createMultisigSigningSession({ ...BASE_INPUT, scheme: 'taproot-musig2' });
        const ps = progressSummary(s);
        expect(ps.label).toBe('Nonces collected');
    });

    it('MuSig2 collecting-sigs label', () => {
        const s = createMultisigSigningSession({ ...BASE_INPUT, scheme: 'taproot-musig2' });
        s.status = 'collecting-sigs';
        s.partialSigs = [{ pubkey: PK_A, sig: 'b'.repeat(64), contributedAt: new Date().toISOString() }];
        const ps = progressSummary(s);
        expect(ps.label).toBe('Partial sigs collected');
        expect(ps.current).toBe(1);
    });

    it('returns null for null session', () => {
        expect(progressSummary(null)).toBeNull();
        expect(progressSummary(undefined)).toBeNull();
    });
});
