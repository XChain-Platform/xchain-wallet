// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import {
    advanceUploadStage,
    newPendingFileUpload,
    withFunding,
} from '../../../packages/core/src/flows/multipartUploadRecord.js';
import { MULTIPART_FILE_MAX_BYTES } from '../../../packages/core/src/flows/fileSizeLimits.js';

const UPPER_A = 'A'.repeat(64);
const UPPER_B = 'B'.repeat(64);
const BASE = {
    id: 'upload-1',
    walletId: 'wallet-1',
    chainId: 'bitcoin-regtest',
    sourceAddress: 'bcrt1qsource',
    originalSha256: UPPER_A,
    fileHash: UPPER_B,
    meta: { name: 'art.bin' },
    gate: null,
    compression: '',
    totalParts: 2,
    totalBytes: 400_000,
    partDigests: ['C'.repeat(64), 'D'.repeat(64)],
    linkTarget: null,
    createdAt: 1_797_000_000_000,
};

function input(overrides = {}) {
    return {
        ...BASE,
        meta: { ...BASE.meta },
        partDigests: [...BASE.partDigests],
        ...overrides,
    };
}

function outputs(totalParts = 2, txid = 'e'.repeat(64)) {
    return Array.from({ length: totalParts + 1 }, (_, vout) => ({
        txid,
        vout,
        value: 10_000 + vout,
        scriptPubKey: `script-${vout}`,
    }));
}

function expectCode(action, code, field) {
    expect(action).toThrowError(expect.objectContaining({
        code,
        message: expect.stringContaining(field),
    }));
}

function fundedRecord() {
    const record = newPendingFileUpload(input());
    return withFunding(record, { fundingTxid: 'e'.repeat(64), fundingOutputs: outputs() });
}

function sentRecord() {
    const record = advanceUploadStage(fundedRecord(), 'sending');
    return {
        ...record,
        pieces: record.pieces.map((piece) => ({ ...piece, txid: `piece-${piece.index}` })),
    };
}

describe('new pending file upload shape', () => {
    it('returns exactly the persisted fields with normalized digests', () => {
        const record = newPendingFileUpload(input());
        expect(Object.keys(record)).toEqual([
            'id', 'walletId', 'chainId', 'sourceAddress', 'originalSha256', 'fileHash',
            'meta', 'gate', 'compression', 'totalParts', 'totalBytes', 'partDigests',
            'fundingTxid', 'fundingOutputs', 'pieces', 'stage', 'linkTarget', 'createdAt',
        ]);
        expect(record).toMatchObject({
            originalSha256: 'a'.repeat(64),
            fileHash: 'b'.repeat(64),
            partDigests: ['c'.repeat(64), 'd'.repeat(64)],
            fundingTxid: null,
            fundingOutputs: [],
            stage: 'funding',
        });
    });

    it('builds 26 parts followed by the manifest', () => {
        const record = newPendingFileUpload(input({
            totalParts: 26,
            partDigests: Array.from({ length: 26 }, (_, index) => index.toString(16).padStart(64, '0')),
        }));
        expect(record.pieces).toHaveLength(27);
        expect(record.pieces.map(({ index }) => index)).toEqual([...Array(26).keys(), -1]);
        expect(record.pieces[26]).toEqual({ index: -1, signedTxids: [], txid: null, actionIndex: null });
    });
});

