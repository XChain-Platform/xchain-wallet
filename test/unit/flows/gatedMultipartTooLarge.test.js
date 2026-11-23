// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearGatedContentCaches, unlockGatedFile } from '../../../packages/core/src/flows/gatedContent.js';
import { chooseFileUploadPath } from '../../../packages/core/src/flows/fileUploadPath.js';
import { multipartFieldReasons } from '../../../packages/core/src/flows/multipartFieldReasons.js';
import { planMultipartFile } from '../../../packages/core/src/flows/multipartFilePlan.js';

const GATED_MAX_BYTES = 67_108_864;
const SUPPORT = Object.freeze({
    supported: true, lane: 'envelope', buildMode: 'one_call',
});
const KEY = Buffer.alloc(32, 7);
const KEY_HASH = createHash('sha256').update(KEY).digest('hex');

class LengthStub extends Uint8Array {
    get byteLength() { return GATED_MAX_BYTES + 1; }
}

function preview(reason) {
    return {
        quotes: { taproot: null, standard: null },
        reasons: { taproot: reason, standard: null },
    };
}

beforeEach(() => clearGatedContentCaches());

describe('gated multipart original bound', () => {
    it('refuses the first byte above the bound without allocating it', async () => {
        const bytes = new LengthStub(1);
        expect(chooseFileUploadPath({
            byteLength: bytes.byteLength,
            singleTransactionCap: 300_000,
            support: SUPPORT,
            gated: true,
        })).toEqual({
            path: 'refused', reason: 'too_large', maxBytes: GATED_MAX_BYTES,
        });
        expect(chooseFileUploadPath({
            byteLength: bytes.byteLength,
            singleTransactionCap: 300_000,
            support: SUPPORT,
        })).toMatchObject({ path: 'multipart', maxBytes: 262_140_000_000 });

        const fields = multipartFieldReasons(preview('GATED_BYTES_TOO_LARGE'));
        expect(fields.reasons.taproot).toBe('tooLarge');
        expect(fields.caps.taproot).toBe(GATED_MAX_BYTES);

        await expect(planMultipartFile(bytes, {}, { gate: { ticker: 'GATE' } }))
            .rejects.toMatchObject({
                name: 'RangeError', code: 'GATED_BYTES_TOO_LARGE',
                originalBytes: GATED_MAX_BYTES + 1, maxBytes: GATED_MAX_BYTES,
            });
        await expect(planMultipartFile(bytes)).resolves.toMatchObject({ totalBytes: 1 });
    });
});

describe('gated multipart unlock bound', () => {
    it('refuses stored bytes above the original bound plus GCM overhead before raw fetch', async () => {
        const sdk = {
            getAction: vi.fn(async () => ({ data: [{ multipart: {
                total_bytes: GATED_MAX_BYTES + 29,
            } }] })),
            getGatedFileRaw: vi.fn(),
            getMessagesForAddress: vi.fn(async () => [{ bytes: KEY }]),
            gatedFile: {
                parseKeyPayload: vi.fn(() => [KEY]),
                decryptFileBytes: vi.fn(),
            },
        };
        await expect(unlockGatedFile({
            sdk, address: 'holder', wif: 'wif', chainId: 'btc-regtest', actionIndex: '42', keyHash: KEY_HASH,
        })).rejects.toMatchObject({
            code: 'GATED_FILE_TOO_LARGE',
            totalBytes: GATED_MAX_BYTES + 29,
            maxBytes: GATED_MAX_BYTES + 28,
        });
        expect(sdk.getAction).toHaveBeenCalledWith('42');
        expect(sdk.getGatedFileRaw).not.toHaveBeenCalled();
        expect(sdk.gatedFile.decryptFileBytes).not.toHaveBeenCalled();
    });
});
