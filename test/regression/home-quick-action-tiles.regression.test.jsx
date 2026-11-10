// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: Home quick actions are the same four square tiles at
// every width and for demo wallets.
//
//   [P2] 2026-11-10: Below 834px the row offered Swap in place of More
//        actions, a demo wallet lost Receive and More actions, and each
//        tile laid its icon beside the label in a wide, short button.
//
// jsdom has no layout, so the tile shape is pinned on the stylesheet and the
// e2e layout sweep measures it in a browser.

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
const FOUR = ['Send', 'Receive', 'Exchange', 'More actions'];

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

async function quickActionNames() {
    const row = await screen.findByRole('group', { name: 'Quick actions' });
    return within(row).getAllByRole('button').map((button) => button.textContent.trim());
}

describe('Home quick action tiles', () => {
    it.each([
        ['web', 360], ['web', 1280], ['web', 1440],
        ['desktop', 360], ['desktop', 1280], ['desktop', 1440],
        ['popup', 360],
    ])('holds exactly Send, Receive, Exchange and More actions in the %s shell at %ipx', async (shell, width) => {
        setWidth(width);
        mountHome(handlers(), shell);
        expect(await quickActionNames()).toEqual(FOUR);
        expect(screen.queryByRole('button', { name: 'Swap' })).toBeNull();
    });

    it.each([360, 1280, 1440])('holds the same four tiles for a demo wallet at %ipx', async (width) => {
        setWidth(width);
        markDemoWallet(WALLET.id);
        mountHome(handlers());
        expect(await quickActionNames()).toEqual(FOUR);
    });

    it('opens the actions menu from More actions and never from a second More button', async () => {
        setWidth(360);
        const h = handlers();
        mountHome(h, 'desktop');
        const row = await screen.findByRole('group', { name: 'Quick actions' });
        within(row).getByRole('button', { name: 'More actions' }).click();
        expect(h.onActions).toHaveBeenCalledTimes(1);
        expect(screen.getAllByRole('button', { name: 'More actions' })).toHaveLength(1);
    });

    it('puts every tile icon before its label', async () => {
        mountHome(handlers());
        const row = await screen.findByRole('group', { name: 'Quick actions' });
        for (const button of within(row).getAllByRole('button')) {
            const [first, last] = [button.firstElementChild, button.lastElementChild];
            expect(first).not.toBe(last);
            expect(first.querySelector('svg')).not.toBeNull();
            expect(last.textContent.trim()).not.toBe('');
        }
    });

    it('draws each tile square with the icon centred above the label', () => {
        const base = ruleBody('.tile', tileCss);
        const tile = `${base}\n${ruleBody('.tile.tile', tileCss)}`;
        expect(base).toMatch(/aspect-ratio:\s*1\s*\/\s*1/);
        expect(base).toMatch(/flex-direction:\s*column/);
        expect(tile).toMatch(/aspect-ratio:\s*1\s*\/\s*1/);
        expect(tile).toMatch(/flex-direction:\s*column/);
        expect(tile).toMatch(/align-items:\s*center/);
        expect(tile).toMatch(/justify-content:\s*center/);
        expect(ruleBody('.quickActions')).not.toMatch(/grid-auto-columns:\s*minmax\(0,\s*1fr\)/);
    });
});
