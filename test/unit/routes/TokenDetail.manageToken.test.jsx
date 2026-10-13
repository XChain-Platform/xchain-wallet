// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// TokenDetail gates its direct Manage action on the same all-addresses
// ownership check ManageToken itself uses, never on the active address alone.

import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

// Both cases share a (chainId, tick) pair with different creators, and
// useTokenInfo caches by that pair across the whole module, so a stale
// hit from case 1 would otherwise leak into case 2's assertions.
afterEach(() => { cleanup(); __clearTokenInfoCache(); });

// jsdom has no ResizeObserver; TokenDetail's balance hero uses one to
// auto-shrink the amount text. Same stub as test/unit/routes-render.test.jsx.
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

const CHAIN = 'bitcoin-regtest';
const MINE = 'bcrt1qmineminemineminemineminemineminemine0';
const OTHER = 'bcrt1qotherotherotherotherotherotherotherot';

function renderDetail({ creator, kind = 'token', onManageToken = vi.fn(), withPrimaryActions = false } = {}) {
    const messaging = {
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getTokenInfo: vi.fn().mockResolvedValue({ creator }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: MINE }] }),
        getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
        listGatedContent: vi.fn().mockResolvedValue([]),
    };
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(TokenDetail, {
            walletId: 'w1',
            chainId: CHAIN,
            tick: 'S18PROBE',
            kind,
            quantity: '100',
            onBack() {},
            onSend: withPrimaryActions ? vi.fn() : undefined,
            onReceive: withPrimaryActions ? vi.fn() : undefined,
            onBuy: withPrimaryActions ? vi.fn() : undefined,
            onManageToken,
        }),
    ));
    return { messaging, onManageToken };
}

describe('TokenDetail "Manage token" action', () => {
    it('keeps the balance label and amount ahead of the hero actions in DOM reading order', () => {
        renderDetail({ creator: OTHER });

        const hero = screen.getByRole('region', { name: 'S18PROBE balance' });
        const label = within(hero).getByText('Total balance');
        const amountUnit = within(hero).getByText('S18PROBE');
        const action = within(hero).getByRole('button', { name: 'Hide balance' });

        expect(label.compareDocumentPosition(amountUnit) & Node.DOCUMENT_POSITION_FOLLOWING)
            .toBeTruthy();
        expect(amountUnit.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING)
            .toBeTruthy();
    });

    it('renders and navigates for the issuing wallet', async () => {
        const { onManageToken } = renderDetail({ creator: MINE, withPrimaryActions: true });

        const manage = await screen.findByRole('button', { name: 'Manage' });
        const actions = within(screen.getByRole('group', { name: 'Quick actions' }))
            .getAllByRole('button');
        expect(actions.map((button) => button.getAttribute('aria-label') || button.textContent)).toEqual([
            'Send',
            'Receive',
            'Trade',
            'Manage',
        ]);
        fireEvent.click(manage);

        expect(onManageToken).toHaveBeenCalledTimes(1);
    });

    it('does not render for a wallet that only holds (never issued) the tick', async () => {
        const { messaging } = renderDetail({ creator: OTHER });

        await waitFor(() => expect(messaging.getAddressesByChain).toHaveBeenCalled());
        expect(screen.queryByRole('button', { name: 'Manage' })).toBeNull();
    });

    it('does not render Manage for a native coin', () => {
        renderDetail({ creator: MINE, kind: 'native' });

        expect(screen.queryByRole('button', { name: 'Manage' })).toBeNull();
    });
});
