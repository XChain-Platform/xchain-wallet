// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash, randomBytes } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MULTIPART_FILE_MAX_BYTES } from '../../../packages/core/src/flows/fileSizeLimits.js';
import { clearGatedContentCaches, unlockGatedFile } from '../../../packages/core/src/flows/gatedContent.js';
import { resolveGatedInflate } from '../../../packages/core/src/flows/gatedInflateLimit.js';

const V0_ACTION = 'FILE|0|a.bin|application/octet-stream|T|M|||||1';
const V1_ACTION = 'FILE|1|hash|2|20|a.bin|application/octet-stream|T|M|GATE|1|key|1|1';
const KEY = Buffer.alloc(32, 7);
const KEY_HASH = createHash('sha256').update(KEY).digest('hex');
let nextActionIndex = 100;
let overCapFixture;

function largeFixture(size) {
    const original = Buffer.concat([randomBytes(90_000), Buffer.alloc(size - 90_000)]);
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
        sdk, address: `holder-${actionIndex}`, wif: 'wif', actionIndex, keyHash: KEY_HASH,
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
            declared: '1', options: { maxOutputBytes: MULTIPART_FILE_MAX_BYTES },
        });
        expect(getAction).toHaveBeenCalledTimes(1);
    });
});

describe('supplied deflate gated inflate resolution', () => {
    it('probes once for the version and keeps the supplied field', async () => {
        const getAction = vi.fn(async () => ({ data: { tx_data: V1_ACTION, COMPRESSION: '0' } }));
        const result = await resolveGatedInflate({ sdk: { getAction }, actionIndex: 6, declared: '1' });
        expect(result).toEqual({ declared: '1', options: { maxOutputBytes: MULTIPART_FILE_MAX_BYTES } });
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
            declared: '', options: { maxOutputBytes: MULTIPART_FILE_MAX_BYTES },
        });
        expect(getAction).toHaveBeenCalledTimes(1);
    });
});

describe('missing gated inflate probe', () => {
    it('fails closed and returns fresh objects', async () => {
        const first = await resolveGatedInflate({ sdk: {}, actionIndex: 9 });
        const second = await resolveGatedInflate({ sdk: {}, actionIndex: 9 });
        expect(first).toEqual({ declared: '', options: { maxOutputBytes: MULTIPART_FILE_MAX_BYTES } });
        expect(second).not.toBe(first);
        expect(second.options).not.toBe(first.options);
    });
});

describe('parsed-only gated inflate resolution', () => {
    it('reads parsed compression and fails closed with the cap', async () => {
        const getAction = vi.fn(async () => ({ data: { COMPRESSION: 1 } }));
        await expect(resolveGatedInflate({ sdk: { getAction }, actionIndex: 10 })).resolves.toEqual({
            declared: '1', options: { maxOutputBytes: MULTIPART_FILE_MAX_BYTES },
        });
        expect(getAction).toHaveBeenCalledTimes(1);
    });
});

describe('version 1 inflation at the multipart cap', () => {
    it('returns all 12,000,000 original bytes', async () => {
        const fixture = largeFixture(MULTIPART_FILE_MAX_BYTES);
        expect(fixture.original.length).toBeLessThanOrEqual(fixture.stored.length * 150);
        const { bytes, sdk } = await unlockFixture(fixture, V1_ACTION);
        expect(bytes.equals(fixture.original)).toBe(true);
        expect(bytes).toHaveLength(MULTIPART_FILE_MAX_BYTES);
        expect(sdk.getAction).toHaveBeenCalledTimes(1);
    });
});

describe('version 1 inflation beyond the multipart cap', () => {
    it('returns the stored stream unchanged', async () => {
        overCapFixture = overCapFixture || largeFixture(MULTIPART_FILE_MAX_BYTES + 1);
        expect(overCapFixture.original.length).toBeLessThanOrEqual(overCapFixture.stored.length * 150);
        const { bytes } = await unlockFixture(overCapFixture, V1_ACTION);
        expect(bytes.equals(overCapFixture.stored)).toBe(true);
        expect(bytes.equals(overCapFixture.original)).toBe(false);
    });
});

describe('version 0 inflation beyond the multipart cap', () => {
    it('retains the ratio-only ceiling', async () => {
        overCapFixture = overCapFixture || largeFixture(MULTIPART_FILE_MAX_BYTES + 1);
        const { bytes } = await unlockFixture(overCapFixture, V0_ACTION);
        expect(bytes.equals(overCapFixture.original)).toBe(true);
        expect(bytes).toHaveLength(MULTIPART_FILE_MAX_BYTES + 1);
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
