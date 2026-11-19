// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Home's tabs are Balances, NFTs and DeFi (operator 2026-11-15); the
// Balances list is narrowed to coins or tokens from the filter popover's
// Type field. These helpers drive that the way a person does, for tests
// written against the retired Coins and Tokens tabs.

import { fireEvent, screen, within } from '@testing-library/react';
import { selectOption } from './selectOption.js';

/** Opens one of Home's tabs by its visible name (Balances, NFTs, DeFi). */
export function openHomeTab(name) {
    fireEvent.click(screen.getByRole('tab', { name }));
}

/** The filter popover, opening it if needed. */
export function openHomeFilterPanel() {
    const existing = screen.queryByRole('dialog', { name: 'Filter and sort' });
    if (existing) return existing;
    fireEvent.click(screen.getByRole('button', { name: 'Filter and sort' }));
    return screen.getByRole('dialog', { name: 'Filter and sort' });
}

/**
 * Shows the Balances tab narrowed to `type` ('all', 'coins' or 'tokens'):
 * opens Balances, picks the Type in the filter popover, then closes it.
 */
export function showHomeBalances(type = 'all') {
    openHomeTab('Balances');
    const panel = openHomeFilterPanel();
    selectOption(within(panel).getByRole('button', { name: /^Type/ }), type);
    fireEvent.click(screen.getByRole('button', { name: 'Filter and sort' }));
}

/** Opens a retired tab name on the new tabs: Coins and Tokens are Balances Types. */
export function openLegacyHomeTab(name) {
    if (name === 'Coins') return showHomeBalances('coins');
    if (name === 'Tokens') return showHomeBalances('tokens');
    if (name === 'All') return showHomeBalances('all');
    return openHomeTab(name);
}