describe('new pending file upload refusals', () => {
    it.each(['id', 'walletId', 'chainId', 'sourceAddress'])('rejects an empty %s', (field) => {
        expectCode(() => newPendingFileUpload(input({ [field]: '  ' })), 'FILE_UPLOAD_RECORD_INVALID', field);
    });

    it.each(['originalSha256', 'fileHash'])('rejects an invalid %s', (field) => {
        expectCode(() => newPendingFileUpload(input({ [field]: 'f'.repeat(63) })),
            'FILE_UPLOAD_RECORD_INVALID', field);
    });

    it.each([1, 33, 2.5])('rejects totalParts %s', (totalParts) => {
        expectCode(() => newPendingFileUpload(input({ totalParts })), 'FILE_UPLOAD_RECORD_INVALID', 'totalParts');
    });

    it.each([0, MULTIPART_FILE_MAX_BYTES + 1, 1.5])('rejects totalBytes %s', (totalBytes) => {
        expectCode(() => newPendingFileUpload(input({ totalBytes })), 'FILE_UPLOAD_RECORD_INVALID', 'totalBytes');
    });

    it('rejects a digest count mismatch and an invalid digest', () => {
        expectCode(() => newPendingFileUpload(input({ partDigests: [UPPER_A] })),
            'FILE_UPLOAD_RECORD_INVALID', 'partDigests');
        expectCode(() => newPendingFileUpload(input({ partDigests: [UPPER_A, 'no'] })),
            'FILE_UPLOAD_RECORD_INVALID', 'partDigests[1]');
        expectCode(() => newPendingFileUpload(input({ partDigests: Array(2) })),
            'FILE_UPLOAD_RECORD_INVALID', 'partDigests[0]');
    });
});

describe('new pending file upload link and time refusals', () => {
    it.each([
        {},
        { tick: '', issueActionIndex: 1 },
        { tick: 'ART', issueActionIndex: 0 },
        { tick: 'ART', issueActionIndex: '01' },
        { tick: 'ART', issueActionIndex: 'one' },
    ])('rejects link target %#', (linkTarget) => {
        expectCode(() => newPendingFileUpload(input({ linkTarget })),
            'FILE_UPLOAD_RECORD_INVALID', 'linkTarget');
    });

    it.each([NaN, Infinity, -Infinity, '1'])('rejects non-finite createdAt %#', (createdAt) => {
        expectCode(() => newPendingFileUpload(input({ createdAt })),
            'FILE_UPLOAD_RECORD_INVALID', 'createdAt');
    });

    it('accepts null and numeric or decimal-string link indexes', () => {
        expect(newPendingFileUpload(input()).linkTarget).toBeNull();
        expect(newPendingFileUpload(input({ linkTarget: { tick: 'ART', issueActionIndex: 2 } })).linkTarget)
            .toEqual({ tick: 'ART', issueActionIndex: 2 });
        expect(newPendingFileUpload(input({ linkTarget: { tick: 'ART', issueActionIndex: '2' } })).linkTarget)
            .toEqual({ tick: 'ART', issueActionIndex: '2' });
    });
});

describe('funding record transition', () => {
    it('copies the funding result into a funding-stage record', () => {
        const record = newPendingFileUpload(input());
        const fundingOutputs = outputs();
        const funded = withFunding(record, { fundingTxid: 'e'.repeat(64), fundingOutputs });
        expect(funded).not.toBe(record);
        expect(funded.fundingTxid).toBe('e'.repeat(64));
        expect(funded.fundingOutputs).toEqual(fundingOutputs);
        expect(funded.fundingOutputs).not.toBe(fundingOutputs);
    });

    it.each([
        ['stage', () => withFunding({ ...newPendingFileUpload(input()), stage: 'sending' },
            { fundingTxid: 'e'.repeat(64), fundingOutputs: outputs() })],
        ['fundingTxid', () => withFunding(newPendingFileUpload(input()),
            { fundingTxid: 'bad', fundingOutputs: outputs() })],
        ['fundingOutputs', () => withFunding(newPendingFileUpload(input()),
            { fundingTxid: 'e'.repeat(64), fundingOutputs: outputs().slice(1) })],
        ['fundingOutputs[0].txid', () => withFunding(newPendingFileUpload(input()),
            { fundingTxid: 'f'.repeat(64), fundingOutputs: outputs() })],
    ])('rejects invalid %s', (field, action) => {
        expectCode(action, 'FILE_UPLOAD_FUNDING_INVALID', field);
    });

    it.each([
        ['vout', -1],
        ['value', 1.5],
        ['scriptPubKey', ''],
    ])('rejects an invalid output %s', (field, value) => {
        const fundingOutputs = outputs();
        fundingOutputs[0] = { ...fundingOutputs[0], [field]: value };
        expectCode(() => withFunding(newPendingFileUpload(input()), {
            fundingTxid: 'e'.repeat(64), fundingOutputs,
        }), 'FILE_UPLOAD_FUNDING_INVALID', `fundingOutputs[0].${field}`);
    });

    it('rejects a sparse output list', () => {
        expectCode(() => withFunding(newPendingFileUpload(input()), {
            fundingTxid: 'e'.repeat(64), fundingOutputs: Array(3),
        }), 'FILE_UPLOAD_FUNDING_INVALID', 'fundingOutputs[0]');
    });
});

