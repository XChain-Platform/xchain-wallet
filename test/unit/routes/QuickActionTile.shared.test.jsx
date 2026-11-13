// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Home and token detail draw their quick actions with one shared tile: every
// tile in either row carries the shared tile class and the shared icon slot,
// in a demo wallet and in a watch-only wallet alike, and neither screen's own
// stylesheet keeps a tile rule of its own.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { clearDemoWalletId, markDemoWallet } from '../../../packages/core/src/flows/demoMode.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import tileStyles from '../../../packages/core/src/ui/QuickActionTile.module.css';

vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({
    useReachability: () => ({
        loading: false,
        overall: 'normal',
        perChain: [],
        refresh: vi.fn(),
        lastChecked: null,
        error: null,
    }),
}));

const read = (path) => readFileSync(join(process.cwd(), path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

let savedResizeObserver;
beforeAll(() => {
    class StubObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() { return []; }
    }
    savedResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = globalThis.ResizeObserver || StubObserver;
});
afterAll(() => { globalThis.ResizeObserver = savedResizeObserver; });

afterEach(() => {
    cleanup();
    resetWalletModes();
    clearDemoWalletId();
    __clearTokenInfoCache();
});

const WALLET = { id: 'tile-wallet', name: 'Tile Wallet' };
const CHAIN = 'bitcoin-regtest';
const MINE = 'bcrt1qmineminemineminemineminemineminemine0';

// `options.walletMode` is the mode of the tile wallet, published the way the
// shell does from the wallet list; settings carry no mode.
function messaging(options = {}) {
    const walletMode = options.walletMode || 'full';
    publishWalletModes({ wallets: [{ ...WALLET, walletMode }], activeWalletId: WALLET.id });
    return {
        listWallets: vi.fn().mockResolvedValue([{ ...WALLET, walletMode }]),
        listAccounts: vi.fn().mockResolvedValue([]),
        getWalletBalances: vi.fn().mockResolvedValue({
            'bitcoin-mainnet': [{
                address: 'bc1qtile',
                balances: { native: { tick: 'BTC', quantity: '100000000', divisibility: 8 }, tokens: [] },
            }],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({}),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: MINE }] }),
        getTokenInfo: vi.fn().mockResolvedValue({ creator: MINE, divisibility: 8 }),
        getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
        listGatedContent: vi.fn().mockResolvedValue([]),
    };
}

function mountHome(settings) {
    render(
        <MessagingProvider shell="web" messaging={messaging(settings)}>
            <Home
                activeWalletId={WALLET.id}
                onSend={vi.fn()}
                onReceive={vi.fn()}
                onExchange={vi.fn()}
                onSwap={vi.fn()}
                onActions={vi.fn()}
            />
        </MessagingProvider>,
    );
}

function mountTokenDetail(settings) {
    render(
        <MessagingProvider shell="web" messaging={messaging(settings)}>
            <TokenDetail
                walletId={WALLET.id}
                chainId={CHAIN}
                tick="S18PROBE"
                kind="token"
                quantity="100"
                onBack={() => {}}
                onSend={vi.fn()}
                onReceive={vi.fn()}
                onBuy={vi.fn()}
                onViewActivity={vi.fn()}
                onManageToken={vi.fn()}
            />
        </MessagingProvider>,
    );
}

// Token detail's Actions tab (the selected tab on open) holds the action
// tiles; every one is the shared square tile with the shared icon slot.
async function expectSharedTiles(names) {
    await waitFor(() => expect(document.querySelector('button[data-action-id]')).not.toBeNull());
    const tiles = Array.from(document.querySelectorAll('button[data-action-id]'));
    expect(tiles.map((tile) => tile.textContent.trim())).toEqual(expect.arrayContaining(names));
    for (const tile of tiles) {
        expect(tile, tile.textContent).toHaveClass(tileStyles.tile);
        expect(tile, tile.textContent).toHaveClass(tileStyles.square);
        expect(tile.querySelector(`.${tileStyles.icon}`), tile.textContent).not.toBeNull();
    }
}

const MODES = [
    ['a demo wallet', () => { markDemoWallet(WALLET.id); return {}; }],
    ['a watch-only wallet', () => ({ walletMode: 'watcher' })],
];

describe('shared quick-action tile', () => {
    it.each(MODES)('draws every Home quick action with the shared tile in %s', async (_label, setup) => {
        mountHome(setup());
        const group = await screen.findByRole('group', { name: 'Quick actions' });
        await within(group).findByRole('button', { name: 'Send' });
        const tiles = within(group).getAllByRole('button');
        // More keeps the full "More actions" name as its accessible label.
        expect(tiles.map((tile) => tile.textContent.trim())).toEqual(['Send', 'Receive', 'Exchange', 'More']);
        for (const tile of tiles) {
            expect(tile, tile.textContent).toHaveClass(tileStyles.tile);
            expect(tile.querySelector(`.${tileStyles.icon}`), tile.textContent).not.toBeNull();
        }
    });

    it.each(MODES)('draws every token detail Actions tab tile with the shared tile in %s', async (_label, setup) => {
        mountTokenDetail(setup());
        await expectSharedTiles(['Send', 'Receive']);
    });

    it('keeps no tile rule in either screen stylesheet', () => {
        for (const file of ['Home.module.css', 'TokenDetail.module.css']) {
            const css = read(`packages/core/src/shared/routes/${file}`);
            expect(css, file).not.toMatch(/\.quickAction(?:Icon)?(?![\w-])/);
        }
        const shared = read('packages/core/src/ui/QuickActionTile.module.css');
        expect(shared).toMatch(/\n\.tile\s*\{[^}]*aspect-ratio:\s*1\s*\/\s*1[^}]*\}/);
        expect(shared).toMatch(/\n\.tile\s*\{[^}]*flex-direction:\s*column/);
        expect(shared).toMatch(/\n\.icon\s*\{[^}]*width:\s*32px/);
    });
});
