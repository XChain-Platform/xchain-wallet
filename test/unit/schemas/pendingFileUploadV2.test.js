// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    MAX_WAVE_PIECES,
    createPendingFileUpload,
    validatePendingFileUpload,
} from '../../../packages/core/src/schemas/pendingFileUpload.js';
import { migratePendingFileUpload } from '../../../packages/core/src/schemas/migrations.js';

const piece = (index) => ({
    index,
    signedTxids: [],
    txid: null,
    actionIndex: null,
});

function input(overrides = {}) {
    return {
        walletId: 'wallet-1',
        chainId: 'bitcoin-regtest',
        sourceAddress: 'bcrt1qsource',
        originalSha256: 'a'.repeat(64),
        fileHash: 'b'.repeat(64),
        meta: { name: 'large.bin', type: 'application/octet-stream' },
        lane: 'envelope',
        buildMode: 'one_call',
        gate: null,
        compression: '',
        totalParts: 2,
        totalBytes: 500_000,
        partCapacity: 389_920,
        approvedRate: 2,
        blobKey: 'upload-blob',
        linkTarget: null,
        ...overrides,
    };
}

function v1Record() {
    return {
        schemaVersion: 1,
        id: 'legacy-upload',
        walletId: 'wallet-1',
        chainId: 'bitcoin-regtest',
        sourceAddress: 'bcrt1qsource',
        originalSha256: 'a'.repeat(64),
        fileHash: 'b'.repeat(64),
        meta: { name: 'large.bin', type: 'application/octet-stream' },
        lane: 'envelope',
        buildMode: 'one_call',
        gate: null,
        compression: '',
        totalParts: 2,
        totalBytes: 500_000,
        linkTarget: null,
        createdAt: '2026-11-16T12:00:00.000Z',
        stage: 'funding',
        partDigests: ['c'.repeat(64), 'd'.repeat(64)],
        fundingTxid: 'e'.repeat(64),
        fundingOutputs: [21_000, 22_000, 23_000],
        pieces: [piece(-1), piece(0), piece(1)],
    };
}

describe('pendingFileUpload v2 bounded persistence', () => {
    it('derives a widened-index capacity when callers omit it', () => {
        const record = createPendingFileUpload(input({
            totalParts: 101,
            partCapacity: undefined,
        }));
        const legacy = v1Record();
        legacy.totalParts = 101;

        expect(record.partCapacity).toBe(389_919);
        expect(migratePendingFileUpload(legacy).partCapacity).toBe(389_919);
    });

    it('serializes a 65,535-part header below 64 KB without part digests', () => {
        const record = createPendingFileUpload(input({
            totalParts: 65_535,
            totalBytes: 25_000_000_000,
            fundingOutputs: Array.from({ length: MAX_WAVE_PIECES }, (_, value) => value),
        }));
        const encoded = JSON.stringify(record);

        expect(record.totalParts).toBe(65_535);
        expect(record.wave.pieces).toHaveLength(MAX_WAVE_PIECES);
        expect(record).not.toHaveProperty('partDigests');
        expect(Buffer.byteLength(encoded)).toBeLessThan(64 * 1024);
    });

    it('migrates a v1 record into a valid v2 header and wave zero', () => {
        const legacy = v1Record();
        const migrated = migratePendingFileUpload(legacy);

        expect(migrated).not.toHaveProperty('partDigests');
        expect(migrated).not.toHaveProperty('fundingTxid');
        expect(migrated).not.toHaveProperty('fundingOutputs');
        expect(migrated).not.toHaveProperty('pieces');
        expect(migrated).toMatchObject({
            schemaVersion: 2,
            partCapacity: 389_920,
            approvedRate: null,
            wavesDone: 0,
            blobKey: null,
            path: null,
        });
        expect(migrated.wave).toMatchObject({
            index: 0,
            fundingTxid: legacy.fundingTxid,
            fundingOutputs: legacy.fundingOutputs,
            pieces: legacy.pieces,
        });
        expect(validatePendingFileUpload(migrated)).toEqual({ ok: true, errors: [] });
    });

    it('refuses a v2 record containing part digests', () => {
        const record = {
            ...createPendingFileUpload(input()),
            partDigests: ['c'.repeat(64), 'd'.repeat(64)],
        };
        const validation = validatePendingFileUpload(record);

        expect(validation.ok).toBe(false);
        expect(validation.errors).toContain('partDigests: must be absent');
    });

    it('refuses a wave containing 101 pieces', () => {
        const pieces = Array.from({ length: MAX_WAVE_PIECES + 1 }, (_, index) => piece(index));
        const record = createPendingFileUpload(input({
            totalParts: 65_535,
            totalBytes: 25_000_000_000,
            wave: { index: 0, fundingTxid: null, fundingOutputs: [], pieces },
        }));
        const validation = validatePendingFileUpload(record);

        expect(validation.ok).toBe(false);
        expect(validation.errors).toContain(
            `wave.pieces: must contain 1 to ${MAX_WAVE_PIECES} unique valid pieces`,
        );
    });
});
