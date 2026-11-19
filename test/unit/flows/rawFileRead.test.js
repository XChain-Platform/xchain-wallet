// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it, vi } from 'vitest';
import {
    classifyRawError,
    readRawFile,
} from '../../../packages/core/src/flows/rawFileRead.js';

const incomplete = { state: 'not_ready', reason: 'FILE_INCOMPLETE', status: 409 };
const mismatch = { state: 'not_ready', reason: 'FILE_ASSEMBLY_MISMATCH', status: 422 };

function rejectingSdk(error) {
    return { getGatedFileRaw: vi.fn(async () => { throw error; }) };
}

describe('classifyRawError HTTP status shapes', () => {
    it.each([
        ['direct 409', { status: 409 }, incomplete],
        ['response 422', { response: { status: 422 } }, mismatch],
        ['SDK details 409', { details: { status: 409 } }, incomplete],
    ])('classifies %s', (_label, error, expected) => {
        expect(classifyRawError(error)).toEqual(expected);
    });

    it.each([
        { status: 404 },
        { response: { status: 404 } },
        { details: { status: 404 } },
    ])('classifies a 404 as missing', (error) => {
        expect(classifyRawError(error)).toEqual({ state: 'missing' });
    });
});

describe('classifyRawError response body shapes', () => {
    it.each([
        ['SDK binary body', {
            details: { data: Buffer.from(JSON.stringify({ code: 'FILE_INCOMPLETE' })) },
        }, incomplete],
        ['Axios body', {
            response: { data: { code: 'FILE_ASSEMBLY_MISMATCH' } },
        }, mismatch],
        ['direct body', { body: { code: 'FILE_INCOMPLETE' } }, incomplete],
    ])('classifies the %s', (_label, error, expected) => {
        expect(classifyRawError(error)).toEqual(expected);
    });
});

describe('readRawFile ready state', () => {
    it('returns bytes as a Buffer and forwards the coin', async () => {
        const sdk = { getGatedFileRaw: vi.fn(async () => new Uint8Array([1, 2, 3])) };

        const result = await readRawFile(sdk, '42', 'DOGE');

        expect(result.state).toBe('ready');
        expect(Buffer.isBuffer(result.bytes)).toBe(true);
        expect(result.bytes).toEqual(Buffer.from([1, 2, 3]));
        expect(sdk.getGatedFileRaw).toHaveBeenCalledWith('42', 'DOGE');
    });
});

describe('readRawFile missing state', () => {
    it.each([null, undefined, Buffer.alloc(0)])('returns missing for an empty body', async (body) => {
        const sdk = { getGatedFileRaw: vi.fn(async () => body) };
        await expect(readRawFile(sdk, 8)).resolves.toEqual({ state: 'missing' });
    });

    it('returns missing for a 404', async () => {
        const sdk = rejectingSdk({ details: { status: 404 } });
        await expect(readRawFile(sdk, 8)).resolves.toEqual({ state: 'missing' });
    });
});

describe('readRawFile not-ready state', () => {
    it.each([
        [{ status: 409 }, incomplete],
        [{ response: { status: 422 } }, mismatch],
    ])('returns the classified route state', async (error, expected) => {
        await expect(readRawFile(rejectingSdk(error), 8)).resolves.toEqual(expected);
    });
});

describe('readRawFile unknown errors', () => {
    it('rethrows the original error unchanged', async () => {
        const error = new Error('network unavailable');
        await expect(readRawFile(rejectingSdk(error), 8)).rejects.toBe(error);
    });
});
