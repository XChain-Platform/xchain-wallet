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
import formStyles from '../../../packages/core/src/ui/FormPage.module.css';
import { unknownTokenKeys } from '../../../packages/core/src/shared/components/HomeTabs.jsx';
import { TokenPicker } from '../../../packages/core/src/shared/routes/TokenPicker.jsx';
import { selectOption } from '../../helpers/selectOption.js';

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
    it('uses compact descriptions and leaves the token lists to the Tokens page', async () => {
        setup({
            pinnedTokens: ['bitcoin-mainnet:BTC'],
            hiddenTokens: ['litecoin-mainnet:LTC'],
        });

        expect(await screen.findByText('Pinned and escrowed balances stay visible.')).toBeTruthy();
        expect(screen.getByRole('group', { name: 'Display settings' })).toHaveClass(formStyles.fullWidth);
        // The watched, pinned and hidden lists and the old in-page add form are gone.
        expect(screen.queryByRole('region', { name: /Watched tokens/ })).toBeNull();
        expect(screen.queryByRole('region', { name: /Pinned tokens/ })).toBeNull();
        expect(screen.queryByRole('region', { name: /Hidden tokens/ })).toBeNull();
        expect(screen.queryByRole('textbox', { name: 'Token ticker' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Watch Token' })).toBeNull();
    });

    it('puts written help tips on every balance and row-affordance setting', async () => {
        setup();

        await screen.findByRole('button', { name: 'About Hide small balances' });
        const tips = [
            ['Hide small balances', 'Pinned and escrowed balances stay visible.'],
            ['Hide unknown tokens', 'Collapse tokens without a name or image'],
            ['Small-balance threshold', 'A balance with no price is never hidden by its value'],
            ['Balance number format', 'Change displayed formatting without changing stored or submitted values.'],
            ['Show pin button on rows', 'A star pins or unpins the token on Home.'],
            ['Show hide button on rows', "Moves the token to Home's Hidden section."],
        ];

        for (const [label, copy] of tips) {
            const trigger = screen.getByRole('button', { name: `About ${label}` });
            fireEvent.click(trigger);
            expect(within(trigger.parentElement).getByRole('tooltip')).toHaveTextContent(copy);
        }
    });

    it('keeps the reset buttons iconed and the threshold rows on the shared field row', async () => {
        setup();
        await screen.findByRole('combobox', { name: 'Small-balance threshold' });
        for (const name of ['Reset List Preferences', 'Reset to Defaults']) {
            const button = screen.queryByRole('button', { name: new RegExp(name, 'i') });
            expect(button?.querySelector('svg')).not.toBeNull();
        }
        const thresholdRow = screen.getByRole('combobox', { name: 'Small-balance threshold' }).parentElement.parentElement.parentElement;
        expect(thresholdRow).toHaveClass(layoutStyles.fieldRow);
        expect(thresholdRow.style.background).toBe('var(--xc-settings-row-bg, var(--xc-card-bg))');
        expect(thresholdRow.style.border).toBe('var(--xc-settings-row-border, var(--xc-card-border))');
        expect(screen.getByRole('combobox', { name: 'Balance number format' }).parentElement.parentElement.parentElement).toHaveClass(layoutStyles.fieldRow);
    });

    it('persists every balance display control through settings updates', async () => {
        const messaging = setup();
        const hide = await screen.findByRole('switch', { name: 'Hide small balances' });
        const hideUnknown = screen.getByRole('switch', { name: 'Hide unknown tokens' });

        expect(screen.getByRole('group', { name: 'Display settings' })).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'Display options' })).toBeNull();
        expect(screen.getByRole('region', { name: 'Balance display' })).toBeTruthy();
        expect(screen.getByRole('region', { name: 'Row affordances' })).toBeTruthy();
        fireEvent.click(hide);
        fireEvent.click(hideUnknown);
        const threshold = screen.getByRole('combobox', { name: 'Small-balance threshold' });
        const numberFormat = screen.getByRole('combobox', { name: 'Balance number format' });
        // Both are the shared themed dropdown trigger (ruling G96).
        expect(threshold.className).toMatch(/trigger/);
        expect(numberFormat.className).toMatch(/trigger/);
        // The amount is in the display currency (operator ruling 2026-11-14).
        selectOption(threshold, '10');
        selectOption(numberFormat, 'trim');

        await waitFor(() => {
            expect(messaging.updateSettings).toHaveBeenCalledWith({ privacy: { hideSmallBalances: true } });
            expect(messaging.updateSettings).toHaveBeenCalledWith({ hideUnknownTokens: true });
            expect(messaging.updateSettings).toHaveBeenCalledWith({ smallBalanceFiat: '10' });
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
            smallBalanceFiat: '10',
            numberFormat: 'plain',
        });

        fireEvent.click(await screen.findByRole('button', { name: 'Reset to Defaults' }));
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
            smallBalanceFiat: '1',
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

    it('keeps the hide-unknown-tokens option but words it without pricing status', async () => {
        setup();

        expect(await screen.findByText('Hide unknown tokens')).toBeInTheDocument();
        expect(screen.getByText(/Collapse tokens without a name or image/)).toBeInTheDocument();
        expect(screen.queryByText(/unpriced/i)).toBeNull();
    });
});
