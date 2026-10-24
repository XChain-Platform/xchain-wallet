// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: the Android camera permission dialog keeps Scan open.
//
//   [P1] 2026-10-23: the system camera dialog pauses the Android activity,
//        and the pause ran the background path: Scan went to Home, so a
//        denial landed on Home with no guidance. The denial was then never
//        remembered, and the next scan waited on "Starting camera…" for a
//        getUserMedia the WebView never answered.

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QrScanner } from '../../packages/core/src/ui/QrScanner.jsx';
import { cameraRequests } from '../../packages/core/src/ui/cameraRequest.js';
import { beginCameraRequest } from '../../packages/core/src/ui/cameraWait.js';

const isCameraRequestPending = () => cameraRequests.pending > 0;
import { useNativeAppLifecycle } from '../../packages/web/src/platform/nativeAppLifecycle.js';

const savedBarcodeDetector = Object.getOwnPropertyDescriptor(window, 'BarcodeDetector');
const savedMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
const savedSecureContext = Object.getOwnPropertyDescriptor(window, 'isSecureContext');
const savedVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
const savedHidden = Object.getOwnPropertyDescriptor(document, 'hidden');

function restoreProperty(target, name, descriptor) {
    if (descriptor) Object.defineProperty(target, name, descriptor);
    else delete target[name];
}

function installCameraApi(getUserMedia) {
    Object.defineProperty(window, 'BarcodeDetector', {
        configurable: true,
        value: function BarcodeDetector() {},
    });
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia },
    });
}

function setVisibility(state) {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => state === 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
}

function LifecycleHarness({ onBackground, onResume }) {
    const suspended = useNativeAppLifecycle({
        checkAutoLock: () => false,
        onBackground,
        onUnlockedResume: onResume,
    });
    return <div data-testid="screen">{suspended ? 'covered' : 'scan'}</div>;
}

beforeEach(() => {
    globalThis.Capacitor = { isNativePlatform: () => true, Plugins: {} };
});

afterEach(() => {
    cleanup();
    sessionStorage.clear();
    delete globalThis.Capacitor;
    vi.useRealTimers();
    vi.restoreAllMocks();
    restoreProperty(window, 'BarcodeDetector', savedBarcodeDetector);
    restoreProperty(navigator, 'mediaDevices', savedMediaDevices);
    restoreProperty(window, 'isSecureContext', savedSecureContext);
    restoreProperty(document, 'visibilityState', savedVisibility);
    restoreProperty(document, 'hidden', savedHidden);
    cameraRequests.pending = 0;
});

describe('regression/native-camera-prompt', () => {
    it('[REGRESSION P1] does not background the app for the camera permission dialog', () => {
        const onBackground = vi.fn();
        const onResume = vi.fn();
        render(<LifecycleHarness onBackground={onBackground} onResume={onResume} />);
        const endRequest = beginCameraRequest();

        act(() => document.dispatchEvent(new Event('pause')));
        expect(onBackground).not.toHaveBeenCalled();
        expect(screen.getByTestId('screen')).toHaveTextContent('scan');

        endRequest();
        act(() => document.dispatchEvent(new Event('resume')));
        expect(onBackground).not.toHaveBeenCalled();
        expect(onResume).toHaveBeenCalledOnce();
    });

    it('[REGRESSION P1] backgrounds the app when the user leaves from the dialog', () => {
        const onBackground = vi.fn();
        render(<LifecycleHarness onBackground={onBackground} onResume={vi.fn()} />);
        const endRequest = beginCameraRequest();

        act(() => document.dispatchEvent(new Event('pause')));
        act(() => setVisibility('hidden'));

        expect(onBackground).toHaveBeenCalledOnce();
        expect(screen.getByTestId('screen')).toHaveTextContent('covered');
        endRequest();
    });

    it('[REGRESSION P1] shows the denied message on the scanner after the dialog', async () => {
        let deny;
        const getUserMedia = vi.fn(() => new Promise((_resolve, reject) => { deny = reject; }));
        installCameraApi(getUserMedia);
        render(<QrScanner onFrame={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: 'Continue to camera' }));
        await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
        expect(isCameraRequestPending()).toBe(true);

        await act(async () => { deny(new DOMException('Permission denied', 'NotAllowedError')); });

        expect(await screen.findByRole('alert')).toHaveTextContent(/allow the camera.*settings.*paste the code/i);
        expect(isCameraRequestPending()).toBe(false);
    });

    it('[REGRESSION P1] remembers a denial that lands after the scanner closed', async () => {
        let deny;
        const getUserMedia = vi.fn(() => new Promise((_resolve, reject) => { deny = reject; }));
        installCameraApi(getUserMedia);
        const first = render(<QrScanner onFrame={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Continue to camera' }));
        await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());

        first.unmount();
        await act(async () => { deny(new DOMException('Permission denied', 'NotAllowedError')); });
        render(<QrScanner onFrame={vi.fn()} />);

        expect(screen.getByRole('alert')).toHaveTextContent(/allow the camera.*settings.*paste the code/i);
        expect(getUserMedia).toHaveBeenCalledOnce();
    });

    it('[REGRESSION P1] stops waiting for a camera that never answers, counting only time in front', async () => {
        vi.useFakeTimers();
        const getUserMedia = vi.fn(() => new Promise(() => {}));
        installCameraApi(getUserMedia);
        render(<QrScanner onFrame={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Continue to camera' }));
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(getUserMedia).toHaveBeenCalledOnce();
        expect(screen.getByText('Starting camera…')).toBeInTheDocument();

        // The permission dialog is up: its time does not count.
        act(() => document.dispatchEvent(new Event('pause')));
        await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
        expect(screen.queryByRole('alert')).toBeNull();
        act(() => document.dispatchEvent(new Event('resume')));

        await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
        expect(screen.getByRole('alert')).toHaveTextContent(/could not start.*paste the code/i);
        expect(isCameraRequestPending()).toBe(false);
        // Not remembered: the next scanner asks again.
        cleanup();
        render(<QrScanner onFrame={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Continue to camera' })).toBeInTheDocument();
    });
});
