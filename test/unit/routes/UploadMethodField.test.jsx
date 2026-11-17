// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The shared Upload method field and its hook: the options, their order, the
// Cheapest mark, the default, the disabled reasons, one fee estimate per
// option and the triggers that recompute it (never a keystroke).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { customFeeEstimate, estimateNativeSendFeeTiers } from '../../../packages/core/src/flows/feeEstimate.js';

vi.mock('../../../packages/core/src/flows/uploadMethod.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, estimateUploadMethodFees: vi.fn(actual.estimateUploadMethodFees) };
});

const uploadMethodLib = await import('../../../packages/core/src/flows/uploadMethod.js');
const {
    UploadMethodField,
    useUploadMethod,
    UPLOAD_METADATA_SETTLE_MS,
} = await import('../../../packages/core/src/shared/components/UploadMethodField.jsx');

const registry = defaultRegistry();
const BTC = registry.get('bitcoin-mainnet');
const LTC = registry.get('litecoin-mainnet');
const DOGE = registry.get('dogecoin-mainnet');
const tiers = estimateNativeSendFeeTiers({ chainId: 'bitcoin-mainnet', chainRegistry: registry });
const HD = { id: 'a1', address: 'bc1qexample', source: 'hd' };
const FILE = { name: 'art.png', type: 'image/png', bytes: new Uint8Array(2000) };
const sizeOf = (file, meta) => uploadMethodLib.publicFileCompiledBytes(
    { name: file.name, type: file.type, ...meta }, file.bytes.length,
);
const estimateCalls = () => uploadMethodLib.estimateUploadMethodFees.mock.calls.length;

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    uploadMethodLib.estimateUploadMethodFees.mockClear();
});

function baseArgs(overrides = {}) {
    return {
        descriptor: BTC,
        fromAddress: HD,
        isWatcherMode: false,
        feeEstimate: tiers.normal,
        coinTicker: 'BTC',
        file: FILE,
        metadata: { title: '', memo: '' },
        compiledBytesFor: sizeOf,
        standardCap: 8000,
        ...overrides,
    };
}

function Harness(props) {
    const upload = useUploadMethod(props);
    return <UploadMethodField upload={upload} />;
}

const trigger = () => screen.getByRole('button', { name: /^Upload method: / });
function openOptions() {
    fireEvent.click(trigger());
    return screen.getAllByRole('option');
}

describe('UploadMethodField', () => {
    it('lists Taproot upload first, marked Cheapest, then Standard, each with an icon and a fee', () => {
        render(<Harness {...baseArgs()} />);
        expect(trigger()).toHaveAccessibleName('Upload method: Taproot upload');
        const options = openOptions();
        expect(options).toHaveLength(2);
        expect(options[0]).toHaveTextContent(/^Taproot upload/);
        expect(options[0].querySelector('[data-upload-cheapest]')).toHaveTextContent('Cheapest');
        expect(options[1]).toHaveTextContent(/^Standard/);
        expect(options[1].querySelector('[data-upload-cheapest]')).toBeNull();
        for (const option of options) {
            expect(option.querySelector('svg')).not.toBeNull();
            expect(option).not.toHaveAttribute('aria-disabled');
        }
        const fees = uploadMethodLib.estimateUploadMethodFees({
            compiledBytes: sizeOf(FILE, { title: '', memo: '' }), descriptor: BTC, feeEstimate: tiers.normal,
        });
        expect(options[0].querySelector('[data-upload-fee="taproot"]'))
            .toHaveTextContent(`Network fee about ${fees.taproot.coinAmount} BTC`);
        expect(options[1].querySelector('[data-upload-fee="standard"]'))
            .toHaveTextContent(`Network fee about ${fees.standard.coinAmount} BTC`);
        expect(fees.taproot.sats).toBeLessThan(fees.standard.sats);
    });

    it('shows no fee before a file is picked', () => {
        render(<Harness {...baseArgs({ file: null, standardCap: null })} />);
        const options = openOptions();
        expect(options[0].querySelector('[data-upload-fee]')).toBeNull();
        expect(options[1].querySelector('[data-upload-fee]')).toBeNull();
    });

    it.each([
        ['a hardware wallet', { fromAddress: { ...HD, source: 'trezor' } }, "Hardware wallets can't sign the reveal transaction yet."],
        ['another phone signing', { isWatcherMode: true }, "Not available when another phone signs: it can't sign the reveal."],
        ['Litecoin', { descriptor: LTC }, 'Not on Litecoin until the wallet turns on Taproot addresses.'],
        ['Dogecoin', { descriptor: DOGE }, 'Dogecoin has no Taproot.'],
    ])('disables the envelope with its reason for %s and defaults to Standard', (_name, overrides, reason) => {
        render(<Harness {...baseArgs(overrides)} />);
        expect(trigger()).toHaveAccessibleName('Upload method: Standard');
        const [taproot, standard] = openOptions();
        expect(taproot).toHaveAttribute('aria-disabled', 'true');
        expect(taproot.querySelector('[data-upload-description]')).toHaveTextContent(reason);
        expect(standard).not.toHaveAttribute('aria-disabled');
        // A disabled option cannot be picked.
        fireEvent.click(taproot);
        expect(trigger()).toHaveAccessibleName('Upload method: Standard');
    });

    it('disables Standard for a file over its ceiling, naming that ceiling', () => {
        render(<Harness {...baseArgs({ file: { ...FILE, bytes: new Uint8Array(20000) }, standardCap: 8000 })} />);
        const [, standard] = openOptions();
        expect(standard).toHaveAttribute('aria-disabled', 'true');
        expect(standard).toHaveTextContent('This file is too large for it: Standard carries up to 7.8 KB.');
    });

    it('switches to Standard on a pick', () => {
        render(<Harness {...baseArgs()} />);
        const [, standard] = openOptions();
        fireEvent.click(standard);
        expect(trigger()).toHaveAccessibleName('Upload method: Standard');
    });
});

