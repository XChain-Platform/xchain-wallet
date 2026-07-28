// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

//  / D-82: "My Tokens" is scoped to OWNERSHIP (getOwnedTokens ->
// getTokens(address, 'address'), which the explorer filters
// `WHERE m.owner_id = ?`) while every string on the page claimed
// ISSUANCE. One transfer proved both halves false at once: the wallet
// that issued S18PROBE read "You haven't issued any tokens yet", and the
// wallet that received it listed S18PROBE under "Tokens you issued".
//
// These pin the copy to the query. A row that arrived by TRANSFER is the
// case the old wording got backwards, so the list test uses one.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MyTokens } from '../../../packages/core/src/shared/routes/MyTokens.jsx';
import { buildCommands } from '../../../packages/core/src/shared/commandPalette/commandRegistry.js';

const CHAIN = 'bitcoin-regtest';
const ADDRESS = 'mkHS9ne12qx9pS9VojpwU5xtRd4T7X7ZUt';

function mountMyTokens({ tokens }) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{ id: 'addr-1', address: ADDRESS }],
        }),
        getOwnedTokens: vi.fn().mockResolvedValue(tokens),
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({ rows: [] });
        },
        has: (t, prop) => prop in t,
    });
    const { container } = render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(MyTokens, {
                walletId: 'w',
                onBack() {},
                onIssue() {},
                onSelectTick() {},
            }),
        ),
    );
    return container;
}

afterEach(() => cleanup());

describe('My Tokens copy matches its ownership query ( / D-82)', () => {
    it('the empty state talks about owning, not issuing', async () => {
        const container = mountMyTokens({ tokens: [] });

        await waitFor(() => {
            expect(container.textContent).toMatch(/don.t own any tokens yet/i);
        });
        // The wallet that issued a token and then transferred it away lands
        // here; telling it that it never issued anything is simply false.
        expect(container.textContent).not.toMatch(/issued any tokens/i);
    });

    it('a token that arrived by TRANSFER is not labelled as issued', async () => {
        const container = mountMyTokens({
            tokens: [{
                tick: 'S18PROBE',
                description: 'transferred in from another wallet',
                locked: false,
                divisibility: 8,
                totalSupply: '1000',
                maxSupply: null,
                youOwn: true,
            }],
        });

        await waitFor(() => {
            expect(container.textContent).toContain('S18PROBE');
        });
        expect(container.textContent).not.toMatch(/issued/i);
    });

    it('the command-palette entry does not claim issuance scope', () => {
        const commands = buildCommands({ navigate: () => {} });
        const entry = commands.find((c) => c.id === 'nav-my-tokens');

        expect(entry).toBeTruthy();
        expect(entry.subtitle).toBe('Tokens you own');
        // "issued" stays a search keyword: someone hunting for the tokens
        // they created should still land here, the label just stops lying.
        expect(entry.keywords).toContain('issued');
    });
});
