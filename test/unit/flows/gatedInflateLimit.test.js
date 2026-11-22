// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash, randomBytes } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GATED_MULTIPART_MAX_BYTES } from '../../../packages/core/src/flows/fileSizeLimits.js';
import {
    clearGatedContentCaches, unlockGatedFile, unlockGatedFileWithStatus,
} from '../../../packages/core/src/flows/gatedContent.js';
import { composeGatedManifestBatch } from '../../../packages/core/src/flows/gatedMultipartBatch.js';
import { resolveGatedInflate } from '../../../packages/core/src/flows/gatedInflateLimit.js';

const V0_ACTION = 'FILE|0|a.bin|application/octet-stream|T|M|||||1';
const V1_ACTION = 'FILE|1|hash|2|20|a.bin|application/octet-stream|T|M|GATE|1|key|1|1';
const KEY = Buffer.alloc(32, 7);
const KEY_HASH = createHash('sha256').update(KEY).digest('hex');
let nextActionIndex = 100;
let overCapFixture;

function largeFixture(size) {
    const entropyBytes = Math.ceil(size / 140);
    const original = Buffer.concat([randomBytes(entropyBytes), Buffer.alloc(size - entropyBytes)]);
    return { original, stored: deflateRawSync(original) };
}

function sdkFor(stored, actionString) {
    return {
        getAction: vi.fn(async () => ({ data: { tx_data: actionString } })),
        getGatedFileRaw: vi.fn(async () => stored),
        getMessagesForAddress: vi.fn(async () => [{ bytes: KEY }]),
        gatedFile: {
            parseKeyPayload: vi.fn(() => [KEY]),
            decryptFileBytes: vi.fn(() => stored),
        },
    };
}

async function unlockFixture(fixture, actionString) {
    const sdk = sdkFor(fixture.stored, actionString);
    const actionIndex = String(nextActionIndex++);
    const bytes = await unlockGatedFile({
        sdk, address: `holder-${actionIndex}`, wif: 'wif', chainId: 'btc-regtest', actionIndex, keyHash: KEY_HASH,
    });
    return { bytes: Buffer.from(bytes), sdk };
}

beforeEach(() => clearGatedContentCaches());

describe('version 0 gated inflate resolution', () => {
    it('keeps the action field and ratio-only options', async () => {
        const getAction = vi.fn(async () => ({ data: { action_string: V0_ACTION } }));
        await expect(resolveGatedInflate({ sdk: { getAction }, actionIndex: 4 })).resolves.toEqual({
            declared: '1', options: {},
        });
        expect(getAction).toHaveBeenCalledWith('4');
    });
});

describe('version 1 gated inflate resolution', () => {
    it('keeps the manifest field and applies the multipart cap', async () => {
        const getAction = vi.fn(async () => ({ tx_data: V1_ACTION }));
        await expect(resolveGatedInflate({ sdk: { getAction }, actionIndex: 5 })).resolves.toEqual({
            declared: '1', options: { maxOutputBytes: GATED_MULTIPART_MAX_BYTES },
        });
        expect(getAction).toHaveBeenCalledTimes(1);
    });
});

describe('supplied deflate gated inflate resolution', () => {
    it('probes once for the version and keeps the supplied field', async () => {
        const getAction = vi.fn(async () => ({ data: { tx_data: V1_ACTION, COMPRESSION: '0' } }));
        const result = await resolveGatedInflate({ sdk: { getAction }, actionIndex: 6, declared: '1' });
        expect(result).toEqual({ declared: '1', options: { maxOutputBytes: GATED_MULTIPART_MAX_BYTES } });
        expect(getAction).toHaveBeenCalledTimes(1);
    });
});

describe('supplied raw gated inflate resolution', () => {
    it('does not probe when no inflation can occur', async () => {
        const getAction = vi.fn(async () => ({ tx_data: V1_ACTION }));
        await expect(resolveGatedInflate({ sdk: { getAction }, actionIndex: 7, declared: '0' }))
            .resolves.toEqual({ declared: '0', options: {} });
        expect(getAction).not.toHaveBeenCalled();
    });
});

describe('throwing gated inflate probe', () => {
    it('fails closed with the multipart cap', async () => {
        const getAction = vi.fn(async () => { throw new Error('offline'); });
        await expect(resolveGatedInflate({ sdk: { getAction }, actionIndex: 8 })).resolves.toEqual({
            declared: '', options: { maxOutputBytes: GATED_MULTIPART_MAX_BYTES },
        });
        expect(getAction).toHaveBeenCalledTimes(1);
    });
});

describe('missing gated inflate probe', () => {
    it('fails closed and returns fresh objects', async () => {
        const first = await resolveGatedInflate({ sdk: {}, actionIndex: 9 });
        const second = await resolveGatedInflate({ sdk: {}, actionIndex: 9 });
        expect(first).toEqual({ declared: '', options: { maxOutputBytes: GATED_MULTIPART_MAX_BYTES } });
        expect(second).not.toBe(first);
        expect(second.options).not.toBe(first.options);
    });
});

describe('parsed-only gated inflate resolution', () => {
    it('reads parsed compression and fails closed with the cap', async () => {
        const getAction = vi.fn(async () => ({ data: { COMPRESSION: 1 } }));
        await expect(resolveGatedInflate({ sdk: { getAction }, actionIndex: 10 })).resolves.toEqual({
            declared: '1', options: { maxOutputBytes: GATED_MULTIPART_MAX_BYTES },
        });
        expect(getAction).toHaveBeenCalledTimes(1);
    });
});

