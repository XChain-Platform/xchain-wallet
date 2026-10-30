// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A camera track ends when access is withdrawn, but also when the camera is
// unplugged or taken by another app. Only the first is a denial worth
// remembering for the session; after the others the next scanner tries again.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QrScanner } from '../../../packages/core/src/ui/QrScanner.jsx';

const savedMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
const savedPermissions = Object.getOwnPropertyDescriptor(navigator, 'permissions');

function restore(name, saved) {
    if (saved) Object.defineProperty(navigator, name, saved);
    else delete navigator[name];
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.sessionStorage.clear();
    delete window.BarcodeDetector;
    restore('mediaDevices', savedMediaDevices);
    restore('permissions', savedPermissions);
});

function useCamera(cameraState) {
    const track = new EventTarget();
    track.stop = vi.fn();
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [track] });
    window.BarcodeDetector = function BarcodeDetector() { this.detect = async () => []; };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    const permission = { state: 'granted' };
    Object.defineProperty(navigator, 'permissions', {
        configurable: true,
        value: { query: vi.fn(async () => permission) },
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    vi.spyOn(window, 'cancelAnimationFrame');
    return {
        getUserMedia,
        endTrack(stateAfter) {
            permission.state = stateAfter ?? cameraState;
            track.dispatchEvent(new Event('ended'));
        },
        track,
    };
}

describe('QrScanner camera loss', () => {
    it('lets the next scanner try again after the camera goes away with access still granted', async () => {
        const camera = useCamera('granted');
        const first = render(<QrScanner onFrame={() => {}} />);
        await screen.findByText(/Scanning/);

        camera.endTrack('granted');

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(/camera stopped/i);
        expect(alert).not.toHaveTextContent(/allow the camera/i);
        expect(camera.track.stop).toHaveBeenCalled();
        expect(window.sessionStorage.getItem('xchain.qr-camera-failure')).toBeNull();
        first.unmount();

        render(<QrScanner onFrame={() => {}} />);
        await screen.findByText(/Scanning/);
        expect(camera.getUserMedia).toHaveBeenCalledTimes(2);
    });

    it('remembers a withdrawn permission for the session', async () => {
        const camera = useCamera('granted');
        const first = render(<QrScanner onFrame={() => {}} />);
        await screen.findByText(/Scanning/);

        camera.endTrack('denied');

        expect(await screen.findByRole('alert')).toHaveTextContent(/allow the camera/i);
        first.unmount();
        render(<QrScanner onFrame={() => {}} />);
        expect(screen.getByRole('alert')).toHaveTextContent(/allow the camera/i);
        expect(camera.getUserMedia).toHaveBeenCalledTimes(1);
    });
});
