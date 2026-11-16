// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { fileMultipartRequest } from '../../../packages/core/src/flows/fileMultipartRequest.js';
import { handleFileMultipart } from '../../../packages/core/src/flows/fileMultipartRoutes.js';

const BYTES = Uint8Array.of(0, 127, 128, 255);
const FROM = {
    address: 'bcrt1source',
    publicKey: `02${'ab'.repeat(32)}`,
    type: 'p2wpkh',
};

function request(overrides = {}) {
    return fileMultipartRequest({
        walletId: 'wallet-1',
        chainId: 'btc:regtest',
        from: FROM,
        bytes: BYTES,
        meta: { name: 'photo.png', type: 'image/png' },
        path: { path: 'multipart', lane: 'envelope', buildMode: 'one_call' },
        linkTarget: null,
        gate: null,
        ...overrides,
    });
}

function routeDeps() {
    const sdk = { waitForAction: vi.fn() };
    return {
        publishMultipartFile: vi.fn(async () => ({ pendingFileUploadId: 'upload-1' })),
        sdkRegistry: { get: vi.fn(() => sdk) },
    };
}

function popupRoundTrip(value) {
    return JSON.parse(JSON.stringify(value));
}

describe('file multipart request route seam', () => {
    it.each([
        ['public', {}, null, undefined],
        ['artwork', { linkTarget: { tick: 'ART', issueActionIndex: 42 } },
            { tick: 'ART', issueActionIndex: '42' }, undefined],
        ['resumed', { resumeId: 'upload-1' }, null, 'upload-1'],
    ])('forwards a serialized %s request to the publisher', async (
        _name, overrides, linkTarget, resumeId,
    ) => {
        const deps = routeDeps();
        await handleFileMultipart(popupRoundTrip(request(overrides)), deps);
        expect(deps.publishMultipartFile).toHaveBeenCalledOnce();
        const forwarded = deps.publishMultipartFile.mock.calls[0][0];
        expect(forwarded.bytes).toEqual(BYTES);
        expect(forwarded.from.address).toBe(FROM.address);
        expect(forwarded.sourceAddress).toBe(FROM.address);
        expect(forwarded.lane).toBe('envelope');
        expect(forwarded.buildMode).toBe('one_call');
        expect(forwarded.linkTarget).toEqual(linkTarget);
        expect(forwarded.resumeId).toBe(resumeId);
    });
});

describe('file multipart request route source validation', () => {
    it('refuses a serialized request without the top-level source before publishing', async () => {
        const deps = routeDeps();
        const routed = popupRoundTrip(request());
        delete routed.sourceAddress;
        await expect(handleFileMultipart(routed, deps)).rejects.toThrow(
            'handleFileMultipart: sourceAddress is required',
        );
        expect(deps.publishMultipartFile).not.toHaveBeenCalled();
        expect(deps.sdkRegistry.get).not.toHaveBeenCalled();
    });
});
