// @vitest-environment node
// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { handleFileMultipart } from '../../../packages/core/src/flows/fileMultipartRoutes.js';
import { createGatedKey } from '../../../packages/core/src/schemas/gatedKey.js';

const require = createRequire(import.meta.url);
const { XChainSDK } = require('xchain-sdk');
const BASE = {
    walletId: 'wallet-1', chainId: 'bitcoin-regtest', sourceAddress: 'bcrt1source',
    bytes: Uint8Array.of(1, 2, 3),
};

function storedKey(sdk, gateTicker = 'GATE') {
    const generated = sdk.gatedFile.generateKey();
    const record = createGatedKey({
        walletId: BASE.walletId,
        chainId: BASE.chainId,
        gateTicker,
        keyHash: generated.keyHash,
        keyHex: Buffer.from(generated.key).toString('hex'),
        source: 'published',
    });
    return { key: Buffer.from(generated.key), record };
}

function harness({ gatedRecord, pendingRecord, result } = {}) {
    const events = [];
    const sdk = new XChainSDK({ network: 'bitcoin-regtest', preflight: false });
    const gatedKeys = {
        get: vi.fn(async () => gatedRecord),
        put: vi.fn(async () => { events.push('put'); }),
    };
    const pendingFileUploads = { get: vi.fn(async () => pendingRecord) };
    const publishMultipartFile = vi.fn(async () => {
        events.push('publish');
        return result ?? { fileId: '42' };
    });
    return {
        deps: {
            publishMultipartFile,
            vault: { gatedKeys, pendingFileUploads },
            sdkRegistry: { get: vi.fn(() => sdk) },
            chainRegistry: {},
            signer: {},
        },
        events,
        gatedKeys,
        pendingFileUploads,
        publishMultipartFile,
        sdk,
    };
}

function forwarded(harnessResult) {
    return harnessResult.publishMultipartFile.mock.calls[0][0];
}

function uploadRecord(gate) {
    return {
        id: 'upload-1', chainId: BASE.chainId, sourceAddress: BASE.sourceAddress,
        originalSha256: 'a'.repeat(64), meta: { name: 'secret.bin' }, gate,
        pieces: [], fundingTxid: null, totalParts: 2, stage: 'funding', linkTarget: null,
        createdAt: '2026-11-15T08:00:00.000Z',
    };
}

describe('fresh gated multipart key generation', () => {
    it('stores the generated key before publishing without mutating input', async () => {
        const h = harness();
        const gate = Object.freeze({ ticker: 'GATE', minAmount: '5' });
        const request = Object.freeze({ ...BASE, gate });
        await handleFileMultipart(request, h.deps);
        const published = forwarded(h);
        const keyHash = createHash('sha256').update(published.gate.key).digest('hex');

        expect(published.gate).toMatchObject({ ticker: 'GATE', minAmount: '5' });
        expect(published.gate.key).toBeInstanceOf(Uint8Array);
        expect(published.gate.key).toHaveLength(32);
        expect(h.gatedKeys.put).toHaveBeenCalledOnce();
        expect(h.gatedKeys.put.mock.calls[0][0]).toMatchObject({ keyHash });
        expect(h.events).toEqual(['put', 'publish']);
        expect(request).toEqual({ ...BASE, gate: { ticker: 'GATE', minAmount: '5' } });
        expect(published).not.toHaveProperty('existingKeyHash');
    });
});

describe('stored multipart key reuse', () => {
    it('resolves existingKeyHash without writing a new key', async () => {
        const h = harness();
        const stored = storedKey(h.sdk);
        h.gatedKeys.get.mockResolvedValue(stored.record);
        const request = {
            ...BASE, gate: { ticker: 'GATE', minAmount: '7' },
            existingKeyHash: stored.record.keyHash,
        };

        await handleFileMultipart(request, h.deps);

        expect(forwarded(h).gate.key).toEqual(stored.key);
        expect(h.gatedKeys.get).toHaveBeenCalledWith(stored.record.id);
        expect(h.gatedKeys.put).not.toHaveBeenCalled();
        expect(forwarded(h)).not.toHaveProperty('existingKeyHash');
        expect(request).toHaveProperty('existingKeyHash', stored.record.keyHash);
    });
});

