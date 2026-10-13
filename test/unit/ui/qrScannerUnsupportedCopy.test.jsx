// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Without BarcodeDetector the scanner explains itself. Inside the native app
// there is no other browser to switch to, so it never sends the user to one.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QrScanner } from '../../../packages/core/src/ui/QrScanner.jsx';

const savedMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete window.Capacitor;
    delete window.BarcodeDetector;
    if (savedMediaDevices) {
        Object.defineProperty(navigator, 'mediaDevices', savedMediaDevices);
    } else {
        delete navigator.mediaDevices;
    }
});

function useBrowserCamera(getUserMedia) {
    window.BarcodeDetector = function BarcodeDetector() { this.detect = async () => []; };
    Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia },
    });
}

describe('QrScanner without BarcodeDetector', () => {
    it('tells an app user to paste, with no browser advice', () => {
        window.Capacitor = { isNativePlatform: () => true };
        render(<QrScanner onFrame={() => {}} />);
        const note = screen.getByTestId('qr-scanner-unsupported');
        expect(note.textContent).toMatch(/not available on this device/);
        expect(note.textContent).not.toMatch(/Chrome|Chromium|BarcodeDetector/);
    });

    it('points a browser user at a Chromium browser or pasting', () => {
        render(<QrScanner onFrame={() => {}} />);
        const note = screen.getByTestId('qr-scanner-unsupported');
        expect(note.textContent).toMatch(/Chromium browsers can/);
        expect(note.textContent).not.toMatch(/BarcodeDetector|payload/);
    });

    it('renders deterministic documentation states without using a camera', async () => {
        window.BarcodeDetector = function BarcodeDetector() {};
        const { rerender } = render(
            <QrScanner previewState="unsupported" onFrame={() => {}} />,
        );
        expect(screen.getByTestId('qr-scanner-unsupported').textContent).toMatch(/Chromium browsers can/);

        rerender(<QrScanner previewState="denied" onFrame={() => {}} />);
        expect((await screen.findByRole('alert')).textContent).toMatch(/allow the camera/);
    });
});

describe('QrScanner browser camera failures', () => {
    it.each([
        ['permission denial', 'NotAllowedError', /allow the camera.*settings.*paste the code instead/i],
        ['missing camera', 'NotFoundError', /No camera.*Paste the code instead/i],
        ['busy camera', 'NotReadableError', /camera is busy.*Close other apps.*paste the code instead/i],
    ])('replaces a black preview after %s with an actionable message', async (_case, name, message) => {
        useBrowserCamera(vi.fn().mockRejectedValue({ name }));
        const { container } = render(<QrScanner onFrame={() => {}} />);

        expect(container.querySelector('video').style.display).toBe('none');
        expect(await screen.findByRole('alert')).toHaveTextContent(message);
        expect(container.querySelector('video').style.display).toBe('none');
    });

    it('uses plain fallback text when the detector cannot start', async () => {
        window.BarcodeDetector = function BarcodeDetector() { throw new Error('decoder init 0x17'); };
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: { getUserMedia: vi.fn() },
        });
        render(<QrScanner onFrame={() => {}} />);

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(/camera could not start.*paste the code instead/i);
        expect(alert).not.toHaveTextContent(/decoder|0x17/i);
    });

    it('stops the camera and replaces the preview when video playback fails', async () => {
        const stop = vi.fn();
        const stream = { getTracks: () => [{ stop }] };
        useBrowserCamera(vi.fn().mockResolvedValue(stream));
        vi.spyOn(HTMLMediaElement.prototype, 'play')
            .mockRejectedValue(new Error('media pipeline 0x99'));
        const { container } = render(<QrScanner onFrame={() => {}} />);

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(/camera could not start.*paste the code instead/i);
        expect(alert).not.toHaveTextContent(/pipeline|0x99/i);
        expect(container.querySelector('video').style.display).toBe('none');
        expect(stop).toHaveBeenCalledOnce();
    });
});
