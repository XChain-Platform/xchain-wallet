// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// QrScanner on the iPhone app: no BarcodeDetector, a native scanner
// registered by the shell. It must pick that scanner only there, open it on a
// tap, hand every code to onFrame in order (animated multi-part QR codes
// depend on it), close it when the screen goes away, and explain a refusal in
// plain words.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
    MAX_SCANNED_QR_CHARS,
    QrScanner,
    cameraErrorText,
    nativeScanClosedText,
} from '../../../packages/core/src/ui/QrScanner.jsx';
import { setNativeQrScanner } from '../../../packages/core/src/ui/nativeQrScanner.js';

const savedMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

afterEach(() => {
    cleanup();
    setNativeQrScanner(null);
    delete window.Capacitor;
    delete window.BarcodeDetector;
    if (savedMediaDevices) {
        Object.defineProperty(navigator, 'mediaDevices', savedMediaDevices);
    } else {
        delete navigator.mediaDevices;
    }
});

/**
 * A scanner double. `start` stays pending until the test resolves or rejects
 * it, so the opening window can be exercised; `emit` and `close` stand in for
 * the native events.
 */
function fakeScanner() {
    const state = {
        onValue: /** @type {Function | null} */ (null),
        onClosed: /** @type {Function | null} */ (null),
        resolve: /** @type {Function | null} */ (null),
        reject: /** @type {Function | null} */ (null),
        stop: vi.fn(),
    };
    const scanner = {
        start: vi.fn((onValue, onClosed) => {
            state.onValue = onValue;
            state.onClosed = onClosed;
            return new Promise((resolve, reject) => {
                state.resolve = () => resolve(state.stop);
                state.reject = (reason) => {
                    const err = new Error(`native QR scan could not start: ${reason}`);
                    err.reason = reason;
                    reject(err);
                };
            });
        }),
    };
    return { scanner, state };
}

async function tapScan() {
    fireEvent.click(screen.getByRole('button', { name: /Scan with camera/ }));
}

async function openScanner(state) {
    await tapScan();
    await act(async () => { state.resolve(); });
}

describe('QrScanner picks its camera path', () => {
    it('uses the native scanner when there is no BarcodeDetector, and waits for a tap', () => {
        const { scanner } = fakeScanner();
        setNativeQrScanner(scanner);
        window.Capacitor = { isNativePlatform: () => true };
        render(<QrScanner onFrame={() => {}} alt="Test scanner" />);

        expect(screen.getByTestId('qr-scanner-native')).toBeTruthy();
        expect(screen.getByRole('region', { name: 'Test scanner' })).toBeTruthy();
        expect(screen.getByRole('button', { name: /Scan with camera/ })).toBeTruthy();
        expect(screen.queryByTestId('qr-scanner-unsupported')).toBeNull();
        expect(scanner.start).not.toHaveBeenCalled();
    });

    it('keeps the BarcodeDetector path whenever BarcodeDetector exists', () => {
        const { scanner } = fakeScanner();
        setNativeQrScanner(scanner);
        window.BarcodeDetector = function BarcodeDetector() { this.detect = async () => []; };
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: { getUserMedia: vi.fn(() => new Promise(() => {})) },
        });
        render(<QrScanner onFrame={() => {}} />);

        expect(screen.getByTestId('qr-scanner')).toBeTruthy();
        expect(screen.queryByTestId('qr-scanner-native')).toBeNull();
        expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
        expect(scanner.start).not.toHaveBeenCalled();
    });

    it('explains camera use in the Android shell before requesting permission', async () => {
        window.Capacitor = { isNativePlatform: () => true };
        window.BarcodeDetector = function BarcodeDetector() { this.detect = async () => []; };
        const getUserMedia = vi.fn(() => new Promise(() => {}));
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: { getUserMedia },
        });

        render(<QrScanner onFrame={() => {}} alt="Test scanner" />);

        const rationale = screen.getByTestId('qr-scanner-camera-rationale');
        expect(rationale.textContent).toMatch(/only to scan QR codes while this scanner is open/);
        expect(rationale.textContent).toMatch(/paste the code instead/i);
        expect(getUserMedia).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Continue to camera' }));
        await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    });

    it('shows the paste advice when neither is available', () => {
        window.Capacitor = { isNativePlatform: () => true };
        render(<QrScanner onFrame={() => {}} />);
        expect(screen.getByTestId('qr-scanner-unsupported').textContent).toMatch(/not available on this device/);
        expect(screen.queryByRole('button', { name: /Scan with camera/ })).toBeNull();
    });
});

