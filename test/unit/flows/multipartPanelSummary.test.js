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
    findActiveUpload,
    summaryPanelProps,
} from '../../../packages/core/src/flows/multipartPanelProps.js';

const DIGEST = 'ab'.repeat(32);

const entry = (overrides = {}) => ({
    id: 'upload-1',
    chainId: 'btc:regtest',
    sourceAddress: 'bcrt1source',
    originalSha256: DIGEST,
    totalParts: 4,
    partsSent: 0,
    stage: 'funding',
    createdAt: '2026-11-15T08:00:00.000Z',
    ...overrides,
});

const match = (overrides = {}) => ({
    chainId: 'btc:regtest',
    sourceAddress: 'bcrt1source',
    originalSha256: DIGEST,
    ...overrides,
});

function capture(run) {
    try {
        run();
    } catch (error) {
        return error;
    }
    throw new Error('Expected function to throw');
}

describe('summaryPanelProps progress mapping', () => {
    it.each([
        ['fresh', entry(), 1, 'funding'],
        ['half-sent', entry({ partsSent: 2, stage: 'sending' }), 3, 'sending'],
        ['all-parts-sent', entry({ partsSent: 4, stage: 'sending' }), 4, 'sending'],
        ['assembling', entry({ partsSent: 4, stage: 'assembling' }), 4, 'assembling'],
    ])('maps a %s summary', (_name, input, currentPart, stage) => {
        expect(summaryPanelProps(input)).toEqual({
            totalParts: 4, transactions: 11, currentPart, stage,
        });
    });

    it('maps 26 parts to 55 transactions', () => {
        expect(summaryPanelProps(entry({ totalParts: 26 })).transactions).toBe(55);
    });
});

describe('summaryPanelProps validation', () => {
    it.each([
        ['entry', null],
        ['totalParts', entry({ totalParts: 1 })],
        ['totalParts', entry({ totalParts: 2.5 })],
        ['totalParts', entry({ totalParts: 65_536 })],
        ['partsSent', entry({ partsSent: -1 })],
        ['partsSent', entry({ partsSent: 1.5 })],
        ['partsSent', entry({ partsSent: 5 })],
        ['stage', entry({ stage: 'waiting' })],
    ])('rejects invalid %s', (field, input) => {
        const error = capture(() => summaryPanelProps(input));
        expect(error).toMatchObject({ code: 'FILE_PANEL_RECORD_INVALID' });
        expect(error.message).toContain(field);
    });

    it.each(['funding', 'sending', 'assembling', 'complete', 'mismatch'])(
        'accepts the %s stage',
        (stage) => expect(summaryPanelProps(entry({ stage })).stage).toBe(stage),
    );
});

// A file held by reference starts before its digest is known, so its match
// carries a blob key or an inline placeholder; the rail showed the panel stuck
// at 0 for a 101-part upload until these matched.
describe('findActiveUpload for a file held by reference', () => {
    it('matches an extension upload by its blob key, the record id', () => {
        const wanted = entry({ id: 'blob-key-1' });
        expect(findActiveUpload([entry({ id: 'other' }), wanted], match({ originalSha256: 'blob-key-1' }))).toBe(wanted);
    });

    it('matches an inline upload created since the start, not an older one', () => {
        const startedAt = Date.parse('2026-11-17T10:00:00.000Z');
        const older = entry({ id: 'older', createdAt: '2026-11-17T09:00:00.000Z' });
        const running = entry({ id: 'running', createdAt: '2026-11-17T10:00:02.000Z', originalSha256: 'cd'.repeat(32) });
        const inline = match({ originalSha256: 'inline:art.bin:900000', startedAt });
        expect(findActiveUpload([older, running], inline)).toBe(running);
        expect(findActiveUpload([older], inline)).toBeNull();
    });
});

describe('findActiveUpload identity and stage matching', () => {
    it('matches among entries on two chains and two sources', () => {
        const wanted = entry();
        const uploads = [
            entry({ id: 'ltc', chainId: 'ltc:regtest' }),
            entry({ id: 'other-source', sourceAddress: 'bcrt1other' }),
            wanted,
        ];
        expect(findActiveUpload(uploads, match())).toBe(wanted);
    });

    it.each(['complete', 'mismatch'])('does not match a %s entry', (stage) => {
        expect(findActiveUpload([entry({ stage })], match())).toBeNull();
    });

    it('returns the newest of two matches', () => {
        const older = entry({ id: 'older' });
        const newer = entry({ id: 'newer', createdAt: '2026-11-15T09:00:00.000Z' });
        expect(findActiveUpload([newer, older], match())).toBe(newer);
    });

    it('matches an upper-case originalSha256', () => {
        const wanted = entry({ originalSha256: DIGEST.toUpperCase() });
        expect(findActiveUpload([wanted], match())).toBe(wanted);
        expect(findActiveUpload([wanted], match({ originalSha256: DIGEST.toUpperCase() })))
            .toBe(wanted);
    });
});

describe('findActiveUpload validation', () => {
    it.each([
        ['uploads', null, match()],
        ['uploads', {}, match()],
        ['chainId', [], match({ chainId: '' })],
        ['sourceAddress', [], match({ sourceAddress: ' ' })],
        ['originalSha256', [], match({ originalSha256: null })],
    ])('rejects invalid %s', (field, uploads, lookup) => {
        const error = capture(() => findActiveUpload(uploads, lookup));
        expect(error).toBeInstanceOf(TypeError);
        expect(error).toMatchObject({ code: 'FILE_PANEL_MATCH_INVALID' });
        expect(error.message).toContain(field);
    });
});

describe('multipart panel summary input handling', () => {
    it('does not mutate summary or matching inputs', () => {
        const summary = entry({ partsSent: 2, stage: 'sending' });
        const uploads = [summary, entry({ id: 'other', chainId: 'ltc:regtest' })];
        const lookup = match({ originalSha256: DIGEST.toUpperCase() });
        const before = structuredClone({ summary, uploads, lookup });
        summaryPanelProps(summary);
        findActiveUpload(uploads, lookup);
        expect({ summary, uploads, lookup }).toEqual(before);
    });
});
