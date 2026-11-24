// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TabsSection } from '../../../packages/web/src/style-guide/sections/TabsSection.jsx';

vi.mock('@xchain-wallet/core/ui', () => ({
    Tabs: ({ items, onChange, value }) => (
        <div>
            {items.map((item) => (
                <button
                    aria-pressed={item.id === value}
                    key={item.id}
                    type="button"
                    onClick={() => onChange(item.id)}
                >
                    {item.label}
                </button>
            ))}
        </div>
    ),
}));

vi.mock('../../../packages/web/src/style-guide/StyleGuidePage.jsx', () => ({
    Section: ({ children }) => <main>{children}</main>,
    Guidance: () => null,
    Markup: () => null,
    LiveExample: ({ label, children }) => <section aria-label={label}>{children}</section>,
}));

describe('TabsSection', () => {
    it('switches every home and token-detail panel branch independently', () => {
        render(<TabsSection />);
        const home = screen.getByRole('region', { name: 'Home tabs' });
        const token = screen.getByRole('region', { name: 'Token detail' });

        expect(within(home).getByRole('tabpanel')).toHaveTextContent('Wallet balances');
        fireEvent.click(within(home).getByRole('button', { name: 'NFTs' }));
        expect(within(home).getByRole('tabpanel')).toHaveTextContent('Wallet NFTs');
        fireEvent.click(within(home).getByRole('button', { name: 'DeFi' }));
        expect(within(home).getByRole('tabpanel')).toHaveTextContent('DeFi positions');
        expect(within(home).getByRole('tabpanel')).toHaveAttribute(
            'aria-labelledby',
            'style-guide-home-tabs-tab-defi',
        );

        expect(within(token).getByRole('tabpanel')).toHaveTextContent('Token actions');
        fireEvent.click(within(token).getByRole('button', { name: 'Details' }));
        expect(within(token).getByRole('tabpanel')).toHaveTextContent('Token details');
        fireEvent.click(within(token).getByRole('button', { name: 'History' }));
        expect(within(token).getByRole('tabpanel')).toHaveTextContent('Token history');
        expect(within(home).getByRole('tabpanel')).toHaveTextContent('DeFi positions');
    });
});
