// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const routeStubs = vi.hoisted(() => ({
    discard: vi.fn(),
    file: vi.fn(),
    list: vi.fn(),
    publish: vi.fn(),
}));

vi.mock('@xchain-wallet/core/flows/fileMultipartRoutes.js', () => ({
    handleDiscardPendingFileUpload: routeStubs.discard,
    handleFileMultipart: routeStubs.file,
    handleListPendingFileUploads: routeStubs.list,
}));

vi.mock('@xchain-wallet/core/flows/publishMultipartFile.js', () => ({
    publishMultipartFile: routeStubs.publish,
}));

const { createBackgroundHost } = await import(
    '../../../packages/extension/src/background/createBackgroundHost.js'
);

const signer = { kind: 'software' };
const sdk = { waitForAction: vi.fn() };
const chainRegistry = { get: () => ({ id: 'bitcoin-regtest' }), list: () => [] };
const pendingFileUploads = {};
const vault = {
    pendingFileUploads,
    settings: { get: async () => ({}) },
    wallets: { list: async () => [] },
};

function makeHost() {
    return createBackgroundHost({
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        broadcastQueueStorage: null,
        chainRegistry,
        getDiagnosticContext: () => ({}),
        logConsoleStorage: null,
        sdkRegistry: { get: () => sdk, for: () => sdk },
        signerPool: { get: () => signer },
        signThrottleStorage: null,
        vault,
    });
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('the multi-part file action host route', () => {
    it('injects the flow, signer, registries, vault and failure hook', async () => {
        const request = { walletId: 'w1', chainId: 'bitcoin-regtest' };
        routeStubs.file.mockResolvedValue({ fileId: 42 });

        const response = await makeHost().handle({ type: 'action.fileMultipart', request });

        expect(response).toEqual({ ok: true, result: { fileId: 42 } });
        expect(routeStubs.file).toHaveBeenCalledOnce();
        const [received, deps] = routeStubs.file.mock.calls[0];
        expect(received).toBe(request);
        expect(deps).toMatchObject({
            chainRegistry, publishMultipartFile: routeStubs.publish, signer, vault,
        });
        expect(deps.sdkRegistry.get(request.chainId)).toBe(sdk);
        expect(typeof deps.onBroadcastFailure).toBe('function');
        // The route drops renderer sizes, so the host must bind the estimators
        // or every multi-part quote fails before the encoder is called.
        const sizes = deps.multipartSizesFor({ id: 'bitcoin-regtest', coin: 'bitcoin' });
        expect(typeof sizes.envelopePairVbytes).toBe('function');
        expect(typeof sizes.standardPairBytes).toBe('function');
    });
});

describe('the pending file upload list host route', () => {
    it('passes the request and vault to the core handler', async () => {
        const request = { walletId: 'w1' };
        routeStubs.list.mockResolvedValue({ uploads: [] });

        const response = await makeHost().handle({
            type: 'pendingFileUploads.listForWallet', request,
        });

        expect(response).toEqual({ ok: true, result: { uploads: [] } });
        expect(routeStubs.list).toHaveBeenCalledWith(request, { vault });
    });
});

describe('the pending file upload discard host route', () => {
    it('passes the request and vault to the core handler', async () => {
        const request = { walletId: 'w1', id: 'upload-1' };
        routeStubs.discard.mockResolvedValue({ removed: true, paidTransactions: 3 });

        const response = await makeHost().handle({
            type: 'pendingFileUploads.discard', request,
        });

        expect(response.result).toEqual({ removed: true, paidTransactions: 3 });
        expect(routeStubs.discard).toHaveBeenCalledWith(request, { vault });
    });
});
