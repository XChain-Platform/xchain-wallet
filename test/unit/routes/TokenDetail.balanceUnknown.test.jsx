// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A token opened without a balance reads it from the wallet. While that read
// is pending or has failed the screen says the amount is unknown; it never
// shows zero or claims there is nothing to send.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-regtest';

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
afterEach(() => { cleanup(); __clearTokenInfoCache(); });

function renderDetail(getWalletBalances) {
    const messaging = {
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getTokenInfo: vi.fn().mockResolvedValue({ creator: 'bcrt1qx', divisibility: 0 }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
        getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
        listGatedContent: vi.fn().mockResolvedValue([]),
        getSupplyHistory: vi.fn().mockResolvedValue([]),
        getWalletBalances,
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TokenDetail walletId="w1" chainId={CHAIN} tick="UNKNOWNBAL" kind="token" onBack={() => {}} onSend={() => {}} />
        </MessagingProvider>,
    );
}

describe('TokenDetail balance that is not known', () => {
    it('says the balance is unavailable after a failed read, not that there is none', async () => {
        renderDetail(vi.fn().mockRejectedValue(new Error('offline')));
        expect(await screen.findByText('Balance is unavailable.')).toBeTruthy();
        expect(screen.queryByText('No balance to send.')).toBeNull();
        expect(screen.getByRole('region', { name: /balance/i }).textContent).not.toMatch(/(^|\D)0(\D|$)/);
    });

    it('says the balance is loading while the read is pending', async () => {
        renderDetail(vi.fn(() => new Promise(() => {})));
        expect(await screen.findByText('Loading balance…')).toBeTruthy();
        expect(screen.queryByText('No balance to send.')).toBeNull();
    });

    it('still reports an empty wallet as no balance once the read answers', async () => {
        renderDetail(vi.fn().mockResolvedValue({}));
        await waitFor(() => expect(screen.getByText('No balance to send.')).toBeTruthy());
    });
});
