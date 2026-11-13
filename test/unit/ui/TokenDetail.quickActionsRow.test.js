// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Token detail shows its actions as tiles on the Actions tab: Send, Receive
// and Exchange first, 80px tall, four across a phone row and 80px squares
// from 600px. History is a tab and Manage token sits in the owner group.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { render, screen, cleanup, within, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import listRowStyles from '../../../packages/core/src/ui/ListRow.module.css';

const css = readFileSync(
    resolve(process.cwd(), 'packages/core/src/shared/routes/TokenDetail.module.css'),
    'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

/** Every declaration block whose selector list names `selector` as a whole token. */
function blocksFor(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?:^|\\}|\\*\\/)\\s*([^{}]*?${escaped}(?![\\w-])[^{}]*)\\{([^}]*)\\}`, 'g');
    const out = [];
    for (const match of css.matchAll(re)) out.push({ selector: match[1].trim(), body: match[2] });
    return out;
}

/** Declaration blocks whose selector list holds `selector` as one whole entry. */
function exactBlocks(selector) {
    return blocksFor(selector).filter((r) => r.selector.split(',').map((part) => part.trim().replace(/\s+/g, ' ')).includes(selector));
}

// The round quick actions row and its More info menu are retired: the
// actions are tiles on the Actions tab.
describe('TokenDetail quick actions CSS', () => {
    it('keeps no quick actions row or More info menu styles', () => {
        expect(blocksFor('.quickActions')).toHaveLength(0);
        expect(blocksFor('.quickActionMoreWrap')).toHaveLength(0);
        expect(blocksFor('.quickActionMoreMenu')).toHaveLength(0);
    });

    it('spans four equal tiles 8px apart across a phone row', () => {
        const base = exactBlocks('.assetActionGrid')[0].body;
        expect(base).toMatch(/display:\s*grid/);
        expect(base).toMatch(/grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
        expect(base).toMatch(/gap:\s*var\(--xc-space-2\)/);
    });

    it('draws every tile 80px tall and 80px squares as many as fit from 600px', () => {
        const tile = css.match(/(?:\.assetActionGrid)+ > \*\s*\{([^}]*)\}/)?.[1] || '';
        expect(tile).toMatch(/block-size:\s*80px/);
        expect(css).toMatch(/@media \(min-width: 600px\)\s*\{\s*\.assetActionGrid\s*\{\s*grid-template-columns:\s*repeat\(auto-fill,\s*80px\);/);
    });
});

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
    __clearTokenInfoCache();
    localStorage.removeItem('xc:activeAccount:w1');
});

const CHAIN = 'bitcoin-regtest';
const MINE = 'bcrt1qmineminemineminemineminemineminemine0';
const OTHER = 'bcrt1qotherotherotherotherotherotherotherot';

function renderDetail({ creator = OTHER, quantity = '100', kind = 'token' } = {}) {
    const handlers = {
        onSend: vi.fn(),
        onReceive: vi.fn(),
        onBuy: vi.fn(),
        onViewActivity: vi.fn(),
        onManageToken: vi.fn(),
    };
    const messaging = {
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getTokenInfo: vi.fn().mockResolvedValue({ creator, divisibility: 8 }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: MINE }] }),
        getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
        listGatedContent: vi.fn().mockResolvedValue([]),
        getWalletBalances: vi.fn().mockResolvedValue(undefined),
    };
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(TokenDetail, {
            walletId: 'w1',
            chainId: CHAIN,
            tick: kind === 'native' ? 'BTC' : 'S18PROBE',
            kind,
            quantity,
            onBack() {},
            ...handlers,
        }),
    ));
    return handlers;
}

function tileNames(group) {
    return within(group).getAllByRole('button').map((b) => b.getAttribute('aria-label') || b.textContent);
}

describe('TokenDetail quick actions render', () => {
    it('holds Send, Receive and Exchange first, in that order, as compact tiles on the Actions tab', async () => {
        renderDetail();
        await screen.findByRole('button', { name: 'Send' });
        const group = screen.getByRole('group', { name: 'Actions for S18PROBE' });
        expect(tileNames(group).slice(0, 3)).toEqual(['Send', 'Receive', 'Exchange']);
        expect(within(group).queryByRole('button', { name: 'More info' })).toBeNull();
        expect(within(group).queryByRole('button', { name: /Market view|Trade/ })).toBeNull();
        expect(within(group).queryByRole('button', { name: 'History' })).toBeNull();
        expect(group.querySelector(`.${listRowStyles.row}`)).toBeNull();
        for (const button of within(group).getAllByRole('button')) {
            expect(button).not.toHaveClass(listRowStyles.row);
        }
    });

    it('opens Exchange with the selected asset', async () => {
        const { onBuy } = renderDetail();
        fireEvent.click(await screen.findByRole('button', { name: 'Exchange' }));
        expect(onBuy).toHaveBeenCalledTimes(1);
    });

    it('retires the More info menu: History is a tab and the other panels are Details rows', async () => {
        renderDetail();
        await screen.findByRole('button', { name: 'Send' });
        expect(screen.queryByRole('button', { name: 'More info' })).toBeNull();
        expect(screen.queryByRole('menu')).toBeNull();
        expect(within(screen.getByRole('tablist', { name: 'Coin or token view' })).getAllByRole('tab').map((tab) => tab.textContent))
            .toEqual(['Actions', 'Details', 'History']);

        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        expect(await screen.findByRole('button', { name: 'Gated content' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Holders' })).toBeTruthy();
    });

    it('keeps a blocked Send visible with the reason that blocks it', async () => {
        renderDetail({ quantity: '0' });
        const group = await screen.findByRole('group', { name: 'Actions for S18PROBE' });
        const send = await within(group).findByRole('button', { name: 'Send' });
        await waitFor(() => expect(send).toBeDisabled());
        const reason = screen.getByText('No balance to send.');
        expect(send.getAttribute('aria-describedby')).toBe(reason.closest('[id]').id);
    });

    it('lists Manage token in its own owner group only for the token owner', async () => {
        renderDetail({ creator: OTHER });
        await screen.findByRole('group', { name: 'Actions for S18PROBE' });
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Manage token' })).toBeNull());
        expect(screen.queryByRole('group', { name: 'You issued this token' })).toBeNull();
        cleanup();
        __clearTokenInfoCache();

        const { onManageToken } = renderDetail({ creator: MINE });
        const owner = await screen.findByRole('group', { name: 'You issued this token' });
        const main = screen.getByRole('group', { name: 'Actions for S18PROBE' });
        expect(within(main).queryByRole('button', { name: 'Manage token' })).toBeNull();
        fireEvent.click(within(owner).getByRole('button', { name: 'Manage token' }));
        expect(onManageToken).toHaveBeenCalledTimes(1);
    });

    it('keeps the Send, Receive and Exchange tiles for a native coin', async () => {
        renderDetail({ kind: 'native' });
        await screen.findByRole('button', { name: 'Send' });
        expect(tileNames(screen.getByRole('group', { name: 'Actions for BTC' })).slice(0, 3))
            .toEqual(['Send', 'Receive', 'Exchange']);
    });
});
