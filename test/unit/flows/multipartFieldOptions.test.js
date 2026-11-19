// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { multipartFieldOptions } from '../../../packages/core/src/flows/multipartFieldOptions.js';
import { multipartFieldReasons } from '../../../packages/core/src/flows/multipartFieldReasons.js';
import { multipartMethodSummaries } from '../../../packages/core/src/flows/multipartMethodOptions.js';
import {
    multipartSupportForMethod,
} from '../../../packages/core/src/flows/multipartMethodSupport.js';
import { previewMultipartQuotes } from '../../../packages/core/src/flows/multipartQuotePreview.js';
import {
    bitcoinDescriptors,
    dogecoinDescriptors,
} from '../../../packages/core/src/registry/descriptors/index.js';

const METHODS = ['taproot', 'standard'];
const SOFTWARE = Object.freeze({ source: 'hd', label: 'Primary' });
const STANDARD_MAX_BYTES = 531_488_850;

class LengthStub extends Uint8Array {
    get byteLength() { return STANDARD_MAX_BYTES + 1; }
}

const BITCOIN = bitcoinDescriptors.find(({ networkKind }) => networkKind === 'regtest');
const DOGECOIN = dogecoinDescriptors.find(({ networkKind }) => networkKind === 'regtest');
const LANES = Object.freeze({
    envelope: Object.freeze({ type: 'envelope', outputFloor: 546, revealPad: false }),
    standard: Object.freeze({ type: 'standard', outputFloor: 546 }),
});
const SIZES = Object.freeze({
    envelopePairVbytes: (partBytes) => partBytes + 100,
    standardPairBytes: (partBytes) => partBytes + 100,
});
const EMPTY = Object.freeze({
    reason: null, cap: null, multipart: false, pending: false, summary: null, fee: null,
});

function supportFor(descriptor = BITCOIN, addressType = 'p2wpkh', addressRecord = SOFTWARE) {
    return Object.fromEntries(METHODS.map((method) => [method, multipartSupportForMethod({
        method, descriptor, addressRecord, addressType,
    })]));
}

async function realQuoteOptions(byteLength) {
    const bytes = byteLength instanceof Uint8Array
        ? byteLength
        : Uint8Array.from(randomBytes(byteLength));
    const preview = await previewMultipartQuotes({
        bytes,
        meta: {}, gate: null, rate: 2, methods: METHODS, lanes: LANES, sizes: SIZES,
    });
    const summaries = multipartMethodSummaries(preview.quotes);
    const fields = multipartFieldReasons(preview);
    return Object.fromEntries(METHODS.map((method) => [method, {
        ...summaries[method],
        reason: fields.reasons[method],
        cap: fields.caps[method],
        single: fields.single[method],
    }]));
}

function input(overrides = {}) {
    return {
        singleReasons: { taproot: 'tooLarge', standard: 'tooLarge' },
        singleFits: { taproot: false, standard: false },
        quoteOptions: null,
        support: supportFor(),
        ...overrides,
    };
}

function expectInvalid(overrides, field) {
    expect(() => multipartFieldOptions(input(overrides))).toThrow(expect.objectContaining({
        name: 'TypeError', code: 'MULTIPART_FIELD_OPTIONS_INVALID',
        message: expect.stringContaining(field),
    }));
}

describe('settled multipart field options', () => {
    it('shows a large Bitcoin file as taproot multipart and refuses Standard at its cap', async () => {
        const bytes = new LengthStub(randomBytes(400_000));
        const quoteOptions = await realQuoteOptions(bytes);
        const result = multipartFieldOptions(input({ quoteOptions }));
        expect(result.options.taproot).toMatchObject({
            reason: null, multipart: true, pending: false,
            summary: '2 parts, 7 transactions', fee: expect.any(Number),
        });
        expect(result.options.standard).toEqual({
            ...EMPTY, reason: 'tooLarge', cap: STANDARD_MAX_BYTES,
        });
        expect(result.reasons).toEqual({ taproot: null, standard: 'tooLarge' });
        expect(result.ready).toBe(true);
    });

    it('keeps a fitting taproot display while Standard supersedes tooLarge', async () => {
        const quoteOptions = await realQuoteOptions(20_000);
        const result = multipartFieldOptions(input({
            singleReasons: { taproot: null, standard: 'tooLarge' },
            singleFits: { taproot: true, standard: false },
            quoteOptions,
        }));
        expect(result.options.taproot).toEqual({ ...EMPTY });
        expect(result.options.standard).toMatchObject({
            reason: null, multipart: true,
            summary: '3 parts, 9 transactions', fee: expect.any(Number),
        });
    });
});

