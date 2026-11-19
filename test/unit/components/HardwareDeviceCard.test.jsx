// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The shared hardware wallet card: vendor picture, device name, one status pill.

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HardwareDeviceCard, hardwareVendorName } from '../../../packages/core/src/shared/components/hardware/index.js';
import { signerVendorLogoUrl } from '../../../packages/core/src/branding/branding.js';

afterEach(cleanup);

describe('HardwareDeviceCard', () => {
    it('shows the vendor picture, the given name and the Found by USB pill', () => {
        render(<HardwareDeviceCard vendor="trezor" model="T2B1" name="Trezor Safe 3" status="found" />);

        const card = screen.getByRole('region', { name: 'Trezor Safe 3' });
        expect(card).toHaveAttribute('data-status', 'found');
        expect(card.querySelector('img')).toHaveAttribute('src', signerVendorLogoUrl('trezor'));
        expect(card.querySelector('img')).toHaveAttribute('alt', '');
        expect(card).toHaveTextContent('Trezor Safe 3');
        expect(card).toHaveTextContent('Found by USB');
    });

    it('falls back to the vendor and model when no name is given', () => {
        render(<HardwareDeviceCard vendor="ledger" model="Nano X" status="connected" />);

        expect(screen.getByRole('region', { name: 'Ledger Nano X' })).toHaveTextContent('Connected');
    });

    it.each([
        ['found', 'Found by USB', 'good'],
        ['connected', 'Connected', 'good'],
        ['unlock', 'Unlock your Ledger', 'wait'],
        ['not-connected', 'Not connected', 'off'],
    ])('draws the %s status as "%s"', (status, text, tone) => {
        const { container } = render(<HardwareDeviceCard vendor="ledger" status={status} />);

        expect(container).toHaveTextContent(text);
        expect(container.querySelector('[data-tone]')).toHaveAttribute('data-tone', tone);
    });

    it('names the vendors in plain words', () => {
        expect(hardwareVendorName('trezor')).toBe('Trezor');
        expect(hardwareVendorName('ledger')).toBe('Ledger');
        expect(hardwareVendorName(undefined)).toBe('hardware wallet');
    });
});
