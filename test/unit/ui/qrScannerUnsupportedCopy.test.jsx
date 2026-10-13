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

import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QrScanner } from '../../../packages/core/src/ui/QrScanner.jsx';

afterEach(() => {
    cleanup();
    delete window.Capacitor;
    delete window.BarcodeDetector;
});

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
});
