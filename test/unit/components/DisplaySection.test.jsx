// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DisplaySection } from '../../../packages/core/src/shared/components/settings/DisplaySection.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';
import inputStyles from '../../../packages/core/src/ui/Input.module.css';

afterEach(() => cleanup());

function setup(overrides = {}, messagingOverrides = {}) {
    let settings = {
        privacy: { hideSmallBalances: false },
        pinnedTokens: [],
        watchedTokens: [],
        hiddenTokens: [],
        showPinAffordance: false,
        showHideAffordance: false,
        smallBalanceThreshold: 'dust',
        numberFormat: 'full',
        ...overrides,
    };
    const messaging = {
        getSettings: vi.fn(() => Promise.resolve(settings)),
        updateSettings: vi.fn((patch) => {
            settings = {
                ...settings,
                ...patch,
                privacy: patch.privacy ? { ...settings.privacy, ...patch.privacy } : settings.privacy,
            };
            return Promise.resolve(settings);
        }),
        getTokenInfo: vi.fn().mockResolvedValue({ canonicalTick: null }),
        ...messagingOverrides,
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <DisplaySection />
        </MessagingProvider>,
    );
    return messaging;
}

describe('DisplaySection', () => {
    it('uses the shared medium control size across the watched-token row', async () => {
        setup();

        const chain = await screen.findByRole('combobox', { name: 'Token chain' });
        const ticker = screen.getByRole('textbox', { name: 'Token ticker' });
        const action = screen.getByRole('button', { name: 'Watch token' });
        expect(chain.parentElement.parentElement).toHaveClass(inputStyles.md);
        expect(ticker.parentElement.parentElement).toHaveClass(inputStyles.md);
        expect(action).toHaveClass(buttonStyles.md);
    });

    it('centres md actions beside watched-token fields', async () => {
        setup({ pinnedTokens: ['bitcoin-mainnet:XCP'] });
        const ticker = await screen.findByRole('textbox', { name: 'Token ticker' });
        const tickerField = ticker.parentElement.parentElement;
        const watchForm = ticker.closest('form');

        expect(tickerField.className).toMatch(/(?:^|\s)_?md_/);
        expect(watchForm.style.alignItems).toBe('center');
        expect(screen.getByRole('button', { name: 'Watch token' }).className).toMatch(/(?:^|\s)_?md_/);

        const search = screen.getByRole('searchbox', { name: 'Search pinned and hidden tokens' });
        fireEvent.change(search, { target: { value: 'X' } });
        const clear = screen.getByRole('button', { name: 'Clear settings token search' });
        const searchRow = clear.parentElement;

        expect(search.parentElement.parentElement.className).toMatch(/(?:^|\s)_?md_/);
        expect(searchRow.style.alignItems).toBe('center');
        expect(clear.className).toMatch(/(?:^|\s)_?md_/);
    });

    it('persists every balance display control through settings updates', async () => {
        const messaging = setup();
        const hide = await screen.findByRole('switch', { name: 'Hide small balances' });

        expect(screen.getByRole('group', { name: 'Display settings' })).toBeTruthy();
        expect(screen.getByRole('region', { name: 'Display options' })).toBeTruthy();
        fireEvent.click(hide);
        const threshold = screen.getByRole('combobox', { name: 'Small-balance threshold' });
        const numberFormat = screen.getByRole('combobox', { name: 'Balance number format' });
        expect(threshold.className).toMatch(/input/);
        expect(numberFormat.className).toMatch(/input/);
        fireEvent.change(threshold, { target: { value: '0.01' } });
        fireEvent.change(numberFormat, { target: { value: 'trim' } });

        await waitFor(() => {
            expect(messaging.updateSettings).toHaveBeenCalledWith({ privacy: { hideSmallBalances: true } });
            expect(messaging.updateSettings).toHaveBeenCalledWith({ smallBalanceThreshold: '0.01' });
            expect(messaging.updateSettings).toHaveBeenCalledWith({ numberFormat: 'trim' });
        });
    });

    it('resets display choices and leaves no pinned tokens for any wallet', async () => {
        const messaging = setup({
            privacy: { hideSmallBalances: true },
            pinnedTokens: ['bitcoin-mainnet:BTC'],
            pinnedTokensByWallet: {
                'wallet-a': ['bitcoin-mainnet:XCP'],
                'wallet-b': ['litecoin-mainnet:LTC'],
            },
            watchedTokens: ['dogecoin-mainnet:DOGE'],
            hiddenTokens: ['bitcoin-mainnet:XCP'],
            showPinAffordance: true,
            showHideAffordance: true,
            smallBalanceThreshold: '1',
            numberFormat: 'plain',
        });

        fireEvent.click(await screen.findByRole('button', { name: 'Reset to defaults' }));
        expect(messaging.updateSettings).not.toHaveBeenCalled();
        const dialog = screen.getByRole('dialog', { name: 'Reset display settings?' });
        expect(dialog).toHaveTextContent('This restores all balance display options and clears pinned tokens, hidden tokens, and saved list preferences. This cannot be undone.');
        fireEvent.click(screen.getByRole('button', { name: 'Reset settings' }));

        await waitFor(() => expect(messaging.updateSettings).toHaveBeenCalledWith({
            pinnedTokens: [],
            pinnedTokensByWallet: {},
            watchedTokens: [],
            hiddenTokens: [],
            showPinAffordance: false,
            showHideAffordance: false,
            smallBalanceThreshold: 'dust',
            numberFormat: 'full',
            privacy: { hideSmallBalances: false },
        }));
        expect(await screen.findByText('Display settings reset to defaults.')).toBeTruthy();
        expect(await messaging.getSettings()).toMatchObject({
            pinnedTokens: [],
            pinnedTokensByWallet: {},
        });
    });

    it('looks up a watched ticker on its selected chain, refuses missing and duplicate tokens, and removes it', async () => {
        const getTokenInfo = vi.fn(({ tick }) => Promise.resolve({
            canonicalTick: tick === 'WOW' ? 'WOW' : null,
        }));
        const messaging = setup({}, { getTokenInfo });
        await screen.findByRole('heading', { name: 'Watched tokens (0)' });

        fireEvent.change(screen.getByRole('combobox', { name: 'Token chain' }), { target: { value: 'dogecoin-testnet' } });
        fireEvent.change(screen.getByRole('textbox', { name: 'Token ticker' }), { target: { value: 'MISSING' } });
        fireEvent.click(screen.getByRole('button', { name: 'Watch token' }));

        expect(await screen.findByText('Token "MISSING" was not found on Dogecoin (testnet).')).toBeTruthy();
        expect(getTokenInfo).toHaveBeenLastCalledWith({
            chainId: 'dogecoin-testnet',
            tick: 'MISSING',
            demo: false,
        });

        fireEvent.change(screen.getByRole('textbox', { name: 'Token ticker' }), { target: { value: 'WOW' } });
        fireEvent.click(screen.getByRole('button', { name: 'Watch token' }));

        await waitFor(() => expect(messaging.updateSettings).toHaveBeenCalledWith({
            watchedTokens: ['dogecoin-testnet:WOW'],
            hiddenTokens: [],
        }));
        expect(await screen.findByText('dogecoin-testnet:WOW')).toBeTruthy();

        fireEvent.change(screen.getByRole('textbox', { name: 'Token ticker' }), { target: { value: 'WOW' } });
        fireEvent.click(screen.getByRole('button', { name: 'Watch token' }));
        expect(await screen.findByText('WOW is already watched on Dogecoin (testnet).')).toBeTruthy();
        expect(getTokenInfo).toHaveBeenCalledTimes(2);

        fireEvent.click(screen.getByRole('button', { name: 'Remove watched token dogecoin-testnet:WOW' }));
        await waitFor(() => expect(messaging.updateSettings).toHaveBeenLastCalledWith({ watchedTokens: [] }));
        expect(screen.queryByText('dogecoin-testnet:WOW')).toBeNull();
    });

    it('does not apply a watched-token lookup after its ticker changes', async () => {
        let resolveLookup;
        const getTokenInfo = vi.fn(() => new Promise((resolve) => { resolveLookup = resolve; }));
        const messaging = setup({}, { getTokenInfo });
        await screen.findByRole('heading', { name: 'Watched tokens (0)' });

        const ticker = screen.getByLabelText('Token ticker');
        fireEvent.change(ticker, { target: { value: 'OLD' } });
        fireEvent.click(screen.getByRole('button', { name: 'Watch token' }));
        fireEvent.change(ticker, { target: { value: 'NEW' } });
        resolveLookup({ canonicalTick: 'OLD' });
        await Promise.resolve();
        await Promise.resolve();

        expect(messaging.updateSettings).not.toHaveBeenCalled();
        expect(ticker).toHaveValue('NEW');
        expect(screen.queryByText(/OLD is now shown/)).toBeNull();
        expect(screen.getByRole('button', { name: 'Watch token' })).toBeEnabled();
    });

    it('debounces token-list search across ticker and network name with clear and keyboard controls', async () => {
        setup({
            pinnedTokens: ['bitcoin-mainnet:XCP'],
            hiddenTokens: ['litecoin-mainnet:LTC'],
        });

        const search = await screen.findByRole('searchbox', { name: 'Search pinned and hidden tokens' });
        fireEvent.change(search, { target: { value: 'liteCOIN' } });
        expect(screen.getByText('bitcoin-mainnet:XCP')).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByText('bitcoin-mainnet:XCP')).toBeNull());
        expect(screen.getByText('litecoin-mainnet:LTC')).toBeInTheDocument();

        fireEvent.change(search, { target: { value: 'missing' } });
        expect(await screen.findByText('No pinned tokens match "missing".')).toBeInTheDocument();
        expect(screen.getByText('No hidden tokens match "missing".')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Clear settings token search' }));
        expect(search).toHaveValue('');
        expect(screen.getByText('bitcoin-mainnet:XCP')).toBeInTheDocument();
        fireEvent.keyDown(search, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Unpin bitcoin-mainnet:XCP' }));
    });
});
