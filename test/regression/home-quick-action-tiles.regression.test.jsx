// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: Home has no Send / Receive / Exchange / More quick action
// row at any width, for demo wallets either. The shared tile keeps its round
// icon over label shape for the pages that still use it.
//
// jsdom has no layout, so the tile shape is pinned on the stylesheet.

import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDemoWalletId, markDemoWallet } from '../../packages/core/src/flows/demoMode.js';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../packages/core/src/shared/components/ToastHost.jsx';
import { Home } from '../../packages/core/src/shared/routes/Home.jsx';

const WALLET = { id: 'quick-action-tiles-wallet', name: 'Tiles wallet' };
const BALANCES = {
    'bitcoin-mainnet': [{
        address: 'bc1qquickactiontiles',
        balances: {
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [],
        },
    }],
};
const FOUR = ['Send', 'Receive', 'Exchange', 'More'];

const readCss = (path) => readFileSync(join(process.cwd(), path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
const homeCss = readCss('packages/core/src/shared/routes/Home.module.css');
// Every quick action is the shared tile, so its shape lives in the tile's own
// stylesheet: the single-class base rule plus the two-class rule that lifts
// the look over the kit Button variant.
const tileCss = readCss('packages/core/src/ui/QuickActionTile.module.css');

function ruleBody(selector, css = homeCss) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\:>,]/g, '\\$&');
    const match = new RegExp(`(^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`).exec(css);
    return match ? match[2] : '';
}

function messaging() {
    return {
        listWallets: vi.fn().mockResolvedValue([WALLET]),
        listAccounts: vi.fn().mockResolvedValue([]),
        getWalletBalances: vi.fn().mockResolvedValue(BALANCES),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({}),
        getAddressesByChain: vi.fn().mockResolvedValue({}),
    };
}

function handlers() {
    return {
        onSend: vi.fn(),
        onReceive: vi.fn(),
        onExchange: vi.fn(),
        onActions: vi.fn(),
        onSwap: vi.fn(),
    };
}

function mountHome(props, shell = 'web') {
    render(
        <MessagingProvider shell={shell} messaging={messaging()}>
            <ToastHost>
                <Home activeWalletId={WALLET.id} {...props} />
            </ToastHost>
        </MessagingProvider>,
    );
}

function setWidth(width) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
}

afterEach(() => {
    cleanup();
    clearDemoWalletId();
    setWidth(1024);
});

async function expectNoHeroActionRow() {
    await screen.findAllByRole('tablist');
    expect(screen.queryByRole('group', { name: 'Quick actions' })).toBeNull();
    for (const name of FOUR.concat(['More actions', 'Swap'])) {
        expect(screen.queryByRole('button', { name })).toBeNull();
    }
}

describe('Home has no quick action tiles', () => {
    it.each([
        ['web', 360], ['web', 1280], ['web', 1440],
        ['desktop', 360], ['desktop', 1280], ['desktop', 1440],
        ['popup', 360],
    ])('holds no Send, Receive, Exchange or More button in the %s shell at %ipx', async (shell, width) => {
        setWidth(width);
        mountHome(handlers(), shell);
        await expectNoHeroActionRow();
    });

    it.each([360, 1280, 1440])('holds none for a demo wallet at %ipx', async (width) => {
        setWidth(width);
        markDemoWallet(WALLET.id);
        mountHome(handlers());
        await expectNoHeroActionRow();
    });

    it('puts the balance tabs straight under the hero', async () => {
        mountHome(handlers());
        const tabs = (await screen.findAllByRole('tablist'))[0];
        expect(within(tabs.closest('main') || document.body).queryByRole('group', { name: 'Quick actions' })).toBeNull();
    });

    it('draws each button as a round 52px icon centred above its label with no outline or fill', () => {
        const base = ruleBody('.tile', tileCss);
        const tile = `${base}\n${ruleBody('.tile.tile', tileCss)}`;
        const round = ruleBody('.tile.tile.tile', tileCss);
        const icon = ruleBody('.tile.tile.tile .icon', tileCss);
        expect(base).toMatch(/flex-direction:\s*column/);
        expect(tile).toMatch(/flex-direction:\s*column/);
        expect(tile).toMatch(/align-items:\s*center/);
        expect(tile).toMatch(/justify-content:\s*center/);
        expect(round).toMatch(/aspect-ratio:\s*auto/);
        expect(round).toMatch(/background:\s*transparent/);
        expect(round).toMatch(/border-color:\s*transparent/);
        expect(ruleBody('.icon', tileCss)).toMatch(/border-radius:\s*50%/);
        expect(icon).toMatch(/width:\s*52px/);
        expect(icon).toMatch(/height:\s*52px/);
        expect(ruleBody('.quickActions')).toBe('');
    });
});
