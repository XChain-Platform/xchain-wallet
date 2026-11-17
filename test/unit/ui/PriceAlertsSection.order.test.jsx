// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Add Price Alert form follows the Form Standard (2026-11-14): one open
// "Price alert" section holding Asset, When the price and Target price in that
// order, with the green action below the section, never inside it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { PriceAlertForm } from '../../../packages/core/src/shared/components/PriceAlertForm.jsx';

afterEach(() => cleanup());

function follows(a, b) {
    return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe('PriceAlertForm order', () => {
    it('keeps the notice and three fields before the action with no repeated section title', () => {
        const { container } = render(<PriceAlertForm walletId="wallet-1" onCreate={vi.fn()} />);

        const notice = screen.getByText(/Fires once when the price gets there/);
        const asset = screen.getByRole('button', { name: /^Asset:/ });
        const direction = screen.getByRole('button', { name: /^When the price/ });
        const price = screen.getByRole('textbox', { name: 'Target price' });
        const add = screen.getByRole('button', { name: 'Add Alert' });

        expect(container.querySelector('[data-form-section-title]')).toBeNull();
        expect(follows(notice, asset)).toBe(true);
        expect(follows(asset, direction)).toBe(true);
        expect(follows(direction, price)).toBe(true);
        expect(follows(price, add)).toBe(true);
    });

    it('draws no Cancel button: the page header has Back', () => {
        render(<PriceAlertForm onCreate={vi.fn()} />);
        expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    });
});
