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
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useMultipartQuotePreview } from '../../../packages/core/src/shared/hooks/useMultipartQuotePreview.js';
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

const methods = ['taproot', 'standard'];
const lanes = {
    envelope: { type: 'envelope', outputFloor: 546, revealPad: false },
    standard: { type: 'standard', outputFloor: 546 },
};
const sizes = {
    envelopePairVbytes: (partBytes) => partBytes + 100,
    standardPairBytes: (partBytes) => partBytes + 100,
};

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function resultWith(fee = 123) {
    return {
        quotes: {
            taproot: { parts: 2, transactions: 7, fee, fundingTotal: fee },
            standard: {
                parts: 3, transactions: 9, fee: fee + 1, fundingTotal: fee + 1,
            },
        },
        reasons: { taproot: null, standard: null },
    };
}

function props(overrides = {}) {
    return {
        bytes: new Uint8Array([1, 2, 3]),
        meta: { name: 'quote.bin' },
        rate: 2,
        methods,
        lanes,
        sizes,
        ...overrides,
    };
}

function mount(initialProps) {
    return renderHook((input) => useMultipartQuotePreview(input), { initialProps });
}

async function expectSettled(result) {
    await waitFor(() => expect(result.current.loading).toBe(false));
}

describe('real multipart quote previews', () => {
    it('maps a large file to a taproot summary and Standard cap', async () => {
        const bytes = new LengthStub(randomBytes(400_000));
        const { result } = mount(props({ bytes }));
        await expectSettled(result);
        expect(result.current.options.taproot.summary).toBe('2 parts, 7 transactions');
        expect(result.current.options.taproot.fee).toEqual(expect.any(Number));
        expect(result.current.options.standard).toMatchObject({
            summary: null, fee: null, reason: 'tooLarge', cap: STANDARD_MAX_BYTES, single: false,
        });
    });

    it('maps a smaller file to a Standard summary and single taproot option', async () => {
        const { result } = mount(props({ bytes: Uint8Array.from(randomBytes(20_000)) }));
        await expectSettled(result);
        expect(result.current.options.standard.summary).toBe('3 parts, 9 transactions');
        expect(result.current.options.standard.fee).toEqual(expect.any(Number));
        expect(result.current.options.taproot).toMatchObject({
            summary: null, fee: null, reason: null, cap: null, single: true,
        });
    });
});

describe('preview call dependencies', () => {
    it('calls once for each triggering input change and ignores fresh estimator objects', async () => {
        const preview = vi.fn().mockResolvedValue(resultWith());
        const firstBytes = new Uint8Array([1]);
        const base = props({ bytes: firstBytes, preview });
        const hook = mount(base);
        await expectSettled(hook.result);
        hook.rerender({ ...base, methods: [...methods], lanes: { ...lanes }, sizes: { ...sizes } });
        expect(preview).toHaveBeenCalledTimes(1);
        const secondBytes = new Uint8Array([1]);
        hook.rerender({ ...base, bytes: secondBytes });
        await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
        hook.rerender({ ...base, bytes: secondBytes, rate: 3 });
        await waitFor(() => expect(preview).toHaveBeenCalledTimes(3));
        hook.rerender({ ...base, bytes: secondBytes, rate: 3, gated: true });
        await waitFor(() => expect(preview).toHaveBeenCalledTimes(4));
        hook.rerender({ ...base, bytes: secondBytes, rate: 3, gated: true, methods: ['standard'] });
        await waitFor(() => expect(preview).toHaveBeenCalledTimes(5));
    });
});

describe('preview gate arguments', () => {
    it('uses zero placeholders with copied gate fields when gated', async () => {
        const preview = vi.fn().mockResolvedValue(resultWith());
        mount(props({ gated: true, gate: { ticker: 'TEST', minAmount: 42 }, preview }));
        await waitFor(() => expect(preview).toHaveBeenCalledOnce());
        expect(preview.mock.calls[0][0].gate).toEqual({
            ticker: 'TEST', minAmount: 42, key: new Uint8Array(32), iv: new Uint8Array(12),
        });
    });

    it('passes a null gate when ungated', async () => {
        const preview = vi.fn().mockResolvedValue(resultWith());
        mount(props({ gated: false, gate: { ticker: 'IGNORED', minAmount: 7 }, preview }));
        await waitFor(() => expect(preview).toHaveBeenCalledOnce());
        expect(preview.mock.calls[0][0].gate).toBeNull();
    });
});

