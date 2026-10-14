// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { csvField, parseCsvRecords } from '../../../../packages/core/src/shared/utils/csv.js';

describe('shared/utils/csv parseCsvRecords', () => {
    it.each([
        ['empty input', '', []],
        ['plain CRLF rows', 'name,value\r\nalpha,1\r\n', [
            { cells: ['name', 'value'], line: 1 },
            { cells: ['alpha', '1'], line: 2 },
        ]],
        ['quoted punctuation', '"a,b","say ""hello"""', [
            { cells: ['a,b', 'say "hello"'], line: 1 },
        ]],
        ['multiline field positions', 'name,notes\nalpha,"one\ntwo"\nbeta,three', [
            { cells: ['name', 'notes'], line: 1 },
            { cells: ['alpha', 'one\ntwo'], line: 2 },
            { cells: ['beta', 'three'], line: 4 },
        ]],
        ['empty physical row', 'a\n\nb', [
            { cells: ['a'], line: 1 },
            { cells: [''], line: 2 },
            { cells: ['b'], line: 3 },
        ]],
    ])('parses %s', (_label, input, expected) => {
        expect(parseCsvRecords(input)).toEqual(expected);
    });

    it.each([
        ['quote in an unquoted field', 'ab"cd', /Line 1: unexpected quote/],
        ['text after a closing quote', '"ab"cd', /Line 1: unexpected character/],
        ['an unterminated quoted field', 'a,"b\nc', /Line 1: unterminated quoted field/],
    ])('rejects %s in strict mode', (_label, input, expected) => {
        expect(() => parseCsvRecords(input, { strict: true })).toThrow(expected);
    });
});

describe('shared/utils/csv csvField', () => {
    it.each([
        ['plain text', 'alpha', 'alpha'],
        ['comma', 'a,b', '"a,b"'],
        ['quote', 'say "hello"', '"say ""hello"""'],
        ['newline', 'a\nb', '"a\nb"'],
        ['null', null, ''],
        ['number', 42, '42'],
    ])('escapes %s', (_label, value, expected) => {
        expect(csvField(value)).toBe(expected);
        expect(parseCsvRecords(csvField(value), { strict: true })[0]?.cells[0] ?? '').toBe(String(value ?? ''));
    });
});