describe('QrScanner with the native scanner', () => {
    it('hands three distinct codes to onFrame in order', async () => {
        const { scanner, state } = fakeScanner();
        setNativeQrScanner(scanner);
        const onFrame = vi.fn();
        render(<QrScanner onFrame={onFrame} />);
        await openScanner(state);

        act(() => {
            state.onValue('xcw:1/3:aa');
            state.onValue('xcw:2/3:bb');
            state.onValue('xcw:3/3:cc');
        });
        expect(onFrame.mock.calls.map((c) => c[0])).toEqual(['xcw:1/3:aa', 'xcw:2/3:bb', 'xcw:3/3:cc']);
        expect(scanner.start).toHaveBeenCalledTimes(1);
    });

    it('rejects oversized input before the payload handler and keeps scanning', async () => {
        const { scanner, state } = fakeScanner();
        setNativeQrScanner(scanner);
        const onFrame = vi.fn();
        render(<QrScanner onFrame={onFrame} />);
        await openScanner(state);

        act(() => { state.onValue('x'.repeat(MAX_SCANNED_QR_CHARS + 1)); });

        expect(onFrame).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent(/too large to read safely/i);
        expect(screen.getByRole('alert')).not.toHaveTextContent(/8192|payload|parse/i);

        act(() => { state.onValue('valid-next-frame'); });
        expect(onFrame).toHaveBeenCalledWith('valid-next-frame');
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getByText(/Scanning/)).toBeInTheDocument();
    });

    it('turns malformed input and payload-handler failures into plain errors', async () => {
        const { scanner, state } = fakeScanner();
        setNativeQrScanner(scanner);
        const rawError = 'SyntaxError: unexpected token at parser.js:42';
        const onFrame = vi.fn(() => { throw new Error(rawError); });
        render(<QrScanner onFrame={onFrame} />);
        await openScanner(state);

        expect(() => act(() => { state.onValue(null); })).not.toThrow();
        expect(onFrame).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent(/could not be read/i);

        expect(() => act(() => { state.onValue('malformed-frame'); })).not.toThrow();
        expect(onFrame).toHaveBeenCalledWith('malformed-frame');
        expect(screen.getByRole('alert')).not.toHaveTextContent(rawError);
        expect(screen.getByRole('button', { name: /Scan with camera/ })).toBeDisabled();
    });

    it('follows a new onFrame without reopening the camera', async () => {
        const { scanner, state } = fakeScanner();
        setNativeQrScanner(scanner);
        const first = vi.fn();
        const second = vi.fn();
        const { rerender } = render(<QrScanner onFrame={first} />);
        await openScanner(state);

        rerender(<QrScanner onFrame={second} />);
        act(() => { state.onValue('part-2'); });
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledWith('part-2');
        expect(scanner.start).toHaveBeenCalledTimes(1);
        expect(state.stop).not.toHaveBeenCalled();
    });

    it('closes the native view on unmount', async () => {
        const { scanner, state } = fakeScanner();
        setNativeQrScanner(scanner);
        const onFrame = vi.fn();
        const { unmount } = render(<QrScanner onFrame={onFrame} />);
        await openScanner(state);

        unmount();
        expect(state.stop).toHaveBeenCalledTimes(1);
        state.onValue('after unmount');
        expect(onFrame).not.toHaveBeenCalled();
    });

    it('closes a view that finishes opening after the screen is gone', async () => {
        const { scanner, state } = fakeScanner();
        setNativeQrScanner(scanner);
        const { unmount } = render(<QrScanner onFrame={() => {}} />);
        await tapScan();
        unmount();
        expect(state.stop).not.toHaveBeenCalled();

        await act(async () => { state.resolve(); });
        expect(state.stop).toHaveBeenCalledTimes(1);
    });

    it('says how to turn the camera on when access is denied', async () => {
        const { scanner, state } = fakeScanner();
        setNativeQrScanner(scanner);
        render(<QrScanner onFrame={() => {}} />);
        await tapScan();
        await act(async () => { state.reject('denied'); });

        expect(screen.getByRole('alert').textContent).toBe(
            'Camera access is turned off for XChain Wallet. Allow it in Settings, or paste the code instead.',
        );
        expect(screen.getByRole('button', { name: /Scan with camera/ }).disabled).toBe(false);
    });

    it('says there is no camera when none is available', async () => {
        const { scanner, state } = fakeScanner();
        setNativeQrScanner(scanner);
        render(<QrScanner onFrame={() => {}} />);
        await tapScan();
        await act(async () => { state.reject('unavailable'); });

        expect(screen.getByRole('alert').textContent).toBe(
            'There is no camera on this device. Paste the code instead.',
        );
    });

    it('says nothing when the view was stopped before it finished opening', async () => {
        const { scanner, state } = fakeScanner();
        setNativeQrScanner(scanner);
        render(<QrScanner onFrame={() => {}} />);
        await tapScan();
        await act(async () => { state.reject('stopped'); });

        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getByRole('button', { name: /Scan with camera/ }).disabled).toBe(false);
    });

    it('offers the button again after the view closes by itself', async () => {
        const { scanner, state } = fakeScanner();
        setNativeQrScanner(scanner);
        render(<QrScanner onFrame={() => {}} />);
        await openScanner(state);
        expect(screen.getByRole('button', { name: /Scan with camera/ }).disabled).toBe(true);

        act(() => { state.onClosed('interrupted'); });
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /Scan with camera/ }).disabled).toBe(false);
        });
        expect(screen.getByRole('alert').textContent).toMatch(/Scan again, or paste the code/);
        expect(state.stop).not.toHaveBeenCalled();
    });

    it('shows no error after the user cancels', async () => {
        const { scanner, state } = fakeScanner();
        setNativeQrScanner(scanner);
        render(<QrScanner onFrame={() => {}} />);
        await openScanner(state);

        act(() => { state.onClosed('cancelled'); });
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /Scan with camera/ }).disabled).toBe(false);
        });
        expect(screen.queryByRole('alert')).toBeNull();
    });
});

describe('native scanner wording', () => {
    it('gives every start refusal plain words that offer pasting', () => {
        for (const reason of ['denied', 'unavailable', 'busy', 'error']) {
            const text = cameraErrorText({ reason });
            expect(text).toMatch(/paste the code instead/i);
            expect(text).not.toMatch(new RegExp(`\\b${reason}\\b`));
        }
    });

    it('keeps the browser wording for browser errors', () => {
        expect(cameraErrorText({ name: 'NotAllowedError' })).toMatch(/allow the camera in your device settings/);
    });

    it('explains a close only when the user did not ask for it', () => {
        expect(nativeScanClosedText('cancelled')).toBeNull();
        expect(nativeScanClosedText('interrupted')).toMatch(/paste the code/);
        expect(nativeScanClosedText('error')).toMatch(/paste the code/);
    });
});
