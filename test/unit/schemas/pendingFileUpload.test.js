// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import {
    CURRENT_VERSION,
    PENDING_FILE_UPLOAD_STAGES,
    createPendingFileUpload,
    validatePendingFileUpload,
} from '../../../packages/core/src/schemas/pendingFileUpload.js';
import * as schemaIndex from '../../../packages/core/src/schemas/index.js';
import { migratePendingFileUpload } from '../../../packages/core/src/schemas/migrations.js';
import { emptyDocument } from '../../../packages/core/src/storage/codec.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import { removeWallet } from '../../../packages/core/src/flows/removeWallet.js';

const BASE_INPUT = {
    walletId: 'wallet-1',
    chainId: 'bitcoin-regtest',
    sourceAddress: 'bcrt1qsource',
    originalSha256: 'a'.repeat(64),
    fileHash: 'b'.repeat(64),
    meta: { name: 'art.bin', type: 'application/octet-stream' },
    gate: null,
    compression: '',
    totalParts: 2,
    totalBytes: 500_000,
    partDigests: ['c'.repeat(64), 'd'.repeat(64)],
    fundingOutputs: [21_000, 22_000, 23_000],
    linkTarget: null,
};

function invalidField(record, field, value) {
    return validatePendingFileUpload({ ...record, [field]: value });
}

function memoryCollection(records = []) {
    return {
        list: async () => records,
        get: async (id) => records.find((record) => record.id === id) ?? null,
        findBy: async (field, value) => records.filter((record) => record[field] === value),
        put: async () => {},
        delete: async (id) => {
            const index = records.findIndex((record) => record.id === id);
            if (index >= 0) records.splice(index, 1);
        },
    };
}

function removalHarness() {
    const uploads = [
        { id: 'target-upload', walletId: 'wallet-1' },
        { id: 'other-upload', walletId: 'wallet-2' },
    ];
    const vault = {
        wallets: memoryCollection([{ id: 'wallet-1', importedKeys: [] }]),
        addresses: memoryCollection(),
        pendingTxs: memoryCollection(),
        connectedSites: memoryCollection(),
        pendingFileUploads: memoryCollection(uploads),
    };
    for (const name of [
        'accounts', 'signers', 'pendingAirdrops', 'pendingDeploys',
        'multisigSigningSessions', 'coSignerAccounts', 'watchlistEntries',
        'priceAlerts', 'gatedKeys', 'autopayOrders',
    ]) vault[name] = memoryCollection();
    return { uploads, vault };
}

describe('createPendingFileUpload', () => {
    it('creates a valid funding-stage record with a manifest and every part', () => {
        const pending = createPendingFileUpload(BASE_INPUT);

        expect(pending).toMatchObject({
            schemaVersion: CURRENT_VERSION,
            walletId: BASE_INPUT.walletId,
            chainId: BASE_INPUT.chainId,
            sourceAddress: BASE_INPUT.sourceAddress,
            originalSha256: BASE_INPUT.originalSha256,
            fileHash: BASE_INPUT.fileHash,
            fundingTxid: null,
            stage: 'funding',
            linkTarget: null,
        });
        expect(pending.pieces).toEqual([
            { index: -1, signedTxids: [], txid: null, actionIndex: null },
            { index: 0, signedTxids: [], txid: null, actionIndex: null },
            { index: 1, signedTxids: [], txid: null, actionIndex: null },
        ]);
        expect(pending.id).toEqual(expect.any(String));
        expect(Number.isFinite(Date.parse(pending.createdAt))).toBe(true);
        expect(validatePendingFileUpload(pending)).toEqual({ ok: true, errors: [] });
    });

    it('copies mutable plan fields and preserves a link target', () => {
        const input = {
            ...BASE_INPUT,
            meta: { ...BASE_INPUT.meta },
            gate: { ticker: 'ART', keyHash: 'e'.repeat(64) },
            partDigests: [...BASE_INPUT.partDigests],
            fundingOutputs: [{ value: 21_000 }, { value: 22_000 }, { value: 23_000 }],
            linkTarget: { tick: 'ART', issueActionIndex: '101' },
        };
        const pending = createPendingFileUpload(input);

        input.meta.name = 'changed';
        input.gate.ticker = 'OTHER';
        input.partDigests[0] = 'f'.repeat(64);
        input.fundingOutputs[0].value = 1;
        input.linkTarget.tick = 'OTHER';
        expect(pending.meta.name).toBe('art.bin');
        expect(pending.gate.ticker).toBe('ART');
        expect(pending.partDigests[0]).toBe('c'.repeat(64));
        expect(pending.fundingOutputs[0].value).toBe(21_000);
        expect(pending.linkTarget).toEqual({ tick: 'ART', issueActionIndex: '101' });
    });
});

