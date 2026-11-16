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
import { multipartFieldReasons } from '../../../packages/core/src/flows/multipartFieldReasons.js';

function preview(method, reason, quote = null) {
    return {
        quotes: { taproot: null, standard: null, [method]: quote },
        reasons: { taproot: null, standard: null, [method]: reason },
    };
}

function expectInvalid(input, subject) {
    let failure;
    try { multipartFieldReasons(input); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(TypeError);
    expect(failure).toMatchObject({ code: 'MULTIPART_FIELD_REASONS_INVALID' });
    expect(failure.message).toContain(subject);
}

describe('multipart field size refusal mapping', () => {
    it.each([
        ['taproot', 'TOO_MANY_PARTS', 12_000_000],
        ['standard', 'TOO_MANY_PARTS', 259_648],
        ['taproot', 'ORIGINAL_BYTES_TOO_LARGE', 12_000_000],
        ['standard', 'ORIGINAL_BYTES_TOO_LARGE', 12_000_000],
        ['taproot', 'STORED_BYTES_TOO_LARGE', 12_000_000],
        ['standard', 'STORED_BYTES_TOO_LARGE', 12_000_000],
    ])('maps %s %s to tooLarge with cap %i', (method, code, cap) => {
        const result = multipartFieldReasons(preview(method, code));
        expect(result.reasons[method]).toBe('tooLarge');
        expect(result.caps[method]).toBe(cap);
        expect(result.single[method]).toBe(false);
    });

    it('derives the Standard part-count cap from 32 parts of 8114 bytes', () => {
        const result = multipartFieldReasons(preview('standard', 'TOO_MANY_PARTS'));
        expect(result.caps.standard).toBe(32 * 8_114);
    });
});

describe('multipart field available option mapping', () => {
    it.each(['taproot', 'standard'])('marks a %s single-part option as available', (method) => {
        const result = multipartFieldReasons(preview(method, 'SINGLE_PART'));
        expect(result.reasons[method]).toBeNull();
        expect(result.caps[method]).toBeNull();
        expect(result.single[method]).toBe(true);
    });

    it.each(['taproot', 'standard'])('keeps a quoted %s option available', (method) => {
        const result = multipartFieldReasons(preview(method, null, { fee: 123 }));
        expect(result.reasons[method]).toBeNull();
        expect(result.caps[method]).toBeNull();
        expect(result.single[method]).toBe(false);
    });

    it('leaves an unquoted option without a reason untouched', () => {
        expect(multipartFieldReasons(preview('taproot', null))).toEqual({
            reasons: { taproot: null, standard: null },
            caps: { taproot: null, standard: null },
            single: { taproot: false, standard: false },
        });
    });
});

describe('multipart field reason validation', () => {
    it.each([
        ['taproot', 'EMPTY_FILE'],
        ['standard', 'GATE_IV_INVALID'],
        ['taproot', 7],
    ])('refuses an unsupported %s reason', (method, reason) => {
        expectInvalid(preview(method, reason), method);
    });

    it.each(['taproot', 'standard'])('refuses a %s quote with a reason', (method) => {
        expectInvalid(preview(method, 'SINGLE_PART', { fee: 123 }), method);
    });
});

describe('multipart field reason shape validation', () => {
    it.each([
        [null, 'preview'],
        [[], 'preview'],
        [{ reasons: {} }, 'quotes'],
        [{ quotes: null, reasons: {} }, 'quotes'],
        [{ quotes: [], reasons: {} }, 'quotes'],
        [{ quotes: {} }, 'reasons'],
        [{ quotes: {}, reasons: null }, 'reasons'],
        [{ quotes: {}, reasons: [] }, 'reasons'],
    ])('refuses malformed input %#', (input, subject) => {
        expectInvalid(input, subject);
    });
});

describe('multipart field reason result ownership', () => {
    it('returns fresh outer and nested objects on every call', () => {
        const input = preview('taproot', 'TOO_MANY_PARTS');
        const first = multipartFieldReasons(input);
        const second = multipartFieldReasons(input);
        expect(first).not.toBe(second);
        expect(first.reasons).not.toBe(second.reasons);
        expect(first.caps).not.toBe(second.caps);
        expect(first.single).not.toBe(second.single);
        first.reasons.taproot = 'changed';
        expect(second.reasons.taproot).toBe('tooLarge');
    });
});
