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
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
    useMultipartUploadMethod,
} from '../../../packages/core/src/shared/hooks/useMultipartUploadMethod.js';
import {
    bitcoinDescriptors,
    dogecoinDescriptors,
} from '../../../packages/core/src/registry/descriptors/index.js';
import {
    MULTIPART_FILE_MAX_PARTS,
    multipartPartCapacity,
} from '../../../packages/core/src/flows/fileSizeLimits.js';

const BITCOIN = bitcoinDescriptors.find(({ networkKind }) => networkKind === 'regtest');
const DOGECOIN = dogecoinDescriptors.find(({ networkKind }) => networkKind === 'regtest');
const SOFTWARE = Object.freeze({ source: 'hd', label: 'Primary' });
// The Standard cap sizes every part for the widest index a 65,535-part file uses.
const STANDARD_MAX_BYTES = MULTIPART_FILE_MAX_PARTS
    * multipartPartCapacity('STANDARD', String(MULTIPART_FILE_MAX_PARTS - 1).length);

class LengthStub extends Uint8Array {
    get byteLength() { return STANDARD_MAX_BYTES + 1; }
}

const LANES = Object.freeze({
    envelope: Object.freeze({ type: 'envelope', outputFloor: 546, revealPad: false }),
    standard: Object.freeze({ type: 'standard', outputFloor: 546 }),
});
const SIZES = Object.freeze({
    envelopePairVbytes: (partBytes) => partBytes + 100,
    standardPairBytes: (partBytes) => partBytes + 100,
});

function props(overrides = {}) {
    return {
        bytes: new Uint8Array([1, 2, 3]),
        meta: { name: 'upload.bin' },
        rate: 2,
        descriptor: BITCOIN,
        addressRecord: SOFTWARE,
        addressType: 'p2wpkh',
        singleReasons: { taproot: 'tooLarge', standard: 'tooLarge' },
        singleFits: { taproot: false, standard: false },
        lanes: LANES,
        sizes: SIZES,
        ...overrides,
    };
}

function previewResult(overrides = {}) {
    return {
        quotes: { taproot: null, standard: null },
        reasons: { taproot: null, standard: null },
        ...overrides,
    };
}

function quoted(method, parts = 2, fee = 123) {
    return previewResult({
        quotes: {
            taproot: null,
            standard: null,
            [method]: {
                parts, transactions: 1 + (2 * (parts + 1)), fee, fundingTotal: fee,
            },
        },
    });
}

function mount(initialProps) {
    return renderHook((input) => useMultipartUploadMethod(input), { initialProps });
}

async function settled(result) {
    await waitFor(() => expect(result.current.loading).toBe(false));
}

describe('real multipart upload method preview', () => {
    it('shows the Taproot quote and the Standard multipart cap', async () => {
        const bytes = new LengthStub(randomBytes(400_000));
        const hook = mount(props({ bytes }));
        await settled(hook.result);
        expect(hook.result.current.options.taproot).toMatchObject({
            reason: null, multipart: true, summary: '2 parts, 7 transactions',
            fee: expect.any(Number),
        });
        expect(hook.result.current.options.standard).toMatchObject({
            reason: 'tooLarge', cap: STANDARD_MAX_BYTES, multipart: false,
        });
        expect(hook.result.current.reasons).toEqual({ taproot: null, standard: 'tooLarge' });
        expect(hook.result.current).toMatchObject({ ready: true, loading: false, error: null });
    });
});

describe('method planning boundaries', () => {
    it('plans both eligible methods in display order', async () => {
        const preview = vi.fn().mockResolvedValue(quoted('taproot'));
        const hook = mount(props({ preview }));
        await waitFor(() => expect(preview).toHaveBeenCalledOnce());
        expect(preview).toHaveBeenCalledWith(expect.objectContaining({
            methods: ['taproot', 'standard'],
        }));
        await settled(hook.result);
    });

    it('plans only Standard when Dogecoin has no Taproot envelope', async () => {
        const preview = vi.fn().mockResolvedValue(quoted('standard', 3));
        const hook = mount(props({
            descriptor: DOGECOIN, addressType: 'p2pkh', preview,
            singleReasons: { taproot: 'noTaproot', standard: 'tooLarge' },
        }));
        await settled(hook.result);
        expect(preview).toHaveBeenCalledWith(expect.objectContaining({ methods: ['standard'] }));
        expect(hook.result.current.reasons.taproot).toBe('noTaproot');
        expect(hook.result.current.options.standard.summary).toBe('3 parts, 9 transactions');
    });

    it('plans nothing for hardware or two fitting methods', () => {
        const hardwarePreview = vi.fn();
        const hardware = mount(props({
            addressRecord: { source: 'trezor' }, preview: hardwarePreview,
        }));
        expect(hardwarePreview).not.toHaveBeenCalled();
        expect(hardware.result.current.reasons).toEqual({
            taproot: 'hardware', standard: 'hardware',
        });
        const fittingPreview = vi.fn();
        const fitting = mount(props({
            preview: fittingPreview,
            singleReasons: { taproot: null, standard: null },
            singleFits: { taproot: true, standard: true },
        }));
        expect(fittingPreview).not.toHaveBeenCalled();
        expect(fitting.result.current.ready).toBe(true);
    });

    it('plans only Taproot for a Bitcoin p2tr source', async () => {
        const preview = vi.fn().mockResolvedValue(quoted('taproot'));
        const hook = mount(props({ addressType: 'p2tr', preview }));
        await settled(hook.result);
        expect(preview).toHaveBeenCalledWith(expect.objectContaining({ methods: ['taproot'] }));
        expect(hook.result.current.options.standard.reason).toBe('sourceType');
    });
});

