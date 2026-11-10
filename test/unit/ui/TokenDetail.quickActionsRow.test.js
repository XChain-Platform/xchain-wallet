// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Token detail quick actions are the same four square tiles as Home: Send,
// Receive, Exchange and More info, each with its icon centred over its label.
// History and Manage live in the More info menu, never as top-level tiles.

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

describe('TokenDetail quick actions CSS', () => {
    it('lays the quick actions out as one horizontal row', () => {
        const rules = exactBlocks('.quickActions');
        expect(rules.length).toBeGreaterThan(0);
        for (const { body } of rules) {
            expect(body).not.toMatch(/flex-direction:\s*column/);
            expect(body).not.toMatch(/grid-auto-flow:\s*row/);
        }
        const base = rules[0].body;
        expect(base).toMatch(/display:\s*(flex|grid)/);
        if (/display:\s*grid/.test(base)) {
            expect(base).toMatch(/grid-auto-flow:\s*column/);
        } else {
            expect(base).not.toMatch(/flex-wrap:\s*wrap/);
        }
    });

    it('never stretches the tile tracks to the row width', () => {
        for (const { body } of blocksFor('.quickActions')) {
            expect(body).not.toMatch(/\b\d*\.?\d+fr\b/);
            expect(body).not.toMatch(/flex:\s*1\b|flex-grow:\s*[1-9]/);
            expect(body).not.toMatch(/justify-content:\s*(stretch|space-between|space-around|space-evenly)/);
        }
        const base = exactBlocks('.quickActions')[0].body;
        // Every track has a fixed upper bound, so a wide screen keeps compact tiles.
        expect(base).toMatch(/grid-auto-columns:\s*minmax\(\s*0\s*,\s*[^)]*\d+px[^)]*\)/);
    });

    it('draws each quick action as a square tile with the icon over the label', () => {
        const buttonRules = exactBlocks('.quickActions > button');
        expect(buttonRules.length).toBeGreaterThan(0);
        // The More info tile sits in its menu wrapper and shares the tile rule.
        expect(buttonRules.some((r) => /\.quickActionMoreWrap > button/.test(r.selector))).toBe(true);
        const body = buttonRules.map((r) => r.body).join('\n');
        expect(body).toMatch(/aspect-ratio:\s*1\s*\/\s*1/);
        expect(body).toMatch(/flex-direction:\s*column/);
        expect(body).toMatch(/align-items:\s*center/);
        expect(body).toMatch(/justify-content:\s*center/);
        // A fixed min-height taller than a phone tile would break the square.
        expect(body).not.toMatch(/min-height:\s*\d+px/);
        expect(body).toMatch(/min-width:\s*0/);
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
    it('holds Send, Receive, Exchange and More info in that order as compact tiles', async () => {
        renderDetail();
        await screen.findByRole('button', { name: 'Send' });
        const group = screen.getByRole('group', { name: 'Quick actions' });
        expect(tileNames(group)).toEqual(['Send', 'Receive', 'Exchange', 'More info']);
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

    it('keeps History in the More info menu and runs it from there', async () => {
        const { onViewActivity } = renderDetail();
        const more = await screen.findByRole('button', { name: 'More info' });
        expect(more).toHaveAttribute('aria-haspopup', 'menu');
        expect(more).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('menu')).toBeNull();

        fireEvent.click(more);
        expect(more).toHaveAttribute('aria-expanded', 'true');
        const menu = screen.getByRole('menu', { name: 'More info' });
        expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['History']);
        fireEvent.click(within(menu).getByRole('menuitem', { name: 'History' }));
        expect(onViewActivity).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('menu')).toBeNull();
    });

    it('closes the More info menu on Escape', async () => {
        renderDetail();
        const more = await screen.findByRole('button', { name: 'More info' });
        fireEvent.click(more);
        expect(screen.getByRole('menu')).toBeTruthy();
        fireEvent.keyDown(window, { key: 'Escape' });
        await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    });

    it('keeps a blocked Send visible with the reason that blocks it', async () => {
        renderDetail({ quantity: '0' });
        const group = await screen.findByRole('group', { name: 'Quick actions' });
        const send = await within(group).findByRole('button', { name: 'Send' });
        await waitFor(() => expect(send).toBeDisabled());
        const reason = within(group).getByText('No balance to send.');
        expect(send.getAttribute('aria-describedby')).toBe(reason.id);
    });

    it('lists Manage in the More info menu only for the token owner', async () => {
        renderDetail({ creator: OTHER });
        fireEvent.click(await screen.findByRole('button', { name: 'More info' }));
        await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'Manage' })).toBeNull());
        cleanup();
        __clearTokenInfoCache();

        const { onManageToken } = renderDetail({ creator: MINE });
        const group = await screen.findByRole('group', { name: 'Quick actions' });
        expect(within(group).queryByRole('button', { name: 'Manage' })).toBeNull();
        fireEvent.click(within(group).getByRole('button', { name: 'More info' }));
        const manage = await screen.findByRole('menuitem', { name: 'Manage' });
        expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((item) => item.textContent))
            .toEqual(['History', 'Manage']);
        fireEvent.click(manage);
        expect(onManageToken).toHaveBeenCalledTimes(1);
    });

    it('keeps the same four tiles for a native coin', async () => {
        renderDetail({ kind: 'native' });
        await screen.findByRole('button', { name: 'Send' });
        expect(tileNames(screen.getByRole('group', { name: 'Quick actions' })))
            .toEqual(['Send', 'Receive', 'Exchange', 'More info']);
    });
});
