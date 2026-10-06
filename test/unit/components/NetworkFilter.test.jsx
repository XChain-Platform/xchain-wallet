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
import { NetworkFilter } from '../../../packages/core/src/shared/components/NetworkFilter.jsx';

const descriptors = {
    bitcoin: { displayName: 'Bitcoin', color: '#f7931a' },
    litecoin: { displayName: 'Litecoin', color: '#345d9d' },
    dogecoin: { displayName: 'Dogecoin', color: '#c2a633' },
    ethereum: { displayName: 'Ethereum', color: '#627eea' },
    solana: { displayName: 'Solana', color: '#14f195' },
    dash: { displayName: 'Dash', color: '#008de4' },
    cosmos: { displayName: 'Cosmos Hub', color: '#2e3148' },
};

const chainRegistry = {
    byCoin: (coin) => descriptors[coin]
        ? [{ id: `${coin}-main`, ...descriptors[coin] }]
        : [],
};

const knownFamilies = ['bitcoin', 'litecoin', 'dogecoin'];
const manyFamilies = [...knownFamilies, 'ethereum', 'solana', 'dash', 'cosmos'];

function mount(overrides = {}) {
    const props = {
        chainRegistry,
        coinFamilies: knownFamilies,
        value: 'all',
        onChange: vi.fn(),
        ...overrides,
    };
    return { ...render(<NetworkFilter {...props} />), props };
}

function openList() {
    const trigger = screen.getByRole('button', { name: /All networks|Bitcoin|Dogecoin|unknown/i });
    fireEvent.click(trigger);
    return { trigger, listbox: screen.getByRole('listbox') };
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('NetworkFilter trigger', () => {
    it.each([
        { coinFamilies: knownFamilies, countLabel: '3 networks' },
        { coinFamilies: ['bitcoin'], countLabel: '1 network' },
    ])('summarizes all networks as $countLabel', ({ coinFamilies, countLabel }) => {
        mount({ coinFamilies });

        const trigger = screen.getByRole('button', { name: /All networks/ });
        expect(trigger).toHaveTextContent('All networks');
        expect(trigger).toHaveTextContent(countLabel);
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });

    it('uses the selected family display name', () => {
        mount({ value: 'dogecoin' });

        expect(screen.getByRole('button', { name: /Dogecoin/ })).toHaveTextContent('Dogecoin');
    });

    it('falls back to the selected coin code without a descriptor', () => {
        mount({ coinFamilies: ['unknown'], value: 'unknown' });

        expect(screen.getByRole('button', { name: /unknown/ })).toHaveTextContent('unknown');
    });
});

describe('NetworkFilter selection', () => {
    it('opens an expanded list with All networks first', () => {
        mount();

        const { trigger, listbox } = openList();
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        expect(within(listbox).getAllByRole('option')[0]).toHaveTextContent('All networks');
    });

    it.each([
        ['all', /^All networks/],
        ['dogecoin', /^Dogecoin/],
    ])('reports %s and closes the list', (selection, optionName) => {
        const { props } = mount({ value: 'bitcoin' });
        const trigger = screen.getByRole('button', { name: /Bitcoin/ });
        fireEvent.click(trigger);

        fireEvent.click(screen.getByRole('option', { name: optionName }));
        expect(props.onChange).toHaveBeenCalledOnce();
        expect(props.onChange).toHaveBeenCalledWith(selection);
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });
});

describe('NetworkFilter dismissal', () => {
    it('closes on Escape', () => {
        mount();
        openList();

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('closes on a mousedown outside the filter', () => {
        mount();
        openList();

        fireEvent.mouseDown(document.body);
        expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('stays open on a mousedown inside the popover', () => {
        mount();
        const { listbox } = openList();

        fireEvent.mouseDown(listbox);
        expect(screen.getByRole('listbox')).toBe(listbox);
    });
});

describe('NetworkFilter search', () => {
    it('only offers search for more than six families', () => {
        mount();
        openList();
        expect(screen.queryByPlaceholderText('Search networks…')).toBeNull();
        cleanup();

        mount({ coinFamilies: manyFamilies });
        openList();
        expect(screen.getByPlaceholderText('Search networks…')).toBeInTheDocument();
    });

    it('filters labels and tickers case-insensitively', () => {
        mount({ coinFamilies: manyFamilies });
        openList();
        const search = screen.getByPlaceholderText('Search networks…');

        fireEvent.change(search, { target: { value: 'bitCOIN' } });
        expect(screen.getByRole('option', { name: /^Bitcoin/ })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: /^Litecoin/ })).toBeNull();

        fireEvent.change(search, { target: { value: 'ltC' } });
        expect(screen.getByRole('option', { name: /^Litecoin/ })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: /^Bitcoin/ })).toBeNull();
    });

    it('shows the empty result message', () => {
        mount({ coinFamilies: manyFamilies });
        openList();

        fireEvent.change(screen.getByPlaceholderText('Search networks…'), {
            target: { value: 'not-a-network' },
        });
        expect(screen.getByText('No matching networks.')).toBeInTheDocument();
    });

    it('uses known short tickers and uppercases other coin codes', () => {
        mount({ coinFamilies: manyFamilies });
        const { listbox } = openList();

        expect(within(listbox).getByRole('option', { name: /^Bitcoin/ })).toHaveTextContent('BTC');
        expect(within(listbox).getByRole('option', { name: /^Litecoin/ })).toHaveTextContent('LTC');
        expect(within(listbox).getByRole('option', { name: /^Dogecoin/ })).toHaveTextContent('DOGE');
        expect(within(listbox).getByRole('option', { name: /^Ethereum/ })).toHaveTextContent('ETHEREUM');
    });
});
