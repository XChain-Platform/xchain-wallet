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
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { NetworkFilter } from '../../../packages/core/src/shared/components/NetworkFilter.jsx';
import { NetworkFilterDropdown } from '../../../packages/core/src/shared/components/NetworkFilterDropdown.jsx';
import { useWalletFilters } from '../../../packages/core/src/shared/hooks/useWalletFilters.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
    globalThis.localStorage?.removeItem('xc:homeFilters:wallet-a');
    globalThis.localStorage?.removeItem('xc:homeFilters:wallet-b');
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

    it('keeps repeated family rows uniquely keyed', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        mount({ coinFamilies: ['bitcoin', 'bitcoin'] });

        openList();

        expect(screen.getAllByRole('option', { name: /^Bitcoin/ })).toHaveLength(2);
        expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(/same key|unique "key" prop/i);
    });
});

describe('NetworkFilter dismissal', () => {
    it('closes on Escape', () => {
        mount();
        const { trigger } = openList();
        screen.getByRole('option', { name: /^Bitcoin/ }).focus();

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(document.activeElement).toBe(trigger);
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

describe('NetworkFilter keyboard navigation', () => {
    it('opens on ArrowDown, moves among options, and returns focus on Escape', () => {
        mount({ value: 'litecoin' });
        const trigger = screen.getByRole('button', { name: /Litecoin/ });

        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        const selected = screen.getByRole('option', { name: /^Litecoin/ });
        expect(selected).toHaveFocus();

        fireEvent.keyDown(selected, { key: 'ArrowDown' });
        expect(screen.getByRole('option', { name: /^Dogecoin/ })).toHaveFocus();
        fireEvent.keyDown(document.activeElement, { key: 'Home' });
        expect(screen.getByRole('option', { name: /^All networks/ })).toHaveFocus();

        fireEvent.keyDown(document.activeElement, { key: 'Escape' });
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(trigger).toHaveFocus();
    });

    it('moves from a large-list search field into the options', () => {
        mount({ coinFamilies: manyFamilies });
        openList();
        const search = screen.getByPlaceholderText('Search networks…');

        expect(search).toHaveFocus();
        fireEvent.keyDown(search, { key: 'ArrowDown' });
        expect(screen.getByRole('option', { name: /^All networks/ })).toHaveFocus();
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
        expect(screen.getByRole('searchbox', { name: 'Search networks' })).toBeInTheDocument();
    });

    it('gives the search field a name independent of its placeholder', () => {
        mount({ coinFamilies: manyFamilies });
        openList();

        const search = screen.getByRole('searchbox', { name: 'Search networks' });
        expect(search).toHaveAttribute('placeholder', 'Search networks…');
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

describe('shared network filter surfaces', () => {
    it('uses the canonical filter for compact dropdowns and clears through All networks', () => {
        const onChange = vi.fn();
        render(<NetworkFilterDropdown value="dogecoin" onChange={onChange} />);
        const trigger = screen.getByRole('button', { name: 'Filter by network' });

        expect(trigger).toHaveTextContent('Dogecoin');
        fireEvent.click(trigger);
        fireEvent.click(screen.getByRole('option', { name: /^All networks/ }));
        expect(onChange).toHaveBeenCalledWith('all');
    });

    it('allows both toolbar controls to shrink inside a 320px viewport', () => {
        const css = readFileSync(resolve(
            process.cwd(),
            'packages/core/src/shared/components/NetworkFilterDropdown.module.css',
        ), 'utf8');
        const wrapper = css.match(/\.networkWrap\s*\{[^}]*\}/)?.[0] || '';

        expect(wrapper).toMatch(/flex:\s*1 1 0/);
        expect(wrapper).toMatch(/min-width:\s*0/);
        expect(wrapper).not.toMatch(/min-width:\s*10\.5rem/);
    });
});

describe('wallet filter persistence', () => {
    it('restores network and token filters independently for each wallet', () => {
        const { result, rerender } = renderHook(
            ({ walletId }) => useWalletFilters(walletId),
            { initialProps: { walletId: 'wallet-a' } },
        );

        act(() => {
            result.current.setNetworkFilter('litecoin');
            result.current.setTokenQuery('pep');
        });
        expect(JSON.parse(globalThis.localStorage.getItem('xc:homeFilters:wallet-a'))).toMatchObject({
            networkFilter: 'litecoin',
            tokenQuery: 'pep',
        });

        rerender({ walletId: 'wallet-b' });
        expect(result.current.networkFilter).toBe('all');
        expect(result.current.tokenQuery).toBe('');
        act(() => result.current.setNetworkFilter('dogecoin'));

        rerender({ walletId: 'wallet-a' });
        expect(result.current.networkFilter).toBe('litecoin');
        expect(result.current.tokenQuery).toBe('pep');
    });
});
