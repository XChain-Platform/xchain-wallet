// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import {
    MAX_SCANNED_QR_CHARS,
    QrScanner,
    scannedQrPayloadError,
} from '../../../packages/core/src/ui/QrScanner.jsx';

const savedMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
const savedBarcodeDetector = Object.getOwnPropertyDescriptor(window, 'BarcodeDetector');

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    if (savedMediaDevices) Object.defineProperty(navigator, 'mediaDevices', savedMediaDevices);
    else delete navigator.mediaDevices;
    if (savedBarcodeDetector) Object.defineProperty(window, 'BarcodeDetector', savedBarcodeDetector);
    else delete window.BarcodeDetector;
});

function installCamera(detect) {
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] };
    const frames = [];
    window.BarcodeDetector = function BarcodeDetector() { this.detect = detect; };
    Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
    });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    return { cancel, frames, stop };
}

async function runNextFrame(frames) {
    await waitFor(() => expect(frames.length).toBeGreaterThan(0));
    const frame = frames.shift();
    await act(async () => { await frame(0); });
}

describe('<QrScanner> browser edge branches', () => {
    it('bounds non-string, blank, and oversized payloads', () => {
        expect(scannedQrPayloadError(null)).toMatch(/could not be read/);
        expect(scannedQrPayloadError('   ')).toMatch(/could not be read/);
        expect(scannedQrPayloadError('x'.repeat(MAX_SCANNED_QR_CHARS + 1))).toMatch(/too large/);
        expect(scannedQrPayloadError('valid')).toBeNull();
    });

    it('reports a malformed frame, then recovers on the next valid frame', async () => {
        const detect = vi.fn()
            .mockResolvedValueOnce([{ rawValue: '' }])
            .mockResolvedValueOnce([{ rawValue: 'bitcoin:bc1qvalid' }]);
        const onFrame = vi.fn();
        const { frames } = installCamera(detect);
        render(<QrScanner onFrame={onFrame} />);

        await runNextFrame(frames);
        expect(screen.getByRole('alert')).toHaveTextContent(/could not be read/);
        expect(onFrame).not.toHaveBeenCalled();

        await runNextFrame(frames);
        expect(onFrame).toHaveBeenCalledWith('bitcoin:bc1qvalid');
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('turns consumer failures into plain errors without stopping the loop', async () => {
        const detect = vi.fn().mockResolvedValue([{ rawValue: 'valid-code' }]);
        const onFrame = vi.fn(() => { throw new Error('parser internals'); });
        const { frames } = installCamera(detect);
        render(<QrScanner onFrame={onFrame} />);

        await runNextFrame(frames);

        expect(screen.getByRole('alert')).toHaveTextContent(/could not be read/);
        expect(frames).toHaveLength(1);
    });

    it('ignores transient detector failures and stops media on unmount', async () => {
        const detect = vi.fn().mockRejectedValue(new Error('video not ready'));
        const { cancel, frames, stop } = installCamera(detect);
        const view = render(<QrScanner onFrame={() => {}} />);

        await runNextFrame(frames);
        expect(screen.queryByRole('alert')).toBeNull();
        expect(frames).toHaveLength(1);

        view.unmount();
        expect(stop).toHaveBeenCalledOnce();
        expect(cancel).toHaveBeenCalledOnce();
    });
});