describe('preview dependencies', () => {
    it('calls once per triggering input change and ignores fresh estimators', async () => {
        const preview = vi.fn().mockResolvedValue(quoted('taproot'));
        const base = props({ preview, singleFits: { taproot: false, standard: true } });
        const hook = mount(base);
        await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
        hook.rerender({ ...base, lanes: { ...LANES }, sizes: { ...SIZES } });
        expect(preview).toHaveBeenCalledTimes(1);
        const bytes = new Uint8Array([4]);
        hook.rerender({ ...base, bytes });
        await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
        hook.rerender({ ...base, bytes, rate: 3 });
        await waitFor(() => expect(preview).toHaveBeenCalledTimes(3));
        hook.rerender({ ...base, bytes, rate: 3, gated: true });
        await waitFor(() => expect(preview).toHaveBeenCalledTimes(4));
    });
});

describe('preview failures', () => {
    it('keeps the rejected error code and is not ready', async () => {
        const failure = Object.assign(new Error('preview failed'), { code: 'PREVIEW_FAILED' });
        const hook = mount(props({ preview: vi.fn().mockRejectedValue(failure) }));
        await waitFor(() => expect(hook.result.current.error).toBe(failure));
        expect(hook.result.current.error.code).toBe('PREVIEW_FAILED');
        expect(hook.result.current.ready).toBe(false);
        expect(hook.result.current.loading).toBe(false);
    });
});

describe('field option failures', () => {
    it('keeps the invalid input error in render without throwing', () => {
        const { result } = mount(props({ singleReasons: null, preview: vi.fn() }));
        expect(result.current).toMatchObject({
            options: null, reasons: null, ready: false, loading: false,
        });
        expect(result.current.error?.code).toBe('MULTIPART_FIELD_OPTIONS_INVALID');
    });
});

describe('method support failures', () => {
    it('keeps a support error and never calls the preview', () => {
        const failure = Object.assign(new Error('support failed'), { code: 'SUPPORT_FAILED' });
        const descriptor = new Proxy(BITCOIN, {
            get(target, property) {
                if (property === 'taprootEnvelope') throw failure;
                return Reflect.get(target, property);
            },
        });
        const preview = vi.fn();
        const { result } = mount(props({ descriptor, preview }));
        expect(result.current).toEqual({
            options: null, reasons: null, ready: false,
            error: failure, loading: false,
        });
        expect(preview).not.toHaveBeenCalled();
    });
});

describe('input ownership', () => {
    it('does not mutate any input', async () => {
        const bytes = new Uint8Array([1, 2, 3]);
        const singleReasons = Object.freeze({ taproot: 'tooLarge', standard: 'tooLarge' });
        const singleFits = Object.freeze({ taproot: false, standard: false });
        const meta = Object.freeze({ name: 'frozen.bin' });
        const gate = Object.freeze({ ticker: 'TEST', minAmount: 42 });
        const descriptor = Object.freeze({ ...BITCOIN });
        const addressRecord = Object.freeze({ source: 'hd', label: 'Frozen' });
        const before = {
            bytes: bytes.slice(),
            descriptor: structuredClone(descriptor),
            singleReasons: { ...singleReasons },
            singleFits: { ...singleFits },
        };
        const preview = vi.fn().mockResolvedValue(quoted('taproot'));
        const hook = mount(props({
            bytes, meta, gated: true, gate, descriptor,
            addressRecord, singleReasons, singleFits, preview,
        }));
        await settled(hook.result);
        expect(bytes).toEqual(before.bytes);
        expect(descriptor).toEqual(before.descriptor);
        expect({ singleReasons, singleFits }).toEqual({
            singleReasons: before.singleReasons, singleFits: before.singleFits,
        });
        expect(meta).toEqual({ name: 'frozen.bin' });
        expect(gate).toEqual({ ticker: 'TEST', minAmount: 42 });
        expect(addressRecord).toEqual({ source: 'hd', label: 'Frozen' });
        expect(preview.mock.calls[0][0]).toMatchObject({ bytes, meta, rate: 2 });
    });
});
