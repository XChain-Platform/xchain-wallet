// @vitest-environment node
// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

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

function savedKey(sdk, gateTicker = 'SAVED') {
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

function harness({ status, pendingRecord, gateMinAmountHeights } = {}) {
    const sdk = new XChainSDK({ network: 'bitcoin-regtest', preflight: false });
    const getStatus = vi.spyOn(sdk, 'getStatus').mockImplementation(async () => {
        if (status instanceof Error) throw status;
        return status ?? { last_block: { RBTC: 100 } };
    });
    const gatedKeys = {
        get: vi.fn(async () => undefined),
        put: vi.fn(async () => undefined),
    };
    const pendingFileUploads = { get: vi.fn(async () => pendingRecord) };
    const publishMultipartFile = vi.fn(async () => ({ fileId: '42' }));
    return {
        deps: {
            publishMultipartFile,
            vault: { gatedKeys, pendingFileUploads },
            sdkRegistry: { get: vi.fn(() => sdk) },
            chainRegistry: {}, signer: {}, gateMinAmountHeights,
        },
        gatedKeys, getStatus, pendingFileUploads, publishMultipartFile, sdk,
    };
}

function forwarded(h) {
    return h.publishMultipartFile.mock.calls[0][0];
}

function expectStopped(h) {
    expect(h.gatedKeys.put).not.toHaveBeenCalled();
    expect(h.publishMultipartFile).not.toHaveBeenCalled();
}

describe('fresh multipart gate ticker normalization', () => {
    it('trims and upper-cases the forwarded and stored ticker', async () => {
        const h = harness();
        await handleFileMultipart({ ...BASE, gate: { ticker: '  gate  ', minAmount: '' } }, h.deps);
        expect(forwarded(h).gate.ticker).toBe('GATE');
        expect(h.gatedKeys.put.mock.calls[0][0].gateTicker).toBe('GATE');
        expect(h.getStatus).not.toHaveBeenCalled();
    });

    it('refuses an empty ticker before key storage or publishing', async () => {
        const h = harness();
        await expect(handleFileMultipart(
            { ...BASE, gate: { ticker: '   ', minAmount: '' } }, h.deps,
        )).rejects.toMatchObject({
            code: 'GATED_TICKER_INVALID', message: 'Gate ticker is required.',
        });
        expectStopped(h);
        expect(h.getStatus).not.toHaveBeenCalled();
    });
});

describe('active multipart gate threshold', () => {
    it('forwards a valid threshold at an active watermark', async () => {
        const h = harness({ gateMinAmountHeights: { 'bitcoin-regtest': 0 } });
        await handleFileMultipart({ ...BASE, gate: { ticker: 'GATE', minAmount: '1.25' } }, h.deps);
        expect(forwarded(h).gate.minAmount).toBe('1.25');
        expect(h.getStatus).toHaveBeenCalledOnce();
        expect(h.gatedKeys.put).toHaveBeenCalledOnce();
    });
});

describe('inactive multipart gate threshold', () => {
    it.each([
        ['the default unscheduled map', undefined, { last_block: { RBTC: 100 } }, false],
        ['a watermark below activation', { 'bitcoin-regtest': 101 }, { last_block: { RBTC: 100 } }, true],
        ['a failed status read', { 'bitcoin-regtest': 0 }, new Error('offline'), true],
    ])('refuses %s before key storage or publishing', async (_label, heights, status, readsStatus) => {
        const h = harness({ gateMinAmountHeights: heights, status });
        await expect(handleFileMultipart(
            { ...BASE, gate: { ticker: 'GATE', minAmount: '2' } }, h.deps,
        )).rejects.toMatchObject({
            code: 'GATE_MIN_AMOUNT_NOT_ACTIVE',
            message: 'Unlock thresholds are not active on this chain yet.',
        });
        expect(h.getStatus).toHaveBeenCalledTimes(readsStatus ? 1 : 0);
        expectStopped(h);
    });
});

describe('invalid multipart gate threshold', () => {
    it('uses the shared validation sentence without reading status', async () => {
        const h = harness({ gateMinAmountHeights: { 'bitcoin-regtest': 0 } });
        await expect(handleFileMultipart(
            { ...BASE, gate: { ticker: 'GATE', minAmount: '1..2' } }, h.deps,
        )).rejects.toMatchObject({
            code: 'GATE_MIN_AMOUNT_INVALID',
            message: 'Unlock threshold must be a positive decimal amount.',
        });
        expect(h.getStatus).not.toHaveBeenCalled();
        expectStopped(h);
    });
});

describe('empty multipart gate threshold', () => {
    it('forwards an empty string without reading status', async () => {
        const h = harness();
        await handleFileMultipart({ ...BASE, gate: { ticker: 'GATE', minAmount: '  ' } }, h.deps);
        expect(forwarded(h).gate.minAmount).toBe('');
        expect(h.getStatus).not.toHaveBeenCalled();
    });
});

describe('resumed multipart gate threshold', () => {
    it('keeps the saved gate without validation or a status read', async () => {
        const h = harness();
        const stored = savedKey(h.sdk);
        h.gatedKeys.get.mockResolvedValue(stored.record);
        h.pendingFileUploads.get.mockResolvedValue({
            gate: { ticker: 'SAVED', minAmount: '9', keyHash: stored.record.keyHash },
        });
        await handleFileMultipart({
            ...BASE, resumeId: 'upload-1', gate: { ticker: 'form', minAmount: 'bad' },
        }, h.deps);
        expect(forwarded(h).gate).toEqual({ ticker: 'SAVED', minAmount: '9', key: stored.key });
        expect(h.getStatus).not.toHaveBeenCalled();
        expect(h.gatedKeys.put).not.toHaveBeenCalled();
    });
});

describe('ungated multipart threshold ownership', () => {
    it('forwards the request without reading gate activation status', async () => {
        const h = harness();
        const req = { ...BASE, meta: { name: 'public.bin' } };
        await handleFileMultipart(req, h.deps);
        expect(forwarded(h)).toMatchObject(req);
        expect(forwarded(h)).not.toHaveProperty('gate');
        expect(h.getStatus).not.toHaveBeenCalled();
    });
});
