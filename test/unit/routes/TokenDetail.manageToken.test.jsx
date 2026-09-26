// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A user who issued a token had no way from the holder
// view (TokenDetail) into the issuer surface (ManageToken); the only
// path was Menu -> My Tokens. The "Manage token" entry in the quick-
// actions "More" menu is gated on the same all-addresses ownership
// check ManageToken itself uses (useIsTokenIssuer.js), never on the
// active address alone.

import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
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

function renderDetail({ creator, onManageToken = vi.fn() } = {}) {
    const messaging = {
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
            kind: 'token',
            quantity: '100',
            onBack() {},
            onManageToken,
        }),
    ));
    return { messaging, onManageToken };
}

describe('TokenDetail "Manage token" action', () => {
    it('renders and navigates for the issuing wallet', async () => {
        const { onManageToken } = renderDetail({ creator: MINE });

        // The gate starts at null (owner-gate fetch in flight), so the
        // "More" button stays disabled until it resolves true.
        const moreButton = screen.getByRole('button', { name: 'More' });
        await waitFor(() => expect(moreButton).not.toBeDisabled());
        fireEvent.click(moreButton);
        const entry = await screen.findByRole('menuitem', { name: 'Manage token' });
        fireEvent.click(entry);

        expect(onManageToken).toHaveBeenCalledTimes(1);
    });

    it('does not render for a wallet that only holds (never issued) the tick', async () => {
        const { messaging } = renderDetail({ creator: OTHER });

        // Let the owner-gate fetch settle (isOwner: null -> false) before
        // asserting absence; with no other "More" entries wired in this
        // test, the button itself stays disabled rather than opening an
        // empty menu, so the absence check does not depend on a click.
        await waitFor(() => expect(messaging.getAddressesByChain).toHaveBeenCalled());
        expect(screen.queryByText('Manage token')).toBeNull();
        expect(screen.getByRole('button', { name: 'More' })).toBeDisabled();
    });
});