describe('version 1 inflation at the multipart cap', () => {
    it('returns all gated-bound original bytes', async () => {
        const fixture = largeFixture(GATED_MULTIPART_MAX_BYTES);
        expect(fixture.original.length).toBeLessThanOrEqual(fixture.stored.length * 150);
        const { bytes, sdk } = await unlockFixture(fixture, V1_ACTION);
        expect(bytes.equals(fixture.original)).toBe(true);
        expect(bytes).toHaveLength(GATED_MULTIPART_MAX_BYTES);
        expect(sdk.getAction).toHaveBeenCalledTimes(1);
    });
});

describe('version 1 inflation beyond the multipart cap', () => {
    it('returns the stored stream unchanged', async () => {
        overCapFixture = overCapFixture || largeFixture(GATED_MULTIPART_MAX_BYTES + 1);
        expect(overCapFixture.original.length).toBeLessThanOrEqual(overCapFixture.stored.length * 150);
        const { bytes } = await unlockFixture(overCapFixture, V1_ACTION);
        expect(bytes.equals(overCapFixture.stored)).toBe(true);
        expect(bytes.equals(overCapFixture.original)).toBe(false);
    });
});

describe('version 0 inflation beyond the multipart cap', () => {
    it('retains the ratio-only ceiling', async () => {
        overCapFixture = overCapFixture || largeFixture(GATED_MULTIPART_MAX_BYTES + 1);
        const { bytes } = await unlockFixture(overCapFixture, V0_ACTION);
        expect(bytes.equals(overCapFixture.original)).toBe(true);
        expect(bytes).toHaveLength(GATED_MULTIPART_MAX_BYTES + 1);
    });
});

describe('small version 1 inflation', () => {
    it('returns all 2,000 original bytes unchanged', async () => {
        const original = randomBytes(2_000);
        const fixture = { original, stored: deflateRawSync(original) };
        const { bytes } = await unlockFixture(fixture, V1_ACTION);
        expect(bytes.equals(original)).toBe(true);
        expect(bytes).toHaveLength(2_000);
    });
});

const BATCH_V0_ACTION = `BATCH|0|${V0_ACTION};MESSAGE|2|BTC|addr|ct`;

function batchV1Action() {
    const batch = composeGatedManifestBatch({
        manifest: {
            FILE_HASH: 'a'.repeat(64), TOTAL_PARTS: '2', TOTAL_BYTES: '20',
            NAME: 'a.bin', TYPE: 'application/octet-stream', TITLE: 'T', MEMO: 'M',
            GATE_TICKER: 'GATE', KEY_HASH: KEY_HASH, COMPRESSION: '1',
        },
        keyHandoffCiphertext: 'ct', coin: 'BTC', sourceAddress: 'addr',
    });
    return `${batch.action}|${batch.params.VERSION}|${batch.params.COMMAND}`;
}

describe('BATCH-wrapped gated inflate resolution', () => {
    it('reads a version 0 FILE leg with ratio-only options', async () => {
        const getAction = vi.fn(async () => ({ data: { tx_data: BATCH_V0_ACTION } }));
        await expect(resolveGatedInflate({ sdk: { getAction }, actionIndex: 12 })).resolves.toEqual({
            declared: '1', options: {},
        });
    });

    it('reads the published manifest leg with the multipart cap', async () => {
        const getAction = vi.fn(async () => ({ data: { tx_data: batchV1Action() } }));
        await expect(resolveGatedInflate({ sdk: { getAction }, actionIndex: 13 })).resolves.toEqual({
            declared: '1', options: { maxOutputBytes: GATED_MULTIPART_MAX_BYTES },
        });
    });
});

describe('BATCH-published gated unlock', () => {
    it('inflates the decrypted bytes of a FILE published inside a BATCH', async () => {
        const original = Buffer.from('gated original bytes '.repeat(12));
        const fixture = { original, stored: deflateRawSync(original) };
        expect(fixture.stored.length).toBeLessThan(original.length);
        const { bytes } = await unlockFixture(fixture, BATCH_V0_ACTION);
        expect(bytes.equals(original)).toBe(true);
    });
});

async function unlockWithStatus(sdk, actionIndex) {
    return unlockGatedFileWithStatus({
        sdk, address: 'holder-status', wif: 'wif', chainId: 'btc-regtest', actionIndex, keyHash: KEY_HASH,
    });
}

describe('gated unlock stored-form status', () => {
    it('reports an invalid stream as stored form with its error, on a cache hit too', async () => {
        const junk = Buffer.from('not a deflate stream at all');
        const sdk = sdkFor(junk, V1_ACTION);
        const first = await unlockWithStatus(sdk, '300');
        expect(first.storedForm).toBe(true);
        expect(first.inflateError).toBe('INVALID_DEFLATE_STREAM');
        expect(Buffer.from(first.plaintext).equals(junk)).toBe(true);
        const second = await unlockWithStatus(sdk, '300');
        expect(sdk.gatedFile.decryptFileBytes).toHaveBeenCalledTimes(1);
        expect(second.storedForm).toBe(true);
        expect(second.inflateError).toBe('INVALID_DEFLATE_STREAM');
    });

    it('reports a valid stream and an uncompressed file as recovered content', async () => {
        const original = Buffer.from('recovered content '.repeat(10));
        const inflated = await unlockWithStatus(sdkFor(deflateRawSync(original), V1_ACTION), '301');
        expect(inflated).toMatchObject({ storedForm: false, inflateError: null });
        expect(Buffer.from(inflated.plaintext).equals(original)).toBe(true);
        const raw = await unlockWithStatus(sdkFor(original, V1_ACTION.replace(/\|1$/, '|0')), '302');
        expect(raw).toMatchObject({ storedForm: false, inflateError: null });
        expect(Buffer.from(raw.plaintext).equals(original)).toBe(true);
    });
});
