// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';

import {
    LIST_META_DESCRIPTION_MAX_BYTES,
    LIST_META_NAME_MAX_BYTES,
    listMetaInputError,
    utf8ByteLength,
} from '../../../packages/core/src/flows/listMetaInput.js';

const FIELDS = [
    ['name', LIST_META_NAME_MAX_BYTES],
    ['description', LIST_META_DESCRIPTION_MAX_BYTES],
];

describe('listMetaInputError', () => {
    it('exports the protocol byte caps', () => {
        expect(LIST_META_NAME_MAX_BYTES).toBe(64);
        expect(LIST_META_DESCRIPTION_MAX_BYTES).toBe(512);
    });

    it.each(FIELDS)('accepts an empty %s', (field) => {
        expect(listMetaInputError(field, '', { isCreate: true })).toBeNull();
    });

    it.each(FIELDS)('reports every %s input error in field-rule order', (field, cap) => {
        expect(listMetaInputError(field, `${'a'.repeat(cap + 1)};|`, { isCreate: true }))
            .toBe('pipe');
        expect(listMetaInputError(field, `${'a'.repeat(cap + 1)};`, { isCreate: true }))
            .toBe('semicolon');
        expect(listMetaInputError(field, 'a'.repeat(cap + 1), { isCreate: true }))
            .toBe('length');
        expect(listMetaInputError(field, '-', { isCreate: true })).toBe('format');
    });

    it.each(FIELDS)('counts a four-byte emoji at and over the %s cap', (field, cap) => {
        const atCap = `${'a'.repeat(cap - 4)}😀`;
        const overCap = `${'a'.repeat(cap - 3)}😀`;

        expect(utf8ByteLength('😀')).toBe(4);
        expect(utf8ByteLength(atCap)).toBe(cap);
        expect(listMetaInputError(field, atCap, { isCreate: true })).toBeNull();
        expect(utf8ByteLength(overCap)).toBe(cap + 1);
        expect(listMetaInputError(field, overCap, { isCreate: true })).toBe('length');
    });

    it.each(FIELDS)('accepts the clear sentinel when setting %s', (field) => {
        expect(listMetaInputError(field, '-', { isCreate: false })).toBeNull();
    });
});
