// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    handleDiscardPendingFileUpload,
    handleListPendingFileUploads,
} from '../../packages/core/src/flows/fileMultipartRoutes.js';
import {
    createPendingFileUpload,
    validatePendingFileUpload,
} from '../../packages/core/src/schemas/pendingFileUpload.js';

const DIGESTS = ['a'.repeat(64), 'b'.repeat(64)];

function createPendingStore(records) {
    const stored = new Map(records.map((record) => [record.id, structuredClone(record)]));
    return {
        get(id) {
            return stored.get(id) ?? null;
        },
        // The vault collection API the routes call (storage/Vault.js makeCollection).
        findBy(field, value) {
            return [...stored.values()].filter((record) => record[field] === value);
        },
        put(record) {
            stored.set(record.id, record);
            return record;
        },
        delete(id) {
            return stored.delete(id);
        },
    };
}

function takePending(pending) {
    const next = pending.shift();
    if (!next) throw new Error('No multipart call is pending');
    return next;
}

export function multipartRecordFixture(overrides = {}) {
    const record = createPendingFileUpload({
        walletId: 'wallet-1',
        chainId: 'btc:regtest',
        sourceAddress: 'bcrt1source',
        originalSha256: 'c'.repeat(64),
        fileHash: 'd'.repeat(64),
        meta: { name: 'multipart.txt', type: 'text/plain' },
        gate: null,
        compression: 'none',
        totalParts: 2,
        totalBytes: 12,
        partDigests: DIGESTS,
        fundingOutputs: [1000, 1000, 1000],
        linkTarget: null,
    });
    const fixture = { ...record, ...overrides };
    if (!validatePendingFileUpload(fixture).ok) {
        throw new Error('multipartRecordFixture overrides produced an invalid record');
    }
    return fixture;
}

export function createMultipartShellStub({ records = [] } = {}) {
    const calls = [];
    const pending = [];
    const pendingFileUploads = createPendingStore(records);
    const vault = { pendingFileUploads };
    const messaging = {
        listPendingFileUploads(...args) {
            calls.push({ name: 'listPendingFileUploads', args });
            return handleListPendingFileUploads(args[0], { vault });
        },
        discardPendingFileUpload(...args) {
            calls.push({ name: 'discardPendingFileUpload', args });
            return handleDiscardPendingFileUpload(args[0], { vault });
        },
        fileMultipart(...args) {
            calls.push({ name: 'fileMultipart', args });
            return new Promise((resolve, reject) => pending.push({ resolve, reject }));
        },
    };
    return {
        messaging,
        calls,
        advance(id, patch) {
            const record = pendingFileUploads.get(id);
            if (!record) throw new Error(`Unknown pending file upload: ${id}`);
            pendingFileUploads.put({ ...record, ...patch });
        },
        finish(reply) {
            takePending(pending).resolve(reply);
        },
        fail(error) {
            takePending(pending).reject(error);
        },
    };
}
