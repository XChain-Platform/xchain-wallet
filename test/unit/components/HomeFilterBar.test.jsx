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
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { HomeFilterBar } from '../../../packages/core/src/shared/components/HomeFilterBar.jsx';
import chipStyles from '../../../packages/core/src/ui/Chip.module.css';
import networkFilterStyles from '../../../packages/core/src/shared/components/NetworkFilter.module.css';

const descriptors = {
    bitcoin: { id: 'bitcoin-mainnet', displayName: 'Bitcoin' },
    litecoin: { id: 'litecoin-mainnet', displayName: 'Litecoin' },
};

const chainRegistry = {
    byCoin(coin) {
        return descriptors[coin] ? [descriptors[coin]] : [];
    },
};

function mount(overrides = {}) {
    const props = {
        chainRegistry,
        coinFamilies: ['bitcoin', 'litecoin'],
        networkFilter: 'all',
        onNetworkFilterChange: vi.fn(),
        tokenQuery: '',
        onTokenQueryChange: vi.fn(),
        ...overrides,
    };
    return { ...render(<HomeFilterBar {...props} />), props };
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('HomeFilterBar', () => {
    it('shows the token query and reports typed text', () => {
        const onTokenQueryChange = vi.fn();
        mount({ tokenQuery: 'sol', onTokenQueryChange });

        const input = screen.getByRole('searchbox', { name: 'Search tokens by name' });
        expect(input).toHaveValue('sol');
        fireEvent.change(input, { target: { value: 'solar' } });
        expect(onTokenQueryChange).toHaveBeenCalledWith('solar');
    });

    it.each(['all', ''])('shows All networks for the %j filter', (networkFilter) => {
        mount({ networkFilter });
        const button = screen.getByRole('button', { name: /^Filter by network/ });
        expect(button).toHaveTextContent('All networks');
        expect(button).toHaveClass(chipStyles.chip);
        expect(button).toHaveAttribute('aria-pressed', 'false');
    });

    it('shows a selected network display name', () => {
        mount({ networkFilter: 'bitcoin' });
        const button = screen.getByRole('button', { name: /^Filter by network/ });
        expect(button).toHaveTextContent('Bitcoin');
        expect(button).toHaveAttribute('aria-pressed', 'true');
    });

    // G96: inside the filter panel every dropdown is the white field, so a
    // chosen network never paints the pressed (blue) fill.
    it('keeps the panel network dropdown unfilled while a network is chosen', () => {
        mount({ variant: 'menu', networkFilter: 'litecoin' });
        const button = screen.getByRole('button', { name: /^Filter by network/ });
        expect(button).toHaveTextContent('Litecoin');
        expect(button).toHaveClass(networkFilterStyles.fieldLook);
        expect(button).toHaveClass(networkFilterStyles.idle);
    });

    it('falls back to the coin code without a descriptor', () => {
        mount({ coinFamilies: ['unknown'], networkFilter: 'unknown' });
        const button = screen.getByRole('button', { name: /^Filter by network/ });
        expect(button).toHaveTextContent('unknown');
    });

    it('opens the labelled network list and exposes its options', () => {
        mount();
        const button = screen.getByRole('button', { name: /^Filter by network/ });

        expect(button).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(button);
        expect(button).toHaveAttribute('aria-expanded', 'true');
        // The full-screen network list (operator ruling 2026-11-13), not a listbox.
        const list = screen.getByRole('dialog', { name: 'Network' });
        expect(within(list).getByRole('button', { name: 'Select Bitcoin' })).toHaveTextContent('Bitcoin');
    });

    it('closes the network list on Escape and returns focus to the filter', () => {
        mount();
        const button = screen.getByRole('button', { name: /^Filter by network/ });

        fireEvent.click(button);
        expect(screen.getByRole('dialog', { name: 'Network' })).toBeInTheDocument();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('dialog', { name: 'Network' })).toBeNull();
        expect(button).toHaveFocus();
    });

    it('reports the picked option and closes the network list', () => {
        const onNetworkFilterChange = vi.fn();
        mount({ onNetworkFilterChange });
        fireEvent.click(screen.getByRole('button', { name: /^Filter by network/ }));

        const list = screen.getByRole('dialog', { name: 'Network' });
        fireEvent.click(within(list).getByRole('button', { name: 'Select Litecoin' }));
        expect(onNetworkFilterChange).toHaveBeenCalledWith('litecoin');
        expect(screen.queryByRole('dialog', { name: 'Network' })).toBeNull();
    });
});
