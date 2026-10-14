// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { RouteErrorBoundary } from '../../packages/core/src/shared/components/RouteErrorBoundary.jsx';
import { ScanRoute } from '../../packages/core/src/shared/routes/ScanRoute.jsx';

const savedBarcodeDetector = Object.getOwnPropertyDescriptor(window, 'BarcodeDetector');
const savedMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
const savedSecureContext = Object.getOwnPropertyDescriptor(window, 'isSecureContext');

function restoreProperty(target, name, descriptor) {
    if (descriptor) {
        Object.defineProperty(target, name, descriptor);
    } else {
        delete target[name];
    }
}

function installCameraApi(getUserMedia) {
    Object.defineProperty(window, 'BarcodeDetector', {
        configurable: true,
        value: function BarcodeDetector() {},
    });
    Object.defineProperty(window, 'isSecureContext', {
        configurable: true,
        value: true,
    });
    Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: getUserMedia ? { getUserMedia } : undefined,
    });
}

afterEach(() => {
    cleanup();
    // The scanner remembers a camera failure for the session; each case starts fresh.
    sessionStorage.clear();
    vi.restoreAllMocks();
    restoreProperty(window, 'BarcodeDetector', savedBarcodeDetector);
    restoreProperty(navigator, 'mediaDevices', savedMediaDevices);
    restoreProperty(window, 'isSecureContext', savedSecureContext);
});

describe('regression/scanner-without-camera', () => {
    it.each([
        ['an undefined mediaDevices API', null, /camera access is not available.*paste the code/i],
        ['a NotAllowedError rejection', 'NotAllowedError', /allow the camera.*settings.*paste the code/i],
        ['a NotFoundError rejection', 'NotFoundError', /no camera.*paste the code/i],
    ])('keeps ScanRoute in its page template for %s', async (_case, errorName, message) => {
        const getUserMedia = errorName
            ? vi.fn().mockRejectedValue(new DOMException('Camera unavailable', errorName))
            : null;
        installCameraApi(getUserMedia);
        const onBoundaryError = vi.fn();

        render(
            <RouteErrorBoundary onError={onBoundaryError}>
                <ScanRoute onClassified={vi.fn()} onBack={vi.fn()} />
            </RouteErrorBoundary>,
        );

        const page = screen.getByRole('form', { name: 'Scan' });
        expect(screen.getByRole('main', { name: 'Scan' })).toContainElement(page);
        expect(within(page).getByRole('textbox', { name: 'Or paste it here' })).toBeInTheDocument();

        const cameraState = errorName
            ? await within(page).findByRole('alert')
            : within(page).getByTestId('qr-scanner-unsupported');
        expect(cameraState).toHaveTextContent(message);
        expect(screen.queryByRole('form', { name: 'This screen could not be shown' })).toBeNull();
        expect(onBoundaryError).not.toHaveBeenCalled();
        if (getUserMedia) expect(getUserMedia).toHaveBeenCalledOnce();
    });
});
