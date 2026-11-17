// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Token detail shows its actions as one action list on the Actions tab (G101):
// Send, Receive and Exchange first, a description under each title, a
// blocked action as a disabled row with its reason. History is a tab and
// Manage token sits in the owner list. The grid CSS checks below stay while
// other pages still draw the shared tile grid.

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

    it('keeps no tile grid or tile reason styles now the actions are a list (G101)', () => {
        expect(blocksFor('.assetActionGrid')).toHaveLength(0);
        expect(blocksFor('.assetActionReasons')).toHaveLength(0);
        expect(blocksFor('.quickActionReason')).toHaveLength(0);
    });

    it('stacks the action list and the owner list 8px apart', () => {
        expect(exactBlocks('.assetActions')[0].body).toMatch(/gap:\s*var\(--xc-space-2\)/);
        expect(exactBlocks('.assetActionOwner')[0].body).toMatch(/gap:\s*var\(--xc-space-2\)/);
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

function renderDetail({ creator = OTHER, quantity = '100', kind = 'token', assetActions = null } = {}) {
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
            assetActions,
            ...handlers,
        }),
    ));
    return handlers;
}

/** The action ids of a list's rows, in page order. */
function rowIds(list) {
    return [...list.querySelectorAll('[data-action-id]')].map((row) => row.getAttribute('data-action-id'));
}

describe('TokenDetail action list render (G101)', () => {
    it('holds Send, Receive and Exchange first, in that order, as action list rows on the Actions tab', async () => {
        renderDetail();
        await screen.findByRole('button', { name: /^Send\b/ });
        // Actions is the first tab and the one selected.
        const tabs = within(screen.getByRole('tablist', { name: 'Coin or token view' })).getAllByRole('tab');
        expect(tabs[0].textContent).toBe('Actions');
        expect(tabs[0].getAttribute('aria-selected')).toBe('true');
        const list = screen.getByRole('list', { name: 'Actions for S18PROBE' });
        expect(list.tagName).toBe('UL');
        expect(rowIds(list).slice(0, 3)).toEqual(['send', 'receive', 'exchange']);
        expect(within(list).queryByRole('button', { name: /^More info/ })).toBeNull();
        expect(within(list).queryByRole('button', { name: /^(Market view|Trade)/ })).toBeNull();
        expect(within(list).queryByRole('button', { name: /^History/ })).toBeNull();
        // Each row is the kit list row with a description line under its title.
        for (const row of within(list).getAllByRole('button')) {
            expect(row).toHaveClass(listRowStyles.row);
            expect(row.querySelector(`.${listRowStyles.subtitle}`)?.textContent).toBeTruthy();
        }
        expect(within(list).getByRole('button', { name: /^Send\b/ }).textContent)
            .toContain('Send S18PROBE to an address or contact');
    });

    it('opens Exchange with the selected asset', async () => {
        const { onBuy } = renderDetail();
        fireEvent.click(await screen.findByRole('button', { name: /^Exchange\b/ }));
        expect(onBuy).toHaveBeenCalledTimes(1);
    });

    it('runs each basic action handler from its row', async () => {
        const { onSend, onReceive } = renderDetail();
        const send = await screen.findByRole('button', { name: /^Send\b/ });
        await waitFor(() => expect(send).not.toHaveAttribute('aria-disabled'));
        fireEvent.click(send);
        fireEvent.click(screen.getByRole('button', { name: /^Receive\b/ }));
        expect(onSend).toHaveBeenCalledTimes(1);
        expect(onReceive).toHaveBeenCalledTimes(1);
    });

    it('retires the More info menu: History is a tab and the other panels are Details rows', async () => {
        renderDetail();
        await screen.findByRole('button', { name: /^Send\b/ });
        expect(screen.queryByRole('button', { name: 'More info' })).toBeNull();
        expect(screen.queryByRole('menu')).toBeNull();
        expect(within(screen.getByRole('tablist', { name: 'Coin or token view' })).getAllByRole('tab').map((tab) => tab.textContent))
            .toEqual(['Actions', 'Details', 'History']);

        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        expect(await screen.findByRole('button', { name: 'Gated content' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Holders' })).toBeTruthy();
    });

    it('keeps a blocked Send as a disabled row that says why', async () => {
        const { onSend } = renderDetail({ quantity: '0' });
        const list = await screen.findByRole('list', { name: 'Actions for S18PROBE' });
        const send = await within(list).findByRole('button', { name: /^Send\b/ });
        await waitFor(() => expect(send).toHaveAttribute('aria-disabled', 'true'));
        const reason = within(send).getByText('No balance to send.');
        expect(send.getAttribute('aria-describedby')).toBe(reason.id);
        fireEvent.click(send);
        expect(onSend).not.toHaveBeenCalled();
    });

    it('lists Manage token when the shell wires it and leaves authorization to the forms', async () => {
        renderDetail({ creator: OTHER });
        const nonOwner = await screen.findByRole('list', { name: 'You issued this token' });
        expect(within(nonOwner).getByRole('button', { name: /^Manage token\b/ })).toBeTruthy();
        cleanup();
        __clearTokenInfoCache();

        const { onManageToken } = renderDetail({ creator: MINE });
        const owner = await screen.findByRole('list', { name: 'You issued this token' });
        const main = screen.getByRole('list', { name: 'Actions for S18PROBE' });
        expect(within(main).queryByRole('button', { name: /^Manage token\b/ })).toBeNull();
        fireEvent.click(within(owner).getByRole('button', { name: /^Manage token\b/ }));
        expect(onManageToken).toHaveBeenCalledTimes(1);
    });

    it('draws a registry Destroy row in the danger tone', async () => {
        const onDestroy = vi.fn();
        renderDetail({ assetActions: { onDestroy } });
        const destroy = await screen.findByRole('button', { name: /^Destroy\b/ });
        expect(destroy.getAttribute('data-tone')).toBe('danger');
        expect(within(screen.getByRole('list', { name: 'Actions for S18PROBE' })).getByRole('button', { name: /^Destroy\b/ })).toBe(destroy);
        fireEvent.click(destroy);
        expect(onDestroy).toHaveBeenCalledTimes(1);
    });

    it('keeps the Send, Receive and Exchange rows for a native coin', async () => {
        renderDetail({ kind: 'native' });
        await screen.findByRole('button', { name: /^Send\b/ });
        expect(rowIds(screen.getByRole('list', { name: 'Actions for BTC' })).slice(0, 3))
            .toEqual(['send', 'receive', 'exchange']);
    });
});
