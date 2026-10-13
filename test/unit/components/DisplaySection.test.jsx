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

afterEach(() => cleanup());

function setup(overrides = {}) {
    let settings = {
        privacy: { hideSmallBalances: false },
        pinnedTokens: [],
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
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <DisplaySection />
        </MessagingProvider>,
    );
    return messaging;
}

describe('DisplaySection', () => {
    it('persists every balance display control through settings updates', async () => {
        const messaging = setup();
        const hide = await screen.findByRole('switch', { name: 'Hide small balances' });

        fireEvent.click(hide);
        fireEvent.change(screen.getByLabelText('Small-balance threshold'), { target: { value: '0.01' } });
        fireEvent.change(screen.getByLabelText('Balance number format'), { target: { value: 'trim' } });

        await waitFor(() => {
            expect(messaging.updateSettings).toHaveBeenCalledWith({ privacy: { hideSmallBalances: true } });
            expect(messaging.updateSettings).toHaveBeenCalledWith({ smallBalanceThreshold: '0.01' });
            expect(messaging.updateSettings).toHaveBeenCalledWith({ numberFormat: 'trim' });
        });
    });

    it('resets display choices and token lists together', async () => {
        const messaging = setup({
            privacy: { hideSmallBalances: true },
            pinnedTokens: ['bitcoin-mainnet:BTC'],
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
            hiddenTokens: [],
            showPinAffordance: false,
            showHideAffordance: false,
            smallBalanceThreshold: 'dust',
            numberFormat: 'full',
            privacy: { hideSmallBalances: false },
        }));
        expect(await screen.findByText('Display settings reset to defaults.')).toBeTruthy();
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