describe('useUploadMethod', () => {
    it('follows the pick in the ceiling, the compose request and the review copy', () => {
        const { result } = renderHook((props) => useUploadMethod(props), { initialProps: baseArgs() });
        expect(result.current.method).toBe('taproot');
        expect(result.current.ceilingOpts).toEqual({ encoding: 'TAPROOT' });
        expect(result.current.encoderOpts).toEqual({ encoding: 'AUTO', options: { signerSupportsTapscript: true } });
        expect(result.current.confirmLine).toBe('Upload method: Taproot upload.');
        expect(result.current.feeText).toBe(`${result.current.fees.taproot.coinAmount} BTC`);
        act(() => result.current.setPicked('standard'));
        expect(result.current.method).toBe('standard');
        expect(result.current.ceilingOpts).toEqual({});
        expect(result.current.encoderOpts).toEqual({});
        expect(result.current.confirmLine).toBe('Upload method: Standard.');
        expect(result.current.feeText).toBe(`${result.current.fees.standard.coinAmount} BTC`);
    });

    it('estimates once per input change and never per keystroke', () => {
        vi.useFakeTimers();
        const { rerender } = renderHook((props) => useUploadMethod(props), { initialProps: baseArgs() });
        expect(estimateCalls()).toBe(1);

        // A re-render with the same inputs, and a method pick, re-estimate nothing.
        rerender(baseArgs());
        expect(estimateCalls()).toBe(1);

        // Forty keystrokes in the title: no estimate until typing pauses, then one.
        let title = '';
        for (let i = 0; i < 40; i += 1) {
            title += 'x';
            rerender(baseArgs({ metadata: { title, memo: '' } }));
            act(() => { vi.advanceTimersByTime(50); });
        }
        expect(estimateCalls()).toBe(1);
        act(() => { vi.advanceTimersByTime(UPLOAD_METADATA_SETTLE_MS); });
        expect(estimateCalls()).toBe(2);
        const settled = { title, memo: '' };

        // The file, the From address and the fee rate each re-estimate once.
        const otherFile = { ...FILE, bytes: new Uint8Array(3000) };
        rerender(baseArgs({ metadata: settled, file: otherFile }));
        expect(estimateCalls()).toBe(3);
        rerender(baseArgs({ metadata: settled, file: otherFile, fromAddress: { ...HD, id: 'a2', address: 'bc1qother' } }));
        expect(estimateCalls()).toBe(4);
        rerender(baseArgs({
            metadata: settled, file: otherFile, fromAddress: { ...HD, id: 'a2', address: 'bc1qother' }, feeEstimate: tiers.fast,
        }));
        expect(estimateCalls()).toBe(5);
    });

    it('recomputes the fee shown when the rate changes', () => {
        const { result, rerender } = renderHook((props) => useUploadMethod(props), { initialProps: baseArgs() });
        const normal = result.current.fees.taproot.sats;
        rerender(baseArgs({ feeEstimate: tiers.fast }));
        // Fast is 12 sat/vB against Normal's 6.
        expect(result.current.fees.taproot.sats).toBe(normal * 2);
    });

    it('re-estimates a typed Custom rate once typing pauses, not per digit', () => {
        vi.useFakeTimers();
        const custom = (rate) => customFeeEstimate({ chainId: 'bitcoin-mainnet', chainRegistry: registry, rate });
        const { result, rerender } = renderHook((props) => useUploadMethod(props), { initialProps: baseArgs() });
        expect(estimateCalls()).toBe(1);
        for (const typed of ['1', '12', '12.', '12.5']) {
            rerender(baseArgs({ feeEstimate: custom(typed) }));
            act(() => { vi.advanceTimersByTime(50); });
        }
        expect(estimateCalls()).toBe(1);
        act(() => { vi.advanceTimersByTime(UPLOAD_METADATA_SETTLE_MS); });
        expect(estimateCalls()).toBe(2);
        const vbytes = result.current.fees.taproot.vbytes;
        expect(result.current.fees.taproot.sats).toBe(Math.ceil(12.5 * vbytes));
    });

    it('shares a controlled pick', () => {
        const onPick = vi.fn();
        const { result } = renderHook((props) => useUploadMethod(props), {
            initialProps: baseArgs({ picked: 'standard', onPick }),
        });
        expect(result.current.method).toBe('standard');
        act(() => result.current.setPicked('taproot'));
        expect(onPick).toHaveBeenCalledWith('taproot');
    });
});
