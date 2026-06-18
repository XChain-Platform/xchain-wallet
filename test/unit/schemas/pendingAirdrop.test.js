// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: schemas/pendingAirdrop. createPendingAirdrop + validatePendingAirdrop.

import { describe, it, expect } from 'vitest';
import {
    createPendingAirdrop,
    validatePendingAirdrop,
    PENDING_AIRDROP_STAGES,
    CURRENT_VERSION,
} from '../../../packages/core/src/schemas/pendingAirdrop.js';

const BASE_INPUT = {
    walletId: 'wallet-1',
    chainId: 'bitcoin-mainnet',
    fromAddress: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
    token: 'MYTOKEN',
    amountPer: '100',
    recipients: ['1addr1', '1addr2'],
    listTxid: 'aabbcc',
};

describe('PENDING_AIRDROP_STAGES', () => {
    it('contains waiting-index, ready-to-airdrop, done', () => {
        expect(PENDING_AIRDROP_STAGES).toContain('waiting-index');
        expect(PENDING_AIRDROP_STAGES).toContain('ready-to-airdrop');
        expect(PENDING_AIRDROP_STAGES).toContain('done');
    });
});

describe('createPendingAirdrop', () => {
    it('creates a well-formed record', () => {
        const p = createPendingAirdrop(BASE_INPUT);
        expect(p.schemaVersion).toBe(CURRENT_VERSION);
        expect(typeof p.id).toBe('string');
        expect(p.walletId).toBe('wallet-1');
        expect(p.chainId).toBe('bitcoin-mainnet');
        expect(p.fromAddress).toBe('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2');
        expect(p.token).toBe('MYTOKEN');
        expect(p.amountPer).toBe('100');
        expect(p.recipients).toEqual(['1addr1', '1addr2']);
        expect(p.listTxid).toBe('aabbcc');
        expect(p.listActionIndex).toBeNull();
        expect(p.airdropTxid).toBeNull();
        expect(p.stage).toBe('waiting-index');
        expect(typeof p.createdAt).toBe('string');
        expect(p.memo).toBeNull();
    });

    it('copies recipients (does not share reference)', () => {
        const input = { ...BASE_INPUT };
        const p = createPendingAirdrop(input);
        input.recipients.push('extra');
        expect(p.recipients).toHaveLength(2);
    });

    it('uses provided memo', () => {
        const p = createPendingAirdrop({ ...BASE_INPUT, memo: 'Happy airdrop' });
        expect(p.memo).toBe('Happy airdrop');
    });

    it('defaults memo to null', () => {
        const p = createPendingAirdrop(BASE_INPUT);
        expect(p.memo).toBeNull();
    });

    it('passes validation immediately after creation', () => {
        const r = validatePendingAirdrop(createPendingAirdrop(BASE_INPUT));
        expect(r.ok).toBe(true);
    });
});

