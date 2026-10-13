// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: Home balance failure states.
//
//   [P0] 2026-10-13: A failed first balance load can look like a freshly
//        synchronized empty wallet, while a failed refresh can hide saved data.

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../packages/core/src/shared/components/ToastHost.jsx';
import { Home } from '../../packages/core/src/shared/routes/Home.jsx';
import { writeBalanceCache } from '../../packages/core/src/shared/utils/balanceCache.js';

const WALLET = { id: 'balance-failure-wallet', name: 'Balance failure wallet' };
const CHAIN = 'litecoin-regtest';
const ADDRESS = 'rltc1qbalancefailure';

const cachedBalances = {
    [CHAIN]: [{
        address: ADDRESS,
        balances: {
            native: { tick: 'LTC', quantity: '100000000', divisibility: 8 },
            tokens: [],
        },
        error: null,
        errorCode: null,
        retryAfterSeconds: null,
    }],
};

function failingMessaging() {
    return {
        listWallets: vi.fn().mockResolvedValue([WALLET]),
        listAccounts: vi.fn().mockResolvedValue([]),
        getWalletBalances: vi.fn().mockRejectedValue(new Error('fetch failed')),
        getAddressesByChain: vi.fn().mockResolvedValue({}),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({}),
    };
}

function mountHome(messaging) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ToastHost>
                <Home activeWalletId={WALLET.id} />
            </ToastHost>
        </MessagingProvider>,
    );
}

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    cleanup();
    localStorage.clear();
});

describe('regression/home-balance-failure', () => {
    it('[REGRESSION P0] keeps an uncached failure distinct from a fresh empty wallet', async () => {
        mountHome(failingMessaging());

        expect(await screen.findByText(/Couldn't load balances/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
        expect(document.body).not.toHaveTextContent('$0.00');
        expect(document.body).not.toHaveTextContent('Fund your wallet');
        expect(document.body).not.toHaveTextContent(/Updated /);
    });

    it('[REGRESSION P0] preserves cached balances and marks them stale after failure', async () => {
        writeBalanceCache(WALLET.id, null, {
            balances: cachedBalances,
            activeByChain: {},
            fetchedAt: Date.now() - 10 * 60_000,
        });

        mountHome(failingMessaging());

        expect(await screen.findByText(/Showing saved balances from the last successful sync/))
            .toBeInTheDocument();
        expect(screen.getByText('Litecoin')).toBeInTheDocument();
        expect(screen.getByLabelText('1.00000000 LTC')).toBeInTheDocument();
        const syncLabel = screen.getByText(/Updated 10 min ago/);
        expect(syncLabel.className).toMatch(/stale/i);
        expect(document.body).not.toHaveTextContent('Fund your wallet');
    });
});
