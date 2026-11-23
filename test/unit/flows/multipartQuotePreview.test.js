// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { previewMultipartQuotes } from '../../../packages/core/src/flows/multipartQuotePreview.js';
import {
    MULTIPART_FILE_MAX_PARTS,
    multipartPartCapacity,
} from '../../../packages/core/src/flows/fileSizeLimits.js';

// The Standard cap sizes every part for the widest index a 65,535-part file uses.
const STANDARD_MAX_BYTES = MULTIPART_FILE_MAX_PARTS
    * multipartPartCapacity('STANDARD', String(MULTIPART_FILE_MAX_PARTS - 1).length);

class LengthStub extends Uint8Array {
    get byteLength() { return STANDARD_MAX_BYTES + 1; }
}

const lanes = Object.freeze({
    envelope: Object.freeze({ type: 'envelope', outputFloor: 546, revealPad: false }),
    standard: Object.freeze({ type: 'standard', outputFloor: 546 }),
});
const sizes = Object.freeze({
    envelopePairVbytes: (partBytes) => partBytes + 100,
    standardPairBytes: (partBytes) => partBytes + 100,
});

function spyInput(overrides = {}) {
    return {
        bytes: new Uint8Array([1, 2, 3]),
        meta: { name: 'quote.bin' },
        gate: { ticker: 'TEST' },
        rate: 2,
        methods: ['taproot', 'standard'],
        lanes,
        sizes,
        ...overrides,
    };
}

function multipartPlan(carrier) {
    return {
        carrier,
        parts: [{ bytes: new Uint8Array([1]) }, { bytes: new Uint8Array([2]) }],
        totalParts: 2,
    };
}

describe('multipart quote preview with the real planner and quoter', () => {
    it('quotes a two-part envelope while isolating the Standard part cap', async () => {
        const bytes = new LengthStub(randomBytes(400_000));
        const result = await previewMultipartQuotes({
            bytes, meta: {}, gate: null, rate: 2,
            methods: ['taproot', 'standard'], lanes, sizes,
        });
        expect(result.quotes.taproot).toMatchObject({ parts: 2, transactions: 7 });
        expect(result.quotes.standard).toBeNull();
        expect(result.reasons).toEqual({ taproot: null, standard: 'TOO_MANY_PARTS' });
    });

    it('quotes three Standard parts and skips a single-part envelope', async () => {
        const result = await previewMultipartQuotes({
            bytes: Uint8Array.from(randomBytes(20_000)), meta: {}, gate: null, rate: 2,
            methods: ['taproot', 'standard'], lanes, sizes,
        });
        expect(result.quotes.taproot).toBeNull();
        expect(result.quotes.standard).toMatchObject({ parts: 3, transactions: 9 });
        expect(result.reasons).toEqual({ taproot: 'SINGLE_PART', standard: null });
    });
});

describe('multipart quote preview option execution', () => {
    it('plans and quotes each listed method exactly once with the required arguments', async () => {
        const input = spyInput();
        const planner = vi.fn(async (_bytes, _meta, { carrier }) => multipartPlan(carrier));
        const quoter = vi.fn((plan) => ({
            parts: plan.totalParts, transactions: 7, fee: 123, fundingTotal: 999,
        }));
        const result = await previewMultipartQuotes({ ...input, planner, quoter });
        expect(planner).toHaveBeenCalledTimes(2);
        expect(planner).toHaveBeenNthCalledWith(1, input.bytes, input.meta, {
            carrier: 'envelope', gate: input.gate,
        });
        expect(planner).toHaveBeenNthCalledWith(2, input.bytes, input.meta, {
            carrier: 'standard', gate: input.gate,
        });
        expect(quoter).toHaveBeenNthCalledWith(1, expect.any(Object), 2, lanes.envelope, sizes);
        expect(quoter).toHaveBeenNthCalledWith(2, expect.any(Object), 2, lanes.standard, sizes);
        expect(quoter).toHaveBeenCalledTimes(2);
        expect(Object.keys(result.quotes.taproot)).toEqual([
            'parts', 'transactions', 'fee', 'fundingTotal',
        ]);
        expect(result.quotes.taproot).toEqual({
            parts: 2, transactions: 7, fee: 123, fundingTotal: 999,
        });
    });

    it('does not plan or quote an omitted method', async () => {
        const planner = vi.fn(async (_bytes, _meta, { carrier }) => multipartPlan(carrier));
        const quoter = vi.fn(() => ({
            parts: 2, transactions: 7, fee: 123, fundingTotal: 456,
        }));
        const result = await previewMultipartQuotes({
            ...spyInput({ methods: ['standard'] }), planner, quoter,
        });
        expect(planner).toHaveBeenCalledOnce();
        expect(planner.mock.calls[0][2].carrier).toBe('standard');
        expect(quoter).toHaveBeenCalledOnce();
        expect(result).toMatchObject({
            quotes: { taproot: null }, reasons: { taproot: null },
        });
    });

    it('never quotes a plan containing fewer than two parts', async () => {
        const planner = vi.fn(async () => ({ parts: [{ bytes: new Uint8Array([1]) }] }));
        const quoter = vi.fn();
        const result = await previewMultipartQuotes({
            ...spyInput({ methods: ['taproot'] }), planner, quoter,
        });
        expect(quoter).not.toHaveBeenCalled();
        expect(result.reasons.taproot).toBe('SINGLE_PART');
    });
});

