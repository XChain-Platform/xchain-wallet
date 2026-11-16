// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it, vi } from 'vitest';
import {
    handleDiscardPendingFileUpload,
    handleFileMultipart,
    handleListPendingFileUploads,
} from '../../../packages/core/src/flows/fileMultipartRoutes.js';

function upload(overrides = {}) {
    return {
        id: 'upload-1',
        walletId: 'wallet-1',
        chainId: 'btc:regtest',
        sourceAddress: 'bcrt1source',
        originalSha256: 'a'.repeat(64),
        meta: { name: 'photo.png' },
        gate: null,
        pieces: [
            { index: 0, txid: 'part-0' },
            { index: 1, txid: null },
            { index: -1, txid: 'manifest' },
        ],
        fundingTxid: 'funding',
        totalParts: 2,
        stage: 'sending',
        linkTarget: null,
        createdAt: '2026-11-15T08:00:00.000Z',
        ...overrides,
    };
}

function routeDeps(overrides = {}) {
    const sdk = { waitForAction: vi.fn(async () => 'indexed') };
    return {
        publishMultipartFile: vi.fn(async () => ({ pendingFileUploadId: 'upload-1' })),
        vault: {},
        sdkRegistry: { get: vi.fn(() => sdk) },
        chainRegistry: {},
        signer: {},
        onBroadcastFailure: vi.fn(),
        sdk,
        ...overrides,
    };
}

describe('handleFileMultipart forwarding', () => {
    it('injects dependencies and an SDK-backed transaction waiter', async () => {
        const deps = routeDeps();
        const req = {
            walletId: 'wallet-1', chainId: 'btc:regtest', sourceAddress: 'bcrt1source',
            bytes: new Uint8Array([1, 2, 3]), meta: { name: 'photo.png' }, signer: 'untrusted',
        };
        await expect(handleFileMultipart(req, deps)).resolves.toEqual({ pendingFileUploadId: 'upload-1' });
        expect(deps.sdkRegistry.get).toHaveBeenCalledWith('btc:regtest');
        const forwarded = deps.publishMultipartFile.mock.calls[0][0];
        expect(forwarded).toMatchObject({ ...req, signer: deps.signer, vault: deps.vault });
        expect(forwarded.chainRegistry).toBe(deps.chainRegistry);
        expect(forwarded.sdkRegistry).toBe(deps.sdkRegistry);
        expect(forwarded.onBroadcastFailure).toBe(deps.onBroadcastFailure);
        await expect(forwarded.waitForTxid('tx-1', { patienceMs: 10 })).resolves.toBe('indexed');
        expect(deps.sdk.waitForAction).toHaveBeenCalledWith('tx-1', { patienceMs: 10 });
    });
});

describe('handleFileMultipart validation', () => {
    it.each([
        ['walletId', { chainId: 'c', sourceAddress: 'a', bytes: new Uint8Array([1]) }],
        ['chainId', { walletId: 'w', sourceAddress: 'a', bytes: new Uint8Array([1]) }],
        ['sourceAddress', { walletId: 'w', chainId: 'c', bytes: new Uint8Array([1]) }],
        ['bytes', { walletId: 'w', chainId: 'c', sourceAddress: 'a', bytes: new Uint8Array() }],
    ])('rejects missing %s before invoking the flow', async (field, req) => {
        const deps = routeDeps();
        await expect(handleFileMultipart(req, deps)).rejects.toThrow(field);
        expect(deps.publishMultipartFile).not.toHaveBeenCalled();
        expect(deps.sdkRegistry.get).not.toHaveBeenCalled();
    });
});

describe('handleListPendingFileUploads', () => {
    it('returns only the panel summary and excludes the manifest from parts sent', async () => {
        const findBy = vi.fn(async () => [upload(), upload({
            id: 'upload-2', meta: {}, pieces: [], fundingTxid: null, stage: 'funding',
        })]);
        const vault = { pendingFileUploads: { findBy } };
        await expect(handleListPendingFileUploads({ walletId: 'wallet-1' }, { vault })).resolves.toEqual({
            uploads: [
                {
                    id: 'upload-1', name: 'photo.png', chainId: 'btc:regtest',
                    sourceAddress: 'bcrt1source', originalSha256: 'a'.repeat(64),
                    createdAt: '2026-11-15T08:00:00.000Z', linkTarget: null, gated: false,
                    partsSent: 1, totalParts: 2, paidTransactions: 5, stage: 'sending',
                },
                {
                    id: 'upload-2', name: '', chainId: 'btc:regtest',
                    sourceAddress: 'bcrt1source', originalSha256: 'a'.repeat(64),
                    createdAt: '2026-11-15T08:00:00.000Z', linkTarget: null, gated: false,
                    partsSent: 0, totalParts: 2, paidTransactions: 0, stage: 'funding',
                },
            ],
        });
        expect(findBy).toHaveBeenCalledWith('walletId', 'wallet-1');
    });
});

describe('handleDiscardPendingFileUpload', () => {
    it('removes an owned record and reports transactions already paid', async () => {
        const remove = vi.fn(async () => true);
        const vault = { pendingFileUploads: { get: vi.fn(async () => upload()), delete: remove } };
        await expect(handleDiscardPendingFileUpload(
            { walletId: 'wallet-1', id: 'upload-1' }, { vault },
        )).resolves.toEqual({ removed: true, paidTransactions: 5 });
        expect(remove).toHaveBeenCalledWith('upload-1');
    });

    it.each([
        ['FILE_UPLOAD_NOT_FOUND', null],
        ['FILE_UPLOAD_WALLET_MISMATCH', upload({ walletId: 'wallet-2' })],
    ])('refuses %s without removing the record', async (code, record) => {
        const remove = vi.fn();
        const vault = { pendingFileUploads: { get: vi.fn(async () => record), delete: remove } };
        await expect(handleDiscardPendingFileUpload(
            { walletId: 'wallet-1', id: 'upload-1' }, { vault },
        )).rejects.toMatchObject({ code });
        expect(remove).not.toHaveBeenCalled();
    });
});
