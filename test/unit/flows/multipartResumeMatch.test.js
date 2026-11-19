// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    confirmResumePick,
    findResumableUpload,
} from '../../../packages/core/src/flows/multipartResumeMatch.js';

const ORIGINAL_SHA = 'ab'.repeat(32);
const FILE_HASH = 'cd'.repeat(32);

function upload(overrides = {}) {
    return {
        id: 'upload-1',
        walletId: 'wallet-1',
        chainId: 'bitcoin-mainnet',
        sourceAddress: 'bc1qsource',
        originalSha256: ORIGINAL_SHA,
        fileHash: FILE_HASH,
        totalParts: 3,
        partCapacity: 389_920,
        stage: 'parts',
        createdAt: '2026-11-15T08:00:00.000Z',
        ...overrides,
    };
}

const pick = (overrides = {}) => ({
    walletId: 'wallet-1',
    chainId: 'bitcoin-mainnet',
    originalSha256: ORIGINAL_SHA,
    ...overrides,
});

describe('findResumableUpload identity matching', () => {
    it('returns null for a fresh pick with no record', () => {
        expect(findResumableUpload([], pick())).toBeNull();
    });

    it('returns the matching record', () => {
        const record = upload();
        expect(findResumableUpload([record], pick())).toBe(record);
    });

    it('compares the original digest case-insensitively', () => {
        const record = upload({ originalSha256: ORIGINAL_SHA.toUpperCase() });
        expect(findResumableUpload([record], pick())).toBe(record);
        expect(findResumableUpload([record], pick({ originalSha256: ORIGINAL_SHA.toUpperCase() })))
            .toBe(record);
    });

    it('skips records from another wallet or chain', () => {
        const otherWallet = upload({ id: 'other-wallet', walletId: 'wallet-2' });
        const otherChain = upload({ id: 'other-chain', chainId: 'litecoin-mainnet' });
        expect(findResumableUpload([otherWallet, otherChain], pick())).toBeNull();
    });

    it.each(['short', 'g'.repeat(64), '', null])('refuses a bad digest %j', (digest) => {
        expect(() => findResumableUpload([], pick({ originalSha256: digest })))
            .toThrow(expect.objectContaining({ code: 'RESUME_BAD_DIGEST' }));
    });
});

describe('findResumableUpload stage and recency', () => {
    it.each(['complete', 'mismatch'])('returns a matching %s record with its stage', (stage) => {
        const record = upload({ stage });
        expect(findResumableUpload([record], pick())).toMatchObject({ stage });
    });

    it('chooses the newest of two matches', () => {
        const older = upload({ id: 'older', createdAt: '2026-11-15T08:00:00.000Z' });
        const newer = upload({ id: 'newer', createdAt: '2026-11-15T09:00:00.000Z' });
        expect(findResumableUpload([newer, older], pick())).toBe(newer);
    });
});

describe('confirmResumePick', () => {
    it('confirms the same plan with a case-insensitive file hash', () => {
        expect(confirmResumePick(upload(), {
            fileHash: FILE_HASH.toUpperCase(), totalParts: 3, partCapacity: 389_920,
            sourceAddress: 'bc1qsource',
        })).toBe(true);
    });

    it.each([
        ['hash', { fileHash: 'ef'.repeat(32), totalParts: 3 }],
        ['part count', { fileHash: FILE_HASH, totalParts: 4 }],
        ['part capacity', { fileHash: FILE_HASH, totalParts: 3, partCapacity: 389_919 }],
    ])('refuses a changed %s and names both hashes', (_reason, plan) => {
        expect(() => confirmResumePick(upload(), { ...plan, sourceAddress: 'bc1qsource' }))
            .toThrow(expect.objectContaining({
                code: 'RESUME_PLAN_MISMATCH',
                message: expect.stringContaining(FILE_HASH),
            }));
        try {
            confirmResumePick(upload(), { ...plan, sourceAddress: 'bc1qsource' });
        } catch (error) {
            expect(error.message).toContain(plan.fileHash);
        }
    });

    it('refuses a changed source address', () => {
        expect(() => confirmResumePick(upload(), {
            fileHash: FILE_HASH, totalParts: 3, partCapacity: 389_920,
            sourceAddress: 'bc1qother',
        })).toThrow(expect.objectContaining({ code: 'RESUME_SOURCE_MISMATCH' }));
    });

    it('checks the plan before the source address', () => {
        expect(() => confirmResumePick(upload(), {
            fileHash: 'ef'.repeat(32), totalParts: 3, partCapacity: 389_920,
            sourceAddress: 'bc1qother',
        })).toThrow(expect.objectContaining({ code: 'RESUME_PLAN_MISMATCH' }));
    });
});

describe('multipart resume input immutability', () => {
    it('does not mutate records or pick inputs', () => {
        const records = [upload(), upload({ id: 'newer', createdAt: '2026-11-15T09:00:00.000Z' })];
        const lookup = pick({ originalSha256: ORIGINAL_SHA.toUpperCase() });
        const plan = {
            fileHash: FILE_HASH.toUpperCase(), totalParts: 3, partCapacity: 389_920,
            sourceAddress: 'bc1qsource',
        };
        const before = structuredClone({ records, lookup, plan });
        const record = findResumableUpload(records, lookup);
        confirmResumePick(record, plan);
        expect({ records, lookup, plan }).toEqual(before);
    });
});