describe('multipart quote preview planner errors', () => {
    it('isolates a coded RangeError and continues with the other option', async () => {
        const refusal = Object.assign(new RangeError('cannot plan'), { code: 'CUSTOM_LIMIT' });
        const planner = vi.fn(async (_bytes, _meta, { carrier }) => {
            if (carrier === 'envelope') throw refusal;
            return multipartPlan(carrier);
        });
        const quoter = vi.fn(() => ({
            parts: 2, transactions: 7, fee: 55, fundingTotal: 66,
        }));
        const result = await previewMultipartQuotes({ ...spyInput(), planner, quoter });
        expect(result).toEqual({
            quotes: {
                taproot: null,
                standard: { parts: 2, transactions: 7, fee: 55, fundingTotal: 66 },
            },
            reasons: { taproot: 'CUSTOM_LIMIT', standard: null },
        });
        expect(planner).toHaveBeenCalledTimes(2);
        expect(quoter).toHaveBeenCalledOnce();
    });

    it.each([
        new Error('planner failed'),
        new RangeError('uncoded range failure'),
        Object.assign(new TypeError('coded wrong type'), { code: 'WRONG_TYPE' }),
    ])('rejects an unrecoverable planner error unchanged', async (failure) => {
        const promise = previewMultipartQuotes({
            ...spyInput({ methods: ['taproot'] }), planner: async () => { throw failure; },
        });
        await expect(promise).rejects.toBe(failure);
    });
});

describe('multipart quote preview input validation', () => {
    it.each([
        ['bytes', { bytes: null }],
        ['bytes', { bytes: new Uint8Array() }],
        ['bytes', { bytes: new Uint16Array([1]) }],
        ['rate', { rate: 0 }],
        ['rate', { rate: Infinity }],
        ['rate', { rate: '2' }],
        ['methods', { methods: ['legacy'] }],
        ['methods', { methods: ['taproot', 'taproot'] }],
        ['lanes.envelope', { lanes: { standard: lanes.standard } }],
        ['lanes.standard', { lanes: { envelope: lanes.envelope } }],
    ])('refuses invalid %s before planning', async (field, overrides) => {
        const planner = vi.fn();
        const promise = previewMultipartQuotes({ ...spyInput(overrides), planner });
        await expect(promise).rejects.toMatchObject({ code: 'MULTIPART_PREVIEW_INVALID' });
        await expect(promise).rejects.toThrow(field);
        expect(planner).not.toHaveBeenCalled();
    });

    it('does not mutate any input', async () => {
        const input = spyInput({ methods: Object.freeze(['taproot']) });
        Object.freeze(input.meta);
        Object.freeze(input.gate);
        const snapshot = [...input.bytes];
        const planner = vi.fn(async (_bytes, _meta, { carrier }) => multipartPlan(carrier));
        await previewMultipartQuotes({ ...Object.freeze(input), planner });
        expect([...input.bytes]).toEqual(snapshot);
        expect(input).toEqual(spyInput({ bytes: input.bytes, methods: input.methods }));
    });
});
