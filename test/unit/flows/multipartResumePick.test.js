// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { checkResumePick } from '../../../packages/core/src/flows/multipartResumePick.js';

const DIGEST = '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81';
const BYTES = new Uint8Array([1, 2, 3]);

function entry(overrides = {}) {
    return {
        id: 'upload-1',
        chainId: 'bitcoin-mainnet',
        sourceAddress: 'bc1qsource',
        gated: false,
        originalSha256: DIGEST,
        stage: 'sending',
        ...overrides,
    };
}

const pick = (overrides = {}) => ({
    entry: entry(),
    bytes: BYTES,
    chainId: 'bitcoin-mainnet',
    sourceAddress: 'bc1qsource',
    gated: false,
    ...overrides,
});

describe('checkResumePick matching', () => {
    it('returns the resumable upload id for a matching pick', () => {
        expect(checkResumePick(pick())).toEqual({ ok: true, resumeId: 'upload-1' });
    });

    it('matches an upper-case stored hash', () => {
        const upper = entry({ originalSha256: DIGEST.toUpperCase() });
        expect(checkResumePick(pick({ entry: upper }))).toEqual({
            ok: true, resumeId: 'upload-1',
        });
    });

    it('detects a one-byte file change', () => {
        expect(checkResumePick(pick({ bytes: new Uint8Array([1, 2, 4]) })))
            .toEqual({ ok: false, reason: 'file_mismatch' });
    });
});

describe('checkResumePick mismatch ordering', () => {
    const wrongEntry = entry({
        chainId: 'litecoin-mainnet', sourceAddress: 'ltc1qother', gated: true,
    });

    it.each([
        [{ entry: wrongEntry, bytes: new Uint8Array([9]) }, 'chain_mismatch'],
        [{
            entry: entry({ sourceAddress: 'ltc1qother', gated: true }),
            bytes: new Uint8Array([9]),
        }, 'source_mismatch'],
        [{ entry: entry({ gated: true }), bytes: new Uint8Array([9]) }, 'gate_mismatch'],
        [{ bytes: new Uint8Array([9]) }, 'file_mismatch'],
    ])('returns the first applicable reason %#', (overrides, reason) => {
        expect(checkResumePick(pick(overrides))).toEqual({ ok: false, reason });
    });
});

describe('checkResumePick terminal stages', () => {
    it.each(['complete', 'mismatch'])('refuses the %s stage before mismatch checks', (stage) => {
        const terminal = entry({
            stage, chainId: 'other', sourceAddress: 'other', gated: true,
        });
        expect(checkResumePick(pick({ entry: terminal, bytes: new Uint8Array([9]) })))
            .toEqual({ ok: false, reason: 'not_resumable' });
    });
});

describe('checkResumePick input validation', () => {
    const invalidCases = [
        ['entry', { entry: null }],
        ['entry.id', { entry: entry({ id: '' }) }],
        ['entry.id', { entry: entry({ id: 7 }) }],
        ['entry.originalSha256', { entry: entry({ originalSha256: 'a'.repeat(63) }) }],
        ['entry.originalSha256', { entry: entry({ originalSha256: 'g'.repeat(64) }) }],
        ['bytes', { bytes: [1, 2, 3] }],
        ['bytes', { bytes: new Uint8Array() }],
        ['chainId', { chainId: '' }],
        ['sourceAddress', { sourceAddress: '  ' }],
        ['gated', { gated: 0 }],
    ];

    it.each(invalidCases)('refuses invalid %s', (field, overrides) => {
        expect(() => checkResumePick(pick(overrides))).toThrow(expect.objectContaining({
            name: 'TypeError', code: 'FILE_RESUME_PICK_INVALID',
            message: expect.stringContaining(field),
        }));
    });
});

describe('checkResumePick input immutability', () => {
    it('does not mutate any input', () => {
        const input = pick({ entry: entry({ originalSha256: DIGEST.toUpperCase() }) });
        const before = {
            ...input,
            entry: { ...input.entry },
            bytes: Array.from(input.bytes),
        };
        checkResumePick(input);
        expect({ ...input, entry: { ...input.entry }, bytes: Array.from(input.bytes) })
            .toEqual(before);
    });
});
