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
import { chooseFileUploadPath } from '../../../packages/core/src/flows/fileUploadPath.js';

const MAX_BYTES = 262_140_000_000;
const ENVELOPE = Object.freeze({ supported: true, lane: 'envelope', buildMode: 'one_call' });
const STANDARD = Object.freeze({ supported: true, lane: 'standard', buildMode: 'two_step' });

function choose(byteLength, support = ENVELOPE, singleTransactionCap = 8_000) {
    return chooseFileUploadPath({ byteLength, singleTransactionCap, support });
}

function expectInvalid(input, field) {
    try {
        chooseFileUploadPath(input);
        throw new Error('expected chooseFileUploadPath to throw');
    } catch (error) {
        expect(error).toBeInstanceOf(TypeError);
        expect(error).toMatchObject({ code: 'FILE_UPLOAD_PATH_INVALID' });
        expect(error.message).toContain(field);
    }
}

describe('chooseFileUploadPath single-transaction boundary', () => {
    it('keeps a file at the cap single and sends the next byte multipart', () => {
        expect(choose(8_000)).toEqual({ path: 'single', maxBytes: MAX_BYTES });
        expect(choose(8_001)).toEqual({
            path: 'multipart', lane: 'envelope', buildMode: 'one_call', maxBytes: MAX_BYTES,
        });
    });

    it('keeps a cap above the multipart bound as the maximum', () => {
        const cap = MAX_BYTES + 10;
        expect(choose(cap, STANDARD, cap)).toEqual({ path: 'single', maxBytes: cap });
        expect(choose(cap + 1, STANDARD, cap)).toEqual({
            path: 'refused', reason: 'too_large', maxBytes: cap,
        });
    });
});

describe('chooseFileUploadPath multipart boundary', () => {
    it.each([
        [ENVELOPE, 'envelope', 'one_call'],
        [STANDARD, 'standard', 'two_step'],
    ])('accepts the public maximum on the %s lane', (support, lane, buildMode) => {
        expect(choose(MAX_BYTES, support)).toEqual({
            path: 'multipart', lane, buildMode, maxBytes: MAX_BYTES,
        });
    });

    it.each([ENVELOPE, STANDARD])('refuses the next byte on a supported lane', (support) => {
        expect(choose(MAX_BYTES + 1, support)).toEqual({
            path: 'refused', reason: 'too_large', maxBytes: MAX_BYTES,
        });
    });
});

describe('chooseFileUploadPath unsupported lanes', () => {
    it.each(['watcher', 'hardware', 'watchOnly', 'signer', 'sourceType'])(
        'keeps the single-transaction cap for %s',
        (reason) => {
            expect(choose(8_001, { supported: false, reason })).toEqual({
                path: 'refused', reason, maxBytes: 8_000,
            });
        },
    );

    it('still chooses single below the cap', () => {
        expect(choose(7_999, { supported: false, reason: 'hardware' })).toEqual({
            path: 'single', maxBytes: 8_000,
        });
    });
});

describe('chooseFileUploadPath input contract', () => {
    it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '1', null])(
        'refuses invalid byteLength %#',
        (byteLength) => expectInvalid(
            { byteLength, singleTransactionCap: 8_000, support: ENVELOPE },
            'byteLength',
        ),
    );

    it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '8000', null])(
        'refuses invalid singleTransactionCap %#',
        (singleTransactionCap) => expectInvalid(
            { byteLength: 1, singleTransactionCap, support: ENVELOPE },
            'singleTransactionCap',
        ),
    );

    it.each([
        [null, 'support'], [{}, 'support.supported'], [{ supported: 1 }, 'support.supported'],
        [{ supported: true, lane: 'other', buildMode: 'one_call' }, 'support.lane'],
        [{ supported: true, lane: 'envelope', buildMode: ' ' }, 'support.buildMode'],
        [{ supported: false, reason: '' }, 'support.reason'],
    ])('refuses invalid support %#', (support, field) => {
        expectInvalid({ byteLength: 1, singleTransactionCap: 8_000, support }, field);
    });

    it('does not mutate its input or support', () => {
        const support = Object.freeze({ supported: true, lane: 'standard', buildMode: 'one_call' });
        const input = Object.freeze({ byteLength: 8_001, singleTransactionCap: 8_000, support });
        expect(chooseFileUploadPath(input)).toEqual({
            path: 'multipart', lane: 'standard', buildMode: 'one_call', maxBytes: MAX_BYTES,
        });
        expect(input).toEqual({ byteLength: 8_001, singleTransactionCap: 8_000, support });
    });
});
