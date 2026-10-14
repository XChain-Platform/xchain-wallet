// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Send and Swap token pickers must not say "Nothing to send yet" while
// balances could not be checked; they say that once, with a retry.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const reachability = vi.hoisted(() => ({ overall: 'normal', refresh: null }));

vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({
    useReachability: () => ({
        overall: reachability.overall,
        loading: false,
        perChain: [],
        lastChecked: null,
        refresh: reachability.refresh,
        error: null,
    }),
}));

const { MessagingProvider } = await import('../../../packages/core/src/shared/MessagingProvider.jsx');
const { TokenPicker } = await import('../../../packages/core/src/shared/routes/TokenPicker.jsx');

const emptyBalances = {
    'bitcoin-mainnet': [{
        address: 'bc1qpicker',
        balances: { native: { tick: 'BTC', quantity: '0', divisibility: 8 }, tokens: [] },
    }],
};

function mount() {
    const messaging = {
        getSettings: vi.fn().mockResolvedValue({}),
        updateSettings: vi.fn().mockResolvedValue({}),
        getWalletBalances: vi.fn().mockResolvedValue(emptyBalances),
        getAddressesByChain: vi.fn().mockResolvedValue({ 'bitcoin-mainnet': [{ address: 'bc1qpicker' }] }),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TokenPicker purpose="send" walletId="wallet-1" onSelect={() => {}} onBack={() => {}} />
        </MessagingProvider>,
    );
    return messaging;
}

beforeEach(() => {
    reachability.overall = 'normal';
    reachability.refresh = vi.fn();
});

afterEach(() => cleanup());

describe('TokenPicker empty list and the balance check', () => {
    it('says "Nothing to send yet" when the empty read is trustworthy', async () => {
        mount();
        expect(await screen.findByText('Nothing to send yet')).toBeInTheDocument();
        expect(screen.queryByText('Balances could not be checked')).toBeNull();
    });

    it('says balances could not be checked instead, and Try again reloads them', async () => {
        reachability.overall = 'degraded';
        const messaging = mount();
        expect(await screen.findByText('Balances could not be checked')).toBeInTheDocument();
        expect(screen.queryByText('Nothing to send yet')).toBeNull();

        const loadsBefore = messaging.getWalletBalances.mock.calls.length;
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(reachability.refresh).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(messaging.getWalletBalances.mock.calls.length).toBeGreaterThan(loadsBefore));
    });
});
