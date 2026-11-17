// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// G04: a list page's filter panel is Home's: the search box first, then
// Home's network picker, then the page's own pickers. My Tokens lists the
// tokens owned across every network, so its panel carries the network
// picker above the Type dropdown, and the empty state's Create Token
// carries the Plus icon (U63, every button carries an icon).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MyTokens } from '../../../packages/core/src/shared/routes/MyTokens.jsx';

afterEach(() => cleanup());

function mount({ byChain, tokensByChain }) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue(byChain),
        getOwnedTokens: vi.fn(async ({ chainId }) => tokensByChain[chainId] || []),
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({ rows: [] });
        },
        has: (t, prop) => prop in t,
    });
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <MyTokens walletId="w" onBack={() => {}} onIssue={() => {}} onSelectTick={() => {}} />
        </MessagingProvider>,
    );
}

const token = (tick) => ({ tick, description: `${tick} token`, locked: false, divisibility: 8, totalSupply: '1', maxSupply: null, youOwn: true });

describe('My Tokens filter panel', () => {
    it('puts the network picker between the search box and the Type dropdown', async () => {
        mount({
            byChain: {
                'bitcoin-regtest': [{ id: 'a', address: 'mkHS9ne12qx9pS9VojpwU5xtRd4T7X7ZUt' }],
                'dogecoin-regtest': [{ id: 'b', address: 'nZ5nVbFJt4ZWv6xEw6y1pY3YgTRqsQx3wD' }],
            },
            tokensByChain: { 'bitcoin-regtest': [token('BTCTOKEN')], 'dogecoin-regtest': [token('DOGETOKEN')] },
        });
        await screen.findByRole('button', { name: 'Open BTCTOKEN token details' });
        fireEvent.click(screen.getByRole('button', { name: 'Filter tokens' }));
        const panel = screen.getByRole('dialog', { name: 'Filter tokens' });
        const search = within(panel).getByRole('searchbox', { name: 'Search your tokens by ticker or description' });
        const network = within(panel).getByLabelText('Filter by network');
        // The Type dropdown rests on All tokens.
        const type = within(panel).getByText('All tokens');
        expect(search.compareDocumentPosition(network) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(network.compareDocumentPosition(type) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('gives the empty state Create Token its Plus icon', async () => {
        mount({ byChain: { 'bitcoin-regtest': [{ id: 'a', address: 'mkHS9ne12qx9pS9VojpwU5xtRd4T7X7ZUt' }] }, tokensByChain: {} });
        await screen.findByText('No owned tokens yet');
        const create = screen.getAllByRole('button', { name: /Create Token/ }).find((button) => button.textContent.includes('Create Token'));
        expect(create.querySelector('svg')).toBeTruthy();
    });
});
