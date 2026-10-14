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
    PENDING_DEPLOY_STAGES,
    createPendingDeploy,
    validatePendingDeploy,
} from '../../../packages/core/src/schemas/pendingDeploy.js';

const BASE_INPUT = {
    walletId: 'wallet-1',
    chainId: 'bitcoin-mainnet',
    sourceAddress: 'bc1qdeployer',
    codeHash: 'a'.repeat(64),
    code: 'export function run() { return true; }',
    totalChunks: 2,
    assembleParams: {
        VERSION: '3',
        NAME: 'example',
        CODE_HASH: 'a'.repeat(64),
    },
};

describe('createPendingDeploy', () => {
    it('creates a valid resumable deployment', () => {
        const pending = createPendingDeploy({ ...BASE_INPUT, name: 'Example contract' });

        expect(pending).toMatchObject({
            schemaVersion: CURRENT_VERSION,
            walletId: BASE_INPUT.walletId,
            chainId: BASE_INPUT.chainId,
            sourceAddress: BASE_INPUT.sourceAddress,
            codeHash: BASE_INPUT.codeHash,
            code: BASE_INPUT.code,
            totalChunks: BASE_INPUT.totalChunks,
            assembleParams: BASE_INPUT.assembleParams,
            deployTxid: null,
            contractActionIndex: null,
            stage: 'chunking',
            name: 'Example contract',
        });
        expect(pending.id).toEqual(expect.any(String));
        expect(pending.chunks).toEqual([
            { index: 0, txid: null, actionIndex: null },
            { index: 1, txid: null, actionIndex: null },
        ]);
        expect(Number.isFinite(Date.parse(pending.createdAt))).toBe(true);
        expect(validatePendingDeploy(pending)).toEqual({ ok: true, errors: [] });
    });

    it('copies assembly parameters and defaults the optional name to null', () => {
        const input = { ...BASE_INPUT, assembleParams: { ...BASE_INPUT.assembleParams } };
        const pending = createPendingDeploy(input);

        input.assembleParams.NAME = 'mutated';
        expect(pending.assembleParams.NAME).toBe('example');
        expect(pending.name).toBeNull();
    });
});

describe('validatePendingDeploy', () => {
    it.each([null, [], 'pending', 1])('rejects non-record input %#', (record) => {
        expect(validatePendingDeploy(record)).toEqual({
            ok: false,
            errors: ['pendingDeploy: must be an object'],
        });
    });

    it.each([
        ['schemaVersion', 2],
        ['id', ''],
        ['walletId', ''],
        ['chainId', ''],
        ['sourceAddress', ''],
        ['codeHash', 'A'.repeat(64)],
        ['code', ''],
        ['totalChunks', 0],
        ['chunks', 'not-an-array'],
        ['assembleParams', []],
        ['deployTxid', ''],
        ['contractActionIndex', ''],
        ['stage', 'waiting'],
        ['createdAt', 'not-a-date'],
        ['name', 42],
    ])('rejects an invalid %s', (field, value) => {
        const pending = createPendingDeploy(BASE_INPUT);
        const result = validatePendingDeploy({ ...pending, [field]: value });

        expect(result.ok).toBe(false);
        expect(result.errors).toContainEqual(expect.stringMatching(new RegExp(`^${field}:`)));
    });

    it.each([
        ['index', -1],
        ['index', 0.5],
        ['txid', ''],
        ['actionIndex', ''],
    ])('rejects a chunk with an invalid %s', (field, value) => {
        const pending = createPendingDeploy(BASE_INPUT);
        const chunks = pending.chunks.map((chunk, index) =>
            index === 0 ? { ...chunk, [field]: value } : chunk);
        const result = validatePendingDeploy({ ...pending, chunks });

        expect(result).toEqual({
            ok: false,
            errors: ['chunks: must be an array of totalChunks chunk entries'],
        });
    });

    it('rejects a chunk count that differs from totalChunks', () => {
        const pending = createPendingDeploy(BASE_INPUT);
        const result = validatePendingDeploy({ ...pending, chunks: pending.chunks.slice(0, 1) });

        expect(result).toEqual({
            ok: false,
            errors: ['chunks: must be an array of totalChunks chunk entries'],
        });
    });

    it.each(PENDING_DEPLOY_STAGES)('accepts the %s stage', (stage) => {
        const pending = createPendingDeploy(BASE_INPUT);

        expect(validatePendingDeploy({ ...pending, stage }).ok).toBe(true);
    });

    it.each([
        ['deployTxid', null],
        ['deployTxid', 'deploy-txid'],
        ['contractActionIndex', null],
        ['contractActionIndex', '123:4'],
        ['name', null],
        ['name', ''],
        ['name', 'Example contract'],
    ])('accepts the supported nullable or string %s value %#', (field, value) => {
        const pending = createPendingDeploy(BASE_INPUT);

        expect(validatePendingDeploy({ ...pending, [field]: value }).ok).toBe(true);
    });
});
