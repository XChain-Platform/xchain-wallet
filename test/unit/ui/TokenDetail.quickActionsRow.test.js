// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Token detail quick actions (Send, Receive, Market view, History) are one
// horizontal row of compact buttons, never a stack of full-width list rows.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
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

describe('TokenDetail quick actions CSS', () => {
    it('lays the quick actions out as one horizontal row', () => {
        const rules = blocksFor('.quickActions').filter((r) => r.selector === '.quickActions');
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

    it('lets each quick action shrink below its content so four fit at 320 px', () => {
        const buttonRules = blocksFor('.quickActions > button');
        expect(buttonRules.length).toBeGreaterThan(0);
        expect(buttonRules.some(({ body }) => /min-width:\s*0/.test(body))).toBe(true);
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

function renderDetail({ creator = OTHER, quantity = '100' } = {}) {
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
            tick: 'S18PROBE',
            kind: 'token',
            quantity,
            onBack() {},
            onSend: vi.fn(),
            onReceive: vi.fn(),
            onBuy: vi.fn(),
            onViewActivity: vi.fn(),
            onManageToken: vi.fn(),
        }),
    ));
}

describe('TokenDetail quick actions render', () => {
    it('holds Send, Receive, Market view and History in that order as compact buttons', async () => {
        renderDetail();
        await screen.findByRole('button', { name: 'Send' });
        const group = screen.getByRole('group', { name: 'Quick actions' });
        const buttons = within(group).getAllByRole('button');
        expect(buttons.map((b) => b.textContent)).toEqual([
            expect.stringContaining('Send'),
            expect.stringContaining('Receive'),
            expect.stringContaining('Market view'),
            expect.stringContaining('History'),
        ]);
        expect(group.querySelector(`.${listRowStyles.row}`)).toBeNull();
        for (const button of buttons) expect(button).not.toHaveClass(listRowStyles.row);
    });

    it('keeps a blocked Send visible with the reason that blocks it', async () => {
        renderDetail({ quantity: '0' });
        const group = await screen.findByRole('group', { name: 'Quick actions' });
        const send = await within(group).findByRole('button', { name: 'Send' });
        await waitFor(() => expect(send).toBeDisabled());
        expect(within(group).getByText('No balance to send.')).toBeInTheDocument();
    });

    it('shows Manage only for the token owner', async () => {
        renderDetail({ creator: OTHER });
        await screen.findByRole('button', { name: 'Send' });
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Manage' })).toBeNull());
        cleanup();
        __clearTokenInfoCache();

        renderDetail({ creator: MINE });
        const group = await screen.findByRole('group', { name: 'Quick actions' });
        const manage = await within(group).findByRole('button', { name: 'Manage' });
        expect(manage).not.toHaveClass(listRowStyles.row);
    });
});
