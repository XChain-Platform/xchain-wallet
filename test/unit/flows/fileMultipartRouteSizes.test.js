// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { handleFileMultipart } from '../../../packages/core/src/flows/fileMultipartRoutes.js';

const DESCRIPTOR = { id: 'btc:regtest', coin: 'bitcoin', networkKind: 'regtest' };

function request(overrides = {}) {
    return {
        walletId: 'wallet-1',
        chainId: 'btc:regtest',
        sourceAddress: 'bcrt1source',
        bytes: Uint8Array.of(1, 2, 3),
        rate: 4,
        lane: 'envelope',
        buildMode: 'one_call',
        ...overrides,
    };
}

function roundTrip(value) {
    return JSON.parse(JSON.stringify(value));
}

function routeDeps(overrides = {}) {
    const sdk = { waitForAction: vi.fn(async () => 'indexed') };
    return {
        publishMultipartFile: vi.fn(async () => ({ pendingFileUploadId: 'upload-1' })),
        vault: {},
        sdkRegistry: { get: vi.fn(() => sdk) },
        chainRegistry: { get: vi.fn(() => DESCRIPTOR) },
        signer: {},
        onBroadcastFailure: vi.fn(),
        ...overrides,
    };
}

function validSizes() {
    return {
        envelopePairVbytes: vi.fn((partBytes) => partBytes + 1),
        standardPairBytes: vi.fn((partBytes) => partBytes + 2),
    };
}

describe('renderer-controlled multipart funding values', () => {
    it('removes serialized sizes and output floor without mutating the input', async () => {
        const deps = routeDeps();
        const input = roundTrip(request({
            bytes: undefined, rawData: '\x01\x02\x03', outputFloor: 1, sizes: {},
        }));
        const before = structuredClone(input);
        await handleFileMultipart(input, deps);
        const forwarded = deps.publishMultipartFile.mock.calls[0][0];
        expect(forwarded).not.toHaveProperty('outputFloor');
        expect(forwarded).not.toHaveProperty('sizes');
        expect(forwarded.bytes).toEqual(Uint8Array.of(1, 2, 3));
        expect(input).toEqual(before);
    });

    it('forwards ordinary route values unchanged', async () => {
        const deps = routeDeps();
        const input = request();
        await handleFileMultipart(input, deps);
        const forwarded = deps.publishMultipartFile.mock.calls[0][0];
        expect(forwarded).toMatchObject({
            rate: input.rate, lane: input.lane, buildMode: input.buildMode, bytes: input.bytes,
        });
        expect(forwarded.bytes).toBe(input.bytes);
    });
});

describe('host multipart size estimators', () => {
    it.each([1, 3])('resolves and forwards the exact estimator object for %i uploads', async (count) => {
        const sizes = validSizes();
        const multipartSizesFor = vi.fn(() => sizes);
        const deps = routeDeps({ multipartSizesFor });
        for (let index = 0; index < count; index += 1) {
            await handleFileMultipart(request(), deps);
            expect(deps.publishMultipartFile.mock.calls[index][0].sizes).toBe(sizes);
        }
        expect(multipartSizesFor).toHaveBeenCalledTimes(count);
        expect(multipartSizesFor.mock.calls).toEqual(
            Array.from({ length: count }, () => [DESCRIPTOR]),
        );
        expect(deps.chainRegistry.get).toHaveBeenCalledTimes(count);
    });
});

describe('invalid host multipart size estimators', () => {
    it.each([
        ['a missing standard estimator', { envelopePairVbytes: vi.fn() }],
        ['a non-object result', 1],
    ])('refuses %s before publishing', async (_label, sizes) => {
        const deps = routeDeps({ multipartSizesFor: vi.fn(() => sizes) });
        await expect(handleFileMultipart(request(), deps)).rejects.toMatchObject({
            code: 'FILE_MULTIPART_SIZES_INVALID',
        });
        expect(deps.publishMultipartFile).not.toHaveBeenCalled();
        expect(deps.multipartSizesFor).toHaveBeenCalledOnce();
        expect(deps.multipartSizesFor).toHaveBeenCalledWith(DESCRIPTOR);
    });
});

describe('optional host multipart size estimators', () => {
    it('does not forward a sizes key or look up a descriptor without the dependency', async () => {
        const deps = routeDeps();
        await handleFileMultipart(request(), deps);
        expect(deps.publishMultipartFile.mock.calls[0][0]).not.toHaveProperty('sizes');
        expect(deps.chainRegistry.get).not.toHaveBeenCalled();
    });
});
