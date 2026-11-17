// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Home carries no Send / Receive / Exchange / More quick action row. The
// navigation (bottom bar, sidebar) holds Send and Receive, and the wallet menu
// holds Exchange (Markets) and All actions, so Home is the balance hero, the
// tabs and the content under them.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { clearDemoWalletId, markDemoWallet } from '../../../packages/core/src/flows/demoMode.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';
import { visibleWalletMenu } from '../../../packages/core/src/shared/walletMenu.js';

const read = (path) => readFileSync(join(process.cwd(), path), 'utf8');
const homeStyles = read('packages/core/src/shared/routes/Home.module.css');
const homeSource = read('packages/core/src/shared/routes/Home.jsx');
const heroSource = read('packages/core/src/shared/components/TotalBalanceHero.jsx');
// The hero's controls live in the shared balance hero menu (U52).
const heroMenuSource = read('packages/core/src/shared/components/BalanceHeroMenu.jsx');

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
        // §20: the mode is the wallet's own, carried on its safe record.
        listWallets: vi.fn().mockResolvedValue([{ ...WALLET, walletMode: settings.walletMode || 'full' }]),
        listAccounts: vi.fn().mockResolvedValue([]),
        getWalletBalances: vi.fn().mockResolvedValue(BALANCES),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue(settings),
        getAddressesByChain: vi.fn().mockResolvedValue({}),
    };
}

const handlers = {
    onSend: vi.fn(),
    onReceive: vi.fn(),
    onExchange: vi.fn(),
    onSwap: vi.fn(),
    onActions: vi.fn(),
    onHistory: vi.fn(),
};

async function mountHome(props = handlers, shell = 'web', settings = {}) {
    render(
        React.createElement(
            MessagingProvider,
            { shell, messaging: makeMessaging(settings) },
            React.createElement(Home, { activeWalletId: WALLET.id, ...props }),
        ),
    );
    // The balance tabs render once the balances have loaded.
    await screen.findAllByRole('tablist');
}

function expectNoQuickActions() {
    expect(screen.queryByRole('group', { name: 'Quick actions' })).toBeNull();
    for (const name of ['Send', 'Receive', 'Exchange', 'More', 'More actions', 'Swap']) {
        expect(screen.queryByRole('button', { name })).toBeNull();
    }
}

afterEach(() => {
    cleanup();
    clearDemoWalletId();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
});

describe('Home source', () => {
    it('builds Home from the shared kit and keeps no quick action row', () => {
        // Home's only buttons were the signer stack, now the shared ActionList (G101).
        expect(homeSource).toContain("import { EmptyState, Icon");
        expect(homeSource).toContain("import { ActionList, ActionListItem } from '../components/ActionList.jsx';");
        expect(heroMenuSource).toContain("import { Button, Icon }");
        expect(homeSource).not.toMatch(/<button\b/);
        expect(heroSource).not.toMatch(/<button\b/);
        expect(heroMenuSource).not.toMatch(/<button\b/);
        expect(homeSource).not.toContain('QuickActionTile');
        expect(homeSource).not.toContain("t('home.moreShort')");
        expect(homeStyles).not.toMatch(/\.quickActions/);
        expect(homeStyles).not.toMatch(/\.actionsFull/);
    });
});

describe('Home draws no quick actions', () => {
    it.each([
        ['mobile web', 'web', 360],
        ['extension', 'popup', 360],
        ['desktop at 833px', 'desktop', 833],
        ['desktop at 1280px', 'desktop', 1280],
    ])('has no Send, Receive, Exchange or More button in the %s shell', async (_label, shell, width) => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
        await mountHome(handlers, shell);
        expectNoQuickActions();
    });

    it('has no quick actions without an actions menu or an Exchange handler', async () => {
        await mountHome({ onSend: vi.fn(), onReceive: vi.fn() }, 'desktop');
        expectNoQuickActions();
    });

    it('has no quick actions and no demo send notice in a demo wallet', async () => {
        markDemoWallet(WALLET.id);
        await mountHome();
        expectNoQuickActions();
        expect(screen.queryByText("Demo wallets can't send. Create a real wallet to send.")).toBeNull();
    });

    it('has no quick actions and no watch-only hint in a watch-only wallet', async () => {
        await mountHome(handlers, 'popup', { walletMode: 'watcher' });
        expectNoQuickActions();
        expect(screen.queryByText(/builds Send and Swap transactions unsigned/)).toBeNull();
    });
});

describe('Home draws no pending airdrop card', () => {
    it('has no resume card and reads no pending airdrops', async () => {
        const messaging = {
            ...makeMessaging(),
            listPendingAirdropsForWallet: vi.fn().mockResolvedValue([
                { id: 'a1', stage: 'ready-to-airdrop', amountPer: '1', token: 'TOK', recipients: [1, 2] },
            ]),
        };
        render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(Home, { activeWalletId: WALLET.id, onResumeAirdrop: vi.fn() }),
            ),
        );
        await screen.findAllByRole('tablist');
        expect(screen.queryByRole('group', { name: 'Pending airdrops' })).toBeNull();
        expect(screen.queryByRole('button', { name: /Resume airdrop/ })).toBeNull();
        expect(messaging.listPendingAirdropsForWallet).not.toHaveBeenCalled();
    });
});

describe('the actions Home used to carry stay reachable elsewhere', () => {
    it('keeps Send, Receive, Exchange and All actions in the wallet menu', () => {
        const ids = visibleWalletMenu({ hasDexSurface: true }).flatMap((group) => group.rows.map((row) => row.id));
        for (const id of ['send', 'receive', 'markets', 'actions']) expect(ids).toContain(id);
    });
});
