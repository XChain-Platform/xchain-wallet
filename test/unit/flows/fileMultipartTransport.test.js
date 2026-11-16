// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { handleFileMultipart } from '../../../packages/core/src/flows/fileMultipartRoutes.js';
import { bytesFromLatin1 } from '../../../packages/core/src/flows/latin1Bytes.js';

const KEY_HEX = '9f'.repeat(32);
const BASE_REQUEST = {
    walletId: 'wallet-1', chainId: 'btc:regtest', sourceAddress: 'bcrt1source',
};

function depsReturning(result = { fileId: '42' }) {
    const publishMultipartFile = vi.fn(async () => result);
    return {
        publishMultipartFile,
        vault: {},
        sdkRegistry: { get: vi.fn(() => ({ waitForAction: vi.fn() })) },
        chainRegistry: {},
        signer: {},
        onBroadcastFailure: vi.fn(),
    };
}

function uploadRecord() {
    return {
        id: 'upload-1', chainId: 'btc:regtest', sourceAddress: 'bcrt1source',
        originalSha256: 'a'.repeat(64), meta: { name: 'secret.bin' },
        gate: { key: KEY_HEX }, pieces: [{ index: 0, txid: 'part-0' }],
        fundingTxid: 'funding', totalParts: 1, stage: 'sending', linkTarget: null,
        createdAt: '2026-11-15T08:00:00.000Z',
    };
}

describe('Latin-1 byte decoding', () => {
    it('round-trips every byte value into a new Uint8Array', () => {
        const expected = Uint8Array.from({ length: 256 }, (_unused, index) => index);
        const rawData = Buffer.from(expected).toString('latin1');
        const actual = bytesFromLatin1(rawData);
        expect(actual).toEqual(expected);
        expect(actual).toBeInstanceOf(Uint8Array);
        expect(actual).not.toBe(expected);
    });
});

describe('JSON Latin-1 multipart transport', () => {
    it('delivers a 400,000-byte random payload byte-identically to the flow', async () => {
        const expected = new Uint8Array(randomBytes(400_000));
        const request = JSON.parse(JSON.stringify({
            ...BASE_REQUEST, rawData: Buffer.from(expected).toString('latin1'),
        }));
        const deps = depsReturning();
        await handleFileMultipart(request, deps);
        const forwarded = deps.publishMultipartFile.mock.calls[0][0];
        expect(forwarded.bytes).toEqual(expected);
        expect(forwarded.bytes).toBeInstanceOf(Uint8Array);
        expect(forwarded).not.toHaveProperty('rawData');
    });
});

describe('Uint8Array multipart transport', () => {
    it('forwards the existing byte array unchanged', async () => {
        const bytes = new Uint8Array([0, 127, 128, 255]);
        const deps = depsReturning();
        await handleFileMultipart({ ...BASE_REQUEST, bytes }, deps);
        expect(deps.publishMultipartFile.mock.calls[0][0].bytes).toBe(bytes);
    });
});

describe('multipart byte transport refusals', () => {
    it.each([
        ['a non-string', 42],
        ['an empty string', ''],
        ['a character above byte range', '\u0100'],
    ])('rejects %s before calling the flow', async (_label, rawData) => {
        const deps = depsReturning();
        await expect(handleFileMultipart({ ...BASE_REQUEST, rawData }, deps))
            .rejects.toMatchObject({ code: 'FILE_RAW_DATA_INVALID' });
        expect(deps.publishMultipartFile).not.toHaveBeenCalled();
    });

    it('rejects bytes together with rawData before calling the flow', async () => {
        const deps = depsReturning();
        const request = { ...BASE_REQUEST, bytes: new Uint8Array([1]), rawData: '\x01' };
        await expect(handleFileMultipart(request, deps))
            .rejects.toMatchObject({ code: 'FILE_BYTES_AMBIGUOUS' });
        expect(deps.publishMultipartFile).not.toHaveBeenCalled();
    });
});

describe('multipart response projection', () => {
    it('replaces a gated record with its safe upload summary', async () => {
        const record = uploadRecord();
        const deps = depsReturning({ record, pendingFileUploadId: record.id, fileId: '42' });
        const result = await handleFileMultipart({ ...BASE_REQUEST, bytes: Uint8Array.of(1) }, deps);
        expect(result).toMatchObject({
            pendingFileUploadId: 'upload-1', fileId: '42',
            upload: { id: 'upload-1', name: 'secret.bin', gated: true, partsSent: 1 },
        });
        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain('"gate"');
        expect(serialized).not.toContain(KEY_HEX);
    });
});

describe('multipart response passthrough', () => {
    it('returns a result without a record unchanged', async () => {
        const flowResult = { pendingFileUploadId: 'upload-1', fileId: '42' };
        const deps = depsReturning(flowResult);
        const result = await handleFileMultipart({ ...BASE_REQUEST, bytes: Uint8Array.of(1) }, deps);
        expect(result).toBe(flowResult);
    });
});
