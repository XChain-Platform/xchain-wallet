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
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DisplaySection } from '../../../packages/core/src/shared/components/settings/DisplaySection.jsx';
import layoutStyles from '../../../packages/core/src/shared/components/settings/DisplaySection.module.css';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';
import formStyles from '../../../packages/core/src/ui/FormPage.module.css';
import inputStyles from '../../../packages/core/src/ui/Input.module.css';
import { unknownTokenKeys } from '../../../packages/core/src/shared/components/HomeTabs.jsx';
import { TokenPicker } from '../../../packages/core/src/shared/routes/TokenPicker.jsx';

afterEach(() => cleanup());

function setup(overrides = {}, messagingOverrides = {}) {
    let settings = {
        privacy: { hideSmallBalances: false },
        pinnedTokens: [],
        watchedTokens: [],
        hiddenTokens: [],
        hideUnknownTokens: false,
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
    it('uses compact descriptions without repeating section titles', async () => {
        setup({
            pinnedTokens: ['bitcoin-mainnet:BTC'],
            hiddenTokens: ['litecoin-mainnet:LTC'],
        });

        expect(await screen.findByText('Pinned and escrowed balances stay visible.')).toBeTruthy();
        expect(screen.getByText('Float to the top; reorder or unpin here.')).toBeTruthy();
        expect(screen.getByText('Collapse under "Show N hidden"; unhide here.')).toBeTruthy();
        expect(screen.queryByText(/Pinned tokens float/)).toBeNull();
        expect(screen.queryByText(/Hidden tokens collapse/)).toBeNull();
    });

    it('uses the shared medium control size across the watched-token row', async () => {
        setup();

        const chain = await screen.findByRole('combobox', { name: 'Token network' });
        const ticker = screen.getByRole('textbox', { name: 'Token ticker' });
        const action = screen.getByRole('button', { name: 'Watch token' });
        expect(screen.getByRole('group', { name: 'Display settings' })).toHaveClass(formStyles.fullWidth);
        expect(chain.parentElement.parentElement).toHaveClass(inputStyles.md);
        expect(ticker.parentElement.parentElement).toHaveClass(inputStyles.md);
        expect(action).toHaveClass(buttonStyles.md);
    });

    it('uses the shared form surface for equal-height watched-token controls', async () => {
        setup({ pinnedTokens: ['bitcoin-mainnet:XCP'] });
        const ticker = await screen.findByRole('textbox', { name: 'Token ticker' });
        const tickerField = ticker.parentElement.parentElement;
        const watchForm = ticker.closest('form');

        expect(tickerField.className).toMatch(/(?:^|\s)_?md_/);
        expect(watchForm).toHaveClass(formStyles.form);
        expect(watchForm).not.toHaveClass(layoutStyles.fieldRow);
        expect(watchForm.style.background).toBe('');
        expect(watchForm.style.border).toBe('');
        // The form is a column, so a flex basis on the label would be a 280px height.
        const watchLabel = within(watchForm).getByText('Token to watch');
        expect(watchLabel.style.flex).toBe('');
        expect(watchLabel.parentElement.style.flex).toBe('');
        expect(tickerField.parentElement).toHaveClass(layoutStyles.watchControls);
        expect(screen.getByRole('button', { name: 'Watch token' }).className).toMatch(/(?:^|\s)_?md_/);
        const thresholdRow = screen.getByRole('combobox', { name: 'Small-balance threshold' }).parentElement.parentElement.parentElement;
        expect(thresholdRow).toHaveClass(layoutStyles.fieldRow);
        expect(thresholdRow.style.background).toBe('var(--xc-card-bg)');
        expect(thresholdRow.style.border).toBe('var(--xc-card-border)');
        expect(screen.getByRole('combobox', { name: 'Balance number format' }).parentElement.parentElement.parentElement).toHaveClass(layoutStyles.fieldRow);

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
        const hideUnknown = screen.getByRole('switch', { name: 'Hide unknown tokens' });

        expect(screen.getByRole('group', { name: 'Display settings' })).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'Display options' })).toBeNull();
        expect(screen.getByRole('region', { name: 'Balance display' })).toBeTruthy();
        expect(screen.getByRole('region', { name: 'Row affordances' })).toBeTruthy();
        expect(screen.getByRole('region', { name: 'Watched tokens (0)' })).toBeTruthy();
        fireEvent.click(hide);
        fireEvent.click(hideUnknown);
        const threshold = screen.getByRole('combobox', { name: 'Small-balance threshold' });
        const numberFormat = screen.getByRole('combobox', { name: 'Balance number format' });
        expect(threshold.className).toMatch(/input/);
        expect(numberFormat.className).toMatch(/input/);
        fireEvent.change(threshold, { target: { value: '0.01' } });
        fireEvent.change(numberFormat, { target: { value: 'trim' } });

        await waitFor(() => {
            expect(messaging.updateSettings).toHaveBeenCalledWith({ privacy: { hideSmallBalances: true } });
            expect(messaging.updateSettings).toHaveBeenCalledWith({ hideUnknownTokens: true });
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
            hideUnknownTokens: true,
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
            hideUnknownTokens: false,
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

    it('classifies only unfamiliar metadata-free tokens as unknown', () => {
        const token = (tick, overrides = {}) => ({
            chainId: 'bitcoin-mainnet',
            tick,
            kind: 'token',
            displayName: tick,
            imageUrl: null,
            fiatRate: null,
            ...overrides,
        });
        const unknown = unknownTokenKeys([
            token('UNKNOWN'),
            token('NAMED', { displayName: 'Named token' }),
            token('IMAGED', { imageUrl: 'data:image/png;base64,AA==' }),
            token('PRICED', { fiatRate: 0.25 }),
            token('ORDERED', { escrowed: '1' }),
            token('PINNED'),
            token('WATCHED'),
            token('ISSUED'),
            token('BTC', { kind: 'native' }),
        ], {
            pinnedKeys: new Set(['bitcoin-mainnet:PINNED']),
            watchedTokens: ['bitcoin-mainnet:WATCHED'],
            ownedTokens: [{ chainId: 'bitcoin-mainnet', tick: 'ISSUED' }],
        });

        expect([...unknown]).toEqual(['bitcoin-mainnet:UNKNOWN']);
    });

    it('keeps a hidden token balance keyboard-reachable in the Send picker', async () => {
        const onSelect = vi.fn();
        const messaging = {
            getSettings: vi.fn().mockResolvedValue({
                hiddenTokens: ['bitcoin-mainnet:HIDDEN'],
                hideUnknownTokens: true,
            }),
            getWalletBalances: vi.fn().mockResolvedValue({
                'bitcoin-mainnet': [{
                    address: 'bc1qsender',
                    balances: {
                        native: { tick: 'BTC', quantity: '1000', divisibility: 8 },
                        tokens: [
                            { tick: 'HIDDEN', quantity: '25', divisibility: 0 },
                            { tick: 'UNKNOWN', quantity: '50', divisibility: 0 },
                        ],
                    },
                }],
            }),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <TokenPicker
                    purpose="send"
                    walletId="wallet-1"
                    onBack={() => {}}
                    onSelect={onSelect}
                />
            </MessagingProvider>,
        );

        expect(await screen.findByRole('button', { name: /^Select UNKNOWN\b/ }))
            .toBeInTheDocument();
        fireEvent.click(await screen.findByRole('button', { name: 'Show 1 hidden token' }));
        const firstOption = screen.getByRole('button', { name: /^Select Bitcoin\b/ });
        const hiddenOption = screen.getByRole('button', { name: /^Select HIDDEN\b/ });
        firstOption.focus();
        fireEvent.keyDown(firstOption, { key: 'ArrowUp' });

        expect(hiddenOption).toHaveFocus();
        expect(hiddenOption.closest('[role="listitem"]')).toHaveTextContent('25');
        fireEvent.click(hiddenOption);
        expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
            chainId: 'bitcoin-mainnet',
            tick: 'HIDDEN',
        }));
    });

    it('looks up a watched ticker on its selected network, refuses missing and duplicate tokens, and removes it', async () => {
        const getTokenInfo = vi.fn(({ tick }) => Promise.resolve({
            canonicalTick: tick === 'WOW' ? 'WOW' : null,
        }));
        const messaging = setup({}, { getTokenInfo });
        await screen.findByRole('heading', { name: 'Watched tokens (0)' });

        expect(screen.getAllByRole('option').map((option) => option.textContent))
            .not.toContain('Dogecoin (testnet)');

        fireEvent.change(screen.getByRole('combobox', { name: 'Token network' }), { target: { value: 'dogecoin-testnet' } });
        fireEvent.change(screen.getByRole('textbox', { name: 'Token ticker' }), { target: { value: 'MISSING' } });
        fireEvent.click(screen.getByRole('button', { name: 'Watch token' }));

        expect(await screen.findByText('Token "MISSING" was not found on Dogecoin.')).toBeTruthy();
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
        expect(await screen.findByText('Dogecoin:WOW')).toBeTruthy();

        fireEvent.change(screen.getByRole('textbox', { name: 'Token ticker' }), { target: { value: 'WOW' } });
        fireEvent.click(screen.getByRole('button', { name: 'Watch token' }));
        expect(await screen.findByText('WOW is already watched on Dogecoin.')).toBeTruthy();
        expect(getTokenInfo).toHaveBeenCalledTimes(2);

        fireEvent.click(screen.getByRole('button', { name: 'Remove watched token Dogecoin:WOW' }));
        await waitFor(() => expect(messaging.updateSettings).toHaveBeenLastCalledWith({ watchedTokens: [] }));
        expect(screen.queryByText('Dogecoin:WOW')).toBeNull();
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
        expect(screen.getByText('Bitcoin:XCP')).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByText('Bitcoin:XCP')).toBeNull());
        expect(screen.getByText('Litecoin:LTC')).toBeInTheDocument();

        fireEvent.change(search, { target: { value: 'missing' } });
        expect(await screen.findByText('No pinned tokens match "missing".')).toBeInTheDocument();
        expect(screen.getByText('No hidden tokens match "missing".')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Clear settings token search' }));
        expect(search).toHaveValue('');
        expect(screen.getByText('Bitcoin:XCP')).toBeInTheDocument();
        fireEvent.keyDown(search, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Unpin Bitcoin:XCP' }));
    });
});
