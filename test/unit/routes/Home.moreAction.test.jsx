// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Home's overflow quick action: a menu holding one entry is a wasted tap,
// so a lone action renders as its own button and "More" appears only once
// a second entry exists.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { clearDemoWalletId, markDemoWallet } from '../../../packages/core/src/flows/demoMode.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';
import homeModuleStyles from '../../../packages/core/src/shared/routes/Home.module.css';

const homeStyles = readFileSync(join(
    process.cwd(),
    'packages/core/src/shared/routes/Home.module.css',
), 'utf8');
const homeSource = readFileSync(join(
    process.cwd(),
    'packages/core/src/shared/routes/Home.jsx',
), 'utf8');
const heroSource = readFileSync(join(
    process.cwd(),
    'packages/core/src/shared/components/TotalBalanceHero.jsx',
), 'utf8');

const WALLET = { id: 'wallet-a', name: 'Main Wallet' };
const BALANCES = {
    'bitcoin-mainnet': [{
        address: 'bc1qtest',
        balances: {
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [],
        },
    }],
};

function makeMessaging(settings = {}) {
    return {
        listWallets: vi.fn().mockResolvedValue([WALLET]),
        listAccounts: vi.fn().mockResolvedValue([]),
        getWalletBalances: vi.fn().mockResolvedValue(BALANCES),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue(settings),
        getAddressesByChain: vi.fn().mockResolvedValue({}),
    };
}

function mount(props, shell = 'web', settings = {}) {
    render(
        React.createElement(
            MessagingProvider,
            { shell, messaging: makeMessaging(settings) },
            React.createElement(Home, { activeWalletId: WALLET.id, ...props }),
        ),
    );
}

afterEach(() => {
    cleanup();
    clearDemoWalletId();
});

describe('Home overflow quick action', () => {
    it('builds Home actions from the shared Button component', () => {
        expect(homeSource).toContain("import { Button, EmptyState, Icon");
        expect(heroSource).toContain("import { Button, Icon }");
        expect(homeSource).not.toMatch(/<button\b/);
        expect(heroSource).not.toMatch(/<button\b/);
    });

    it('opens Swap directly instead of a one-item More menu', async () => {
        const onSwap = vi.fn();
        mount({ onSwap });

        const swap = await screen.findByRole('button', { name: 'Swap' });
        expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
        fireEvent.click(swap);
        expect(onSwap).toHaveBeenCalledTimes(1);
    });
});

describe('Home desktop actions', () => {
    it('renders Send and Receive once while preserving supplementary actions', async () => {
        mount({
            onSend: vi.fn(),
            onReceive: vi.fn(),
            onCreateToken: vi.fn(),
        }, 'desktop');

        expect(await screen.findAllByRole('button', { name: 'Send' })).toHaveLength(1);
        expect(screen.getAllByRole('button', { name: 'Receive' })).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Create token' })).toBeTruthy();
    });

    it.each([
        [360, 4],
        [844, 4],
        [1280, 8],
    ])('uses matching buttons in an even grid at %ipx (%i columns)', async (viewportWidth, expectedColumns) => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewportWidth });
        mount({
            onCreateToken: vi.fn(),
            onMarkets: vi.fn(),
            onMessaging: vi.fn(),
            onHistory: vi.fn(),
            onAddresses: vi.fn(),
            onContracts: vi.fn(),
            onStaking: vi.fn(),
            onActions: vi.fn(),
        }, 'desktop');

        const more = await screen.findByRole('button', { name: 'More actions' });
        const actionGrid = more.parentElement;
        const actions = within(actionGrid).getAllByRole('button');

        expect(actionGrid).toHaveClass(homeModuleStyles.actionsFull);
        expect(actions).toHaveLength(8);
        actions.forEach((action) => {
            expect(action).toHaveClass(buttonStyles.secondary, buttonStyles.md);
        });
        if (expectedColumns === 4) {
            expect(homeStyles).toMatch(
                /\.actionsFull\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/,
            );
            expect(viewportWidth).toBeLessThan(1024);
        } else {
            expect(homeStyles).toMatch(
                /@media \(min-width: 1024px\)[\s\S]*\.actionsFull\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/,
            );
            // Labels stay on one line; a full row wraps whole tiles instead.
            expect(homeStyles).toMatch(
                /@media \(min-width: 1024px\)[\s\S]*\.actionsFull > button\s*\{[^}]*white-space:\s*nowrap;/,
            );
            expect(viewportWidth).toBeGreaterThanOrEqual(1024);
        }
    });
});

describe('Home quick-action policy', () => {
    const handlers = {
        onSend: vi.fn(),
        onReceive: vi.fn(),
        onExchange: vi.fn(),
        onSwap: vi.fn(),
    };

    it.each([
        ['mobile web', 'web'],
        ['extension', 'popup'],
        ['desktop', 'desktop'],
    ])('keeps the canonical order in the %s shell', async (_label, shell) => {
        mount(handlers, shell);

        const row = await screen.findByRole('group', { name: 'Quick actions' });
        expect(within(row).getAllByRole('button').map((button) => button.textContent.trim()))
            .toEqual(['Send', 'Receive', 'Exchange', 'Swap']);
    });

    it('explains the send restriction only after a demo user presses Send', async () => {
        markDemoWallet(WALLET.id);
        mount(handlers);

        const row = await screen.findByRole('group', { name: 'Quick actions' });
        expect(within(row).getAllByRole('button').map((button) => button.textContent.trim()))
            .toEqual(['Send', 'Exchange']);
        expect(screen.queryByText("Demo wallets can't send. Create a real wallet to send."))
            .toBeNull();

        fireEvent.click(within(row).getByRole('button', { name: 'Send' }));

        expect(handlers.onSend).not.toHaveBeenCalled();
        const notice = screen.getByText("Demo wallets can't send. Create a real wallet to send.");
        expect(notice).toBeVisible();
        // The notice is the first item of the page content, above the controls that raised it.
        expect(notice.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Exit demo & wipe' }));
        expect(screen.getByRole('dialog', { name: 'Exit demo and delete its data?' }))
            .toBeTruthy();
    });

    it('keeps watcher-supported actions and explains their unsigned behavior', async () => {
        mount(handlers, 'popup', { walletMode: 'watcher' });

        const row = await screen.findByRole('group', { name: 'Quick actions' });
        expect(within(row).getAllByRole('button').map((button) => button.textContent.trim()))
            .toEqual(['Send', 'Receive', 'Exchange', 'Swap']);
        const reason = screen.getByText(/builds Send and Swap transactions unsigned/);
        expect(row.getAttribute('aria-describedby')).toBe(reason.id);
    });

    it('reflows to two columns at 320px and lets labels wrap', () => {
        expect(homeStyles).toMatch(
            /@media not all and \(min-width: 360px\)[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
        );
        expect(homeStyles).toMatch(/overflow-wrap:\s*anywhere/);
    });
});
