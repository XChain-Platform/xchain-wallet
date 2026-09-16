// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The origin badge, driven through the surfaces that render it. A bridged copy
// stored as `BTC.PEPECASH` must read as PEPECASH plus an origin, and a native
// row must gain nothing: both halves are assertions about what a holder
// believes they own.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MyTokens } from '../../../packages/core/src/shared/routes/MyTokens.jsx';
import { BridgeOriginTick } from '../../../packages/core/src/shared/routes/BridgeOriginBadge.jsx';

const DOGE = 'dogecoin-mainnet';
const BTC = 'bitcoin-mainnet';
const WAIT = { timeout: 4000 };

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('BridgeOriginTick', () => {
    it('renders the bare name with an origin badge, and keeps the wire name on hover', () => {
        render(React.createElement(BridgeOriginTick, { tick: 'BTC.PEPECASH', localCoin: 'DOGE' }));
        expect(screen.getByText('from BTC')).toBeInTheDocument();
        expect(screen.getByTitle('PEPECASH is bridged from Bitcoin (BTC.PEPECASH)')).toBeInTheDocument();
        expect(screen.getByText(/PEPECASH/)).toBeInTheDocument();
    });

    it('adds nothing to a native row', () => {
        const { container } = render(
            React.createElement(BridgeOriginTick, { tick: 'PEPECASH', localCoin: 'BTC' }),
        );
        expect(container.textContent).toBe('PEPECASH');
        expect(screen.queryByText(/^from /)).toBeNull();
    });

    it('adds nothing to a subasset of THIS chain\'s own reserved root', () => {
        // `BTC.PEPECASH` viewed ON Bitcoin is an ordinary subasset, not a copy
        // bridged from somewhere. A badge there would be a lie about its origin.
        const { container } = render(
            React.createElement(BridgeOriginTick, { tick: 'BTC.PEPECASH', localCoin: 'BTC' }),
        );
        expect(container.textContent).toBe('BTC.PEPECASH');
    });
});

describe('MyTokens: origin badge on an owned row', () => {
    function mount(rows) {
        const base = {
            getAddressesByChain: vi.fn().mockResolvedValue({
                [DOGE]: [{ id: 'a1', address: 'DAddr' }],
            }),
            getOwnedTokens: vi.fn().mockResolvedValue(rows),
            getSettings: vi.fn().mockResolvedValue({}),
        };
        const messaging = new Proxy(base, {
            get(t, p) {
                if (p in t) return t[p];
                if (typeof p !== 'string') return undefined;
                const stub = vi.fn().mockResolvedValue(null);
                t[p] = stub;
                return stub;
            },
        });
        render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(MyTokens, {
                walletId: 'w', onBack() {}, onIssue() {}, onSelectTick() {},
            }),
        ));
    }

    it('lists a bridged copy by its bare name plus its origin, never the rooted wire name', async () => {
        mount([
            { tick: 'BTC.PEPECASH', locked: false, description: null },
            { tick: 'FUFU', locked: false, description: null },
        ]);
        await waitFor(() => expect(screen.getByText('from BTC')).toBeInTheDocument(), WAIT);
        expect(screen.getByText('PEPECASH')).toBeInTheDocument();
        // The native row beside it is untouched.
        expect(screen.getByText('FUFU')).toBeInTheDocument();
        expect(screen.queryByText('BTC.PEPECASH')).toBeNull();
    });
});

describe('MyTokens: a native row on its own chain', () => {
    it('shows no badge for a subasset of this chain\'s reserved root', async () => {
        const base = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [{ id: 'a1', address: 'bc1q' }] }),
            getOwnedTokens: vi.fn().mockResolvedValue([{ tick: 'BTC.PEPECASH', locked: false, description: null }]),
            getSettings: vi.fn().mockResolvedValue({}),
        };
        const messaging = new Proxy(base, {
            get(t, p) {
                if (p in t) return t[p];
                if (typeof p !== 'string') return undefined;
                const stub = vi.fn().mockResolvedValue(null);
                t[p] = stub;
                return stub;
            },
        });
        render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(MyTokens, {
                walletId: 'w', onBack() {}, onIssue() {}, onSelectTick() {},
            }),
        ));
        await waitFor(() => expect(screen.getByText('BTC.PEPECASH')).toBeInTheDocument(), WAIT);
        expect(screen.queryByText('from BTC')).toBeNull();
    });
});