describe('inactive preview inputs', () => {
    it.each([
        ['null bytes', { bytes: null }],
        ['empty bytes', { bytes: new Uint8Array() }],
        ['empty methods', { methods: [] }],
    ])('does not call preview for %s', (_label, override) => {
        const preview = vi.fn();
        const { result } = mount(props({ ...override, preview }));
        expect(preview).not.toHaveBeenCalled();
        expect(result.current).toEqual({ loading: false, options: null, error: null });
    });
});

describe('preview failures', () => {
    it('fails without calling preview when the fee-rate source answers with no rate', async () => {
        const preview = vi.fn();
        const { result } = mount(props({ rate: null, preview }));
        await waitFor(() => expect(result.current.error?.code).toBe('MULTIPART_QUOTE_RATE_UNAVAILABLE'));
        expect(result.current).toEqual({
            loading: false,
            options: null,
            error: expect.objectContaining({ code: 'MULTIPART_QUOTE_RATE_UNAVAILABLE' }),
        });
        expect(preview).not.toHaveBeenCalled();
    });

    it('keeps a rejected error and its code without options', async () => {
        const failure = Object.assign(new Error('preview failed'), { code: 'PREVIEW_FAILED' });
        const { result } = mount(props({ preview: vi.fn().mockRejectedValue(failure) }));
        await waitFor(() => expect(result.current.error).toBe(failure));
        expect(result.current).toEqual({ loading: false, options: null, error: failure });
    });

    it('keeps a mapper error and its code without partial options', async () => {
        const invalid = resultWith();
        invalid.quotes.taproot.transactions = 8;
        const { result } = mount(props({ preview: vi.fn().mockResolvedValue(invalid) }));
        await waitFor(() => expect(result.current.error?.code).toBe('MULTIPART_QUOTE_INVALID'));
        expect(result.current.options).toBeNull();
        expect(result.current.loading).toBe(false);
    });
});

describe('stale preview results', () => {
    it('drops an earlier result that resolves after changed inputs', async () => {
        const first = deferred();
        const second = deferred();
        const preview = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        const hook = mount(props({ preview }));
        hook.rerender(props({ bytes: new Uint8Array([4]), preview }));
        await act(async () => { second.resolve(resultWith(200)); });
        expect(hook.result.current.options.taproot.fee).toBe(200);
        await act(async () => { first.resolve(resultWith(100)); });
        expect(hook.result.current.options.taproot.fee).toBe(200);
    });
});

describe('unmounted preview results', () => {
    it('drops a result that resolves after unmount', async () => {
        const pending = deferred();
        const hook = mount(props({ preview: vi.fn().mockReturnValue(pending.promise) }));
        const before = hook.result.current;
        hook.unmount();
        await act(async () => { pending.resolve(resultWith()); });
        expect(hook.result.current).toBe(before);
    });
});

describe('preview loading state', () => {
    it('keeps working without calling preview while the fee rate is still being fetched', () => {
        const preview = vi.fn();
        const { result } = mount(props({ rate: undefined, preview }));
        expect(result.current).toEqual({ loading: true, options: null, error: null });
        expect(preview).not.toHaveBeenCalled();
    });

    it('stays loading from the call until it settles', async () => {
        const pending = deferred();
        const { result } = mount(props({ preview: vi.fn().mockReturnValue(pending.promise) }));
        expect(result.current).toEqual({ loading: true, options: null, error: null });
        await act(async () => { pending.resolve(resultWith()); });
        expect(result.current.loading).toBe(false);
        expect(result.current.options.taproot.summary).toBe('2 parts, 7 transactions');
        expect(result.current.error).toBeNull();
    });
});
