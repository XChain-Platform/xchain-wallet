// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The owned-token lookup behind My tokens rejects when the explorer read
// fails. An empty list in its place tells the wallet it owns nothing, and
// My tokens then says "No owned tokens yet" during an outage instead of
// showing its load-failure notice.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { listOwnedTokens } from '../../../packages/core/src/flows/listOwnedTokens.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MyTokens } from '../../../packages/core/src/shared/routes/MyTokens.jsx';

const CHAIN = 'bitcoin-regtest';
const ADDRESS = 'mkHS9ne12qx9pS9VojpwU5xtRd4T7X7ZUt';

afterEach(() => cleanup());

function registryWith(getTokens) {
    const sdk = {
        getTokens,
        getToken: vi.fn().mockResolvedValue(null),
        getBalances: vi.fn().mockResolvedValue({ data: [] }),
        getDispensers: vi.fn().mockResolvedValue([]),
    };
    return { get: () => sdk };
}

describe('listOwnedTokens failure', () => {
    it('rejects when the explorer lookup fails', async () => {
        const sdkRegistry = registryWith(vi.fn().mockRejectedValue(new Error('explorer unreachable')));
        await expect(listOwnedTokens({ sdkRegistry, chainId: CHAIN, address: ADDRESS }))
            .rejects.toThrow('explorer unreachable');
    });

    it('still answers an address that owns nothing with an empty list', async () => {
        const sdkRegistry = registryWith(vi.fn().mockResolvedValue([]));
        await expect(listOwnedTokens({ sdkRegistry, chainId: CHAIN, address: ADDRESS })).resolves.toEqual([]);
    });

    it('leads My tokens to its load-failure notice, not the empty state', async () => {
        const sdkRegistry = registryWith(vi.fn().mockRejectedValue(new Error('explorer unreachable')));
        const target = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ id: 'addr-1', address: ADDRESS }] }),
            getOwnedTokens: (req) => listOwnedTokens({ sdkRegistry, ...req }),
        };
        const messaging = new Proxy(target, {
            get(t, prop) {
                if (prop in t) return t[prop];
                return () => Promise.resolve({ rows: [] });
            },
            has: (t, prop) => prop in t,
        });
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <MyTokens walletId="w" onBack={() => {}} onIssue={() => {}} onSelectTick={() => {}} />
            </MessagingProvider>,
        );

        expect(await screen.findByText('Could not load your owned tokens. Try again.')).toBeTruthy();
        expect(screen.queryByText('No owned tokens yet')).toBeNull();
    });
});
