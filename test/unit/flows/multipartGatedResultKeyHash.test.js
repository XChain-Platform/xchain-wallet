// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    handleFileMultipart,
    handleListPendingFileUploads,
} from '../../../packages/core/src/flows/fileMultipartRoutes.js';
import { multipartPublishResult } from '../../../packages/core/src/flows/multipartPublishResult.js';

const KEY_HASH = 'ab'.repeat(32);
const KEY_BYTES = 'cd'.repeat(32);
const TXID = 'ef'.repeat(32);
const REQUEST = {
    walletId: 'wallet-1', chainId: 'btc:regtest', sourceAddress: 'bcrt1source',
    bytes: Uint8Array.of(1),
};

function record(gate) {
    return {
        id: 'upload-1', chainId: 'btc:regtest', sourceAddress: 'bcrt1source',
        originalSha256: '1'.repeat(64), meta: { name: 'secret.bin' }, gate,
        pieces: [], fundingTxid: null, totalParts: 2, stage: 'complete', linkTarget: null,
        createdAt: '2026-11-16T08:00:00.000Z',
    };
}

function routeDeps(flowRecord, listed = []) {
    return {
        publishMultipartFile: vi.fn(async () => ({ record: flowRecord, fileId: '42' })),
        vault: { pendingFileUploads: { listForWallet: vi.fn(async () => listed) } },
        sdkRegistry: { get: vi.fn(() => ({ waitForAction: vi.fn() })) },
        chainRegistry: {}, signer: {}, onBroadcastFailure: vi.fn(),
    };
}

function publishReply(upload) {
    return {
        fileId: '42', txid: TXID,
        multipart: { status: 'complete', total_parts: 2, total_bytes: 300 },
        upload,
    };
}

describe('gated multipart route result key hash', () => {
    it('returns the public key hash without the gate or key bytes', async () => {
        const gate = { ticker: 'ART', keyHash: KEY_HASH, key: KEY_BYTES };
        const result = await handleFileMultipart(REQUEST, routeDeps(record(gate)));
        expect(result.upload).toMatchObject({ gated: true, keyHash: KEY_HASH });
        const json = JSON.stringify(result);
        expect(json).not.toContain('"gate"');
        expect(json).not.toContain(KEY_BYTES);
    });
});

describe('ungated multipart route result key hash', () => {
    it('returns null', async () => {
        const result = await handleFileMultipart(REQUEST, routeDeps(record(null)));
        expect(result.upload.keyHash).toBeNull();
    });
});

describe('pending multipart list key hash', () => {
    it('does not add the key hash field to list entries', async () => {
        const upload = record({ keyHash: KEY_HASH, key: KEY_BYTES });
        const deps = routeDeps(upload, [upload]);
        const result = await handleListPendingFileUploads({ walletId: 'wallet-1' }, deps);
        expect(result.uploads[0]).not.toHaveProperty('keyHash');
    });
});

describe('multipart publish result gated key hash', () => {
    it('returns a valid lowercase hash for a gated upload', () => {
        const result = multipartPublishResult(
            publishReply({ gated: true, keyHash: KEY_HASH }), { originalBytes: 300 },
        );
        expect(result.keyHash).toBe(KEY_HASH);
    });
});

describe('multipart publish result absent or invalid key hash', () => {
    it.each([
        ['ungated', { gated: false, keyHash: KEY_HASH }],
        ['missing', { gated: true }],
        ['upper-case', { gated: true, keyHash: KEY_HASH.toUpperCase() }],
        ['63 characters', { gated: true, keyHash: 'a'.repeat(63) }],
    ])('returns null when the hash is %s', (_label, upload) => {
        const result = multipartPublishResult(publishReply(upload), { originalBytes: 300 });
        expect(result.keyHash).toBeNull();
    });
});