describe('pending file upload plan validation', () => {
    it.each([null, [], 'pending', 1])('rejects non-record input %#', (record) => {
        expect(validatePendingFileUpload(record)).toEqual({
            ok: false,
            errors: ['pendingFileUpload: must be an object'],
        });
    });

    it.each([
        ['schemaVersion', 2],
        ['id', ''],
        ['walletId', ''],
        ['chainId', ''],
        ['sourceAddress', ''],
        ['originalSha256', 'A'.repeat(64)],
        ['fileHash', 'not-a-hash'],
        ['meta', []],
        ['gate', []],
        ['compression', 1],
        ['totalParts', 1],
        ['totalParts', 33],
        ['totalBytes', 0],
        ['totalBytes', 12_000_001],
        ['partDigests', ['c'.repeat(64)]],
    ])('rejects an invalid %s value %#', (field, value) => {
        const pending = createPendingFileUpload(BASE_INPUT);
        const validation = invalidField(pending, field, value);

        expect(validation.ok).toBe(false);
        expect(validation.errors).toContainEqual(expect.stringMatching(new RegExp(`^${field}:`)));
    });

    it('accepts public and gated plan metadata', () => {
        const pending = createPendingFileUpload(BASE_INPUT);
        expect(invalidField(pending, 'gate', null).ok).toBe(true);
        expect(invalidField(pending, 'gate', { ticker: 'ART' }).ok).toBe(true);
        expect(invalidField(pending, 'compression', '1').ok).toBe(true);
    });
});

describe('pending file upload progress validation', () => {
    it.each(PENDING_FILE_UPLOAD_STAGES)('accepts the %s stage', (stage) => {
        const pending = createPendingFileUpload(BASE_INPUT);
        expect(invalidField(pending, 'stage', stage).ok).toBe(true);
    });

    it.each([
        ['fundingTxid', ''],
        ['fundingOutputs', BASE_INPUT.fundingOutputs.slice(1)],
        ['fundingOutputs', [21_000, null, 23_000]],
        ['pieces', []],
        ['stage', 'failed'],
        ['linkTarget', { tick: 'ART', issueActionIndex: '' }],
        ['createdAt', 'not-a-date'],
    ])('rejects an invalid %s', (field, value) => {
        const pending = createPendingFileUpload(BASE_INPUT);
        const validation = invalidField(pending, field, value);

        expect(validation.ok).toBe(false);
        expect(validation.errors).toContainEqual(expect.stringMatching(new RegExp(`^${field}:`)));
    });

    it.each([
        ['index', 2],
        ['signedTxids', ['']],
        ['txid', ''],
        ['actionIndex', ''],
    ])('rejects a piece with an invalid %s', (field, value) => {
        const pending = createPendingFileUpload(BASE_INPUT);
        const pieces = pending.pieces.map((piece, offset) =>
            offset === 0 ? { ...piece, [field]: value } : piece);

        expect(invalidField(pending, 'pieces', pieces)).toEqual({
            ok: false,
            errors: ['pieces: must contain manifest index -1 followed by every part index'],
        });
    });

    it('accepts persisted transaction progress and a null link target', () => {
        const pending = createPendingFileUpload(BASE_INPUT);
        const pieces = pending.pieces.map((piece, offset) => offset === 0 ? {
            ...piece,
            signedTxids: ['signed-commit', 'signed-reveal'],
            txid: 'manifest-txid',
            actionIndex: '123',
        } : piece);
        const progressed = {
            ...pending,
            fundingTxid: 'funding-txid',
            pieces,
            linkTarget: { tick: 'ART', issueActionIndex: '99' },
        };

        expect(validatePendingFileUpload(progressed).ok).toBe(true);
        expect(invalidField(progressed, 'linkTarget', null).ok).toBe(true);
    });
});

describe('pending file upload registration', () => {
    it('exports the schema and its base-v1 migration', () => {
        const pending = createPendingFileUpload(BASE_INPUT);

        expect(schemaIndex.pendingFileUpload.createPendingFileUpload)
            .toBe(createPendingFileUpload);
        expect(schemaIndex.createPendingFileUpload).toBe(createPendingFileUpload);
        expect(schemaIndex.migratePendingFileUpload).toBe(migratePendingFileUpload);
        expect(migratePendingFileUpload(pending)).toBe(pending);
    });

    it('initializes the codec store and vault collection', () => {
        const document = emptyDocument();
        const vault = new Vault({
            backend: new InMemoryBackend(),
            masterKey: new Uint8Array(32),
        });

        expect(document.pendingFileUploads).toEqual([]);
        expect(vault.pendingFileUploads).toEqual(expect.objectContaining({
            get: expect.any(Function),
            put: expect.any(Function),
            delete: expect.any(Function),
        }));
    });

    it('removes the wallet-owned upload record with its wallet', async () => {
        const { uploads, vault } = removalHarness();

        const result = await removeWallet({ vault, walletId: 'wallet-1' });

        expect(uploads).toEqual([{ id: 'other-upload', walletId: 'wallet-2' }]);
        expect(result.removed.pendingFileUploads).toBe(1);
    });
});