describe('gated multipart resume key resolution', () => {
    it('uses the saved gate hash and public fields', async () => {
        const h = harness();
        const stored = storedKey(h.sdk, 'SAVED');
        const savedGate = { ticker: 'SAVED', minAmount: '9', keyHash: stored.record.keyHash };
        h.gatedKeys.get.mockResolvedValue(stored.record);
        h.pendingFileUploads.get.mockResolvedValue(uploadRecord(savedGate));
        const request = Object.freeze({
            ...BASE, resumeId: 'upload-1',
            gate: Object.freeze({ ticker: 'FORM', minAmount: '1' }),
            existingKeyHash: 'f'.repeat(64),
        });

        await handleFileMultipart(request, h.deps);

        expect(h.pendingFileUploads.get).toHaveBeenCalledWith('upload-1');
        expect(h.gatedKeys.get).toHaveBeenCalledWith(stored.record.id);
        expect(forwarded(h).gate).toEqual({ ticker: 'SAVED', minAmount: '9', key: stored.key });
        expect(h.gatedKeys.put).not.toHaveBeenCalled();
        expect(request.existingKeyHash).toBe('f'.repeat(64));
    });
});

describe('request-supplied multipart key refusals', () => {
    it.each([
        ['key', Uint8Array.of(1)],
        ['keyHex', '00'.repeat(32)],
    ])('refuses gate.%s before vault or SDK key work', async (field, value) => {
        const h = harness();
        const generateKey = vi.spyOn(h.sdk.gatedFile, 'generateKey');
        const request = { ...BASE, gate: { ticker: 'GATE', minAmount: '1', [field]: value } };

        await expect(handleFileMultipart(request, h.deps)).rejects.toMatchObject({
            code: 'FILE_MULTIPART_KEY_IN_REQUEST',
        });
        expect(h.pendingFileUploads.get).not.toHaveBeenCalled();
        expect(h.gatedKeys.get).not.toHaveBeenCalled();
        expect(h.gatedKeys.put).not.toHaveBeenCalled();
        expect(h.deps.sdkRegistry.get).not.toHaveBeenCalled();
        expect(generateKey).not.toHaveBeenCalled();
        expect(h.publishMultipartFile).not.toHaveBeenCalled();
    });
});

describe('gated multipart resume refusals', () => {
    it.each([
        ['FILE_UPLOAD_NOT_FOUND', undefined],
        ['GATED_RESUME_GATE_MISSING', uploadRecord(null)],
    ])('refuses %s before key resolution or publishing', async (code, pendingRecord) => {
        const h = harness({ pendingRecord });
        const request = {
            ...BASE, resumeId: 'upload-1', gate: { ticker: 'GATE', minAmount: '1' },
        };

        await expect(handleFileMultipart(request, h.deps)).rejects.toMatchObject({ code });
        expect(h.pendingFileUploads.get).toHaveBeenCalledOnce();
        expect(h.gatedKeys.get).not.toHaveBeenCalled();
        expect(h.gatedKeys.put).not.toHaveBeenCalled();
        expect(h.publishMultipartFile).not.toHaveBeenCalled();
    });
});

describe('ungated multipart request ownership', () => {
    it('publishes an equal fresh request without touching gated vault or SDK methods', async () => {
        const h = harness();
        const generateKey = vi.spyOn(h.sdk.gatedFile, 'generateKey');
        const request = Object.freeze({ ...BASE, meta: Object.freeze({ name: 'public.bin' }) });

        await handleFileMultipart(request, h.deps);

        expect(forwarded(h)).toMatchObject(request);
        expect(forwarded(h)).not.toBe(request);
        expect(h.pendingFileUploads.get).not.toHaveBeenCalled();
        expect(h.gatedKeys.get).not.toHaveBeenCalled();
        expect(h.gatedKeys.put).not.toHaveBeenCalled();
        expect(generateKey).not.toHaveBeenCalled();
        expect(request).toEqual({ ...BASE, meta: { name: 'public.bin' } });
    });
});

describe('gated multipart reply secrecy', () => {
    it('projects a publisher record without key bytes or keyHex', async () => {
        const keyHex = '9f'.repeat(32);
        const h = harness({
            result: {
                fileId: '42',
                record: uploadRecord({ ticker: 'GATE', key: Buffer.from(keyHex, 'hex'), keyHex }),
            },
        });

        const reply = await handleFileMultipart(
            { ...BASE, gate: { ticker: 'GATE', minAmount: '1' } },
            h.deps,
        );

        expect(reply.upload).toMatchObject({ id: 'upload-1', gated: true });
        expect(reply).not.toHaveProperty('record');
        expect(JSON.stringify(reply)).not.toContain(keyHex);
        expect(JSON.stringify(reply)).not.toContain('keyHex');
    });
});
