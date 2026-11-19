// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every token choice in the wallet opens the one TokenPicker. A form whose
// eligible tokens are not the wallet's balances (a contract's holdings on
// Withdraw, the tokens this wallet owns on Bind, Unbind and gated publishing)
// passes them as `rows`: the picker lists exactly those under its own title,
// with the given amount as each row's balance or, without one, the wallet's.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenPicker } from '../../../packages/core/src/shared/routes/TokenPicker.jsx';

const CHAIN = 'bitcoin-regtest';
const WALLET_BALANCES = {
    [CHAIN]: [{
        address: 'bcrt1qholder',
        balances: {
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [
                { tick: 'HELD', quantity: '25', divisibility: 0 },
                { tick: 'OTHER', quantity: '9', divisibility: 0 },
            ],
        },
    }],
};

function mountPicker(props = {}) {
    const messaging = {
        getSettings: vi.fn().mockResolvedValue({}),
        getWalletBalances: vi.fn().mockResolvedValue(WALLET_BALANCES),
    };
    const onSelect = vi.fn();
    const view = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TokenPicker
                purpose="send"
                walletId="wallet-1"
                kindFilter="tokens"
                kindLocked
                onBack={() => {}}
                onSelect={onSelect}
                {...props}
            />
        </MessagingProvider>,
    );
    return { messaging, onSelect, ...view };
}

const option = (tick) => (name) => name.startsWith(`Select ${tick} on Bitcoin,`);
const options = () => screen.queryAllByRole('button', { name: (name) => name.startsWith('Select ') });

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('<TokenPicker rows>', () => {
    it('lists only the given rows under its own title, with each given amount as the balance', async () => {
        const { messaging, onSelect } = mountPicker({
            rows: [
                { chainId: CHAIN, tick: 'HELD', quantity: '1234.5' },
                { chainId: CHAIN, tick: 'ZERO', quantity: '0' },
            ],
        });

        expect(screen.getByRole('heading', { name: 'Select Token' })).toBeInTheDocument();
        const held = await screen.findByRole('button', { name: option('HELD') });
        expect(held).toHaveAccessibleName(/1,234\.5 HELD/);
        // A zero row stays: the list is the eligible set, not what is spendable.
        expect(screen.getByRole('button', { name: option('ZERO') })).toBeInTheDocument();
        expect(options()).toHaveLength(2);
        // Every row carried its own amount, so the wallet was never read.
        expect(messaging.getWalletBalances).not.toHaveBeenCalled();

        fireEvent.click(held);
        expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ chainId: CHAIN, tick: 'HELD' }));
    });

    it('shows the wallet balance for a row with no amount of its own', async () => {
        mountPicker({ rows: [{ chainId: CHAIN, tick: 'HELD' }, { chainId: CHAIN, tick: 'NONE' }] });

        expect(await screen.findByRole('button', { name: option('HELD') })).toHaveAccessibleName(/, 25 HELD/);
        expect(screen.getByRole('button', { name: option('NONE') })).toHaveAccessibleName(/, 0 NONE/);
        expect(screen.queryByRole('button', { name: option('OTHER') })).toBeNull();
        expect(options()).toHaveLength(2);
    });

    it('marks an unreadable amount unavailable instead of printing a number', async () => {
        mountPicker({ rows: [{ chainId: CHAIN, tick: 'ODD', quantity: '?' }] });

        expect(await screen.findByRole('button', { name: option('ODD') })).toHaveAccessibleName(/Balance unavailable/);
    });

    it('loads while the caller has no rows yet, then says the caller\'s empty text', async () => {
        const { rerender } = mountPicker({ rows: null });
        expect(screen.getByRole('status', { name: 'Loading balances' })).toBeInTheDocument();

        rerender(
            <MessagingProvider shell="web" messaging={{ getSettings: vi.fn().mockResolvedValue({}) }}>
                <TokenPicker
                    purpose="send"
                    walletId="wallet-1"
                    kindFilter="tokens"
                    kindLocked
                    rows={[]}
                    // The forms pin the network; an empty list still says the caller's words.
                    networkFilter="bitcoin"
                    emptyTitle="No contract tokens"
                    emptyBody="Tokens held by this contract appear here."
                    onBack={() => {}}
                    onSelect={() => {}}
                />
            </MessagingProvider>,
        );
        expect(await screen.findByText('No contract tokens')).toBeInTheDocument();
        expect(screen.getByText('Tokens held by this contract appear here.')).toBeInTheDocument();
        expect(screen.queryByText(/No balances on this network/)).toBeNull();
        // No filter can bring a row back, so none is offered to reset.
        expect(screen.queryByRole('button', { name: 'Reset Filters' })).toBeNull();
        expect(screen.queryByRole('status', { name: 'Loading balances' })).toBeNull();
    });

    it('leaves the wallet picker as it was when no rows are given', async () => {
        const { messaging } = mountPicker({ title: 'Asset', kindFilter: 'all', kindLocked: false });

        expect(screen.getByRole('heading', { name: 'Asset' })).toBeInTheDocument();
        await screen.findByRole('button', { name: option('HELD') });
        expect(screen.getByRole('button', { name: option('OTHER') })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: (name) => /^Select (BTC|Bitcoin)\b/.test(name) })).toBeInTheDocument();
        expect(messaging.getWalletBalances).toHaveBeenCalled();
    });
});
