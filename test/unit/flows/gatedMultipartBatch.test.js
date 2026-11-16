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
import { composeGatedManifestBatch } from '../../../packages/core/src/flows/gatedMultipartBatch.js';

const FILE_HASH = 'a'.repeat(64);
const KEY_HASH = 'b'.repeat(64);

function manifest(overrides = {}) {
    return {
        fileHash: FILE_HASH,
        totalParts: '3',
        totalBytes: '1200',
        name: 'private.txt',
        type: 'text/plain',
        title: 'Private note',
        memo: 'members only',
        gateTicker: 'GATE',
        keyHash: KEY_HASH,
        ...overrides,
    };
}

function compose(overrides = {}) {
    return composeGatedManifestBatch({
        manifest: { params: manifest() },
        keyHandoffCiphertext: 'eciesciphertext',
        coin: 'BTC',
        sourceAddress: 'bc1qsource',
        ...overrides,
    });
}

function refusal(input, code) {
    expect(() => compose(input)).toThrow(expect.objectContaining({ code }));
}

describe('gated multipart batch wire composition', () => {
    it('emits the exact manifest and handoff with threshold and compression', () => {
        const result = compose({
            manifest: manifest({ gateMinAmount: '2.5', compression: 'deflate-raw' }),
        });
        expect(result).toEqual({
            action: 'BATCH',
            params: {
                VERSION: '0',
                COMMAND: `FILE|1|${FILE_HASH}|3|1200|private.txt|text/plain|Private note|members only|GATE|1|${KEY_HASH}|2.5|deflate-raw;MESSAGE|2|BTC|bc1qsource|eciesciphertext`,
            },
        });
    });

    it('keeps absent threshold and compression as empty trailing fields', () => {
        expect(compose().params.COMMAND).toBe(
            `FILE|1|${FILE_HASH}|3|1200|private.txt|text/plain|Private note|members only|GATE|1|${KEY_HASH}||;MESSAGE|2|BTC|bc1qsource|eciesciphertext`,
        );
    });
});

describe('gated multipart batch hash refusals', () => {
    it.each([
        ['FILE_HASH_FORMAT', { fileHash: 'A'.repeat(64) }],
        ['FILE_HASH_FORMAT', { fileHash: 'a'.repeat(63) }],
        ['KEY_HASH_FORMAT', { keyHash: 'g'.repeat(64) }],
        ['KEY_HASH_FORMAT', { keyHash: '' }],
    ])('uses %s for an invalid digest', (code, fields) => {
        refusal({ manifest: manifest(fields) }, code);
    });
});

describe('gated multipart batch numeric refusals', () => {
    it.each([
        ['TOTAL_PARTS_RANGE', { totalParts: '1' }],
        ['TOTAL_PARTS_RANGE', { totalParts: '33' }],
        ['TOTAL_PARTS_RANGE', { totalParts: '02' }],
        ['TOTAL_PARTS_RANGE', { totalParts: '2.5' }],
        ['TOTAL_BYTES_RANGE', { totalBytes: '0' }],
        ['TOTAL_BYTES_RANGE', { totalBytes: '12000001' }],
        ['TOTAL_BYTES_RANGE', { totalBytes: '01' }],
        ['TOTAL_BYTES_RANGE', { totalBytes: '1.5' }],
    ])('uses %s for an invalid integer', (code, fields) => {
        refusal({ manifest: manifest(fields) }, code);
    });
});

describe('gated multipart batch text refusals', () => {
    it.each([
        ['name', 'bad|name'], ['type', 'bad;type'], ['title', 'bad|title'],
        ['memo', 'bad;memo'], ['gateTicker', 'BAD|GATE'],
        ['gateMinAmount', '1;2'], ['compression', 'deflate|raw'],
    ])('rejects reserved delimiters in %s', (field, value) => {
        refusal({ manifest: manifest({ [field]: value }) }, 'TEXT_FIELD_RESERVED');
    });

    it.each([
        ['coin', { coin: 'BT|C' }],
        ['source', { sourceAddress: 'source;address' }],
        ['ciphertext', { keyHandoffCiphertext: 'cipher|text' }],
    ])('rejects reserved delimiters in MESSAGE %s', (_field, input) => {
        refusal(input, 'TEXT_FIELD_RESERVED');
    });
});

describe('gated multipart batch boundaries and shape', () => {
    it.each([
        ['totalParts', 3, 2], ['totalParts', 3, 32],
        ['totalBytes', 4, 1], ['totalBytes', 4, 12000000],
    ])('accepts the %s boundary %s', (field, wireIndex, value) => {
        const result = compose({ manifest: manifest({ [field]: value }) });
        const fileFields = result.params.COMMAND.split(';')[0].split('|');
        expect(fileFields[wireIndex]).toBe(String(value));
    });

    it('contains exactly two commands and no file bytes or part command', () => {
        const result = compose({
            manifest: { ...manifest(), rawData: 'secret bytes', PART_INDEX: '0' },
        });
        expect(result.params.COMMAND.split(';')).toHaveLength(2);
        expect(result.params.COMMAND).not.toContain('secret bytes');
        expect(result.params.COMMAND).not.toContain('PART_INDEX');
    });

    it('also accepts direct uppercase wire fields', () => {
        const params = Object.fromEntries(Object.entries(manifest()).map(([key, value]) => {
            const wire = key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase();
            return [wire, value];
        }));
        expect(compose({ manifest: params }).params.COMMAND).toContain(`FILE|1|${FILE_HASH}|3|1200|`);
    });
});
