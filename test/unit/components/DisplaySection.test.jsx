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

        await waitFor(() => expect(messaging.updateSettings).toHaveBeenCalledWith({
            pinnedTokens: [],
            watchedTokens: [],
            hiddenTokens: [],
            showPinAffordance: false,
            showHideAffordance: false,
            smallBalanceThreshold: 'dust',
            numberFormat: 'full',
            privacy: { hideSmallBalances: false },
        }));
        expect(await screen.findByText('Display settings reset to defaults.')).toBeTruthy();
    });

    it('looks up a watched ticker on its selected chain, refuses missing and duplicate tokens, and removes it', async () => {
        const getTokenInfo = vi.fn(({ tick }) => Promise.resolve({
            canonicalTick: tick === 'WOW' ? 'WOW' : null,
        }));
        const messaging = setup({}, { getTokenInfo });
        await screen.findByRole('heading', { name: 'Watched tokens (0)' });

        fireEvent.change(screen.getByLabelText('Token chain'), { target: { value: 'dogecoin-testnet' } });
        fireEvent.change(screen.getByLabelText('Token ticker'), { target: { value: 'MISSING' } });
        fireEvent.click(screen.getByRole('button', { name: 'Watch token' }));

        expect(await screen.findByText('Token "MISSING" was not found on Dogecoin (testnet).')).toBeTruthy();
        expect(getTokenInfo).toHaveBeenLastCalledWith({
            chainId: 'dogecoin-testnet',
            tick: 'MISSING',
            demo: false,
        });

        fireEvent.change(screen.getByLabelText('Token ticker'), { target: { value: 'WOW' } });
        fireEvent.click(screen.getByRole('button', { name: 'Watch token' }));

        await waitFor(() => expect(messaging.updateSettings).toHaveBeenCalledWith({
            watchedTokens: ['dogecoin-testnet:WOW'],
            hiddenTokens: [],
        }));
        expect(await screen.findByText('dogecoin-testnet:WOW')).toBeTruthy();

        fireEvent.change(screen.getByLabelText('Token ticker'), { target: { value: 'WOW' } });
        fireEvent.click(screen.getByRole('button', { name: 'Watch token' }));
        expect(await screen.findByText('WOW is already watched on Dogecoin (testnet).')).toBeTruthy();
        expect(getTokenInfo).toHaveBeenCalledTimes(2);

        fireEvent.click(screen.getByRole('button', { name: 'Remove watched token dogecoin-testnet:WOW' }));
        await waitFor(() => expect(messaging.updateSettings).toHaveBeenLastCalledWith({ watchedTokens: [] }));
        expect(screen.queryByText('dogecoin-testnet:WOW')).toBeNull();
    });
});
