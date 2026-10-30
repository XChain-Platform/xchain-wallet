// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { NetworkFilter } from '../../../packages/core/src/shared/components/NetworkFilter.jsx';
import { NetworkFilterDropdown } from '../../../packages/core/src/shared/components/NetworkFilterDropdown.jsx';
import { useWalletFilters } from '../../../packages/core/src/shared/hooks/useWalletFilters.js';
import { Input } from '../../../packages/core/src/ui/Input.jsx';
import { ListPage } from '../../../packages/core/src/ui/ListPage.jsx';
import inputStyles from '../../../packages/core/src/ui/Input.module.css';
import listPageStyles from '../../../packages/core/src/ui/ListPage.module.css';
import dropdownStyles from '../../../packages/core/src/shared/components/NetworkFilterDropdown.module.css';
import filterStyles from '../../../packages/core/src/shared/components/NetworkFilter.module.css';
import chipStyles from '../../../packages/core/src/ui/Chip.module.css';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';

let nativeBack;
let capacitorApp;

beforeEach(() => {
    resetBackStackForTests();
    capacitorApp = {
        addListener: vi.fn((_event, listener) => {
            nativeBack = listener;
            return { remove: vi.fn() };
        }),
        minimizeApp: vi.fn(),
    };
    globalThis.Capacitor = { Plugins: { App: capacitorApp } };
});

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
const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');

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
    resetBackStackForTests();
    delete globalThis.Capacitor;
    vi.restoreAllMocks();
    if (originalInnerWidth) Object.defineProperty(window, 'innerWidth', originalInnerWidth);
    else delete window.innerWidth;
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
        expect(trigger).not.toHaveTextContent(countLabel);
        expect(trigger).toHaveAccessibleName(`All networks, ${countLabel}`);
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(trigger).toHaveAttribute('aria-pressed', 'false');
        expect(trigger).toHaveClass(chipStyles.chip);
    });

    it('uses the selected family display name', () => {
        mount({ value: 'dogecoin' });

        expect(screen.getByRole('button', { name: /Dogecoin/ })).toHaveTextContent('Dogecoin');
        expect(screen.getByRole('button', { name: /Dogecoin/ })).toHaveAttribute('aria-pressed', 'true');
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
    it.each([
        ['network filter', false],
        ['compact network filter dropdown', true],
    ])('closes the %s on Android Back instead of minimizing the app', (_name, compact) => {
        if (compact) render(<NetworkFilterDropdown value="all" onChange={() => {}} />);
        else mount();
        const trigger = compact
            ? screen.getByRole('button', { name: 'Filter by network' })
            : screen.getByRole('button', { name: /All networks/ });
        fireEvent.click(trigger);
        expect(screen.getByRole('listbox')).toBeInTheDocument();

        act(() => nativeBack({ canGoBack: false }));

        expect(screen.queryByRole('listbox')).toBeNull();
        expect(trigger).toHaveFocus();
        expect(capacitorApp.minimizeApp).not.toHaveBeenCalled();
    });

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

    it('selects with Enter and closes on Tab without trapping focus', () => {
        const { props } = mount();
        const { trigger } = openList();
        const bitcoin = screen.getByRole('option', { name: /^Bitcoin/ });
        bitcoin.focus();
        fireEvent.keyDown(bitcoin, { key: 'Enter' });
        expect(props.onChange).toHaveBeenCalledWith('bitcoin');
        expect(trigger).toHaveAttribute('aria-expanded', 'false');

        fireEvent.click(trigger);
        const selected = screen.getByRole('option', { name: /^All networks/ });
        const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
        fireEvent(selected, event);
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(event.defaultPrevented).toBe(false);
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
    it('uses canonical field and chip geometry for neighboring filters', () => {
        render(
            <div>
                <Input type="search" aria-label="Search contacts" />
                <NetworkFilterDropdown value="all" onChange={() => {}} />
            </div>,
        );

        const search = screen.getByRole('searchbox', { name: 'Search contacts' });
        const trigger = screen.getByRole('button', { name: 'Filter by network' });
        const dropdown = trigger.closest(`.${dropdownStyles.networkWrap}`);
        const filter = trigger.closest(`.${filterStyles.wrap}`);
        const css = readFileSync(resolve(
            process.cwd(),
            'packages/core/src/shared/components/NetworkFilter.module.css',
        ), 'utf8');
        const inputCss = readFileSync(resolve(
            process.cwd(),
            'packages/core/src/ui/Input.module.css',
        ), 'utf8');
        const chipCss = readFileSync(resolve(
            process.cwd(),
            'packages/core/src/ui/Chip.module.css',
        ), 'utf8');
        const triggerClass = css.match(/\.trigger\s*\{[^}]*\}/)?.[0] || '';
        const inputClass = inputCss.match(/\.input\s*\{[^}]*\}/)?.[0] || '';
        const inputHeightClass = inputCss.match(/\.input:not\(textarea\)\s*\{[^}]*\}/)?.[0] || '';
        const inputMdClass = inputCss.match(/\.md\s*\{[^}]*\}/)?.[0] || '';
        const chipClass = chipCss.match(/\.chip\s*\{[^}]*\}/)?.[0] || '';

        expect(search).toHaveClass(inputStyles.input);
        expect(dropdown).toHaveClass(dropdownStyles.md);
        expect(filter).toHaveClass(filterStyles.md);
        expect(trigger).toHaveClass(filterStyles.trigger);
        expect(inputHeightClass).toMatch(/height:\s*var\(--xc-control-height\)/);
        expect(inputMdClass).toMatch(/--xc-control-height:\s*var\(--xc-control-h-md\)/);
        expect(inputClass).toMatch(/border-radius:\s*var\(--xc-(?:control-radius|radius-md)/);
        expect(trigger).toHaveClass(chipStyles.chip);
        expect(triggerClass).not.toMatch(/(?:min-)?height:|border-radius:/);
        expect(chipClass).toMatch(/height:\s*var\(--xc-control-h-sm\)/);
        expect(chipClass).toMatch(/border-radius:\s*var\(--xc-radius-pill\)/);
    });

    it('uses the canonical filter for compact dropdowns and clears through All networks', () => {
        const onChange = vi.fn();
        render(<NetworkFilterDropdown value="dogecoin" onChange={onChange} />);
        const trigger = screen.getByRole('button', { name: 'Filter by network' });

        expect(trigger).toHaveTextContent('Dogecoin');
        fireEvent.click(trigger);
        fireEvent.click(screen.getByRole('option', { name: /^All networks/ }));
        expect(onChange).toHaveBeenCalledWith('all');
    });

    it('preserves the label and wraps the shared toolbar at 320px', () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
        window.dispatchEvent(new Event('resize'));
        render(
            <div style={{ width: '320px' }}>
                <ListPage toolbar={(
                    <>
                        <Input type="search" aria-label="Search addresses" />
                        <NetworkFilterDropdown value="all" onChange={() => {}} />
                    </>
                )}>
                    <div>Addresses</div>
                </ListPage>
            </div>,
        );

        const trigger = screen.getByRole('button', { name: 'Filter by network' });
        const dropdown = trigger.closest(`.${dropdownStyles.networkWrap}`);
        const filter = trigger.closest(`.${filterStyles.wrap}`);
        const toolbar = trigger.closest(`.${listPageStyles.toolbar}`);
        const dropdownCss = readFileSync(resolve(
            process.cwd(),
            'packages/core/src/shared/components/NetworkFilterDropdown.module.css',
        ), 'utf8');
        const filterCss = readFileSync(resolve(
            process.cwd(),
            'packages/core/src/shared/components/NetworkFilter.module.css',
        ), 'utf8');
        const listPageCss = readFileSync(resolve(
            process.cwd(),
            'packages/core/src/ui/ListPage.module.css',
        ), 'utf8');
        const dropdownRule = dropdownCss.match(/\.networkWrap\s*\{[^}]*\}/)?.[0] || '';
        const filterRule = filterCss.match(/\.wrap\s*\{[^}]*\}/)?.[0] || '';
        const toolbarRule = listPageCss.match(/\.toolbar\s*\{[^}]*\}/)?.[0] || '';

        expect(window.innerWidth).toBe(320);
        expect(dropdown).toBeInTheDocument();
        expect(filter).toBeInTheDocument();
        expect(toolbar).toBeInTheDocument();
        expect(trigger).toHaveTextContent('All networks');
        // The network count is announced, not drawn, so the label keeps the width.
        expect(trigger).not.toHaveTextContent('3 networks');
        expect(dropdownRule).toMatch(/flex:\s*1 1 10rem/);
        expect(dropdownRule).toMatch(/min-width:\s*min\(10rem, 100%\)/);
        expect(filterRule).toMatch(/min-width:\s*min\(10rem, 100%\)/);
        expect(toolbarRule).toMatch(/flex-wrap:\s*wrap/);
    });

    it('keeps Contacts and Dispensers filters on one line at 411px', () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 411 });
        render(
            <div style={{ width: 411 }}>
                <NetworkFilterDropdown
                    value="all"
                    onChange={() => {}}
                    announceNetworkCount
                />
            </div>,
        );

        const trigger = screen.getByRole('button', {
            name: 'Filter by network: All networks, 3 networks',
        });
        const filter = trigger.closest(`.${filterStyles.wrap}`);
        const filterCss = readFileSync(resolve(
            process.cwd(),
            'packages/core/src/shared/components/NetworkFilter.module.css',
        ), 'utf8');
        const contactsSource = readFileSync(resolve(
            process.cwd(),
            'packages/core/src/shared/routes/ContactsList.jsx',
        ), 'utf8');
        const dispensersSource = readFileSync(resolve(
            process.cwd(),
            'packages/core/src/shared/routes/DispensersList.jsx',
        ), 'utf8');
        const toolbarCss = readFileSync(resolve(
            process.cwd(),
            'packages/core/src/shared/components/ListToolbar.module.css',
        ), 'utf8');

        expect(window.innerWidth).toBe(411);
        expect(trigger).toHaveTextContent('All networks');
        expect(trigger).not.toHaveTextContent('3 networks');
        expect(filter).toHaveClass(filterStyles.md);
        // The kit Chip owns the trigger height; the filter only lets it fill and shrink.
        expect(filterCss).toMatch(/\.trigger\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0/s);
        expect(filterCss).toMatch(/\.triggerLabel\s*\{[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s);
        // Both screens share the ListToolbar, whose class must exist: an undefined one left the controls stacked.
        expect(toolbarCss).toMatch(/\.toolbar\s*\{[^}]*display:\s*flex[^}]*flex-wrap:\s*wrap/s);
        expect(contactsSource).toMatch(/<ListToolbar\b[\s\S]*<NetworkFilterDropdown[\s\S]*announceNetworkCount/);
        expect(dispensersSource).toMatch(/<ListToolbar\b[\s\S]*<NetworkFilterDropdown[\s\S]*announceNetworkCount/);
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
