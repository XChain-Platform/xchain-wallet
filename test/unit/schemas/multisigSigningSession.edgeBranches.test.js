// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    createMultisigSigningSession,
    pendingCosignerPubkeys,
    validateMultisigSigningSession,
} from '../../../packages/core/src/schemas/multisigSigningSession.js';

const PK_A = `02${'a'.repeat(64)}`;
const PK_B = `03${'b'.repeat(64)}`;
const NOW = new Date().toISOString();
const BASE_INPUT = {
    walletId: 'wallet-1',
    chainId: 'bitcoin-mainnet',
    scheme: 'p2wsh-multisig',
    threshold: 2,
    cosignerPubkeys: [PK_A, PK_B],
    msgHash: 'c'.repeat(64),
    psbtHex: '70736274ff',
};

describe('multisig signing session edge branches', () => {
    it('rejects an absent message hash through its empty fallback', () => {
        expect(() => createMultisigSigningSession({
            ...BASE_INPUT,
            msgHash: undefined,
        })).toThrow(/msgHash/);
    });

    it('uses an empty cosigner list when a partial session omits it', () => {
        expect(pendingCosignerPubkeys({
            scheme: 'p2wsh-multisig',
            status: 'collecting-sigs',
            signatures: [],
        })).toEqual([]);
    });

    it('accepts populated nullable fields and valid contributions', () => {
        const session = createMultisigSigningSession(BASE_INPUT);
        const populated = {
            ...session,
            aggNonce: 'd'.repeat(132),
            aggregatedSchnorrSig: 'e'.repeat(128),
            finalizedTxHex: 'ab',
            txid: 'transaction-id',
            nonces: [{ pubkey: PK_A, publicNonce: 'f'.repeat(132), contributedAt: NOW }],
            partialSigs: [{ pubkey: PK_A, sig: 'aa', contributedAt: NOW }],
            signatures: [{ pubkey: PK_B, sig: 'bb', contributedAt: NOW }],
        };

        expect(validateMultisigSigningSession(populated)).toEqual({ ok: true, errors: [] });
    });

    it('rejects each malformed nonce contribution field', () => {
        const session = createMultisigSigningSession(BASE_INPUT);
        const nonces = [
            null,
            { pubkey: 'bad', publicNonce: 'f'.repeat(132), contributedAt: NOW },
            { pubkey: PK_A, publicNonce: 'bad', contributedAt: NOW },
            { pubkey: PK_A, publicNonce: 'f'.repeat(132), contributedAt: 'soon' },
        ];

        for (const nonce of nonces) {
            expect(validateMultisigSigningSession({ ...session, nonces: [nonce] }).ok).toBe(false);
        }
    });

    it('rejects each malformed signature contribution field', () => {
        const session = createMultisigSigningSession(BASE_INPUT);
        const signatures = [
            null,
            { pubkey: 'bad', sig: 'aa', contributedAt: NOW },
            { pubkey: PK_A, sig: 'not-hex', contributedAt: NOW },
            { pubkey: PK_A, sig: 'aa', contributedAt: 'soon' },
        ];

        for (const signature of signatures) {
            expect(validateMultisigSigningSession({
                ...session,
                partialSigs: [signature],
                signatures: [signature],
            }).ok).toBe(false);
        }
    });

    it('rejects malformed nullable values and non-integer thresholds', () => {
        const session = createMultisigSigningSession(BASE_INPUT);
        const invalid = [
            { aggNonce: 'bad' },
            { aggregatedSchnorrSig: 'bad' },
            { finalizedTxHex: 'AB' },
            { txid: '' },
            { threshold: 1.5 },
            { cosignerPubkeys: null },
        ];

        for (const override of invalid) {
            expect(validateMultisigSigningSession({ ...session, ...override }).ok).toBe(false);
        }
    });
});
