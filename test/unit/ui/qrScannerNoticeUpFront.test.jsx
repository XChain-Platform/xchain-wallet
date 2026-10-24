// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A camera failure is a notice, so inside a form page it is handed up to the
// top of the page content with the form's other notices and the scanner draws
// no box of its own between the camera and the paste field.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QrScanner } from '../../../packages/core/src/ui/QrScanner.jsx';
import { FormNotices } from '../../../packages/core/src/ui/formNoticeSlot.js';

afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    delete window.BarcodeDetector;
    delete navigator.mediaDevices;
});

function denyCamera() {
    window.BarcodeDetector = function BarcodeDetector() { this.detect = async () => []; };
    Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })) },
    });
}

describe('QrScanner camera failure', () => {
    it('reports the failure to the form page and draws no notice in place', async () => {
        denyCamera();
        const report = vi.fn();
        render(
            <FormNotices.Provider value={{ report }}>
                <QrScanner onFrame={() => {}} />
            </FormNotices.Provider>,
        );
        await waitFor(() => {
            const entry = report.mock.calls.map(([, e]) => e).find((e) => e && e.variant === 'error');
            expect(entry?.text).toMatch(/allow the camera/);
        });
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('still draws the failure in place outside a form page', async () => {
        denyCamera();
        render(<QrScanner onFrame={() => {}} />);
        expect((await screen.findByRole('alert')).textContent).toMatch(/allow the camera/);
    });
});
