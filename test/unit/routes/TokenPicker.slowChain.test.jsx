// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenPicker } from '../../../packages/core/src/shared/routes/TokenPicker.jsx';
import { CHAIN_BALANCE_WAIT_MS } from '../../../packages/core/src/shared/utils/chainBalanceLoader.js';

const BTC = 'bitcoin-mainnet';
const LTC = 'litecoin-mainnet';

const ENTRIES = {
    [BTC]: [{
        address: 'bc1qpicker',
        balances: { native: { tick: 'BTC', quantity: '1000', divisibility: 8 }, tokens: [] },
    }],
    [LTC]: [{
        address: 'ltc1qpicker',
        balances: { native: { tick: 'LTC', quantity: '2000', divisibility: 8 }, tokens: [] },
    }],
};

// The litecoin explorer accepts the connection and never answers; bitcoin is healthy.
function makeMessaging() {
    let releaseLtc;
    const messaging = {
        getSettings: vi.fn().mockResolvedValue({}),
        updateSettings: vi.fn().mockResolvedValue({}),
        getAddressesByChain: vi.fn().mockResolvedValue({
            [BTC]: [{ address: 'bc1qpicker' }],
            [LTC]: [{ address: 'ltc1qpicker' }],
        }),
        getWalletBalances: vi.fn((walletId, accountId, chainId) => {
            if (chainId === BTC) return Promise.resolve({ [BTC]: ENTRIES[BTC] });
            return new Promise((resolve) => { releaseLtc = () => resolve({ [LTC]: ENTRIES[LTC] }); });
        }),
    };
    return { messaging, release: () => releaseLtc() };
}

function mount(messaging) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TokenPicker purpose="send" walletId="wallet-1" onSelect={() => {}} onBack={() => {}} />
        </MessagingProvider>,
    );
}

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('TokenPicker with one chain that never answers', () => {
    it('lists the healthy chain at once instead of showing skeletons', async () => {
        const { messaging } = makeMessaging();
        mount(messaging);
        expect(await screen.findByText('Bitcoin')).toBeTruthy();
        expect(screen.queryByLabelText('Loading balances')).toBeNull();
    });

    it('adds one note for the slow chain after the bounded wait and lists it when it answers', async () => {
        const { messaging, release } = makeMessaging();
        mount(messaging);
        await screen.findByText('Bitcoin');
        expect(screen.queryByText(/is not responding/)).toBeNull();

        await act(async () => { await vi.advanceTimersByTimeAsync(CHAIN_BALANCE_WAIT_MS + 100); });
        expect(screen.getAllByText(/Litecoin is not responding/)).toHaveLength(1);

        await act(async () => { release(); });
        expect(await screen.findByText('Litecoin')).toBeTruthy();
        expect(screen.queryByText(/is not responding/)).toBeNull();
    });
});