describe('single field reason precedence', () => {
    it.each(['hardware', 'noTaproot'])('keeps %s when a quote is present', async (reason) => {
        const quoteOptions = await realQuoteOptions(400_000);
        const descriptor = reason === 'noTaproot' ? DOGECOIN : BITCOIN;
        const addressRecord = reason === 'hardware' ? { source: 'trezor' } : SOFTWARE;
        const result = multipartFieldOptions(input({
            singleReasons: { taproot: reason, standard: 'tooLarge' },
            quoteOptions,
            support: supportFor(descriptor, 'p2wpkh', addressRecord),
        }));
        expect(result.options.taproot).toEqual({ ...EMPTY, reason });
    });
});

describe('method support precedence', () => {
    it('uses a real sourceType refusal before a Standard quote', async () => {
        const quoteOptions = await realQuoteOptions(20_000);
        const result = multipartFieldOptions(input({
            quoteOptions,
            support: supportFor(BITCOIN, 'p2tr'),
        }));
        expect(result.options.standard).toEqual({ ...EMPTY, reason: 'sourceType' });
    });
});

describe('unsettled quote options', () => {
    it('marks only the non-fitting supported method pending', () => {
        const result = multipartFieldOptions(input({
            singleReasons: { taproot: null, standard: 'tooLarge' },
            singleFits: { taproot: true, standard: false },
        }));
        expect(result.options.taproot).toEqual({ ...EMPTY });
        expect(result.options.standard).toEqual({
            ...EMPTY, multipart: true, pending: true,
        });
        expect(result.reasons).toEqual({ taproot: null, standard: null });
        expect(result.ready).toBe(false);
    });
});

describe('settled quote fallback', () => {
    it.each([
        ['existing tooLarge', 'tooLarge', 'tooLarge'],
        ['missing single reason', null, 'tooLarge'],
    ])('uses %s for an unquoted method', (_label, singleReason, expected) => {
        const quoteOptions = {
            taproot: { summary: null, fee: null, reason: null, cap: null, single: false },
            standard: { summary: null, fee: null, reason: null, cap: null, single: false },
        };
        const result = multipartFieldOptions(input({
            singleReasons: { taproot: singleReason, standard: 'tooLarge' }, quoteOptions,
        }));
        expect(result.options.taproot).toEqual({ ...EMPTY, reason: expected });
    });
});

describe('input shape refusals', () => {
    it.each([
        ['singleReasons', { singleReasons: null }, 'singleReasons'],
        ['singleReasons method', { singleReasons: { taproot: null } }, 'singleReasons.standard'],
        ['empty reason', { singleReasons: { taproot: '', standard: null } }, 'singleReasons.taproot'],
        ['reason type', { singleReasons: { taproot: 7, standard: null } }, 'singleReasons.taproot'],
        ['singleFits', { singleFits: [] }, 'singleFits'],
        ['singleFits method', { singleFits: { taproot: false } }, 'singleFits.standard'],
        ['fit type', { singleFits: { taproot: 1, standard: false } }, 'singleFits.taproot'],
        ['support', { support: null }, 'support'],
        ['support method', { support: { taproot: { supported: true } } }, 'support.standard'],
        ['support state', { support: { taproot: {}, standard: { supported: true } } }, 'support.taproot'],
        ['refusal reason', { support: {
            taproot: { supported: false, reason: '' }, standard: { supported: true },
        } }, 'support.taproot'],
        ['quoteOptions', { quoteOptions: [] }, 'quoteOptions'],
        ['quote method', { quoteOptions: { taproot: {} } }, 'quoteOptions.standard'],
        ['quote entry', { quoteOptions: { taproot: null, standard: {} } }, 'quoteOptions.taproot'],
    ])('refuses invalid %s', (_label, overrides, field) => {
        expectInvalid(overrides, field);
    });
});

describe('result ownership', () => {
    it('returns fresh objects and leaves every input unchanged', () => {
        const frozen = Object.freeze({
            singleReasons: Object.freeze({ taproot: 'tooLarge', standard: 'tooLarge' }),
            singleFits: Object.freeze({ taproot: false, standard: false }),
            quoteOptions: Object.freeze({
                taproot: Object.freeze({ single: true }),
                standard: Object.freeze({ reason: 'tooLarge', cap: 259_648 }),
            }),
            support: Object.freeze({
                taproot: Object.freeze({ supported: true }),
                standard: Object.freeze({ supported: true }),
            }),
        });
        const before = structuredClone(frozen);
        const first = multipartFieldOptions(frozen);
        const second = multipartFieldOptions(frozen);
        expect(first).not.toBe(second);
        expect(first.options).not.toBe(second.options);
        expect(first.options.taproot).not.toBe(second.options.taproot);
        expect(first.reasons).not.toBe(second.reasons);
        first.options.taproot.reason = 'changed';
        expect(second.options.taproot.reason).toBeNull();
        expect(frozen).toEqual(before);
    });
});
