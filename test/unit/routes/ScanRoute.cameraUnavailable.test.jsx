// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ScanRoute } from '../../../packages/core/src/shared/routes/ScanRoute.jsx';

const savedMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

afterEach(() => {
    cleanup();
    delete window.BarcodeDetector;
    if (savedMediaDevices) {
        Object.defineProperty(navigator, 'mediaDevices', savedMediaDevices);
    } else {
        delete navigator.mediaDevices;
    }
});

describe('ScanRoute without a browser camera API', () => {
    it('renders its page template and paste fallback when mediaDevices is undefined', () => {
        window.BarcodeDetector = function BarcodeDetector() {};
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: undefined,
        });

        render(<ScanRoute onClassified={vi.fn()} onBack={vi.fn()} />);

        expect(screen.getByTestId('scan-route')).toBeInTheDocument();
        expect(screen.getByTestId('qr-scanner-unsupported')).toHaveTextContent(
            /camera access isn't available.*paste the code/i,
        );
        expect(screen.getByRole('textbox', { name: 'Or paste it here' })).toBeInTheDocument();
    });

    it('keeps the fallback available when browser policy blocks camera API inspection', () => {
        window.BarcodeDetector = function BarcodeDetector() {};
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            get() {
                throw new DOMException('Camera API blocked', 'SecurityError');
            },
        });

        expect(() => render(
            <ScanRoute onClassified={vi.fn()} onBack={vi.fn()} />,
        )).not.toThrow();

        expect(screen.getByTestId('scan-route')).toBeInTheDocument();
        expect(screen.getByTestId('qr-scanner-unsupported')).toHaveTextContent(
            /camera access isn't available.*paste the code/i,
        );
    });
});
