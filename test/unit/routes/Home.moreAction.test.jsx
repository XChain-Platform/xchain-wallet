// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Home's overflow quick action: a menu holding one entry is a wasted tap,
// so a lone action renders as its own button and "More" appears only once
// a second entry exists.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';

const WALLET = { id: 'wallet-a', name: 'Main Wallet' };

function makeMessaging() {
    return {
        listWallets: vi.fn().mockResolvedValue([WALLET]),
        listAccounts: vi.fn().mockResolvedValue([]),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({}),
        getAddressesByChain: vi.fn().mockResolvedValue({}),
    };
}

function mount(props) {
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging: makeMessaging() },
            React.createElement(Home, { activeWalletId: WALLET.id, ...props }),
        ),
    );
}

afterEach(() => cleanup());

describe('Home overflow quick action', () => {
    it('opens Swap directly instead of a one-item More menu', async () => {
        const onSwap = vi.fn();
        mount({ onSwap });

        const swap = await screen.findByRole('button', { name: 'Swap' });
        expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
        fireEvent.click(swap);
        expect(onSwap).toHaveBeenCalledTimes(1);
    });
});