describe('validatePendingAirdrop', () => {
    it('accepts a valid record', () => {
        const r = validatePendingAirdrop(createPendingAirdrop(BASE_INPUT));
        expect(r.ok).toBe(true);
        expect(r.errors).toHaveLength(0);
    });

    it('rejects non-object input', () => {
        expect(validatePendingAirdrop(null).ok).toBe(false);
        expect(validatePendingAirdrop('x').ok).toBe(false);
    });

    it('rejects wrong schemaVersion', () => {
        const p = createPendingAirdrop(BASE_INPUT);
        const r = validatePendingAirdrop({ ...p, schemaVersion: 99 });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('schemaVersion'))).toBe(true);
    });

    it('rejects empty walletId', () => {
        const p = createPendingAirdrop(BASE_INPUT);
        expect(validatePendingAirdrop({ ...p, walletId: '' }).ok).toBe(false);
    });

    it('rejects empty chainId', () => {
        const p = createPendingAirdrop(BASE_INPUT);
        expect(validatePendingAirdrop({ ...p, chainId: '' }).ok).toBe(false);
    });

    it('rejects empty fromAddress', () => {
        const p = createPendingAirdrop(BASE_INPUT);
        expect(validatePendingAirdrop({ ...p, fromAddress: '' }).ok).toBe(false);
    });

    it('rejects empty token', () => {
        const p = createPendingAirdrop(BASE_INPUT);
        expect(validatePendingAirdrop({ ...p, token: '' }).ok).toBe(false);
    });

    it('rejects empty amountPer', () => {
        const p = createPendingAirdrop(BASE_INPUT);
        expect(validatePendingAirdrop({ ...p, amountPer: '' }).ok).toBe(false);
    });

    it('rejects empty recipients array', () => {
        const p = createPendingAirdrop(BASE_INPUT);
        const r = validatePendingAirdrop({ ...p, recipients: [] });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('recipients'))).toBe(true);
    });

    it('rejects non-array recipients', () => {
        const p = createPendingAirdrop(BASE_INPUT);
        expect(validatePendingAirdrop({ ...p, recipients: 'bad' }).ok).toBe(false);
    });

    it('rejects recipients with empty string element', () => {
        const p = createPendingAirdrop(BASE_INPUT);
        const r = validatePendingAirdrop({ ...p, recipients: [''] });
        expect(r.ok).toBe(false);
    });

    it('rejects empty listTxid', () => {
        const p = createPendingAirdrop(BASE_INPUT);
        expect(validatePendingAirdrop({ ...p, listTxid: '' }).ok).toBe(false);
    });

    it('accepts null listActionIndex', () => {
        const p = createPendingAirdrop(BASE_INPUT);
        expect(validatePendingAirdrop({ ...p, listActionIndex: null }).ok).toBe(true);
    });

    it('accepts non-null listActionIndex', () => {
        const p = createPendingAirdrop(BASE_INPUT);
        expect(validatePendingAirdrop({ ...p, listActionIndex: '42' }).ok).toBe(true);
    });

    it('rejects empty string listActionIndex', () => {
        const p = createPendingAirdrop(BASE_INPUT);
        const r = validatePendingAirdrop({ ...p, listActionIndex: '' });
        expect(r.ok).toBe(false);
    });

    it('accepts null airdropTxid', () => {
        const p = createPendingAirdrop(BASE_INPUT);
        expect(validatePendingAirdrop({ ...p, airdropTxid: null }).ok).toBe(true);
    });

    it('accepts non-null airdropTxid', () => {
        const p = createPendingAirdrop(BASE_INPUT);
        expect(validatePendingAirdrop({ ...p, airdropTxid: 'txid123' }).ok).toBe(true);
    });

    it('rejects invalid stage', () => {
        const p = createPendingAirdrop(BASE_INPUT);
        const r = validatePendingAirdrop({ ...p, stage: 'unknown' });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('stage'))).toBe(true);
    });

    it('accepts all valid stages', () => {
        const p = createPendingAirdrop(BASE_INPUT);
        for (const stage of PENDING_AIRDROP_STAGES) {
            expect(validatePendingAirdrop({ ...p, stage }).ok).toBe(true);
        }
    });

    it('rejects invalid createdAt', () => {
        const p = createPendingAirdrop(BASE_INPUT);
        expect(validatePendingAirdrop({ ...p, createdAt: 'bad' }).ok).toBe(false);
    });

    it('accepts null memo', () => {
        const p = createPendingAirdrop(BASE_INPUT);
        expect(validatePendingAirdrop({ ...p, memo: null }).ok).toBe(true);
    });

    it('accepts string memo', () => {
        const p = createPendingAirdrop(BASE_INPUT);
        expect(validatePendingAirdrop({ ...p, memo: 'note' }).ok).toBe(true);
    });

    it('accepts empty string memo', () => {
        const p = createPendingAirdrop(BASE_INPUT);
        expect(validatePendingAirdrop({ ...p, memo: '' }).ok).toBe(true);
    });

    it('rejects non-string non-null memo', () => {
        const p = createPendingAirdrop(BASE_INPUT);
        const r = validatePendingAirdrop({ ...p, memo: 42 });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('memo'))).toBe(true);
    });
});