describe('upload stage progression', () => {
    it('allows every forward move and both terminal outcomes', () => {
        const sending = advanceUploadStage(fundedRecord(), 'sending');
        const sent = { ...sending, pieces: sentRecord().pieces };
        const assembling = advanceUploadStage(sent, 'assembling');
        expect(advanceUploadStage(assembling, 'complete').stage).toBe('complete');
        expect(advanceUploadStage(assembling, 'mismatch').stage).toBe('mismatch');
    });

    it.each(['funding', 'sending', 'assembling', 'complete', 'mismatch'])
        ('returns an equal copy for the same %s stage', (stage) => {
            const record = { ...newPendingFileUpload(input()), stage };
            const result = advanceUploadStage(record, stage);
            expect(result).toEqual(record);
            expect(result).not.toBe(record);
        });

    it('requires funding and every part plus the manifest to be sent', () => {
        expectCode(() => advanceUploadStage(newPendingFileUpload(input()), 'sending'),
            'FILE_UPLOAD_STAGE_INVALID', 'funding -> sending');
        const sending = advanceUploadStage(fundedRecord(), 'sending');
        expectCode(() => advanceUploadStage(sending, 'assembling'),
            'FILE_UPLOAD_STAGE_INVALID', 'sending -> assembling');
        const missingManifest = { ...sentRecord(), pieces: sentRecord().pieces.slice(0, 2) };
        expectCode(() => advanceUploadStage(missingManifest, 'assembling'),
            'FILE_UPLOAD_STAGE_INVALID', 'sending -> assembling');
    });
});

const REFUSED_STAGE_MOVES = [
    ['funding', 'assembling'],
    ['funding', 'complete'],
    ['funding', 'mismatch'],
    ['sending', 'funding'],
    ['sending', 'complete'],
    ['sending', 'mismatch'],
    ['assembling', 'funding'],
    ['assembling', 'sending'],
    ['complete', 'funding'],
    ['complete', 'sending'],
    ['complete', 'assembling'],
    ['complete', 'mismatch'],
    ['mismatch', 'funding'],
    ['mismatch', 'sending'],
    ['mismatch', 'assembling'],
    ['mismatch', 'complete'],
    ['unknown', 'funding'],
    ['funding', 'unknown'],
];

describe('upload stage refusals', () => {
    it.each(REFUSED_STAGE_MOVES)('rejects %s to %s', (stage, next) => {
        const record = { ...newPendingFileUpload(input()), stage };
        expectCode(() => advanceUploadStage(record, next),
            'FILE_UPLOAD_STAGE_INVALID', `${stage} -> ${next}`);
    });
});

describe('multipart upload record input immutability', () => {
    it('does not mutate builder, funding, or stage inputs', () => {
        const builderInput = input({
            gate: { tick: 'ART' },
            linkTarget: { tick: 'ART', issueActionIndex: '4' },
        });
        const builderSnapshot = structuredClone(builderInput);
        const record = newPendingFileUpload(builderInput);
        const funding = { fundingTxid: 'e'.repeat(64), fundingOutputs: outputs() };
        const fundingSnapshot = structuredClone(funding);
        const funded = withFunding(record, funding);
        const recordSnapshot = structuredClone(funded);
        advanceUploadStage(funded, 'sending');
        expect(builderInput).toEqual(builderSnapshot);
        expect(funding).toEqual(fundingSnapshot);
        expect(funded).toEqual(recordSnapshot);
        expect(record.partDigests).not.toBe(builderInput.partDigests);
    });
});
