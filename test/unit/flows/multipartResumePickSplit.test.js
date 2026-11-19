// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    checkResumePick,
    checkResumePickDigest,
    checkResumePickMeta,
} from '../../../packages/core/src/flows/multipartResumePick.js';

const DIGEST = '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81';

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

const meta = (overrides = {}) => ({
    entry: entry(),
    chainId: 'bitcoin-mainnet',
    sourceAddress: 'bc1qsource',
    gated: false,
    ...overrides,
});

describe('checkResumePickMeta', () => {
    it('returns the metadata success result without bytes', () => {
        expect(checkResumePickMeta(meta())).toEqual({ ok: true });
    });

    it.each(['complete', 'mismatch'])('refuses the %s stage without bytes', (stage) => {
        expect(checkResumePickMeta(meta({ entry: entry({ stage }) })))
            .toEqual({ ok: false, reason: 'not_resumable' });
    });

    it.each([
        [{ entry: entry({ chainId: 'litecoin-mainnet' }) }, 'chain_mismatch'],
        [{ entry: entry({ sourceAddress: 'ltc1qother' }) }, 'source_mismatch'],
        [{ entry: entry({ gated: true }) }, 'gate_mismatch'],
    ])('returns the metadata mismatch reason %# without bytes', (overrides, reason) => {
        expect(checkResumePickMeta(meta(overrides))).toEqual({ ok: false, reason });
    });
});

describe('checkResumePick composition', () => {
    it('keeps entry and bytes validation ahead of the remaining metadata', () => {
        expect(() => checkResumePick({
            ...meta({ chainId: '' }), bytes: [],
        })).toThrow(expect.objectContaining({
            message: 'Invalid resume pick field: bytes',
        }));
        expect(() => checkResumePick({
            ...meta({ entry: entry({ originalSha256: 'x' }) }), bytes: [],
        })).toThrow(expect.objectContaining({
            message: 'Invalid resume pick field: entry.originalSha256',
        }));
    });
});

describe('checkResumePickDigest', () => {
    it('accepts an uppercase matching digest', () => {
        expect(checkResumePickDigest(entry(), DIGEST.toUpperCase()))
            .toEqual({ ok: true, resumeId: 'upload-1' });
    });

    it('refuses a different digest', () => {
        expect(checkResumePickDigest(entry(), 'a'.repeat(64)))
            .toEqual({ ok: false, reason: 'file_mismatch' });
    });

    it('throws for a 63-character digest', () => {
        expect(() => checkResumePickDigest(entry(), 'a'.repeat(63)))
            .toThrow(expect.objectContaining({
                code: 'FILE_RESUME_PICK_INVALID',
            }));
    });
});
